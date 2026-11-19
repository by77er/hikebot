/**
 * The link that adds hikebot to a Discord server: Discord's authorize page
 * with the scopes `bot` and `applications.commands` and the bot permissions
 * `README.md` lists (step 2 of "Discord, once after the first deploy").
 * Only someone allowed to manage the server can finish it.
 */
import { DEFAULT_DISCORD_OAUTH_AUTHORIZE_URL } from "../discord/api";

/** Discord's permission bits the bot asks for, by name. */
const PERMISSIONS = {
  viewChannel: 1n << 10n,
  sendMessages: 1n << 11n,
  embedLinks: 1n << 14n,
  readMessageHistory: 1n << 16n,
  createPublicThreads: 1n << 35n,
  sendMessagesInThreads: 1n << 38n,
  createEvents: 1n << 44n,
};

/** The bitfield of PERMISSIONS, as Discord's `permissions` parameter. */
export const INVITE_PERMISSIONS = Object.values(PERMISSIONS)
  .reduce((all, bit) => all | bit, 0n)
  .toString();

/** The address that invites the bot of the Worker's application. */
export function inviteUrl(env: {
  DISCORD_APPLICATION_ID: string;
  DISCORD_OAUTH_AUTHORIZE_URL?: string;
}): string {
  const url = new URL(
    env.DISCORD_OAUTH_AUTHORIZE_URL || DEFAULT_DISCORD_OAUTH_AUTHORIZE_URL,
  );
  url.searchParams.set("client_id", env.DISCORD_APPLICATION_ID);
  url.searchParams.set("scope", "bot applications.commands");
  url.searchParams.set("permissions", INVITE_PERMISSIONS);
  return url.href;
}
