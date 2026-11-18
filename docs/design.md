# hikebot design

hikebot is a Discord bot for a local hiking group. Members vote on a hike
location, then on a date; admins run the votes from a panel; results are
announced and a forum thread is created for the hike. It receives Discord
interactions over HTTP only: no gateway, no WebSocket.

This document is the design: what the bot does and why, its data model and
its architecture. It does not record which parts are built; the code shows
that, and progress is tracked on the task board.

## Runtime

One Cloudflare Worker, `hiking`, served at `https://hiking.bitcru.sh` (a
Custom Domain on the `bitcru.sh` zone; workers.dev is off), so Discord's
Interactions Endpoint URL is `https://hiking.bitcru.sh/interactions`.
Secrets: `DISCORD_PUBLIC_KEY`,
`DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, declared under
`secrets.required` in `wrangler.jsonc` (which also types them in `Env`). The
var `DISCORD_API_BASE` (default `https://discord.com/api/v10`) is where REST
calls go; tests point it at a fake Discord API. One
`GuildHike` Durable Object per Discord guild (binding `GUILD_HIKE`,
`idFromName(guild_id)`) holds all of that guild's state in its SQLite storage
and makes every state change, so votes and poll closes never race.
`wrangler deploy` creates everything the bot needs, including the Custom
Domain's DNS record; there is no other infrastructure.

Production is deployed by the `Deploy` workflow
(`.github/workflows/deploy.yml`): after the `Undercurrent` workflow succeeds
on a push to `main`, it deploys exactly that commit if it is still the tip of
`main`, setting the three secrets from GitHub Actions secrets with
`wrangler deploy --secrets-file`, then runs `npm run register --if-present`
and checks that `GET /` answers with the health line.

## Request flow

The Worker (`src/index.ts`) routes:

- `GET /` (or `HEAD`): a plain-text health line, `hikebot is running`.
- `POST /interactions`: the Discord interactions endpoint, below. Any other
  method gets 405 with `Allow: POST`.
- Anything else: 404.

For `POST /interactions` the Worker:

1. Reads the raw body and verifies `X-Signature-Ed25519` (hex) over
   `X-Signature-Timestamp` + body with WebCrypto Ed25519 against
   `DISCORD_PUBLIC_KEY` (hex). A missing header, malformed hex, wrong length
   or bad signature is a 401, and nothing reaches a Durable Object.
2. Parses the body as JSON (400 if it is not).
3. Answers `PING` (type 1) with `{"type":1}`.
4. Answers any interaction without `guild_id` (DMs, user installs) with an
   ephemeral Components V2 message saying the bot only works in servers.
5. Otherwise calls `handleInteraction(interaction)` over RPC on the guild's
   `GuildHike` and returns its `response` as JSON. If the outcome has
   `followUp: true`, it also calls
   `ctx.waitUntil(stub.runFollowUp(interaction.id))`.

The main module may export only the default handler and classes (workerd
refuses to start otherwise); shared constants live in other modules. A test
enforces this.

## GuildHike and the handler registry

`GuildHike` (`src/guild/guild-hike.ts`, `extends DurableObject` from
`cloudflare:workers`) stays thin. Its constructor applies migrations inside
`blockConcurrencyWhile` and builds a `Router` (`src/guild/router.ts`) through
`registerFeatures` (`src/features/index.ts`).

A handler takes the interaction and a `HandlerContext` (`env`, the object's
`storage`) and returns a `HandlerResult`: the immediate `response`, plus an
optional `followUp` job. Handlers are registered:

- commands by name: `router.command("hike", handler)`;
- message components by `custom_id` prefix: `router.component("hb:poll:vote", handler)`;
- modal submits by `custom_id` prefix: `router.modal("hb:location:propose", handler)`.

Prefixes are `hb:<feature>` or `hb:<feature>:<action>` and match on `:`
boundaries, longest first: `hb:poll:vote` receives `hb:poll:vote:12` but not
`hb:poll:voter`. Registering the same name or prefix twice throws. A feature
keeps its handlers in its own file under `src/features/` and adds one line to
`registerFeatures`.

An unknown command or `custom_id` (for example a button on an old message)
gets an ephemeral Components V2 reply: "This action is no longer available."

Scheduled jobs are registered the same way, by name:
`router.job("poll:refresh", handler)`. A job name is `<feature>:<action>`.
`GuildHike.alarm()` hands the object's Durable Object alarm to `runAlarm`
(`src/features/index.ts`), which runs the jobs that are due, as "Deferred
work" describes.

## Deferred work

Discord needs a response within 3 seconds, and some actions make several
REST calls. A handler that needs more time returns its immediate
response (often a deferred one) and a `followUp` function. `GuildHike` keeps
the function in memory keyed by interaction id and returns
`{ response, followUp: true }`. The Worker sends the response and calls
`runFollowUp(interaction.id)` inside its own `ctx.waitUntil`, which keeps the
RPC call, and so the Durable Object, alive until the job finishes (Cloudflare
lets a pending call run for up to 15 minutes). `runFollowUp` runs each job
once and returns false if there is no job, for example because the object was
evicted in between, so follow-ups must tolerate being lost: anything that must
survive belongs in storage, written before the response is returned.

Work due at a later time is a scheduled job (`src/guild/schedule.ts`). A
Durable Object has a single alarm, which the scheduler shares among named
jobs. `schedule(storage, job, dueAt)` stores a `job:<name>` key holding when
the job is due; scheduling a job that is already scheduled keeps the earlier
of the two times, and the object's alarm is moved earlier whenever a job is
due before it. Because the schedule lives in storage, it survives a restart
of the object.

