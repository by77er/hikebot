/**
 * The server's page, fifth section: the server's calendar address, in a
 * read-only field a member selects and copies without any script, the
 * bot's sentence on what it is, and Subscribe, the same address as a
 * `webcal:` link that a calendar app opens.
 */
import { CALENDAR_HINT } from "../../../features/hike-log";
import type { WebView } from "../../../guild/web-view";
import { Button } from "../../components/button";
import { CalendarPlusIcon } from "../../components/icons";
import { TextField } from "../../components/text-field";

/** The feed's address as a link that opens a calendar app. */
export function subscribeUrl(url: string): string {
  return url.replace(/^https?:/, "webcal:");
}

export function CalendarAddress({ view }: { view: WebView }) {
  const { url } = view.calendar;
  return (
    <section class="stack" aria-labelledby="calendar">
      <h2 id="calendar">Calendar</h2>
      <TextField
        id="calendar-address"
        name="calendar-address"
        label="Calendar address"
        hint={`${CALENDAR_HINT} Select it and copy it, or subscribe.`}
        value={url}
        type="url"
        spellCheck={false}
        readOnly
      />
      <div class="cluster">
        <Button href={subscribeUrl(url)} icon={CalendarPlusIcon}>
          Subscribe
        </Button>
      </div>
    </section>
  );
}
