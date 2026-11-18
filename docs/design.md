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

`GuildHike.alarm()` hands the object's Durable Object alarm to `runAlarm`
(`src/features/index.ts`), which runs the features' scheduled work: today the
debounced refresh of poll messages, described under "Live updates".

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
  timeout.

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

One global slash command, `/hike`, with one subcommand, `admin` ("Open the
hikebot admin panel"). `src/discord/commands.ts` defines it: guild-only
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
database (migration `0002_guild_settings`, read and written by `GuildConfig`
in `src/guild/config.ts`):

| Column                | Meaning                                                      |
| --------------------- | ------------------------------------------------------------ |
| `id`                  | Always 1: the table holds one row, created by the migration  |
| `admin_role_id`       | Members with this role may use the admin panel               |
| `vote_channel_id`     | Text channel where the location and date polls are posted    |
| `announce_channel_id` | Text or announcement channel where results are announced     |
| `forum_channel_id`    | Forum channel that gets a thread per hike                    |
| `owner_id`            | The guild owner's user id, as `getGuild` last returned it    |
| `owner_fetched_at`    | When `owner_id` was fetched, in milliseconds since the epoch |

Every column but `id` is null until it is set. Setup is complete when the
three channels are set.

## Admin panel

`/hike admin` opens the panel (`src/features/admin-panel.ts`) as an
ephemeral Components V2 reply; its buttons and selects update that message
in place. Its `custom_id`s are `hb:admin:<action>`, and nothing in it pings.

- **Status view**: the bot's name, the admin role and the three channels as
  mentions or "not set", whether setup is complete (and if not, which
  channels are still missing), the active round, and the action buttons.
  `AdminPanelState` holds the settings and the active round.
  `actionButtons(state)` returns the buttons for the current state: the poll
  controls first, then Settings (primary until setup is complete) and
  Refresh. The poll controls are **Start location vote** (`hb:location:start`)
  when setup is complete and no round is active; while a poll is open,
  **Close location vote** (`hb:poll:close:<poll id>`) and **Cancel round**
  (`hb:round:cancel:<round id>`); once the location is decided, **Cancel
  round**. With a round active the view lists the open vote's tallies (most
  votes first) and voter count, or the decided location and whether it was
  drawn from a tie.
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
  is refused. Back returns to the status view.

## Polls

`src/polls/` holds the rules and storage for hike rounds and their votes. It
has no Discord code (nothing there imports `src/discord/` or
`src/features/`); features call it and turn its results into messages.

### Data model

All tables live in the guild's `GuildHike` SQLite database.

