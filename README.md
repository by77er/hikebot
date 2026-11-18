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

## Setup

1. Create an application in the
   [Discord developer portal](https://discord.com/developers/applications)
   and add a bot to it.
2. Set the Worker's three secrets:

   | Secret                   | Where to find it                    |
   | ------------------------ | ----------------------------------- |
   | `DISCORD_PUBLIC_KEY`     | General Information, Public Key     |
   | `DISCORD_APPLICATION_ID` | General Information, Application ID |
   | `DISCORD_BOT_TOKEN`      | Bot, Token                          |

   ```sh
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put DISCORD_APPLICATION_ID
   npx wrangler secret put DISCORD_BOT_TOKEN
   ```

3. Deploy with `npm run deploy`. This creates the Worker and its Durable
   Object; there is no other infrastructure.
4. In the developer portal, under General Information, set the Interactions
   Endpoint URL to `https://<worker-host>/interactions`, for example
   `https://hikebot.<your-subdomain>.workers.dev/interactions`. Discord sends
   a signed PING to check it before saving.
