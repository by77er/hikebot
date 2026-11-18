/**
 * Where a completed round's Discord scheduled event stands, kept beside the
 * round so the panel can show it and the retry can refuse a second
 * creation: being created (since when), or why the last attempt failed. The
 * event's id itself is on the round (`setRoundEvent`). Shared by the hike
 * event feature (`hike-event.ts`) and the admin panel, which only reads it.
 */
import { hikeStart } from "../polls/dates";
import type { RoundView } from "../polls/store";

/** How long a creation in progress keeps others from starting one. */
export const EVENT_CLAIM_MS = 60_000;

const KEY_PREFIX = "hike-event:";

/** What is stored for a round without an event. */
type EventAttempt = { creatingSince: number } | { error: string };

/** Where the round's event stands, as the panel shows it. */
export type HikeEventStatus =
  | { state: "created"; eventId: string }
  | { state: "past" }
  | { state: "creating" }
  | { state: "failed"; reason: string }
  | { state: "unconfirmed" }
  | { state: "missing" };

function key(roundId: number): string {
  return `${KEY_PREFIX}${String(roundId)}`;
}

/**
 * The instant the round's hike starts: its winning date in `timeZone`. NaN
 * when the round has no decided date.
 */
export function roundStart(round: RoundView, timeZone: string): number {
  const date = round.datePoll?.options.find(
    (option) => option.id === round.dateOptionId,
  );
  return date?.dateValue == null ? NaN : hikeStart(date.dateValue, timeZone);
}

/**
 * The event's status for `round` at `now`. Without an event, a hike whose
 * start in `timeZone` is not after `now` gets none, whatever was tried. A
 * creation that started more than `EVENT_CLAIM_MS` ago is taken as lost
 * (its follow-up never finished, for example because the object
 * restarted): Discord may or may not have created the event, so it is
 * unconfirmed, and may be created again from the panel.
 */
export function hikeEventStatus(
  storage: DurableObjectStorage,
  round: RoundView,
  now: number,
  timeZone: string,
): HikeEventStatus {
  if (round.eventId !== null) {
    return { state: "created", eventId: round.eventId };
  }
  if (!(roundStart(round, timeZone) > now)) return { state: "past" };
  const attempt = storage.kv.get<EventAttempt>(key(round.id));
  if (attempt === undefined) return { state: "missing" };
  if ("error" in attempt) return { state: "failed", reason: attempt.error };
  return now - attempt.creatingSince < EVENT_CLAIM_MS
    ? { state: "creating" }
    : { state: "unconfirmed" };
}

/**
 * Marks the event of `round` as being created, unless it exists, its start
 * has passed, or another creation is in progress. Synchronous, so of two
 * clicks handled one after the other only the first gets true.
 */
export function claimHikeEvent(
  storage: DurableObjectStorage,
  round: RoundView,
  now: number,
  timeZone: string,
): boolean {
  const status = hikeEventStatus(storage, round, now, timeZone).state;
  if (status === "created" || status === "past" || status === "creating") {
    return false;
  }
  storage.kv.put<EventAttempt>(key(round.id), { creatingSince: now });
  return true;
}

/** Records why creating the round's event failed, ending the claim. */
export function recordHikeEventFailure(
  storage: DurableObjectStorage,
  roundId: number,
  reason: string,
): void {
  storage.kv.put<EventAttempt>(key(roundId), { error: reason });
}

/** Forgets the round's attempt once its event id is on the round. */
export function clearHikeEventAttempt(
  storage: DurableObjectStorage,
  roundId: number,
): void {
  storage.kv.delete(key(roundId));
}
