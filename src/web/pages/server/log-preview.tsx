/**
 * The server's page, fourth section: the hike log's latest hikes (the view
 * carries `PREVIEW_HIKES` of them), newest first, and a link to the full
 * log when it holds more.
 */
import { NO_HIKES_MESSAGE } from "../../../features/hike-log";
import type { WebView } from "../../../guild/web-view";
import { Button } from "../../components/button";
import { ArrowRightIcon } from "../../components/icons";
import { HikeEntry, hikeCount, logPath } from "./hike-entry";

/** How many hikes the server's page shows. */
export const PREVIEW_HIKES = 5;

export function LogPreview({ view }: { view: WebView }) {
  const { log } = view;
  return (
    <section class="stack" aria-labelledby="hike-log">
      <div class="stack stack--tight">
        <h2 id="hike-log">Hike log</h2>
        <p class="u-muted">
          {log.total === 0 ? NO_HIKES_MESSAGE : hikeCount(log.total)}
        </p>
      </div>
      {log.entries.length > 0 && (
        <ol class="stack list-reset" aria-label="Latest hikes">
          {log.entries.slice(0, PREVIEW_HIKES).map((entry) => (
            <li key={entry.roundId}>
              <HikeEntry view={view} entry={entry} headingLevel={3} />
            </li>
          ))}
        </ol>
      )}
      {log.total > PREVIEW_HIKES && (
        <div class="cluster">
          <Button href={logPath(view.server.id)} iconAfter={ArrowRightIcon}>
            See the whole hike log
          </Button>
        </div>
      )}
    </section>
  );
}
