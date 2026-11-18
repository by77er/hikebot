/**
 * Where the map picture of a completed round's hike stands, kept beside the
 * round so the panel can show it and the retry can refuse a second run:
 * being drawn and shown (since when), why the last attempt failed, that
 * there was nothing to draw (no map data at the pin), or that the pin moved
 * since. The bucket key of the picture the thread and the event show is on
 * the round (`setRoundMapPicture`). Shared by the map picture feature
 * (`map-picture.ts`), the map pin, which records a move, and the admin
 * panel, which only reads it.
 */
import type { PlacePoint, RoundView } from "../polls/store";

/** How long a run in progress keeps others from starting one. */
export const PICTURE_CLAIM_MS = 60_000;

const KEY_PREFIX = "map-picture:";

/** What is stored for a round whose picture is not (yet) shown. */
type PictureAttempt =
  | { showingSince: number }
  | { error: string }
  | { nothing: true }
  | { moved: true };

/** Where the round's map picture stands, as the panel shows it. */
export type MapPictureStatus =
  /** On the thread and the event that exist; `key` is its bucket key. */
  | { state: "shown"; key: string }
  /**
   * Nothing to show: the hike has no pin, our map data does not cover it,
   * or neither the thread nor the event exists to show it on.
   */
  | { state: "none" }
  | { state: "showing" }
  | { state: "failed"; reason: string }
  | { state: "unconfirmed" }
  /**
   * With a thread or an event, and pinned but never shown for this pin, or
   * showing the picture of a pin that moved since.
   */
  | { state: "missing" };

function key(roundId: number): string {
  return `${KEY_PREFIX}${String(roundId)}`;
}

/** The pin of the round's decided location, if it has one. */
export function roundPin(round: RoundView): PlacePoint | null {
  return (
    round.locationPoll?.options.find(
      (option) => option.id === round.locationOptionId,
    )?.place?.point ?? null
  );
}

/**
 * The picture's status for `round` at `now`. A run that started more than
 * `PICTURE_CLAIM_MS` ago is taken as lost (cut off, for example by a
 * restart of the object): the thread may or may not show the picture, so
 * it is unconfirmed, and may be shown again from the panel.
 */
export function mapPictureStatus(
  storage: DurableObjectStorage,
  round: RoundView,
  now: number,
): MapPictureStatus {
  const attempt = storage.kv.get<PictureAttempt>(key(round.id));
  if (attempt !== undefined && "showingSince" in attempt) {
    return now - attempt.showingSince < PICTURE_CLAIM_MS
      ? { state: "showing" }
      : { state: "unconfirmed" };
  }
  if (attempt !== undefined && "error" in attempt) {
    return { state: "failed", reason: attempt.error };
  }
  const surfaces = round.threadId !== null || round.eventId !== null;
  if (attempt !== undefined && "moved" in attempt) {
    return surfaces &&
      (roundPin(round) !== null || round.mapPictureKey !== null)
      ? { state: "missing" }
      : { state: "none" };
  }
  if (round.mapPictureKey !== null) {
    return { state: "shown", key: round.mapPictureKey };
  }
  if (attempt !== undefined || roundPin(round) === null || !surfaces) {
    return { state: "none" };
  }
  return { state: "missing" };
}

/**
 * Marks the picture of `round` as being shown, unless a run is in progress.
 * Synchronous, so of two runs handled one after the other only the first
 * gets true.
 */
export function claimMapPicture(
  storage: DurableObjectStorage,
  round: RoundView,
  now: number,
): boolean {
  if (mapPictureStatus(storage, round, now).state === "showing") return false;
  storage.kv.put<PictureAttempt>(key(round.id), { showingSince: now });
  return true;
}

/** Records why showing the round's picture failed, ending the claim. */
export function recordMapPictureFailure(
  storage: DurableObjectStorage,
  roundId: number,
  reason: string,
): void {
  storage.kv.put<PictureAttempt>(key(roundId), { error: reason });
}

/** Records that there was nothing to draw at the pin, ending the claim. */
export function recordNoMapPicture(
  storage: DurableObjectStorage,
  roundId: number,
): void {
  storage.kv.put<PictureAttempt>(key(roundId), { nothing: true });
}

/**
 * Records that the pin of `round` moved, so the picture shown, if any, is
 * of the old pin. A run in progress keeps its claim: it checks the pin again
 * itself (`showMapPicture`).
 */
export function recordMapPinMoved(
  storage: DurableObjectStorage,
  round: RoundView,
  now: number,
): void {
  if (mapPictureStatus(storage, round, now).state === "showing") return;
  storage.kv.put<PictureAttempt>(key(round.id), { moved: true });
}

/** Whether two pins are the same place; two missing pins are. */
export function samePin(a: PlacePoint | null, b: PlacePoint | null): boolean {
  return a?.lat === b?.lat && a?.lon === b?.lon;
}

/** Forgets the round's attempt once its picture's key is on the round. */
export function clearMapPictureAttempt(
  storage: DurableObjectStorage,
  roundId: number,
): void {
  storage.kv.delete(key(roundId));
}
