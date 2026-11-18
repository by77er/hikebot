/**
 * The guild's calendar feed: one event per hike (completed round), past and
 * future, at its start in the guild's time zone. `GuildHike.calendarFeed`
 * returns it to the Worker, which checks the address and answers the HTTP
 * request (`src/web/calendar.ts`); `src/calendar/ical.ts` writes the text.
 */
import { calendarAddress } from "../calendar/address";
import type { Calendar, CalendarEvent } from "../calendar/ical";
import { eventUrl } from "../discord/api";
import { GuildConfig } from "../guild/config";
import type { WebViewSource } from "../guild/web-view";
import { HIKE_DURATION_HOURS, hikeStart } from "../polls/dates";
import { PollStore, type HikeView } from "../polls/store";

/** The name calendar apps show for the feed. */
export const CALENDAR_NAME = "Hikes";

const HOUR_MS = 60 * 60 * 1000;

/** Every hike of the guild `guildId`, as a calendar stamped now. */
export function loadCalendarFeed(
  storage: DurableObjectStorage,
  guildId: string,
): Calendar {
  const store = new PollStore(storage);
  const { timezone } = new GuildConfig(storage).get();
  const hikes = store.listHikes({ limit: store.countHikes(), offset: 0 });
  return {
    name: CALENDAR_NAME,
    stamp: store.now(),
    events: hikes.flatMap((hike) => {
      const start = hikeStart(hike.date.value, timezone);
      return Number.isNaN(start) ? [] : [hikeEvent(hike, guildId, start)];
    }),
  };
}

function hikeEvent(
  hike: HikeView,
  guildId: string,
  start: number,
): CalendarEvent {
  const thread =
    hike.threadId === null
      ? null
      : `https://discord.com/channels/${guildId}/${hike.threadId}`;
  const event = hike.eventId === null ? null : eventUrl(guildId, hike.eventId);
  const links = [
    ...(thread === null ? [] : [`Hike thread: ${thread}`]),
    ...(event === null ? [] : [`Discord event: ${event}`]),
  ];
  const description = [
    ...(hike.location.details === null ? [] : [hike.location.details, ""]),
    ...links,
  ];
  return {
    uid: `hike-${String(hike.roundId)}-${guildId}@hikebot`,
    start,
    end: start + HIKE_DURATION_HOURS * HOUR_MS,
    summary: `Hike: ${hike.location.label}`,
    location: hike.location.label,
    description: description.join("\n").trim(),
    url: thread ?? event,
  };
}

/** The calendar feed's section of the web view. */
export interface WebCalendarSection {
  /** The feed's signed address, which any calendar app can subscribe to. */
  url: string;
}

/** The guild's feed address, for the web view's members. */
export async function calendarSection(
  source: WebViewSource,
): Promise<WebCalendarSection> {
  return { url: await calendarAddress(source.env, source.guildId) };
}