The alarm's body, `runDueJobs`, runs every job due by the store's clock, and
at least the earliest ones, which the alarm was set for. It removes each
due job's key before running its handler, so a job runs at most once per
alarm, and a job scheduled while the alarm runs (by a job, including itself,
or by a concurrent request) stays scheduled. When the jobs have run it sets
the alarm for the earliest job still scheduled. A job that throws is logged
with its name and the other due jobs still run; a due job no handler is
registered for is logged and dropped. The alarm handler does not throw for
either, so the platform's automatic alarm retry never runs a job that
succeeded a second time. A job that wants another go schedules itself again.

## Talking to Discord

Handlers and follow-ups call Discord's REST API only through `DiscordApi`
(`src/discord/api.ts`, built with `discordApi(env)`): a thin typed wrapper
over `fetch` with no Discord SDK.

- Bot routes (messages, forum threads, guilds, global commands) send
  `Authorization: Bot <DISCORD_BOT_TOKEN>`. Interaction webhook routes
  (edit original response, follow-up) are authorised by the interaction
  token in the path and send no `Authorization` header.
- Every message body gets `allowed_mentions: { parse: [] }` unless the
  caller set `allowed_mentions`.
- A non-2xx response throws `DiscordApiError` with the HTTP status,
  Discord's error `code` and `message` (from its JSON error body, or the
  response text when there is none), the method and the route. Routes in
  errors show `:token` in place of interaction tokens, so errors can be
  logged and shown to admins.
- A 429 is retried after its `retry_after` (or `Retry-After`), at most 3
  times and 5 seconds of waiting in total; past that the 429 is thrown as a
  `DiscordApiError`.

