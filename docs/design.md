# hikebot design

hikebot is a Discord bot for a local hiking group. Members vote on a hike
location, then on a date; admins run the votes from a panel; results are
announced and a forum thread is created for the hike. It receives Discord
interactions over HTTP only: no gateway, no WebSocket.

Sections marked _(later task)_ describe behaviour that is designed but not
built yet.

## Runtime

One Cloudflare Worker, `hikebot`. Secrets: `DISCORD_PUBLIC_KEY`,
`DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, declared under
`secrets.required` in `wrangler.jsonc` (which also types them in `Env`). One
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

Discord needs a response within 3 seconds, and later features make several
REST calls per action. A handler that needs more time returns its immediate
response (often a deferred one) and a `followUp` function. `GuildHike` keeps
the function in memory keyed by interaction id and returns
`{ response, followUp: true }`. The Worker sends the response and calls
`runFollowUp(interaction.id)` inside its own `ctx.waitUntil`, which keeps the
RPC call, and so the Durable Object, alive until the job finishes (Cloudflare
lets a pending call run for up to 15 minutes). `runFollowUp` runs each job
once and returns false if there is no job, for example because the object was
evicted in between, so follow-ups must tolerate being lost: anything that must
survive belongs in storage, written before the response is returned.

## Storage

`src/guild/schema.ts` holds an ordered list of migrations (`name`, `sql`). The
constructor applies, in list order, every migration whose name is not yet in
the `_migrations` table, each in its own transaction together with its
record. Migrations are never renamed, reordered or edited once shipped; new
ones are appended. The list ships empty; features add their tables.

## Source layout

```
src/index.ts                  Worker entry: routing, signature check, PING, dispatch to the DO
src/discord/verify.ts         Ed25519 verification
src/discord/responses.ts      shared interaction responses (ephemeral notice)
src/discord/api.ts            Discord REST client (later task)
src/discord/components.ts     Components V2 builders (later task)
src/discord/commands.ts       slash command definitions (later task)
src/guild/guild-hike.ts       GuildHike DO: handleInteraction, runFollowUp, alarm (later). Keep it thin
src/guild/router.ts           handler registry
src/guild/schema.ts           SQLite migrations
src/guild/config.ts           guild settings store (later task)
src/guild/permissions.ts      admin check (later task)
src/features/index.ts         registerFeatures: one registration line per handler
src/polls/                    rounds, polls, options, votes, tally (later task)
src/features/admin-panel.ts   /hike admin panel (later task)
src/features/location-vote.ts (later task)
src/features/date-vote.ts     (later task)
src/features/hike-thread.ts   (later task)
scripts/register-commands.ts  (later task)
test/                         mirrors src/; test/helpers.ts signs requests and builds interactions
worker-configuration.d.ts     generated by `npm run cf-typegen`; do not edit
```

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

## Commands _(later task)_

One slash command, `/hike admin`, guild-only. It is visible to everyone;
permission is enforced by the bot: the guild owner or members with the
configured admin role.

## Round lifecycle _(later task)_

A guild has at most one active round: `location_voting` ->
`location_decided` -> `date_voting` -> `complete`. An admin can cancel an
active round. A new round can start when there is none or the last one is
`complete` or cancelled.

## Voting _(later task)_

A poll is a public message in the configured voting channel with live tallies
and a Vote button. Vote opens an ephemeral multi-select preselected with the
member's current choices; submitting replaces their votes for that poll.
Individual voters are not shown. A poll has at most 25 options (Discord's
select limit). During the location vote, members add options with a Propose a
location button and modal. Date options are entered by the admin as
`YYYY-MM-DD` or `YYYY-MM-DD HH:MM` and shown as entered, with the weekday; no
timezone conversion.

## Closing _(later task)_

Closing a poll picks the option with the most votes; ties are broken
uniformly at random and the result says so. The poll message is edited to
show final results, and a message is posted in the configured announcements
channel. Closing the date vote also creates a thread with the hike details in
the configured forum channel.
