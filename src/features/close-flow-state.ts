/**
 * What a closed poll's close flow still has to do, kept in the object's
 * synchronous key-value storage under `pending-close:<poll id>` from the
 * transaction that closes the poll until every part is done, so the flow
 * survives a restart of the object. A part is started (claimed) in storage
 * before its Discord call and removed once it finished, whether it
 * succeeded or failed; the record is deleted when no part is left. The
 * runner and the job that finish the flow live in `poll-ui.ts`.
 */

/** The part that edits the poll message to its final state. */
export const FINALIZE_PART = "update the poll message";

/** The part that posts the announcement, after every close step. */
export const ANNOUNCE_PART = "post the announcement";

/**
 * How long a started part keeps another run from touching it. A part
 * started longer ago than this was cut off (its run never finished).
 */
export const CLOSE_PART_CLAIM_MS = 60_000;

const KEY_PREFIX = "pending-close:";

export interface PendingPart {
  /** `FINALIZE_PART`, a close step's name, or `ANNOUNCE_PART`. */
  name: string;
  /** When a run started it, or null while no run has. */
  startedAt: number | null;
}

/** One closed poll's remaining close work. */
export interface PendingClose {
  pollId: number;
  guildId: string;
  /** The guild's time zone when the poll closed. */
  timeZone: string;
  /** What is left to do, in order. */
  parts: PendingPart[];
  /** Lines the finished close steps gave the announcement. */
  announce: string[];
}

/** Where a part stands, for the run that reads it. */
export type PartState =
  { state: "todo" } | { state: "running" } | { state: "cut-off" };

/** Parts started by a run of this instance of the object, by storage. */
const running = new WeakMap<DurableObjectStorage, Set<string>>();

function key(pollId: number): string {
  return `${KEY_PREFIX}${String(pollId)}`;
}

function runKey(pollId: number, part: string): string {
  return `${String(pollId)}:${part}`;
}

function runningIn(storage: DurableObjectStorage): Set<string> {
  let parts = running.get(storage);
  if (parts === undefined) {
    parts = new Set();
    running.set(storage, parts);
  }
  return parts;
}

/**
 * Records the close work of a poll that was just closed: the final edit,
 * then `steps` by name, then the announcement, none started. Call it in the
 * transaction that closes the poll.
 */
export function recordPendingClose(
  storage: DurableObjectStorage,
  pollId: number,
  guildId: string,
  timeZone: string,
  steps: readonly string[],
): void {
  storage.kv.put<PendingClose>(key(pollId), {
    pollId,
    guildId,
    timeZone,
    parts: [FINALIZE_PART, ...steps, ANNOUNCE_PART].map((name) => ({
      name,
      startedAt: null,
    })),
    announce: [],
  });
}

/** The poll's remaining close work, if any is left. */
export function pendingClose(
  storage: DurableObjectStorage,
  pollId: number,
): PendingClose | null {
  return storage.kv.get<PendingClose>(key(pollId)) ?? null;
}

/** Every closed poll's remaining close work, oldest poll first. */
export function pendingCloses(storage: DurableObjectStorage): PendingClose[] {
  return [...storage.kv.list<PendingClose>({ prefix: KEY_PREFIX })]
    .map(([, record]) => record)
    .filter((record) => record.parts.length > 0)
    .sort((a, b) => a.pollId - b.pollId);
}

/**
 * Where `part` stands at `now`: not started, started by a run that may
 * still finish it (one of this instance, younger than
 * `CLOSE_PART_CLAIM_MS`), or cut off: started by an earlier instance of the
 * object, which restarted since, or longer ago than the claim lasts.
 */
export function partState(
  storage: DurableObjectStorage,
  pollId: number,
  part: PendingPart,
  now: number,
): PartState {
  if (part.startedAt === null) return { state: "todo" };
  const live = runningIn(storage).has(runKey(pollId, part.name));
  return live && now - part.startedAt < CLOSE_PART_CLAIM_MS
    ? { state: "running" }
    : { state: "cut-off" };
}

/**
 * Starts `part` of the poll's close work at `now`, unless it is done or a
 * run that may still finish it holds it. Synchronous, so of two runs only
 * the first gets true.
 */
export function startPart(
  storage: DurableObjectStorage,
  pollId: number,
  name: string,
  now: number,
): boolean {
  const record = pendingClose(storage, pollId);
  const part = record?.parts.find((p) => p.name === name);
  if (record === null || part === undefined) return false;
  if (partState(storage, pollId, part, now).state === "running") return false;
  part.startedAt = now;
  storage.kv.put<PendingClose>(key(pollId), record);
  runningIn(storage).add(runKey(pollId, name));
  return true;
}

/**
 * Removes `part` from the poll's close work, adding `announce` to the
 * announcement's lines, and deletes the record once no part is left.
 */
export function finishPart(
  storage: DurableObjectStorage,
  pollId: number,
  name: string,
  announce: readonly string[] = [],
): void {
  runningIn(storage).delete(runKey(pollId, name));
  const record = pendingClose(storage, pollId);
  if (record === null) return;
  record.parts = record.parts.filter((p) => p.name !== name);
  record.announce.push(...announce);
  if (record.parts.length === 0) storage.kv.delete(key(pollId));
  else storage.kv.put<PendingClose>(key(pollId), record);
}

/** Forgets the poll's close work, for a poll that no longer exists. */
export function dropPendingClose(
  storage: DurableObjectStorage,
  pollId: number,
): void {
  storage.kv.delete(key(pollId));
}
