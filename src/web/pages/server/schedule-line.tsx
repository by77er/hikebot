/**
 * The server's page, after the planned hike: the weekly schedule, while it
 * is on. What the bot does next by itself and when, written as the bot
 * writes times ("The next location vote opens Wed, 5 Jun 2030 · 09:00."),
 * unless it is closing the open vote, which the vote's card says; or why
 * it does nothing yet; then when it acts each week. (An admin changes it
 * on the Settings page, whose button heads the page.) Nothing while the
 * schedule is off.
 */
import type { WebSchedule } from "../../../features/schedule-section";
import type { WebView } from "../../../guild/web-view";

type Next = NonNullable<WebSchedule["next"]>;

/** What happens next, as a sentence with its time. */
export function nextSentence({ kind, when }: Next): string {
  switch (kind) {
    case "start-location-vote":
      return `The next location vote opens ${when}.`;
    case "close-location-vote":
      return `The location vote closes ${when}, and the date vote opens.`;
    case "hold-location-vote":
      return `The location vote closes ${when} if anyone has voted, and the date vote opens.`;
    case "start-date-vote":
      return `The date vote opens ${when}.`;
    case "close-date-vote":
      return `The date vote closes ${when}.`;
    case "hold-date-vote":
      return `The date vote closes ${when} if anyone has voted.`;
    case "cancel-quiet-round":
      return `The date vote closes ${when} if anyone has voted; if nobody has, the round is cancelled.`;
  }
}

/** Why the schedule does nothing in the coming weeks. */
function waitingSentence(waiting: WebSchedule["waiting"]): string {
  switch (waiting) {
    case "manual_date_vote":
      return "Nothing until an admin closes the date vote, which was started before the schedule was turned on.";
    case "planned_hike":
      return "The next location vote opens on the schedule after the planned hike.";
    case null:
      return "Nothing in the coming weeks.";
  }
}

/** The kinds of next step that close the vote that is open now. */
const CLOSES_THE_VOTE: Next["kind"][] = [
  "close-location-vote",
  "hold-location-vote",
  "close-date-vote",
  "hold-date-vote",
  "cancel-quiet-round",
];

/**
 * The schedule's next step when it closes the open vote, which the vote's
 * card then says; null otherwise.
 */
export function closingNext(view: WebView): Next | null {
  const next = view.schedule?.next ?? null;
  return next !== null &&
    view.round?.vote &&
    CLOSES_THE_VOTE.includes(next.kind)
    ? next
    : null;
}

function dayCount(n: number): string {
  return n === 1 ? "1 day" : `${String(n)} days`;
}

export function ScheduleLine({ view }: { view: WebView }) {
  const schedule = view.schedule;
  if (schedule === null) return null;
  return (
    <section class="stack stack--tight" aria-labelledby="schedule">
      <h2 id="schedule">Schedule</h2>
      {closingNext(view) === null && (
        <p>
          <strong>
            {schedule.next === null
              ? waitingSentence(schedule.waiting)
              : nextSentence(schedule.next)}
          </strong>
        </p>
      )}
      <p class="u-muted">
        The bot opens and closes the votes on {schedule.weekday}s at{" "}
        {schedule.time} ({schedule.timeZone}); a date vote runs for{" "}
        {dayCount(schedule.dateVoteDays)}.
      </p>
    </section>
  );
}
