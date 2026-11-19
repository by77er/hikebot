/**
 * The one way a page reads a server, and an admin's action changes it:
 * through its `GuildHike` object's `webView` and `adminAction` methods,
 * never its storage.
 */
import type { WebAdminRequest } from "../features/web-admin";
import type { WebActionResult } from "../guild/web-action";
import type { WebViewResult } from "../guild/web-view";

/** A Discord snowflake: 17 to 20 digits. */
const SNOWFLAKE = /^\d{17,20}$/;

/**
 * What the server's page shows to user `userId`, or why it shows nothing:
 * `not_member` (also for ids that cannot be Discord's, without waking an
 * object) or `unavailable` when Discord could not be asked. `log` picks a
 * page of the hike log (1-based `page`, `pageSize` hikes a page).
 */
export async function readGuild(
  env: Env,
  guildId: string,
  userId: string,
  log: { page?: number; pageSize?: number } = {},
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
