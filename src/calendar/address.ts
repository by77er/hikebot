/**
 * A guild's calendar feed address, `/calendar/<guild id>/<signature>.ics`,
 * where the signature is `sign(SIGNING_SECRET, "calendar", <guild id>)`.
 * The address is all a reader needs, so it is made only for a guild's
 * members (in `/hike log`) and checked before any guild object is reached.
 */
import { absoluteUrl } from "../public-url";
import { sign, verify } from "../signing";

const PREFIX = "/calendar/";
const SUFFIX = ".ics";

/** A Discord snowflake as text: 17 to 20 digits, no leading zero. */
const SNOWFLAKE = /^[1-9][0-9]{16,19}$/;

/** The path of `guildId`'s feed. */
export async function calendarPath(
  env: { SIGNING_SECRET: string },
  guildId: string,
): Promise<string> {
  const signature = await sign(env.SIGNING_SECRET, "calendar", guildId);
  return `${PREFIX}${guildId}/${signature}${SUFFIX}`;
}

/** The absolute address of `guildId`'s feed, on `PUBLIC_URL`. */
export async function calendarAddress(
  env: { SIGNING_SECRET: string; PUBLIC_URL: string },
  guildId: string,
): Promise<string> {
  return absoluteUrl(env, await calendarPath(env, guildId));
}

/**
 * The guild whose feed `pathname` is, or null unless it is
 * `/calendar/<snowflake>/<signature>.ics` with that guild's signature.
 */
export async function calendarGuild(
  env: { SIGNING_SECRET: string },
  pathname: string,
): Promise<string | null> {
  if (!pathname.startsWith(PREFIX) || !pathname.endsWith(SUFFIX)) return null;
  const parts = pathname.slice(PREFIX.length, -SUFFIX.length).split("/");
  if (parts.length !== 2) return null;
  const [guildId = "", signature = ""] = parts;
  if (!SNOWFLAKE.test(guildId)) return null;
  const valid = await verify(env.SIGNING_SECRET, "calendar", guildId, signature);
  return valid ? guildId : null;
}
