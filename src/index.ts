import {
  InteractionResponseType,
  InteractionType,
  type APIInteraction,
} from "discord-api-types/v10";
import { ephemeralNotice, GUILD_ONLY_MESSAGE } from "./discord/responses";
import { verifyDiscordSignature } from "./discord/verify";

export { GuildHike } from "./guild/guild-hike";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed("GET, HEAD");
      }
      return new Response("hikebot is running\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (pathname === "/interactions") {
      if (request.method !== "POST") return methodNotAllowed("POST");
      return handleInteractionRequest(request, env, ctx);
    }
    return new Response("Not found\n", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleInteractionRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  const body = new Uint8Array(await request.arrayBuffer());
  if (
    signature === null ||
    timestamp === null ||
    !(await verifyDiscordSignature(
      env.DISCORD_PUBLIC_KEY,
      signature,
      timestamp,
      body,
    ))
  ) {
    return new Response("Bad request signature\n", { status: 401 });
  }

  let interaction: APIInteraction;
  try {
    interaction = JSON.parse(new TextDecoder().decode(body)) as APIInteraction;
  } catch {
    return new Response("Body is not JSON\n", { status: 400 });
  }

  if (interaction.type === InteractionType.Ping) {
    return Response.json({ type: InteractionResponseType.Pong });
  }
  if (!interaction.guild_id) {
    return Response.json(ephemeralNotice(GUILD_ONLY_MESSAGE));
  }

  const stub = env.GUILD_HIKE.get(
    env.GUILD_HIKE.idFromName(interaction.guild_id),
  );
  const outcome = await stub.handleInteraction(interaction);
  if (outcome.followUp) {
    ctx.waitUntil(stub.runFollowUp(interaction.id));
  }
  return Response.json(outcome.response);
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed\n", {
    status: 405,
    headers: { Allow: allow },
  });
}
