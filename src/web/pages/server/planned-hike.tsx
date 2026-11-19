/**
 * The server's page, third section: the planned hike as a full hike card,
 * with its location, details, date and time in the server's time zone
 * (named), and links to its thread and Discord event. Nothing while no hike
 * is planned.
 */
import type { WebView } from "../../../guild/web-view";
import { HikeCard } from "../../components/hike-card";

export function PlannedHike({ view }: { view: WebView }) {
  const hike = view.plannedHike;
  if (hike === null) return null;
  return (
    <section class="stack" aria-labelledby="planned-hike">
      <h2 id="planned-hike">Planned hike</h2>
      <HikeCard
        location={hike.location.label}
        details={hike.location.details}
        start={hike.start}
        when="upcoming"
        links={{ thread: hike.threadUrl, event: hike.eventUrl }}
        headingLevel={3}
      />
    </section>
  );
}
