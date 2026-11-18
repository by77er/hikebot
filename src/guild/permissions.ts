import type {
  APIApplicationCommandInteraction,
  APIInteractionResponse,
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
} from "discord-api-types/v10";
import { DiscordApiError, discordApi, type DiscordApi } from "../discord/api";
import { ephemeralNotice, GUILD_ONLY_MESSAGE } from "../discord/responses";
import { snowflakeTime } from "../discord/snowflake";
import { GuildConfig, type GuildSettings } from "./config";
import type { HandlerContext, HandlerResult } from "./router";

/** How long a cached guild owner id is trusted before it is fetched again. */
export const OWNER_CACHE_MS = 60 * 60 * 1000;

/** The refusals a member gets, once an admin role is set and before. */
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
 * Whether a member is an admin, or why that could not be decided: `error` is
 * what the owner lookup threw.
 */
export type AdminDecision =
  | { ok: true; isAdmin: boolean; settings: GuildSettings }
  | { ok: false; error: unknown };

/**
 * The one admin rule, for Discord interactions and web pages alike: user
 * `userId` of guild `guildId`, holding `roleIds`, is an admin if they hold
 * the configured admin role or own the guild. A member with the admin role
 * is an admin without a lookup. Otherwise the owner id comes from `getGuild`
 * and is cached in the guild's settings: a cached id is trusted for
 * {@link OWNER_CACHE_MS} measured with `now`, then fetched again before it
 * decides anything, so after an ownership transfer the new owner is an admin
 * and the former owner is not. Makes at most one Discord REST call; if it
 * fails, nothing is decided.
 */
export async function decideAdmin(
  storage: DurableObjectStorage,
  api: DiscordApi,
  member: { guildId: string; userId: string; roleIds: readonly string[] },
  now: number,
): Promise<AdminDecision> {
  const config = new GuildConfig(storage);
  let settings = config.get();
  if (
    settings.adminRoleId !== null &&
    member.roleIds.includes(settings.adminRoleId)
  ) {
    return { ok: true, isAdmin: true, settings };
  }

  const stale =
    settings.ownerId === null ||
    settings.ownerFetchedAt === null ||
    now - settings.ownerFetchedAt >= OWNER_CACHE_MS;
  if (stale) {
    try {
      const guild = await api.getGuild(member.guildId);
      settings = config.setOwner(guild.owner_id, now);
    } catch (error) {
      return { ok: false, error };
    }
  }
  return { ok: true, isAdmin: settings.ownerId === member.userId, settings };
}

/**
 * Decides whether the member who sent `interaction` may use the admin panel,
 * with {@link decideAdmin}, measuring the owner cache's age with the
 * interaction's own timestamp. If the owner lookup fails, the member is
 * refused with Discord's error.
 */
export async function checkAdmin(
  interaction: AdminInteraction,
  context: HandlerContext,
  api: DiscordApi = discordApi(context.env),
): Promise<AdminCheck> {
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user.id;
  if (guildId === undefined || userId === undefined) {
    return { allowed: false, response: ephemeralNotice(GUILD_ONLY_MESSAGE) };
  }
  const decision = await decideAdmin(
    context.storage,
    api,
    { guildId, userId, roleIds: interaction.member?.roles ?? [] },
    snowflakeTime(interaction.id),
  );
  if (!decision.ok) {
    return { allowed: false, response: ownerLookupFailed(decision.error) };
  }
  if (decision.isAdmin) {
    return { allowed: true, settings: decision.settings };
  }
  return {
    allowed: false,
    response: ephemeralNotice(
      decision.settings.adminRoleId === null
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
