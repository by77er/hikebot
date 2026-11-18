import {
  InteractionResponseType,
  InteractionType,
  type APIInteraction,
} from "discord-api-types/v10";
import { ephemeralNotice, GUILD_ONLY_MESSAGE } from "./discord/responses";
import { verifyDiscordSignature } from "./discord/verify";
import { webRouter } from "./web/routes";

import type { GuildHike } from "./guild/guild-hike";

export { GuildHike } from "./guild/guild-hike";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/interactions") {
      if (request.method !== "POST") return methodNotAllowed("POST");
      return handleInteractionRequest(request, env, ctx);
    }
    return webRouter.handle(request, env, ctx);
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
    ctx.waitUntil(runFollowUp(stub, interaction));
  }
  return Response.json(outcome.response);
}

/**
 * Runs the interaction's follow-up job in its guild's object, and logs it
 * once when the job was lost (the object restarted since it answered) or
 * failed, with the interaction's id and what it was, never its token.
 */
async function runFollowUp(
  stub: DurableObjectStub<GuildHike>,
  interaction: APIInteraction,
): Promise<void> {
  const what = interactionName(interaction);
  try {
    if (!(await stub.runFollowUp(interaction.id))) {
      console.error(
        `follow-up for interaction ${interaction.id} (${what}) was lost: the guild object restarted before it ran`,
      );
    }
  } catch (error) {
    console.error(
      `follow-up for interaction ${interaction.id} (${what}) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The command's name or the component's or modal's `custom_id`. */
function interactionName(interaction: APIInteraction): string {
  switch (interaction.type) {
    case InteractionType.ApplicationCommand:
      return `/${interaction.data.name}`;
    case InteractionType.MessageComponent:
    case InteractionType.ModalSubmit:
      return interaction.data.custom_id;
    default:
      return `type ${String(interaction.type)}`;
  }
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed\n", {
    status: 405,
    headers: { Allow: allow },
  });
}
