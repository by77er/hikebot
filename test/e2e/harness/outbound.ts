/**
 * The outbound request log: every request the Worker made to the local
 * servers that stand in for the outside world (the fake Discord API and the
 * fake Nominatim), in the order they were recorded. Each fake stamps its
 * records with `nextSequence()`, one counter for both, so the two logs merge
 * into one order. A scenario takes a mark with `e2e.outboundMark()` before
 * an action and reads what went out since with `e2e.outbound(mark)`, for
 * example to check that closing a vote called nothing but Discord.
 */

/** One request either fake received, as the outbound log lists it. */
export interface OutboundRequest {
  /** Which fake received it. */
  host: "discord" | "nominatim";
  /** Its place in the order both fakes recorded requests in, from 1. */
  seq: number;
  /** `Date.now()` when it was recorded. */
  at: number;
  method: string;
  /** The path, for Discord below the API base. */
  path: string;
  status: number;
}

let last = 0;

/** The next sequence number for a recorded request. */
export function nextSequence(): number {
  last += 1;
  return last;
}

/** A recorded request of either fake, with the fields the log reads. */
interface Stamped {
  seq: number;
  at: number;
  method: string;
  path: string;
  status: number;
}

/**
 * The requests of both fakes recorded after the mark `after` (a `seq`, 0
 * for all), in order.
 */
export function outboundRequests(
  discord: readonly Stamped[],
  nominatim: readonly Stamped[],
  after = 0,
): OutboundRequest[] {
  const pick =
    (host: OutboundRequest["host"]) =>
    ({ seq, at, method, path, status }: Stamped): OutboundRequest => ({
      host,
      seq,
      at,
      method,
      path,
      status,
    });
  return [...discord.map(pick("discord")), ...nominatim.map(pick("nominatim"))]
    .filter((r) => r.seq > after)
    .sort((a, b) => a.seq - b.seq);
}

/** The mark that `outboundRequests` lists everything recorded after. */
export function outboundMark(
  discord: readonly Stamped[],
  nominatim: readonly Stamped[],
): number {
  // Each fake appends its records in sequence order.
  return Math.max(0, discord.at(-1)?.seq ?? 0, nominatim.at(-1)?.seq ?? 0);
}
