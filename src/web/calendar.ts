/**
 * `GET /calendar/<guild id>/<signature>.ics`: the guild's hikes as an
 * iCalendar feed, open to anyone who has the address. The signature is
 * checked before the guild's object is reached, so a made-up address never
 * creates one. "Calendar feed" in docs/design.md describes the response.
 */
import { calendarGuild } from "../calendar/address";
import { buildCalendar, type Calendar } from "../calendar/ical";
import type { WebHandler } from "./router";

/** How long a client or cache may reuse the feed, in seconds. */
export const CALENDAR_MAX_AGE = 300;

/** The headers of every feed response, the 304 included. */
const FEED_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": `public, max-age=${String(CALENDAR_MAX_AGE)}`,
  "X-Content-Type-Options": "nosniff",
};

/** The feed route; a bad address gets `notFound`'s answer. */
export function calendarRoute(notFound: WebHandler): WebHandler {
  return async (request, env, ctx) => {
    const { pathname } = new URL(request.url);
    const guildId = await calendarGuild(env, pathname);
    if (guildId === null) return notFound(request, env, ctx);
    const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
    const feed = await stub.calendarFeed(guildId);
    const etag = await feedTag(feed);
    if (matches(request.headers.get("If-None-Match"), etag)) {
      return new Response(null, {
        status: 304,
        headers: { ...FEED_HEADERS, ETag: etag },
      });
    }
    return new Response(buildCalendar(feed), {
      headers: {
        ...FEED_HEADERS,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="hikes.ics"',
        ETag: etag,
      },
    });
  };
}

/**
 * A weak ETag over everything in the feed but its stamp, so it changes when
 * a hike does and not on every request (DTSTAMP is the time of the build).
 */
async function feedTag(feed: Calendar): Promise<string> {
  const data = new TextEncoder().encode(
    JSON.stringify({ name: feed.name, events: feed.events }),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const hex = [...digest.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `W/"${hex}"`;
}

/** Whether an `If-None-Match` value names `etag`, compared weakly. */
function matches(header: string | null, etag: string): boolean {
  if (header === null) return false;
  if (header.trim() === "*") return true;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
  return header.split(",").some((tag) => opaque(tag) === opaque(etag));
}
