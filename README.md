# hikebot

A Discord bot for a local hiking group. Members vote on where to hike, then on
when; admins run the votes from a panel; the results are announced and a forum
thread is created for the hike.

hikebot runs on Cloudflare Workers with one Durable Object per Discord server
holding that server's state. It receives Discord interactions over HTTP only,
with no gateway connection. See [`docs/design.md`](docs/design.md) for the
design and [`AGENTS.md`](AGENTS.md) for how to work on the code.

## Local development

Requires Node.js 22.13 or later. To set up a checkout, run the bot locally,
run the tests and check a change, follow [`AGENTS.md`](AGENTS.md); each
directory with procedures of its own has an `AGENTS.md` too.

Put your Discord application's values in `.dev.vars`; it is git-ignored, so
they are never committed.

To receive real interactions locally, expose the dev server with a tunnel
(for example `cloudflared tunnel --url http://localhost:8787`) and use the
tunnel's URL as the Interactions Endpoint URL below.

## Deployment

Production is the Cloudflare Worker `hiking`, served at
`https://hiking.bitcru.sh`. Every pull request merged to `main` goes live
without a manual step:

1. The merge pushes to `main`, which runs the `Undercurrent` workflow
   (`.github/workflows/undercurrent.yml`).
2. When that run succeeds, the `Deploy` workflow
   (`.github/workflows/deploy.yml`) starts for the same commit. If `main` has
   moved on to a newer commit by then, it skips with a log line and the newer
   commit's own run deploys. A failed or cancelled `Undercurrent` run deploys
   nothing.
3. `Deploy` checks that the five secrets below are set, runs
   `wrangler deploy` with the repository's own wrangler, setting the Worker's
   three secrets from the GitHub secrets, then runs
   `npm run register --if-present` to register the slash commands, and
   finally requests `https://hiking.bitcru.sh/` until it answers
   `hikebot is running`, failing after about two minutes.

The first deploy creates the Worker, its Durable Object and the DNS record
for `hiking.bitcru.sh`; there is no other infrastructure.

### GitHub Actions secrets

Set under Settings, Secrets and variables, Actions in the GitHub repository.
The three `DISCORD_*` values are from the
[Discord developer portal](https://discord.com/developers/applications); the
deploy sets them as the Worker's secrets on every run.

| Secret                   | What it is for                                        | Where to find it                         |
| ------------------------ | ----------------------------------------------------- | ---------------------------------------- |
| `CLOUDFLARE_API_TOKEN`   | Lets wrangler deploy the Worker and its Custom Domain | Cloudflare dashboard, API Tokens (below) |
| `CLOUDFLARE_ACCOUNT_ID`  | The Cloudflare account that holds the Worker and zone | Cloudflare dashboard, account home       |
| `DISCORD_PUBLIC_KEY`     | The Worker verifies interaction signatures with it    | General Information, Public Key          |
| `DISCORD_APPLICATION_ID` | The application the slash commands are registered for | General Information, Application ID      |
| `DISCORD_BOT_TOKEN`      | The Worker and the register step call Discord's API   | Bot, Token                               |

### Cloudflare API token

Create a custom token with these permissions:

- Account, Workers Scripts, Edit, on the account that holds the `bitcru.sh`
  zone;
- Zone, Workers Routes, Edit, on the zone `bitcru.sh`.

The custom domain needs no other permission. Cloudflare's
[Workers authorization](https://developers.cloudflare.com/workers/authorization/workers/)
page lists only the Worker and Workers Routes permissions for adding a Custom
Domain during `wrangler deploy`, and a deploy of this repository against a
fake Cloudflare API calls only `/accounts/<account>/workers/...` endpoints:
the script upload, its settings and subdomain, and
`workers/scripts/hiking/domains/records`, which creates the DNS record and
certificate itself.

### Discord, once after the first deploy

1. In the developer portal, under General Information, set the Interactions
   Endpoint URL to `https://hiking.bitcru.sh/interactions`. Discord sends a
   signed PING to check it before saving.
2. Invite the bot to the server with the scopes `bot` and
   `applications.commands`: under OAuth2, URL Generator, tick both scopes,
   then open the generated URL.

To confirm a deploy, roll back, read production logs or rotate a secret,
follow the procedures in [`AGENTS.md`](AGENTS.md).
