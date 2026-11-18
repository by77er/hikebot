/**
 * Finds where each proposed location is. Coordinates the proposer wrote
 * (in the modal's map field, the name or the details) are stored as
 * `given`; every other location is looked up with OpenStreetMap's geocoder
 * by the `geo:locate` scheduled job, never while answering an interaction.
 * The job looks up one option per run, keeps runs at least
 * `LOOKUP_SPACING_MS` apart (Nominatim's usage policy allows one request a
 * second for the whole application), makes at most `MAX_PLACE_ATTEMPTS`
 * attempts per option with a growing delay, and marks the poll message for
 * a refresh when an option's lookup ends.
 */
import { GuildConfig } from "../guild/config";
import type { HandlerContext, JobHandler } from "../guild/router";
import { schedule } from "../guild/schedule";
import { firstCoordinates } from "../geo/coordinates";
import { GeocodeError, nominatim, type Place } from "../geo/nominatim";
import { PollStore, type OptionPlace, type PlaceLookup } from "../polls/store";
import { scheduleRefresh } from "./poll-ui";

/** The scheduled job that looks up pending places. */
export const LOCATE_JOB = "geo:locate";

/** The least time between two requests to the geocoder from one guild. */
export const LOOKUP_SPACING_MS = 1_100;

/**
 * How long after a location is added its lookup waits, so a burst of
 * proposals is looked up in one paced run of alarms after the poll
 * message's own refresh.
 */
export const LOOKUP_DELAY_MS = 2_000;

/** How long to wait before the second and the third attempt. */
export const RETRY_DELAYS_MS = [30_000, 120_000] as const;

/** When this guild last sent, or will next send, a request to the geocoder. */
const LAST_LOOKUP_KEY = "geo:last-lookup";

/**
 * The place of a location whose fields hold coordinates, the first of
 * `texts` that does (the map field, then the name, then the details), as
 * `given`; undefined when none does, so the option waits for a lookup.
 */
export function givenPlace(
  texts: readonly (string | null | undefined)[],
): OptionPlace | undefined {
  const point = firstCoordinates(texts);
  return point === null
    ? undefined
    : { status: "given", point, name: null, attempts: 0 };
}

/** The earliest time the next request to the geocoder may go out. */
async function nextSlot(
  storage: DurableObjectStorage,
  now: number,
): Promise<number> {
  const last = await storage.get<number>(LAST_LOOKUP_KEY);
  return last === undefined ? now : Math.max(now, last + LOOKUP_SPACING_MS);
}

/**
 * Takes the next free slot for a request to the geocoder, at `now` or
 * `LOOKUP_SPACING_MS` after the last one, and returns when it is, so a
 * caller outside the job (the home area's lookup) waits its turn too.
 */
export async function reserveLookupSlot(
  storage: DurableObjectStorage,
  now: number,
): Promise<number> {
  const slot = await nextSlot(storage, now);
  await storage.put(LAST_LOOKUP_KEY, slot);
  return slot;
}

/**
 * Schedules the lookup job for when the next pending place is due, no
 * sooner than the next free slot, nor than `LOOKUP_DELAY_MS` after a new
 * location. Does nothing when no place is pending. Called after a location
 * is added; it only writes storage.
 */
export async function scheduleLocate(
  storage: DurableObjectStorage,
  store: PollStore,
  now: number,
): Promise<void> {
  const due = store.nextPlaceLookupAt();
  if (due === null) return;
  await schedule(
    storage,
    LOCATE_JOB,
    Math.max(due, await nextSlot(storage, now)),
  );
}

/** `scheduleLocate` after a location was added: waits `LOOKUP_DELAY_MS`. */
export function scheduleNewLookup(
  storage: DurableObjectStorage,
  store: PollStore,
  now: number,
): Promise<void> {
  return scheduleLocate(storage, store, now + LOOKUP_DELAY_MS);
}

/** The delay before the attempt after `attempts` failed ones. */
export function retryDelay(attempts: number): number {
  return (
    RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1] ??
    RETRY_DELAYS_MS[0]
  );
}

/** Why a lookup failed, for the log. */
function failure(error: unknown): string {
  if (error instanceof GeocodeError) return `the geocoder ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * The `geo:locate` job: looks up the place of the pending location that is
 * due first, records the answer, marks its poll message for a refresh when
 * the lookup ended, and schedules itself for the next pending place. Run
 * before the spacing since the last request has passed, it only schedules
 * itself for then.
 */
export const locatePlaces: JobHandler = async (context: HandlerContext) => {
  const { storage } = context;
  const store = new PollStore(storage);
  const now = store.now();
  const slot = await nextSlot(storage, now);
  if (slot > now) {
    await schedule(storage, LOCATE_JOB, slot);
    return;
  }
  const pending = store.nextPendingPlace(now);
  if (pending === null) {
    await scheduleLocate(storage, store, now);
    return;
  }
  await storage.put(LAST_LOOKUP_KEY, now);
  const home = new GuildConfig(storage).get().homeArea;
  let lookup: PlaceLookup;
  try {
    const place: Place | null = await nominatim(context.env).search(
      pending.label,
      home === null ? null : { lat: home.lat, lon: home.lon },
    );
    lookup =
      place === null
        ? { kind: "not_found" }
        : { kind: "found", point: place.point, name: place.name };
  } catch (error) {
    console.error(
      `looking up the place of option ${String(pending.optionId)} (attempt ${String(pending.attempts + 1)}) failed: ${failure(error)}`,
    );
    lookup = {
      kind: "error",
      retryAt: store.now() + retryDelay(pending.attempts + 1),
    };
  }
  const place = store.recordPlaceLookup(pending.optionId, lookup);
  if (place !== null && place.status !== "pending") {
    await scheduleRefresh(storage, pending.pollId, store.now());
  }
  await scheduleLocate(storage, store, store.now());
};
