# hikebot design

hikebot is a Discord bot for a local hiking group. Members vote on a hike
location, then on a date; admins run the votes from a panel; results are
announced and a forum thread is created for the hike. It receives Discord
interactions over HTTP only: no gateway, no WebSocket.

## Runtime

One Cloudflare Worker, `hikebot`. Secrets: `DISCORD_PUBLIC_KEY`,
`DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, declared under
`secrets.required` in `wrangler.jsonc` (which also types them in `Env`). The
var `DISCORD_API_BASE` (default `https://discord.com/api/v10`) is where REST
calls go; tests point it at a fake Discord API. One
`GuildHike` Durable Object per Discord guild (binding `GUILD_HIKE`,
`idFromName(guild_id)`) holds all of that guild's state in its SQLite storage
and makes every state change, so votes and poll closes never race.
`wrangler deploy` creates everything the bot needs; there is no other
infrastructure.

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
"Polls".

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
- Tests run in the Workers runtime through `@cloudflare/vitest-plugin`.

## Commands

One slash command, `/hike admin`, guild-only. It is visible to everyone;
permission is enforced by the bot: the guild owner or members with the
configured admin role.

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
both. Every operation that writes more than one row runs in one
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

## Closing

Closing a poll picks the option with the most votes; ties are broken
uniformly at random and the result says so. The poll message is edited to
show final results, and a message is posted in the configured announcements
channel. Closing the date vote also creates a thread with the hike details in
the configured forum channel.
