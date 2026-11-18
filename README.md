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
they are never committed. `.dev.vars.example` sets `PUBLIC_URL` to the local
dev server, so the links the Worker builds point at it.

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
3. `Deploy` checks that the seven secrets below are set, runs
   `wrangler deploy` with the repository's own wrangler, setting the Worker's
   five secrets (all but the two `CLOUDFLARE_*` ones) from the GitHub
   secrets, then runs
   `npm run register --if-present` to register the slash commands, and
   finally requests `https://hiking.bitcru.sh/healthz` until it answers
   `hikebot is running`, failing after about two minutes.

The first deploy creates the Worker, its Durable Object, the DNS record
for `hiking.bitcru.sh` and the R2 bucket `hikebot-maps` if it is missing;
there is no other infrastructure.

### GitHub Actions secrets

Set under Settings, Secrets and variables, Actions in the GitHub repository.
The `DISCORD_*` values are from the
[Discord developer portal](https://discord.com/developers/applications);
`SIGNING_SECRET` is a random value you make. The deploy sets these five as the
Worker's secrets on every run. To change one, follow "Rotate a secret" in
[`AGENTS.md`](AGENTS.md).

| Secret                   | What it is for                                                                                                                                                        | Where to find it                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`   | Lets wrangler deploy the Worker and its Custom Domain                                                                                                                 | Cloudflare dashboard, API Tokens (below)                                              |
| `CLOUDFLARE_ACCOUNT_ID`  | The Cloudflare account that holds the Worker and zone                                                                                                                 | Cloudflare dashboard, account home                                                    |
| `DISCORD_PUBLIC_KEY`     | The Worker verifies interaction signatures with it                                                                                                                    | General Information, Public Key                                                       |
| `DISCORD_APPLICATION_ID` | The application the slash commands are registered for                                                                                                                 | General Information, Application ID                                                   |
| `DISCORD_BOT_TOKEN`      | The Worker and the register step call Discord's API                                                                                                                   | Bot, Token                                                                            |
| `DISCORD_CLIENT_SECRET`  | The Worker exchanges web sign-in codes with Discord's OAuth2 API. Rotating it fails sign-ins until the next deploy has the new value; sessions already signed in stay | OAuth2, Client Secret (Reset Secret makes a new one)                                  |
| `SIGNING_SECRET`         | The Worker signs session cookies, sign-in state, form tokens and calendar addresses. Rotating it signs everyone out and changes every calendar address                | Any random value of 32 bytes or more, such as the output of `openssl rand -base64 48` |

### Cloudflare API token

Create a custom token with these permissions:

- Account, Workers Scripts, Edit, on the account that holds the `bitcru.sh`
  zone;
- Account, Workers R2 Storage, Edit, on the same account, for the map data
  bucket: `wrangler deploy` looks the bucket up, and the `Map data` workflow
  creates it and uploads the archives;
- Zone, Workers Routes, Edit, on the zone `bitcru.sh`.

The custom domain needs no other permission. Cloudflare's
[Workers authorization](https://developers.cloudflare.com/workers/authorization/workers/)
page lists only the Worker and Workers Routes permissions for adding a Custom
Domain during `wrangler deploy`, and a deploy of this repository against a
fake Cloudflare API calls only `/accounts/<account>/workers/...` endpoints:
the script upload, its settings and subdomain, and
`workers/scripts/hiking/domains/records`, which creates the DNS record and
certificate itself.

### Map data

hikebot keeps OpenStreetMap vector tiles of the whole world at low zoom and
of the US Pacific states in detail in the R2 bucket `hikebot-maps`, rebuilt
monthly by the `Map data` workflow; at under 5 GB per build and two builds
kept, this costs nothing within R2's free tier (10 GB stored, no egress
fee). To map another area, change the `region` box in `maps/regions.json` as
"Change the mapped region" in [`maps/AGENTS.md`](maps/AGENTS.md) says.

### Discord, once after the first deploy

1. In the developer portal, under General Information, set the Interactions
   Endpoint URL to `https://hiking.bitcru.sh/interactions`. Discord sends a
   signed PING to check it before saving.
2. Invite the bot to the server with the scopes `bot` and
   `applications.commands`: under OAuth2, URL Generator, tick both scopes,
   tick the bot permissions below, then open the generated URL.
3. Make sure the bot has these permissions in the voting, announcements and
   hike threads channels (through the invite or the channels' permission
   overrides): View Channel, Send Messages, Send Messages in Threads, Create
   Public Threads, Embed Links and Read Message History.
4. In the server, run `/hike admin` as the server owner, open Settings, and
   pick the admin role and the three channels.

### Slash commands

The bot has one global slash command, `/hike`, with the subcommands `admin`
(the admin panel) and `log` (the group's hikes, for every member), defined in `src/discord/commands.ts`. `npm run register` replaces the
application's global commands with those definitions through Discord's bulk
overwrite, so running it again changes nothing. It reads
`DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN` from the environment, prints
the commands Discord registered, never prints the token, and exits non-zero
when a variable is missing or Discord refuses the request, which fails the
deploy. The `Deploy` workflow runs it after every deploy; to run it by hand,
follow "Register the slash commands" in [`AGENTS.md`](AGENTS.md).

To confirm a deploy, roll back, read production logs or rotate a secret,
follow the procedures in [`AGENTS.md`](AGENTS.md).
