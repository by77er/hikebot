/**
 * Age: how old a piece of data on the page is, such as when the forecast
 * was fetched or the votes were counted, in the words of "Content rules"
 * ("14 min ago"), as a `<time>` holding the exact instant. The words are
 * written when the page is served and kept true in the browser by
 * `ages.mjs`, which the component loads (once a page, as a module) and
 * which rewrites them every 15 seconds; without JavaScript they stay as
 * served. Put the verb before it: "Updated <Age/>", "Counted <Age/>".
 * `now` marks the instant as the page's own clock reading, for the
 * screenshots' frozen clock (`data-clock`).
 */
import { assetPath } from "../assets";
import { ageText } from "../age";

/** The script that keeps every age on the page true. */
export const AGES_SCRIPT = "cairn/ages.mjs";

export interface AgeProps {
  /** The instant the data is from, in milliseconds since the epoch. */
  at: number;
  /** When the page is served. */
  now: number;
  /** The server's time zone, for an age of a day or more. */
  timeZone: string;
}

export function Age({ at, now, timeZone }: AgeProps) {
  return (
    <>
      <script type="module" src={assetPath(AGES_SCRIPT)} />
      <time
        datetime={new Date(at).toISOString()}
        data-age=""
        data-zone={timeZone}
        data-clock={at === now ? "" : undefined}
      >
        {ageText(at, now, timeZone)}
      </time>
    </>
  );
}
