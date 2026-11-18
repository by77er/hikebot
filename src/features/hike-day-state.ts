/**
 * Where a completed round's hike-day announcement stands, kept under
 * `hike-day:<round id>` in the object's synchronous key-value storage from
 * the close of its date vote until the announcement is posted or the hike
 * is over: planned (with the guild it is for), being posted (since when),
 * or why the last attempt failed. Where the posted announcement is, is on
 * the round (`setRoundDayOf`). Shared by the hike-day feature
 * (`hike-day.ts`) and the admin panel, which only reads it.
 */
import { HIKE_DURATION_HOURS, hikeStart } from "../polls/dates";
import type { RoundView } from "../polls/store";

/** The latest the announcement goes out on the hike's day, `HH:MM`. */
export const HIKE_DAY_TIME = "07:00";

/** How long before the start the announcement goes out at the latest. */
export const HIKE_DAY_LEAD_HOURS = 2;

const HOUR_MS = 60 * 60 * 1000;

/**
 * When the announcement of a hike at `dateValue` (`YYYY-MM-DD[ HH:MM]`) in
 * `timeZone` goes out: `HIKE_DAY_TIME` on its day, or `HIKE_DAY_LEAD_HOURS`
 * before its start if that is earlier. NaN when the value is not a date.
 */
export function hikeDayTime(dateValue: string, timeZone: string): number {
  const morning = hikeStart(
    `${dateValue.slice(0, 10)} ${HIKE_DAY_TIME}`,
    timeZone,
  );
  return Math.min(
    morning,
    hikeStart(dateValue, timeZone) - HIKE_DAY_LEAD_HOURS * HOUR_MS,
  );
}

/**
 * When the round's hike starts and ends and when its announcement goes
 * out, in `timeZone`; each NaN when the round has no decided date.
 */
export function hikeDayHours(
  round: RoundView,
  timeZone: string,
): { start: number; end: number; at: number } {
  const value = round.datePoll?.options.find(
    (option) => option.id === round.dateOptionId,
  )?.dateValue;
  if (value == null) return { start: NaN, end: NaN, at: NaN };
  const start = hikeStart(value, timeZone);
  return {
    start,
    end: start + HIKE_DURATION_HOURS * HOUR_MS,
    at: hikeDayTime(value, timeZone),
  };
}

/** How long a post in progress keeps others from starting one. */
export const HIKE_DAY_CLAIM_MS = 60_000;

const KEY_PREFIX = "hike-day:";

/** What is stored for a round whose announcement is not posted. */
export type HikeDayRecord = { guildId: string } & (
  | { postingSince?: undefined; error?: undefined }
  | { postingSince: number; error?: undefined }
  | { error: string; postingSince?: undefined }
);

/** Where the round's hike-day announcement stands, as the panel shows it. */
export type HikeDayStatus =
  | { state: "posted"; channelId: string; messageId: string }
  | { state: "planned" }
  | { state: "posting" }
  | { state: "failed"; reason: string }
  | { state: "unconfirmed" }
  | { state: "none" };

function key(roundId: number): string {
  return `${KEY_PREFIX}${String(roundId)}`;
}

/**
 * The announcement's status for `round` at `now`. A post that started more
 * than `HIKE_DAY_CLAIM_MS` ago was cut off before Discord's answer came
 * back (for example because the object restarted), so it may or may not
 * have been posted: it is unconfirmed, and is never posted again without
 * an admin.
 */
export function hikeDayStatus(
  storage: DurableObjectStorage,
  round: RoundView,
  now: number,
): HikeDayStatus {
  if (round.dayOf !== null) return { state: "posted", ...round.dayOf };
  const record = storage.kv.get<HikeDayRecord>(key(round.id));
  if (record === undefined) return { state: "none" };
  if (record.error !== undefined) {
    return { state: "failed", reason: record.error };
  }
  if (record.postingSince === undefined) return { state: "planned" };
  return now - record.postingSince < HIKE_DAY_CLAIM_MS
    ? { state: "posting" }
    : { state: "unconfirmed" };
}

/** Every round with a hike-day record, by round id. */
export function hikeDayRecords(
  storage: DurableObjectStorage,
): Map<number, HikeDayRecord> {
  const records = new Map<number, HikeDayRecord>();
  for (const [name, record] of storage.kv.list<HikeDayRecord>({
    prefix: KEY_PREFIX,
  })) {
    records.set(Number(name.slice(KEY_PREFIX.length)), record);
  }
  return records;
}

/**
 * Plans the round's announcement for the guild `guildId`, unless it already
 * has a record (a second close-flow run leaves the first one's as it is).
 */
export function planHikeDay(
  storage: DurableObjectStorage,
  roundId: number,
  guildId: string,
): void {
  if (storage.kv.get(key(roundId)) !== undefined) return;
  storage.kv.put<HikeDayRecord>(key(roundId), { guildId });
}

/**
 * Marks the round's announcement as being posted for `guildId`, unless it
 * was posted or a post younger than the claim is under way. Synchronous, so
 * of two attempts only the first gets true.
 */
export function claimHikeDay(
  storage: DurableObjectStorage,
  round: RoundView,
  guildId: string,
  now: number,
): boolean {
  const state = hikeDayStatus(storage, round, now).state;
  if (state === "posted" || state === "posting") return false;
  storage.kv.put<HikeDayRecord>(key(round.id), { guildId, postingSince: now });
  return true;
}

/** Records why posting the round's announcement failed, ending the claim. */
export function recordHikeDayFailure(
  storage: DurableObjectStorage,
  roundId: number,
  guildId: string,
  reason: string,
): void {
  storage.kv.put<HikeDayRecord>(key(roundId), { guildId, error: reason });
}

/** Forgets the round's record: it was posted, or the hike is over. */
export function clearHikeDay(
  storage: DurableObjectStorage,
  roundId: number,
): void {
  storage.kv.delete(key(roundId));
}
