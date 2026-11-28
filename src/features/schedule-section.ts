/**
 * The weekly schedule in the web view (`src/guild/web-view.ts`): while it
 * is on, its weekday and time in the guild's time zone and the next thing
 * it does, found as the admin panel finds it (`nextCadenceAction`), with
 * that time written as the bot writes times, in the guild's time zone.
 * Null while it is off.
 */
import type { WebViewSource } from "../guild/web-view";
import { dateTimeIn, WEEKDAY_NAMES } from "../polls/dates";
import {
  cadenceSnapshot,
  nextCadenceAction,
  type CadenceActionKind,
} from "./cadence-state";

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
    /** `at` in `timeZone`, as the bot writes it: `Wed, 5 Jun 2030 · 09:00`. */
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

/**
 * `at` in `timeZone` as the bot writes a time everywhere:
 * `Wed, 5 Jun 2030 · 09:00`, so the page and Discord agree.
 */
function whenText(at: number, timeZone: string): string {
  return dateTimeIn(timeZone, at);
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
            when: whenText(next.at, timeZone),
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
