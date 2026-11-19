/**
 * The weekly schedule in the web view (`src/guild/web-view.ts`): while it
 * is on, its weekday and time in the guild's time zone and the next thing
 * it does, found as the admin panel finds it (`nextCadenceAction`), with
 * that time written in the guild's time zone. Null while it is off.
 */
import type { WebViewSource } from "../guild/web-view";
import { timeIn, todayIn, WEEKDAY_NAMES, weekdayOf } from "../polls/dates";
import {
  cadenceSnapshot,
  nextCadenceAction,
  type CadenceActionKind,
} from "./cadence-state";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface WebSchedule {
  /** The day the votes open and close: `Wednesday`. */
  weekday: string;
  /** Their time of day in `timeZone`: `09:00`. */
  time: string;
  /** The guild's IANA time zone. */
  timeZone: string;
  /** How many days after it opens the date vote closes. */
  dateVoteDays: number;
  /** What the schedule does next; null when it does nothing in the coming weeks. */
  next: {
    kind: CadenceActionKind;
    /** In milliseconds since the epoch. */
    at: number;
    /**
     * `at` in `timeZone`: `Wednesday 09:00` within the coming week,
     * `Wednesday 2 Dec 09:00` further ahead.
     */
    when: string;
  } | null;
  /**
   * Why `next` is null: `manual_date_vote` while a date vote started before
   * the schedule was turned on waits for an admin to close it,
   * `planned_hike` while the planned hike is further ahead than the
   * schedule looks; null otherwise.
   */
  waiting: "manual_date_vote" | "planned_hike" | null;
}

/** `at` in `timeZone` as the schedule's line says it. */
function whenText(at: number, now: number, timeZone: string): string {
  const day = todayIn(timeZone, at);
  const weekday = WEEKDAY_NAMES[weekdayOf(day)] ?? "";
  const time = timeIn(timeZone, at);
  if (at - now < WEEK_MS) return `${weekday} ${time}`;
  const [, month = 1, date = 1] = day.split("-").map(Number);
  return `${weekday} ${String(date)} ${MONTHS[month - 1] ?? ""} ${time}`;
}

/** The schedule while it is on; null while it is off. */
export function scheduleSection(source: WebViewSource): WebSchedule | null {
  const { settings, now } = source;
  const { cadence, timezone: timeZone } = settings;
  if (!cadence.enabled) return null;
  const snapshot = cadenceSnapshot(source.store, settings);
  const next = nextCadenceAction(settings, snapshot, now);
  return {
    weekday: WEEKDAY_NAMES[cadence.weekday] ?? "",
    time: cadence.time,
    timeZone,
    dateVoteDays: cadence.dateVoteDays,
    next:
      next === null
        ? null
        : {
            kind: next.kind,
            at: next.at,
            when: whenText(next.at, now, timeZone),
          },
    waiting:
      next !== null
        ? null
        : snapshot.round?.status === "date_voting"
          ? "manual_date_vote"
          : snapshot.hikeEnd !== null && snapshot.hikeEnd > now
            ? "planned_hike"
            : null,
  };
}