- `rounds`: one hike being planned. `status` is `location_voting` ->
  `location_decided` -> `date_voting` -> `complete`, or `cancelled` from any
  of the first three. A guild has at most one active round (status other than
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
  (`YYYY-MM-DD` or `YYYY-MM-DD HH:MM`). `label_key` (trimmed, whitespace
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

| Operation                                           | Does                                                                                                                           | Refuses with                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `startRound(userId, initialLocations)`              | creates a `location_voting` round and its open location poll with the given options (may be none)                              | `round_active`, plus the option codes below                                                                                 |
| `addOption(pollId, { label, details, proposedBy })` | adds an option; on a date poll the label is parsed as a date and stored as its display label                                   | `poll_not_found`, `poll_closed`, `invalid_label`, `invalid_details`, `invalid_date`, `too_many_options`, `duplicate_option` |
| `setVotes(pollId, userId, optionIds)`               | replaces the member's votes in the poll with exactly that set; empty clears them                                               | `poll_not_found`, `poll_closed`, `unknown_option`                                                                           |
| `closePoll(pollId, userId)`                         | picks the winner (below), closes the poll, and moves the round to `location_decided` (location poll) or `complete` (date poll) | `poll_not_found`, `poll_closed`, `no_options`, `invalid_state`                                                              |
| `startDatePoll(roundId, userId, dates)`             | from `location_decided` only: opens the date poll with 2-25 distinct dates, sorted chronologically; round -> `date_voting`     | `round_not_found`, `invalid_state`, `invalid_date`, `duplicate_option`, `too_few_options`, `too_many_options`               |
| `cancelRound(roundId, userId)`                      | closes any open poll without a winner; round -> `cancelled`                                                                    | `round_not_found`, `invalid_state` (already ended)                                                                          |
| `setPollMessage(pollId, channelId, messageId)`      | records the poll's Discord message                                                                                             | `poll_not_found`                                                                                                            |
| `setRoundThread(roundId, threadId)`                 | records the hike's forum thread                                                                                                | `round_not_found`                                                                                                           |

Reads return null when there is nothing to return:
`getPoll(pollId, viewerId?)`, `getRound(roundId, viewerId?)`,
`getActiveRound(viewerId?)` and `getLastRound(viewerId?)` (the most recently
started round). A poll read model has its options in creation order, each
with its vote count, the number of distinct voters, and `viewerVotes`, the
viewer's current votes. A round read model includes its location and date
polls.

### Winner and tie-break

`pickWinner` (`src/polls/tally.ts`) takes the options with the highest vote
count. One option wins outright. When several share the top count, including
every option at zero votes, one is drawn uniformly at random (rejection
sampling over a 32-bit random value, so there is no modulo bias) and the poll
records `tie_broken` and the tied option ids.

### Date options

`parseDateOption(line)` accepts `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` (24-hour,
one or more spaces between date and time, surrounding whitespace ignored).
It rejects dates and times that do not exist (`2026-02-30`, `25:00`) and any
other format (`2026/12/05`, `2026-12-05T09:00`, `9:00`). It returns the
normalized `value` and a `label` with the weekday of the calendar date, for
example `Sat, 5 Dec 2026` or `Sat, 5 Dec 2026 · 09:00`. There is no timezone
conversion.

## Round lifecycle

A guild has at most one active round: `location_voting` ->
`location_decided` -> `date_voting` -> `complete`. An admin can cancel an
active round. A new round can start when there is none or the last one is
`complete` or cancelled.

## Voting

A poll is a public message in the configured voting channel with live tallies
and a Vote button. Vote opens an ephemeral multi-select preselected with the
member's current choices; submitting replaces their votes for that poll.
Individual voters are not shown. A poll has at most 25 options (Discord's
select limit). During the location vote, members add options with a Propose a
location button and modal. Date options are entered by the admin as
`YYYY-MM-DD` or `YYYY-MM-DD HH:MM` and shown as entered, with the weekday; no
timezone conversion.

The poll message, the vote flow, the refresh and the close and cancel flows
are shared by every poll kind (`src/features/poll-ui.ts`). A kind supplies a
`PollWording`: its heading, instructions, nouns, whether options show their
proposer, the buttons after Vote and the announcement's heading. The
location vote's wording and its own controls (start, propose) are in
`src/features/location-vote.ts`; `registerFeatures` passes the wordings by
kind to `registerPollUi`.

### Poll message

One Components V2 container: the heading and one line of instructions, then
one Text Display per option, most votes first and ties in the order the
options were added (`rankOptions` in `src/polls/tally.ts`), each with its vote
count, its details and, for the location vote, "Proposed by" and the
proposer's mention (which pings no one). Then the number of members who have
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

**Propose a location** opens a modal (`hb:location:propose:<poll id>`) with
Name (required, up to 80 characters) and Details (optional paragraph, up to
300: a trail link, distance, notes). A valid submit adds the option through
`addOption` and confirms ephemerally. A duplicate name ("**X** is already on
the list."), a full poll ("This vote already has 25 locations…") and a closed
poll each get their own ephemeral answer; a full or closed poll is refused
already at the button.

### Live updates

A vote or proposal marks its poll for a refresh (a `poll-refresh:<poll id>`
key in the object's storage, holding when it is due) and, unless the object
already has an alarm, sets one `REFRESH_DELAY_MS` (2 seconds) after the
store's clock. The alarm edits the message of every marked poll that is still
open, so a burst of votes causes one edit. A failed edit is logged and
dropped; the member's interaction never waits for it. Marks added while the
alarm ran get an alarm of their own. Every edit of a poll message (refresh,
close, cancel) runs through one queue per object (`queuePollEdit`), so an
older render never lands after a newer one.

Votes, proposals and stale selects that arrive after a close or cancel get an
ephemeral "This vote has closed." (a stale select is replaced by it).

## Starting the location vote

**Start location vote** opens a modal (`hb:location:start`) with one
optional paragraph, "Initial locations (one per line)". Lines are trimmed,
blank lines dropped and duplicates (compared as `labelKey` does) collapsed; a
line over 80 characters, or more than 25 locations, is refused with an
ephemeral message naming the line or the count, and nothing starts. Otherwise
the handler starts the round through `startRound` (recording the admin as
proposer of the initial locations) and answers with a deferred update of the
panel. The follow-up posts the poll message in the voting channel, records it
with `setPollMessage` and redraws the panel. If Discord refuses the post, the
follow-up cancels the round again, so no round is left active, and the panel
names the channel and Discord's error.

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
follow-up edits the poll message to its final state, posts the announcement
(heading "Hike location decided", the winner and its votes, its details, the
tie note, and a link to the poll message) and redraws the panel, which now
shows the decided location. If the edit or the announcement fails, the panel
says which step failed, in which channel, and Discord's error.

**Cancel round**, confirmed, cancels the round through `cancelRound` and
answers with a deferred update; the follow-up rewrites the message of each
poll that was open as cancelled, without buttons, and redraws the panel,
which offers **Start location vote** again. A failed rewrite is named in the
panel. No announcement is posted.

Every admin control (start button and modal, close, cancel and their
confirmations) is registered through `adminOnly`, so a member who replays its
`custom_id` is refused.
