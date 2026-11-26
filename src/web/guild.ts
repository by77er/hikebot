/**
/**
 * The one way a page reads a server, and an action changes it: through
 * its `GuildHike` object's `webView`, `adminAction`, `webVote`,
 * `webPropose` and `saveSettings` methods, never its storage.
 */
import type { WebAdminRequest } from "../features/web-admin";
import type {
  WebActionResult,
  WebMemberResult,
  WebProposeRequest,
  WebVoteRequest,
} from "../guild/web-action";
import type {
  WebSettingsRequest,
  WebSettingsResult,
  WebViewResult,
} from "../guild/web-view";

/** A Discord snowflake: 17 to 20 digits. */
const SNOWFLAKE = /^\d{17,20}$/;

/**
 * What the server's page shows to user `userId`, or why it shows nothing:
 * `not_member` (also for ids that cannot be Discord's, without waking an
 * object) or `unavailable` when Discord could not be asked. `log` picks a
 * page of the hike log (1-based `page`, `pageSize` hikes a page);
 * `settingsForm` asks for the settings page's forms, which only an admin's
 * view carries.
 */
export async function readGuild(
  env: Env,
  guildId: string,
  userId: string,
  log: { page?: number; pageSize?: number; settingsForm?: boolean } = {},
): Promise<WebViewResult> {
  if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(userId)) {
    return { kind: "not_member" };
  }
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
  return stub.webView({ guildId, userId, ...log });
}

/**
 * Runs an admin's round control `request` on guild `guildId` as user
 * `userId`, through the object's `adminAction`, which checks with Discord
 * that the user is a member and an admin at this moment before it acts.
 * Ids that cannot be Discord's are `not_member`, without waking an object.
 */
export async function actOnGuild(
  env: Env,
  guildId: string,
  userId: string,
  request: WebAdminRequest,
): Promise<WebActionResult> {
  if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(userId)) {
    return { kind: "not_member" };
  }
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
  return stub.adminAction({ guildId, userId, ...request });
}

/**
 * Saves the member's votes from the web page through the guild object,
 * which asks Discord first that they are still a member. Ids that cannot
 * be Discord's are `not_member` without waking an object.
 */
export async function voteInGuild(
  env: Env,
  request: WebVoteRequest,
): Promise<WebMemberResult> {
  if (!SNOWFLAKE.test(request.guildId) || !SNOWFLAKE.test(request.userId)) {
    return { kind: "not_member" };
  }
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(request.guildId));
  return stub.webVote(request);
}

/** Adds the member's proposal from the web page, as `voteInGuild` votes. */
export async function proposeInGuild(
  env: Env,
  request: WebProposeRequest,
): Promise<WebMemberResult> {
  if (!SNOWFLAKE.test(request.guildId) || !SNOWFLAKE.test(request.userId)) {
    return { kind: "not_member" };
  }
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(request.guildId));
  return stub.webPropose(request);
}

/**
 * Saves one group of the server's settings for user `userId`, through the
 * guild object's `saveSettings`, which checks again that they are an admin.
 * Ids that cannot be Discord's are `not_member`, without waking an object.
 */
export async function saveGuildSettings(
  env: Env,
  request: WebSettingsRequest,
): Promise<WebSettingsResult> {
  if (!SNOWFLAKE.test(request.guildId) || !SNOWFLAKE.test(request.userId)) {
    return { kind: "not_member" };
  }
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(request.guildId));
  return stub.saveSettings(request);
}
