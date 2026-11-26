/**
 * The server's page, after the planned hike: the weekly schedule, while it
 * is on. What the bot does next by itself and when, in the server's time
 * zone ("The location vote closes Wednesday 09:00."), or why it does
 * nothing yet, then when it acts each week. An admin is told where to
 * change it. Nothing while the schedule is off.
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

function dayCount(n: number): string {
  return n === 1 ? "1 day" : `${String(n)} days`;
}

export function ScheduleLine({ view }: { view: WebView }) {
  const schedule = view.schedule;
  if (schedule === null) return null;
  return (
    <section class="stack stack--tight" aria-labelledby="schedule">
      <h2 id="schedule">Schedule</h2>
      <p>
        <strong>
          {schedule.next === null
            ? waitingSentence(schedule.waiting)
            : nextSentence(schedule.next)}
        </strong>
      </p>
      <p class="u-muted">
        The bot opens and closes the votes on {schedule.weekday}s at{" "}
        {schedule.time} ({schedule.timeZone}); a date vote runs for{" "}
        {dayCount(schedule.dateVoteDays)}.
      </p>
      {view.viewer.isAdmin && (
        <p class="u-muted">
          You are an admin: change the schedule in Discord with /hike admin,
          then Settings.
        </p>
      )}
    </section>
  );
}
