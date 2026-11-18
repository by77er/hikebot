/**
 * Where a completed round's forum thread stands, kept beside the round so
 * the panel can show it and the retry can refuse a second creation: being
 * created (since when), or why the last attempt failed. The thread's id
 * itself is on the round (`setRoundThread`). Shared by the hike thread
 * feature (`hike-thread.ts`) and the admin panel, which only reads it.
 */
import type { RoundView } from "../polls/store";

/** How long a creation in progress keeps others from starting one. */
export const THREAD_CLAIM_MS = 60_000;

const KEY_PREFIX = "hike-thread:";

/** What is stored for a round without a thread. */
type ThreadAttempt = { creatingSince: number } | { error: string };

/** Where the round's thread stands, as the panel shows it. */
export type HikeThreadStatus =
  | { state: "created"; threadId: string }
  | { state: "creating" }
  | { state: "failed"; reason: string }
  | { state: "missing" };

function key(roundId: number): string {
  return `${KEY_PREFIX}${String(roundId)}`;
}

/**
 * The thread's status for `round` at `now`. A creation that started more
 * than `THREAD_CLAIM_MS` ago is taken as lost (its follow-up never
 * finished), so the thread counts as missing again.
 */
export function hikeThreadStatus(
  storage: DurableObjectStorage,
  round: RoundView,
  now: number,
): HikeThreadStatus {
  if (round.threadId !== null) {
    return { state: "created", threadId: round.threadId };
  }
  const attempt = storage.kv.get<ThreadAttempt>(key(round.id));
  if (attempt === undefined) return { state: "missing" };
  if ("error" in attempt) return { state: "failed", reason: attempt.error };
  return now - attempt.creatingSince < THREAD_CLAIM_MS
    ? { state: "creating" }
    : { state: "missing" };
}

/**
 * Marks the thread of `round` as being created, unless it exists or another
 * creation is in progress. Synchronous, so of two clicks handled one after
 * the other only the first gets true.
 */
export function claimHikeThread(
  storage: DurableObjectStorage,
  round: RoundView,
  now: number,
): boolean {
  const status = hikeThreadStatus(storage, round, now).state;
  if (status === "created" || status === "creating") return false;
  storage.kv.put<ThreadAttempt>(key(round.id), { creatingSince: now });
  return true;
}

/** Records why creating the round's thread failed, ending the claim. */
export function recordHikeThreadFailure(
  storage: DurableObjectStorage,
  roundId: number,
  reason: string,
): void {
  storage.kv.put<ThreadAttempt>(key(roundId), { error: reason });
}

/** Forgets the round's attempt once its thread id is on the round. */
export function clearHikeThreadAttempt(
  storage: DurableObjectStorage,
  roundId: number,
): void {
  storage.kv.delete(key(roundId));
}
