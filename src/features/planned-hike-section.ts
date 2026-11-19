/**
 * The planned hike's section of the web view (`src/guild/web-view.ts`): the
 * newest hike in the log while it has not ended yet, with its start in the
 * guild's time zone, links to its thread and Discord event, and where its
 * map picture is kept.
 */
import { channelUrl, eventUrl } from "../discord/api";
import type { WebViewSource } from "../guild/web-view";
import {
  DEFAULT_HIKE_TIME,
  HIKE_DURATION_HOURS,
  hikeStart,
} from "../polls/dates";

export interface WebPlannedHike {
  roundId: number;
  location: { label: string; details: string | null; proposedBy: string };
  start: {
    /** The start instant, in milliseconds since the epoch. */
    at: number;
    /** The wall-clock date and time in `timeZone`: `2026-12-05`, `11:00`. */
    date: string;
    time: string;
    /** As the bot shows it: `Sat, 5 Dec 2026 · 11:00`. */
    label: string;
    /** The guild's IANA time zone. */
    timeZone: string;
  };
  threadId: string | null;
  threadUrl: string | null;
  eventId: string | null;
  eventUrl: string | null;
  /**
   * The `MAPS` bucket key of the map picture its thread and event show, for
   * a page to serve; null while they show none (no pin, no map data there,
   * or not drawn yet).
   */
  mapPictureKey: string | null;
}

/**
 * The newest hike, while its start in the guild's time zone plus
 * `HIKE_DURATION_HOURS` is after `now`; null when there is none.
 */
export function plannedHikeSection(
  source: WebViewSource,
): WebPlannedHike | null {
  const [hike] = source.store.listHikes({ limit: 1, offset: 0 });
  if (hike === undefined) return null;
  const timeZone = source.settings.timezone;
  const at = hikeStart(hike.date.value, timeZone);
  if (!(at + HIKE_DURATION_HOURS * 3_600_000 > source.now)) return null;
  const [date = "", time = DEFAULT_HIKE_TIME] = hike.date.value.split(/\s+/);
  return {
    roundId: hike.roundId,
    location: { ...hike.location },
    start: { at, date, time, label: hike.date.label, timeZone },
    threadId: hike.threadId,
    threadUrl:
      hike.threadId === null ? null : channelUrl(source.guildId, hike.threadId),
    eventId: hike.eventId,
    eventUrl:
      hike.eventId === null ? null : eventUrl(source.guildId, hike.eventId),
    mapPictureKey: hike.mapPictureKey,
  };
}
