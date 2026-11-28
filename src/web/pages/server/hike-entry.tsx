/**
 * One hike of the log as a compact hike card, on the server's page and on
 * the hike log's pages: its date and time in the server's time zone, the
 * location, and links to its thread and event. The view's planned hike is
 * drawn as upcoming, every other hike as past.
 */
import type { WebView } from "../../../guild/web-view";
import { DEFAULT_HIKE_TIME } from "../../../polls/dates";
import { HikeCard } from "../../components/hike-card";

type LogEntry = WebView["log"]["entries"][number];

export function HikeEntry({
  view,
  entry,
  headingLevel,
}: {
  view: WebView;
  entry: LogEntry;
  headingLevel: 2 | 3;
}) {
  const [date = "", time = DEFAULT_HIKE_TIME] = entry.date.value.split(/\s+/);
  return (
    <HikeCard
      size="compact"
      location={entry.location.label}
      start={{
        date,
        time,
        timeZone: view.settings.timeZone,
        label: entry.date.label,
      }}
      when={entry.roundId === view.plannedHike?.roundId ? "upcoming" : "past"}
      links={{ thread: entry.threadUrl, event: entry.eventUrl }}
      headingLevel={headingLevel}
    />
  );
}

/** "1 hike", "12 hikes". */
export function hikeCount(total: number): string {
  return total === 1 ? "1 hike" : `${String(total)} hikes`;
}

/** The path of page `page` of the server's hike log. */
export function logPath(guildId: string, page = 1): string {
  return page === 1
    ? `/g/${guildId}/log`
    : `/g/${guildId}/log?page=${String(page)}`;
}
