import type {
  APIApplicationCommandInteraction,
  APIInteractionResponse,
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
} from "discord-api-types/v10";
import { DiscordApiError, discordApi, type DiscordApi } from "../discord/api";
import { ephemeralNotice } from "../discord/responses";
import { snowflakeTime } from "../discord/snowflake";
import { GuildConfig, type GuildSettings } from "./config";
import type { HandlerContext, HandlerResult } from "./router";

/** How long a cached guild owner id is trusted before a denial. */
export const OWNER_CACHE_MS = 60 * 60 * 1000;

export const ADMIN_ONLY_MESSAGE =
  "The hikebot admin panel is limited to the server owner and members with the admin role.";
export const ADMIN_ONLY_NO_ROLE_MESSAGE =
  "The hikebot admin panel is limited to the server owner and members with the admin role. No admin role is set yet, so only the server owner can use it.";

/** The interactions an admin control can send. */
export type AdminInteraction =
  | APIApplicationCommandInteraction
  | APIMessageComponentInteraction
  | APIModalSubmitInteraction;

export type AdminCheck =
  | { allowed: true; settings: GuildSettings }
  | { allowed: false; response: APIInteractionResponse };

/**
 * Decides whether the member who sent `interaction` may use the admin panel:
 * the guild owner, or a member with the configured admin role. The owner id
 * comes from `getGuild` and is cached in the guild's settings; a cached id
 * older than {@link OWNER_CACHE_MS} (measured with the interaction's own
 * timestamp) is fetched again once before a denial. Makes at most one
 * Discord REST call.
 */
export async function checkAdmin(
  interaction: AdminInteraction,
  context: HandlerContext,
  api: DiscordApi = discordApi(context.env),
): Promise<AdminCheck> {
  const config = new GuildConfig(context.storage);
  let settings = config.get();
  const userId = interaction.member?.user.id;
  const roles = interaction.member?.roles ?? [];
  if (settings.adminRoleId !== null && roles.includes(settings.adminRoleId)) {
    return { allowed: true, settings };
  }

  const now = snowflakeTime(interaction.id);
  const stale =
    settings.ownerId === null ||
    settings.ownerFetchedAt === null ||
    now - settings.ownerFetchedAt >= OWNER_CACHE_MS;
  if (userId !== undefined && settings.ownerId !== userId && stale) {
    try {
      const guild = await api.getGuild(interaction.guild_id ?? "");
      settings = config.setOwner(guild.owner_id, now);
    } catch (error) {
      return { allowed: false, response: ownerLookupFailed(error) };
    }
  }

  if (userId !== undefined && settings.ownerId === userId) {
    return { allowed: true, settings };
  }
  return {
    allowed: false,
    response: ephemeralNotice(
      settings.adminRoleId === null
        ? ADMIN_ONLY_NO_ROLE_MESSAGE
        : ADMIN_ONLY_MESSAGE,
    ),
  };
}

/**
 * Wraps an admin command, component or modal handler so that it runs only
 * for members who pass {@link checkAdmin}; everyone else gets the ephemeral
 * refusal. Register every admin control's handler through this.
 */
export function adminOnly<I extends AdminInteraction>(
  handler: (
    interaction: I,
    context: HandlerContext,
    settings: GuildSettings,
  ) => HandlerResult | Promise<HandlerResult>,
): (interaction: I, context: HandlerContext) => Promise<HandlerResult> {
  return async (interaction, context) => {
    const check = await checkAdmin(interaction, context);
    if (!check.allowed) return { response: check.response };
    return handler(interaction, context, check.settings);
  };
}

function ownerLookupFailed(error: unknown): APIInteractionResponse {
  const reason =
    error instanceof DiscordApiError
      ? `Discord answered: ${error.discordMessage} (HTTP ${String(error.status)})`
      : "Discord could not be reached";
  return ephemeralNotice(
    `Could not check who owns this server, so the admin panel stays closed. ${reason}. Try again in a moment.`,
  );
}
