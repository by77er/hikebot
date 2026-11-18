# Working on hikebot

hikebot is a Discord bot for a hiking group, running on Cloudflare Workers and
Durable Objects, receiving interactions over HTTP only.

## Start here

Read `docs/design.md` before changing anything. It is the source of truth for
behaviour, layout and conventions. When your change alters behaviour, update
`docs/design.md` in the same pull request so it keeps matching the code.

## Source layout

```
src/index.ts              Worker entry: routing, signature check, PING, dispatch to the DO
src/discord/              Discord helpers: verify.ts (Ed25519), responses.ts; later api.ts, components.ts, commands.ts
src/guild/guild-hike.ts   GuildHike Durable Object: handleInteraction, runFollowUp. Keep it thin
src/guild/router.ts       handler registry (commands by name, components/modals by custom_id prefix)
src/guild/schema.ts       SQLite migrations, applied once each and tracked in _migrations
src/features/             one file per feature; register its handlers in src/features/index.ts
src/polls/                rounds, polls, options, votes, tally; see src/polls/AGENTS.md
scripts/                  one-off scripts such as command registration (later)
test/                     mirrors src/; test/helpers.ts signs requests and builds interactions
```

- To add a feature: put its handlers in `src/features/<feature>.ts` and add
  one line per handler to `registerFeatures` in `src/features/index.ts`.
- To add tables: append a migration to `migrations` in `src/guild/schema.ts`.
  Never edit, rename or reorder a migration that has shipped.
- `src/index.ts` may export only the default handler and classes; workerd
  refuses to start otherwise. Put constants elsewhere.
- After changing `wrangler.jsonc`, run `npm run cf-typegen` and commit
  `worker-configuration.d.ts`.

## Conventions

The full list is in `docs/design.md`. In short:

- Every message the bot sends or edits uses Components V2: `flags` includes
  `32768` (`IS_COMPONENTS_V2`), no `content`, no `embeds`; ephemeral adds `64`.
  Modals use Label components (type 18).
- Every message sets `allowed_mentions: { parse: [] }`.
- `custom_id`s are `hb:<feature>:<action>[:<arg>]`, e.g. `hb:poll:vote:12`.
- Respond within 3 seconds; work needing more than one Discord REST call goes
  in a follow-up job (`followUp` on the handler result).
- Types come from `discord-api-types`. No discord.js or other Discord client
  library.
- Inject randomness and time where behaviour depends on them, so tests are
  deterministic.
- TypeScript strict; tests run in the Workers runtime with
  `@cloudflare/vitest-plugin`. Add tests with every change.

## Before opening a pull request

Run Undercurrent against the base branch:

```sh
uc check --base origin/main
```

Install `uc` from the latest release of `by77er/undercurrent` if you do not
have it:

```sh
gh release download --repo by77er/undercurrent --pattern uc-linux-x86_64.tar.gz --dir /tmp/uc
tar -xzf /tmp/uc/uc-linux-x86_64.tar.gz -C /tmp/uc
/tmp/uc/uc --version
```

(Use `uc-linux-aarch64` or `uc-macos-aarch64` on those platforms.) Semantic
rules are judged only when `ANTHROPIC_API_KEY` or `TYPESAFE_API_KEY` is set;
without one they are listed but not judged, so check your change against them
yourself.

If `uc` cannot be installed, run the command rules directly:

```sh
npm run format:check && npm run lint && npm run typecheck && npm test
```

## Rules and instructions

- Never change `UNDERCURRENT.md` in a feature pull request. Undercurrent
  rejects a pull request that changes rule files together with other files
  once the base branch has rule files. The pull request that added the first
  `UNDERCURRENT.md` was the only exception, because `main` had none yet. Rule
  changes go in a pull request of their own, merged before the code that
  depends on them.
- Never commit secrets. Local values go in `.dev.vars` (git-ignored; copy
  `.dev.vars.example`); deployed values are set with `wrangler secret put`.
- Infrastructure is whatever `wrangler deploy` manages (the Worker and its
  Durable Object). Anything Terraform-style beyond that must be written with
  the owner's `by77er/inframe`, a functional frontend for OpenTofu, never as
  raw HCL.