Payloads are built with the pure functions in `src/discord/components.ts`:
component builders, interaction responses (`reply`, `ephemeralReply`,
`update`, `deferredReply`, `deferredUpdate`, `modal`) and `messageBody` for
REST calls and webhook edits. Message responses and bodies carry
`IS_COMPONENTS_V2` (plus `64` when ephemeral) and no `content` or `embeds`.
A deferred reply carries only the ephemeral flag, because Discord accepts no
other flag there; the edit that replaces it is a `messageBody`, which sets
`IS_COMPONENTS_V2`. `customId` builds `hb:<feature>:<action>[:<arg>]` ids
(throwing past Discord's 100 characters) and `parseCustomId` reads them back.
`textInputValue` and `selectValues` read a modal submit by `custom_id`,
inside Label or action row wrappers.

## Storage

`src/guild/schema.ts` holds an ordered list of migrations (`name`, `sql`). The
constructor applies, in list order, every migration whose name is not yet in
the `_migrations` table, each in its own transaction together with its
record. Migrations are never renamed, reordered or edited once shipped; new
ones are appended. `0001_polls` creates the poll tables described under
"Polls". `0002_guild_settings` creates `guild_settings`, described under
"Guild settings".

## Conventions

- Every message the bot sends or edits uses Components V2: `flags` includes
  `32768` (`IS_COMPONENTS_V2`), no `content`, no `embeds`. Ephemeral replies
  add `64`. Modals use Label components (type 18), not action rows.
- `custom_id` scheme: `hb:<feature>:<action>[:<arg>]`, for example
  `hb:poll:vote:12`.
- Bot messages never ping anyone: `allowed_mentions: { parse: [] }`.
- Respond within 3 seconds. An action needing more than one Discord REST call
  responds first (deferred or immediate) and finishes in a follow-up job.
- Types come from `discord-api-types` (import from `discord-api-types/v10`).
  No discord.js or other Discord client library.
- Randomness and time are injected where behaviour depends on them, so tests
  are deterministic.
- Tests come in two layers, described under "Testing".

## Testing

`npm test` runs two Vitest projects; both must pass.

- **Unit** (`test/`, except `test/e2e/`): tests run inside the Workers
  runtime through `@cloudflare/vitest-plugin`, with real Durable Object
  SQLite storage. They import modules from `src/` and test them directly:
  poll rules, the router, the REST client with a stubbed `fetch`, the
  builders.
- **End to end** (`test/e2e/`, `npm run test:e2e`): tests run in Node. Each
  test file starts the Worker from `wrangler.jsonc` in local workerd with
  Wrangler's `createTestHarness`, with fresh in-memory Durable Object
  storage, a signing key pair generated for the file as
  `DISCORD_PUBLIC_KEY`, a dummy bot token and application id, and
  `DISCORD_API_BASE` pointing at a fake Discord API on a free local port.
  Tests reach the Worker only as Discord does, with signed
  `POST /interactions` requests, and import nothing from `src/` (ESLint
  enforces this). The suite needs no network beyond localhost, no
  credentials and no writable home directory; it stops workerd and the fake
  after each file, also when a test fails or times out.

The e2e harness (`test/e2e/harness/`) has four parts:

- An interaction client that builds realistic slash command, button,
  string/role/channel select and modal submit (fields inside Labels)
  payloads, signs them and sends them. It fails the test when the Worker
  takes more than 3 seconds, answers with anything but 200 and JSON, or
  answers with a response Discord would refuse for that interaction: a
  callback type the interaction does not accept (a modal in reply to a modal
  submit, an update to a modal not opened from a message), flags a message
  or deferred response cannot set, or data that breaks the rules below.
- A fake Discord API on `node:http` with the routes the bot uses: create and
  edit message, start forum thread, get guild, edit original interaction
  response, create follow-up and bulk overwrite global commands. As on
  Discord, after an interaction is answered with an update or a deferred
  update, its original response is the message its component (or the modal's
  button) was on. It keeps
  guilds (with owner), channels (with type), threads, messages and
  interaction replies in memory, so tests assert on what the channel shows.
  Tests can make a channel fail as Discord does (403/50013 missing
  permissions, 403/50001 missing access, 404/10003 unknown channel) and
  answer one request with a 429 and `retry_after`.
- Discord's rules, which the fake enforces on every message, edit, thread
  and command it receives and the client on every interaction response,
  answering a 400 that names the rule and links the docs page stating it:
  bot routes need `Authorization: Bot <token>` (401 otherwise); a Components
  V2 message has no `content` or `embeds` and keeps its flag; at most 40
  components and 4000 characters of Text Display text per message; action
  rows hold up to 5 buttons or one select; selects have 1-25 options and
  `min_values` 0-25, `max_values` 1-25 within the option count; option
  label, value and description up to 100 characters; button labels up to
  80; `custom_id` 1-100 characters and unique within a message; modal titles
  and Label text up to 45, 1-5 modal components; text input limits; thread
  names 1-100 characters and forum threads only in forum or media channels;
  command names and descriptions. A request the fake refuses fails the test
  that caused it.
- Helpers that read a message's text, find a component by `custom_id` in a
  nested Components V2 tree, act as a member who clicks, selects and submits
  only controls on messages the fake stores (or in the modal the Worker
  returned), and wait for background work by polling the fake with a
  timeout. `RoundPlayer` (`test/e2e/harness/rounds.ts`) plays the steps of a
  round with them: a guild with its channels, the panel set up, starting,
  voting in, closing and cancelling the location and date votes.

Harness self-tests check every rule of the fake against a payload at the
limit and one past it, and the client against a stand-in server. Those that
need the bot to call Discord before a feature does run a probe Worker
(`test/e2e/probe/worker.ts`, never deployed): the real Worker and the real
`GuildHike` with one extra `/e2e-probe` command on its router, whose
follow-ups call the fake through the real `DiscordApi`. They show that each
guild's state stays in its own object, that the REST client retries a 429
and surfaces 403 and 404 failures as `DiscordApiError`, and that the
signature check, guild routing and follow-up path work in workerd.

## Commands

One global slash command, `/hike`, with two subcommands: `admin` ("Open the
hikebot admin panel", admins only; see "Admin panel") and `log` ("Show the
group's hikes", every member; see "Hike log"). `src/discord/commands.ts`
defines it: guild-only
(`contexts: [0]`, `integration_types: [0]`) and without
`default_member_permissions`, so every member sees it and the bot enforces
who may use it. `npm run register` (`scripts/register-commands.ts`, logic in
`scripts/register.ts`) sends these definitions to Discord's bulk overwrite of
the application's global commands through `DiscordApi`, so a run replaces
the whole set and repeating it changes nothing. It reads
`DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN`, prints what Discord
registered, never prints the token, and exits non-zero on a missing variable
or a failed request. The `Deploy` workflow runs it after every deploy.

`/hike` is routed to `hikeCommand` (`src/features/hike.ts`), which hands the
interaction to the handler of its subcommand; an unknown or missing
subcommand gets the "no longer available" notice.

## Admin permission

`checkAdmin` (`src/guild/permissions.ts`) decides who may use the admin
panel: the guild owner, or a member whose `interaction.member.roles` holds
the configured admin role. Until an admin role is set, only the owner gets
in. An interaction without a guild or member is refused.

The owner id comes from `GET /guilds/{guild.id}` (`getGuild`) and is cached
in `guild_settings` with the time it was fetched. A cached id is trusted for
an hour, measured with the interaction's snowflake timestamp; after that it
is fetched again before it decides anything, so after an ownership transfer
the new owner gets in and the former owner is refused. A member with the
admin role is let in without a lookup, so a check makes at most one REST
call. If the lookup fails, the panel stays closed and the member gets an
ephemeral reply with Discord's error.

Everyone else gets an ephemeral Components V2 reply saying the panel is
limited to the server owner and the admin role (and, when no role is set,
that only the owner can use it). `adminOnly(handler)` wraps a command,
component or modal handler in this check; every admin control's handler is
registered through it, so a member who replays an admin `custom_id` is
refused like one who runs the command.

## Guild settings

Each guild's settings are one row of `guild_settings` in its `GuildHike`
database (migration `0002_guild_settings`, with `timezone` added by
`0003_guild_timezone`; read and written by `GuildConfig` in
`src/guild/config.ts`):

| Column                | Meaning                                                      |
| --------------------- | ------------------------------------------------------------ |
| `id`                  | Always 1: the table holds one row, created by the migration  |
| `admin_role_id`       | Members with this role may use the admin panel               |
| `vote_channel_id`     | Text channel where the location and date polls are posted    |
| `announce_channel_id` | Text or announcement channel where results are announced     |
| `forum_channel_id`    | Forum channel that gets a thread per hike                    |
| `owner_id`            | The guild owner's user id, as `getGuild` last returned it    |
| `owner_fetched_at`    | When `owner_id` was fetched, in milliseconds since the epoch |
| `timezone`            | IANA time zone the group plans hikes in                      |

Every column but `id` is null until it is set. Setup is complete when the
three channels are set.

The time zone is the group's own: dates are wall-clock times there, "today"
is judged there, and a hike's start instant is computed there. A null
`timezone` means the default, `America/Los_Angeles` (`DEFAULT_TIMEZONE` in
`src/polls/dates.ts`); `GuildConfig.get()` returns the effective zone as a
non-null `timezone`, so callers never handle null. An admin sets it from the
panel's Settings view; it is not part of setup.

## Admin panel

`/hike admin` opens the panel (`src/features/admin-panel.ts`) as an
ephemeral Components V2 reply; its buttons and selects update that message
in place. Its `custom_id`s are `hb:admin:<action>`, and nothing in it pings.

- **Status view**: the bot's name, the admin role and the three channels as
  mentions or "not set", the time zone and the time there now
  (`**Time zone:** America/Los_Angeles · now Wed 11:42`, from the store's
  clock, kept as `now` in `AdminPanelState`), whether setup is complete (and if not, which
  channels are still missing), the active round, and the action buttons.
  `AdminPanelState` holds the settings and the active round.
  `actionButtons(state)` returns the buttons for the current state: the poll
  controls first, then Settings (primary until setup is complete) and
  Refresh. The poll controls are **Start location vote** (`hb:location:start`)
  when setup is complete and no round is active; while a poll is open,
  **Close location vote** or **Close date vote** (`hb:poll:close:<poll id>`)
  and **Cancel round** (`hb:round:cancel:<round id>`); once the location is
  decided, **Start date vote** (`hb:date:start`) and **Cancel round**. With a
  round active the view lists the decided location (and whether it was drawn
  from a tie) and the open vote's tallies (most votes first) and voter count.
  With no round active, when the last round was completed, it sums up that
  hike: "**Last hike:** **Lake Loop** on **Sat, 15 Jun 2030 · 09:00**."
  (`finished` in `AdminPanelState`), then where its forum thread stands
  (`thread`): "**Hike thread:** <#thread>", "being created", or "not
  created" with the reason. While that round has no thread and none is
  being created, the panel offers **Create hike thread**
  (`hb:thread:create:<round id>`) after **Start location vote**; see "Hike
  thread".
- **Confirmation view**: Close and Cancel round first replace the status view
  with a question and a confirm button (`hb:poll:close-confirm:<poll id>`,
  `hb:round:cancel-confirm:<round id>`) next to Back; only the confirm button
  acts.
- **Settings view**: a role select for the admin role and three channel
  selects, for voting (text channels), announcements (text and announcement
  channels) and hike threads (forum channels). Each shows the current value
  as its default and saves on change; emptying a select clears the setting.
  The bot checks the pick again: the `@everyone` role (whose id is the
  guild's) is refused as the admin role, and a channel missing from the
  interaction's `resolved` channels or of a type the setting does not take
  is refused. Under the selects, the time zone line as in the status view,
  saying that a date typed without a time starts at 11:00, and **Set time
  zone** (`hb:admin:timezone`), which opens a modal of the same `custom_id`
  with one Label and short text input (`hb:admin:timezone-name`, up to 64
  characters) prefilled with the current zone. A submit is read by
  `normalizeTimeZone` (`src/polls/dates.ts`): an IANA name in any case
  (`america/denver`) is stored in its canonical spelling (`America/Denver`),
  a link as the zone it links to (`US/Pacific` as `America/Los_Angeles`;
  the runtime's older names such as `Asia/Calcutta` as the current
  `Asia/Kolkata`), and the aliases PT/PST/PDT, MT/MST/MDT, CT/CST/CDT and
  ET/EST/EDT become `America/Los_Angeles`, `America/Denver`,
  `America/Chicago` and `America/New_York`, UTC and GMT `UTC`. A valid zone
  is saved and the Settings view redrawn with "Time zone set to <zone>.";
  anything else (an unknown name, an offset such as `+05:00`, nothing)
  changes nothing and gets an ephemeral answer quoting what was typed, the
  zone still in force and three examples. Back returns to the status view.

## Polls

`src/polls/` holds the rules and storage for hike rounds and their votes. It
has no Discord code (nothing there imports `src/discord/` or
`src/features/`); features call it and turn its results into messages.

### Data model

All tables live in the guild's `GuildHike` SQLite database.

- `rounds`: one hike being planned. `status` is `location_voting` ->
  `location_decided` -> `date_voting` -> `complete`, or `cancelled` from any
  of the first three; `date_voting` goes back to `location_decided` when the
  date poll's message could not be posted. A guild has at most one active round (status other than
  `complete` / `cancelled`), enforced by the code and by a partial unique
  index. Also `location_option_id` and `date_option_id` (the winners),
  `thread_id` (the hike's forum thread), `started_by` / `started_at`, and
  `ended_by` / `ended_at` (set on complete or cancel).
- `polls`: belongs to a round; `kind` is `location` or `date` (one of each per
  round at most); `status` is `open` or `closed`. `channel_id` /
  `message_id` locate its Discord message. On close: `winner_option_id`,
  `tie_broken` (0/1) and `tied_option_ids` (JSON array of the options that
  shared the top count; empty when there was no tie). `opened_by` /
  `opened_at` and `closed_by` / `closed_at`.
- `poll_options`: belongs to a poll. `label` (trimmed, 1-80 characters),
  `details` (trimmed, at most 300 characters, null when blank),
  `proposed_by`, `created_at`, and for date options `date_value`
  (`YYYY-MM-DD HH:MM`; rounds started before every date had a time may
  hold `YYYY-MM-DD`, read as 11:00). `label_key` (trimmed, whitespace
  collapsed, lower-cased) is unique per poll, so `Ridge  Trail` and
  `ridge trail` are the same option. At most 25 options per poll, Discord's
  select limit.
- `poll_votes`: `(poll_id, option_id, user_id)` is unique, with `voted_at`. A
  member may vote for any number of options in a poll.

User ids, channel ids and the like are Discord snowflakes stored as text;
times are milliseconds since the epoch.

### Operations

`new PollStore(storage, { now, random })` gives these operations. `now`
defaults to `Date.now` and `random` to `crypto.getRandomValues`; tests inject
both. Features read the time through `store.now()`, the same clock,
for example to schedule an alarm. Every operation that writes more than one row runs in one
`transactionSync`, so a failure leaves no partial rows. A refusal throws
`PollError` with a `code` and a message a member can read.

| Operation                                           | Does                                                                                                                           | Refuses with                                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startRound(userId, initialLocations)`              | creates a `location_voting` round and its open location poll with the given options (may be none)                              | `round_active`, `location_on_cooldown`, plus the option codes below                                                                                                  |
| `addOption(pollId, { label, details, proposedBy })` | adds an option; on a date poll the label is parsed as a date and stored as its display label                                   | `poll_not_found`, `poll_closed`, `invalid_label`, `invalid_details`, `invalid_date`, `too_many_options`, `duplicate_option`, `location_on_cooldown` (location polls) |
| `setVotes(pollId, userId, optionIds)`               | replaces the member's votes in the poll with exactly that set; empty clears them                                               | `poll_not_found`, `poll_closed`, `unknown_option`                                                                                                                    |
| `closePoll(pollId, userId)`                         | picks the winner (below), closes the poll, and moves the round to `location_decided` (location poll) or `complete` (date poll) | `poll_not_found`, `poll_closed`, `no_options`, `invalid_state`                                                                                                       |
| `startDatePoll(roundId, userId, dates)`             | from `location_decided` only: opens the date poll with 2-25 distinct dates, sorted chronologically; round -> `date_voting`     | `round_not_found`, `invalid_state`, `invalid_date`, `duplicate_option`, `too_few_options`, `too_many_options`                                                        |
| `withdrawDatePoll(pollId)`                          | deletes an open date poll with its options and votes; round `date_voting` -> `location_decided`                                | `poll_not_found`, `poll_closed`, `invalid_state`                                                                                                                     |
| `withdrawLocationRound(pollId, userId)`             | from `location_voting` with this location poll open only: closes it without a winner; round -> `cancelled`                     | `poll_not_found`, `poll_closed`, `invalid_state`                                                                                                                     |
| `cancelRound(roundId, userId)`                      | closes any open poll without a winner; round -> `cancelled`                                                                    | `round_not_found`, `invalid_state` (already ended)                                                                                                                   |
| `setPollMessage(pollId, channelId, messageId)`      | records the poll's Discord message                                                                                             | `poll_not_found`                                                                                                                                                     |
| `setRoundThread(roundId, threadId)`                 | records the hike's forum thread                                                                                                | `round_not_found`                                                                                                                                                    |

Reads return null when there is nothing to return:
`getPoll(pollId, viewerId?)`, `getRound(roundId, viewerId?)`,
`getActiveRound(viewerId?)` and `getLastRound(viewerId?)` (the most recently
started round), and `getOption(optionId)`, an option of any poll. A poll
read model has its options in creation order, each with its vote count, the
number of distinct voters, and `viewerVotes`, the viewer's current votes. A
round read model includes its location and date polls.

### Past locations and the cooldown

Past suggestions are not stored separately: every location ever proposed is
a row of `poll_options` in a location poll, and those rows are never
deleted. `listPastLocations(viewerId, pollId)` reads them across all rounds
and returns one entry per `label_key`: the newest option's id, label and
details, `proposedByViewer` (the viewer proposed it in any round),
`lastProposedAt`, `timesHiked` (complete rounds it was the location of),
`cooldownHikesLeft` (0 when free) and `onPoll` (it is an option of poll
`pollId`). The viewer's own come first, then everyone else's, each most
recently proposed first.

A location rests for `COOLDOWN_HIKES` (2) hikes: the decided location of one
of the two most recent `complete` rounds cannot be added to a location poll,
by `addOption` or in `startRound`'s initial list, compared by `label_key`.
Cancelled rounds do not count, so a location decided in a round that was then
cancelled does not rest, and a rest ends by itself once two more rounds have
completed. `restingLocations()` lists them, the most recent hike first, each
with its label, the hike's date and the hikes left; the refusal is
`location_on_cooldown` with `cooldownMessage`'s text, for example "**Eagle
Peak** was the hike on Sat, 5 Dec 2026. It can be suggested again after 2 more
hikes." ("1 more hike" for one). Date polls have no cooldown.

The hike log reads hikes, which are rounds with status `complete` (cancelled
and active rounds are not hikes), from the existing tables; nothing extra is
stored. `listHikes({ limit, offset })` returns them newest date first: by
the decided date option's `date_value` (which sorts chronologically as
text), then by round id, both descending. Each `HikeView` has the round id,
the location (label, details, proposer), the date (`value` and `label`),
the thread id (null when there is none), `completedAt` (when the date vote
closed) and the channel and message ids of the location and date polls
(null until posted), so callers can link them. `countHikes()` counts the
same set.

### Winner and tie-break

`pickWinner` (`src/polls/tally.ts`) takes the options with the highest vote
count. One option wins outright. When several share the top count, including
every option at zero votes, one is drawn uniformly at random (rejection
sampling over a 32-bit random value, so there is no modulo bias) and the poll
records `tie_broken` and the tied option ids.

### Date options

`parseDateOption(line)` accepts `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` (24-hour,
one or more spaces between date and time, surrounding whitespace ignored).
It rejects dates and times that do not exist on the calendar (`2026-02-30`,
`25:00`) and any other format (`2026/12/05`, `2026-12-05T09:00`, `9:00`). A
date typed without a time starts at `DEFAULT_HIKE_TIME`, 11:00, so every
option has a time: it returns the normalized `value` (`YYYY-MM-DD HH:MM`)
and a `label` with the weekday of the calendar date and the time, for
example `Sat, 5 Dec 2026 · 11:00` or `Sat, 5 Dec 2026 · 09:00`. `2026-12-05`
and `2026-12-05 11:00` are the same option.

A value is a wall-clock time in the guild's time zone. The pure helpers in
`src/polls/dates.ts` turn it into instants with `Intl.DateTimeFormat`, no
library, and take the current time as a parameter:

- `hikeStart(dateValue, timeZone)`: the epoch milliseconds of that time in
  the zone; a value without a time is read as 11:00. A time skipped when the
  clocks go forward (02:30 on 8 March 2026 in Los Angeles) maps to the
  instant one hour later on the clock (03:30 PDT, 10:30 UTC); a time that
  happens twice when they go back (01:30 on 1 November 2026) maps to its
  first occurrence (01:30 PDT, 08:30 UTC). Half-hour zones such as
  `Asia/Kolkata` work the same way.
- `todayIn(timeZone, now)`: the calendar day in the zone, `YYYY-MM-DD`.
- `clockIn(timeZone, now)`: the weekday and time there, `Wed 11:42`.
- `normalizeTimeZone(input)`: the zone's stored name, or null (see "Admin
  panel").

## Round lifecycle

A guild has at most one active round: `location_voting` ->
`location_decided` -> `date_voting` -> `complete`. If the date poll's
message cannot be posted, `withdrawDatePoll` takes the date poll back and
the round returns to `location_decided`. An admin can cancel an active
round. A new round can start when there is none or the last one is
`complete` or cancelled.

## Voting

A poll is a public message in the configured voting channel with live tallies
and a Vote button. Vote opens an ephemeral multi-select preselected with the
member's current choices; submitting replaces their votes for that poll.
Individual voters are not shown. A poll has at most 25 options (Discord's
select limit). During the location vote, members add options with a Propose a
location button: a new one in a modal, or one from an earlier round picked
again from a select. Date options are entered by the admin as
`YYYY-MM-DD` or `YYYY-MM-DD HH:MM`, a wall-clock time in the guild's time
zone (11:00 when no time is typed), and shown with the weekday and the time.

The poll message, the vote flow, the refresh and the close and cancel flows
are shared by every poll kind (`src/features/poll-ui.ts`). A kind supplies a
`PollWording`: its heading (from the poll's round, so the date vote can name
the decided location), instructions, nouns, whether options show their
proposer, the order of the options (by votes or by date), the buttons after
Vote, the announcement's heading and opening lines, and its close steps
(see "Closing"). The location vote's wording and its own controls (start,
propose) are in `src/features/location-vote.ts`, the date vote's (start) in
`src/features/date-vote.ts`; `registerFeatures` passes the wordings by kind
to `registerPollUi`.

### Poll message

One Components V2 container: the heading and one line of instructions, then
one Text Display per option, each with its vote count, its details and, for
the location vote, "Proposed by" and the proposer's mention (which pings no
one). Location options are listed most votes first, ties in the order they
were added (`rankOptions` in `src/polls/tally.ts`); date options in
chronological order whatever their votes (`chronological`). The location
vote's heading is "Where should we hike?", the date vote's "When should we
hike <decided location>?". Then the number of members who have
voted, and while open the buttons **Vote** (`hb:poll:vote:<poll id>`) and,
for the location vote, **Propose a location**
(`hb:location:propose:<poll id>`). With no options it says so and invites a
proposal. Details are shortened, all to the same cap with "…", so that the
message's text stays within 4000 characters; with 25 options at the longest
label (80) and details (300) it has 33 components and fits.

Closed, the heading says "(closed)", the winner is marked with 🏆 and named
under the heading with its votes, a tie broken at random adds "N options tied
with X votes each; the winner was drawn at random.", and the buttons are
gone. A poll closed without a winner (its round was cancelled) says "This vote
was cancelled." and has no buttons.

### Vote

**Vote** answers with an ephemeral message holding a string select
(`hb:poll:choose:<poll id>`) of every option, `min_values` 0 and
`max_values` the number of options, each option preselected when the member
voted for it. With no options it answers "There are no locations to vote for
yet. Propose one first." Submitting replaces the member's votes among the
options that select lists with the ones picked, keeping their votes for
options added after it was shown, and updates the ephemeral message with
what they now vote for (or that their votes are cleared) and a fresh select.

### Propose a location

**Propose a location** first looks for past locations (see "Past locations
and the cooldown") that are neither on this poll nor resting. When there is
at least one, it answers with an ephemeral Components V2 message: a string
select "Suggest one again" (`hb:location:again:<poll id>`) of up to 25 of
them, the member's own suggestions first, each option with the label and its
details cut to 100 characters (Discord's description limit); under it a
**New location** button (`hb:location:new:<poll id>`) that opens the modal
below; and, when some rest, one line naming them with the hikes left
("Resting: **Eagle Peak** (2 more hikes), **Lake** (1 more hike)"). Picking
one adds it through `addOption` at once, with its saved label and details and
the member as proposer, and updates the ephemeral message with the
confirmation and a fresh select. When there is nothing to suggest again,
the button opens the modal directly.

The modal (`hb:location:propose:<poll id>`) has Name (required, up to 80
characters) and Details (optional paragraph, up to 300: a trail link,
distance, notes). A valid submit adds the option through `addOption` and
confirms ephemerally. A duplicate name ("**X** is already on the list."), a
full poll ("This vote already has 25 locations…"), a closed poll and a
resting location (the cooldown message) each get their own ephemeral answer,
whether typed or picked from a stale select (which is replaced by the
answer); a full or closed poll is refused already at the buttons.

### Live updates

A vote, proposal or pick of a past location marks its poll for a refresh (a `poll-refresh:<poll id>`
key in the object's storage, holding when it is due) and schedules the
`poll:refresh` job `REFRESH_DELAY_MS` (2 seconds) after the store's clock,
unless it is already scheduled earlier. The job edits the message of every
marked poll that is still open, so a burst of votes causes one edit. A failed
edit is logged and dropped; the member's interaction never waits for it.
Marks added while the job runs schedule it again, so they get a run of their
own. Every edit of a poll message (refresh,
close, cancel) runs through one queue per object (`queuePollEdit`), so an
older render never lands after a newer one.

Votes, proposals and stale selects that arrive after a close or cancel get an
ephemeral "This vote has closed." (a stale select is replaced by it).

## Starting the location vote

**Start location vote** opens a modal (`hb:location:start`) with one
optional paragraph, "Initial locations (one per line)". Lines are trimmed,
blank lines dropped and duplicates (compared as `labelKey` does) collapsed; a
line over 80 characters, or more than 25 locations, is refused with an
ephemeral message naming the line or the count, and nothing starts. A line
holding a resting location (see "Past locations and the cooldown") is
refused the same way, naming each such location with its cooldown message.
Otherwise
the handler starts the round through `startRound` (recording the admin as
proposer of the initial locations) and answers with a deferred update of the
panel. The follow-up posts the poll message in the voting channel, records it
with `setPollMessage` and redraws the panel. If Discord refuses the post, the
follow-up takes the round back with `withdrawLocationRound`, so no round is
left active, and the panel names the channel and Discord's error.

The round is active and on the panel while the post is in flight, so another
admin can cancel it or close the vote in that window. The follow-up keeps
what they did:

- If the post fails, `withdrawLocationRound` refuses, because the poll is no
  longer open, and changes nothing. A cancelled round stays cancelled and a
  decided round keeps its winner. The panel names the channel and Discord's
  error, then says the round had already been cancelled, or that the vote
  had already been closed (naming the winner) and the round was kept.
- If the post succeeds, the follow-up records the message, then edits it to
  the cancelled or closed rendering the cancel and close flows use, without
  buttons, and the panel says the round had been cancelled, or the vote
  closed, meanwhile. The close flow's announcement has no link to the vote,
  since no message was recorded when it ran.

## Starting the date vote

Once the location is decided, **Start date vote** opens a modal
(`hb:date:start`) with one required paragraph, "Candidate dates (one per
line)" (up to 1000 characters), whose placeholder shows both formats,
`2026-12-05 (starts at 11:00) or 2026-12-05 09:00`, and whose help text says
the time defaults to 11:00. `parseCandidateDates` reads it with the store's
clock and the guild's time zone: blank lines are dropped and a repeated date
counts once (a date without a time and the same date at 11:00 are one).
Every line must parse with `parseDateOption`; no date may fall on a calendar
day before today in the guild's time zone (`todayIn`; today is accepted at
any time of day); and there must be 2 to 25 different dates. Otherwise
nothing starts and the admin gets an ephemeral message listing each
offending line by number (as typed, cut to 40 characters; the first 25 such
lines, then a count of the rest; a past date with "today is <day> in
<zone>"), the count problem if any, and the accepted formats with examples
and the 11:00 default.

Valid dates open the date poll through `startDatePoll`, which stores the
options in date order, and the handler answers with a deferred update of the
panel. The follow-up posts the poll message in the voting channel, records it
with `setPollMessage` and redraws the panel. If Discord refuses the post, the
follow-up takes the poll back with `withdrawDatePoll`, so the round stays
`location_decided` with **Start date vote** offered again, and the panel
names the channel and Discord's error.

The date vote has only a **Vote** button: members cannot propose dates.

## Closing

Closing a poll picks the option with the most votes; ties are broken
uniformly at random and the result says so. The poll message is edited to
show final results, and a message is posted in the configured announcements
channel. Closing the date vote also creates a thread with the hike details in
the configured forum channel.

The confirm button closes the poll through `closePoll` before answering, so
the result stands whatever Discord does next, and answers with a deferred
update of the panel. Closing a poll without options is refused in the panel
with an explanation, at the first click and at the confirmation. The
follow-up runs the close flow (`runCloseFlow` in `src/features/poll-ui.ts`)
in this order:

1. Edit the poll message to its final state.
2. Run the kind's close steps (`PollWording.closeSteps`), in order. A
   `CloseStep` has a `name` and a `run(closed, context)` that gets the
   closed poll, its round, the guild id and the guild's time zone as it was
   when the poll closed, and returns lines to add to the
   announcement (such as a link to what it created) and a note for the
   panel. The date vote's one step creates the hike's forum thread (see
   "Hike thread"), before the announcement so that the announcement can
   link it. A step that throws is named in the panel ("Could not <name>:
   <error>") and the flow goes on.
3. Post the announcement: the kind's heading and opening lines, the winner
   and its votes, its details, the tie note, the link to the poll message,
   then the close steps' lines. The location vote's heading is "Hike
   location decided"; the date vote's is "Hike planned", opening with
   "**Where:**" (the decided location and its details) and "**When:**": the
   date's label and Discord's relative timestamp of its start in the guild's
   time zone (`hikeStart`, in seconds), which each member sees in their own
   words and locale, for example
   `**When:** Sat, 5 Dec 2026 · 11:00 (<t:1796497200:R>)`; and ending with "**Hike thread:** <#thread>" when the thread was
   created.
4. Redraw the panel with the result and a line per failed step: after the
   location vote it shows the decided location and **Start date vote**;
   after the date vote the round is `complete` and the panel sums up the
   hike and offers **Start location vote** for the next round.

If the edit or the announcement fails, the panel says which step failed, in
which channel, and Discord's error.

**Cancel round**, confirmed, cancels the round through `cancelRound` and
answers with a deferred update; the follow-up rewrites the message of each
poll that was open as cancelled, without buttons, and redraws the panel,
which offers **Start location vote** again. A failed rewrite is named in the
panel. No announcement is posted.

Every admin control (the start buttons and modals of both votes, close,
cancel and their confirmations, Create hike thread, Set time zone and its
modal) is registered through
`adminOnly`, so a member who replays its `custom_id` is refused.

## Hike log

`/hike log` (`src/features/hike-log.ts`) shows the group's hikes, read with
`listHikes`, to any member: it is not wrapped in `adminOnly`. It answers
with an ephemeral Components V2 message that pings no one: one container
with the heading "Hike log" and the count ("2 hikes"; with more than one
page also "page 2 of 3"), then one Text Display per hike, newest first: the
date label and the location in bold
(`Sat, 15 Jun 2030 · 09:00 · **Ridge**`), its details shortened to 200
characters (`LOG_DETAILS_CAP`) with "…", and "Thread: <#thread>" when the
round has a thread. With no hikes it says "No hikes yet. The first one
appears here when a date vote closes."

A page holds ten hikes (`HIKES_PER_PAGE`). With more than ten, the message
ends with **Newer** and **Older** buttons (`hb:log:page:<n>`, `n` the
1-based page they go to) that redraw it in place with an update; the one
with nowhere to go is disabled. A page number past the end shows the last
page, and one before the first (or not a number) the first. With ten or
fewer hikes there are no buttons. At ten hikes with the longest label (80)
and details (300) and a 20-digit thread id, a page takes about 3,500
characters and 17 components, within Discord's 4000 and 40.

## Hike thread

When the date vote closes, the hike is decided, and the close step in
`src/features/hike-thread.ts` creates a thread (a forum post) for it in the
configured hike threads channel with `startForumThread`, so the group has one
place to organise that hike.

- **Title**: `<location> — <date label>`, for example
  `Eagle Peak — Sat, 5 Dec 2026 · 11:00`. Discord allows 100 characters, so
  an over-long location is shortened with "…" (on a code point boundary)
  and the date is always kept whole (`threadTitle`).
- **First message**, Components V2 in the thread's `message`, pinging no
  one: the location as a heading, its details, "Proposed by" and the
  proposer's mention, the "**When:**" line as in the announcement (the
  date's label and the relative timestamp of its start in the guild's time
  zone when the date vote closed, or now for **Create hike thread**), then one line per vote: the
  winner, its votes and how many members voted, a note when the winner was
  drawn at random from a tie (with the number of tied options), and a link
  to the poll message. Labels and details are bounded (80 and 300
  characters), so it stays far within 40 components and 4000 characters.

The thread's id is stored on the round with `setRoundThread`, and the
announcement links it. If the thread cannot be created (no hike threads
channel set, the bot lacks permission, the channel was deleted or is no
longer a forum), the round is still `complete` and the announcement is
posted without the link. The reason, with Discord's error and what to
check, is shown in the panel under the last hike, with **Create hike
thread**, until the thread exists.

**Create hike thread** retries for the round in its `custom_id`, only while
that round is the last one and `complete` without a thread; otherwise it
redraws the panel saying why it did nothing. It answers with a deferred
update and creates the thread in the follow-up, then redraws the panel with
the link (or the new reason). A retry never posts the announcement again.
Starting a new round does not need the thread; once it starts, the old
round is no longer the last one and its button is gone.

At most one thread is created per round. Where creation stands is kept in
the guild object's synchronous key-value storage (`storage.kv`) under
`hike-thread:<round id>` (`src/features/hike-thread-state.ts`): when a
creation started, or the reason it last failed; it is removed once the
thread id is on the round. The close step and the button both claim the
creation in that key before calling Discord, synchronously and before the
button answers, so a second click while the first is running is told "The
hike thread is being created." and creates nothing, and a click after it
succeeded is told the thread already exists. A claim older than a minute
(`THREAD_CLAIM_MS`) counts as lost, for example when the object restarted
during the follow-up, so the button comes back.
