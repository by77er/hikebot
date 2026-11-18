import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { isPollError, type PollErrorCode } from "../../src/polls/errors";
import { PollStore, type PollStoreOptions } from "../../src/polls/store";
import type { RandomSource } from "../../src/polls/tally";

let counter = 0;

/** A random source that returns `values` in turn, repeating the last one. */
export function sequence(...values: number[]): RandomSource {
  let index = 0;
  return (array) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = values[Math.min(index, values.length - 1)] ?? 0;
      index++;
    }
    return array;
  };
}

/** A clock that starts at `start` and advances by `step` ms per reading. */
export function clock(start = 1_800_000_000_000, step = 1000) {
  let now = start - step;
  return () => (now += step);
}

/**
 * Runs `fn` inside a fresh GuildHike with a PollStore over its storage.
 * Defaults to a stepping clock and a random source that always returns 0.
 */
export function withStore<T>(
  fn: (store: PollStore, storage: DurableObjectStorage) => T,
  options: PollStoreOptions = {},
): Promise<T> {
  counter++;
  const stub = env.GUILD_HIKE.get(
    env.GUILD_HIKE.idFromName(`polls-${String(counter)}`),
  );
  return runInDurableObject(stub, (_instance, state) =>
    fn(
      new PollStore(state.storage, {
        now: clock(),
        random: sequence(0),
        ...options,
      }),
      state.storage,
    ),
  );
}

export function locations(...labels: string[]) {
  return labels.map((label) => ({ label, proposedBy: "u-admin" }));
}

/** Asserts that `fn` throws a PollError with `code`. */
export function expectCode(fn: () => unknown, code: PollErrorCode) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${code}`).toBeDefined();
  expect(isPollError(caught) ? caught.code : caught).toBe(code);
}

export function count(storage: DurableObjectStorage, table: string): number {
  return storage.sql
    .exec<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)
    .one().n;
}

/**
 * Plays a round to `complete` with `label` as its location and `date` (a
 * `parseDateOption` line) as its date, and returns the round's id.
 */
export function completeRound(
  store: PollStore,
  label: string,
  date: string,
  details: string | null = null,
): number {
  const round = store.startRound("u-admin", [
    { label, details, proposedBy: "u-proposer" },
  ]);
  const where = round.locationPoll;
  if (!where) throw new Error("no location poll");
  store.closePoll(where.id, "u-admin");
  const other = date.startsWith("2099-12-31") ? "2099-12-30" : "2099-12-31";
  const when = store.startDatePoll(round.id, "u-admin", [date, other]);
  const pick = when.options.find((o) => o.dateValue === date.trim());
  if (!pick) throw new Error(`no date option ${date}`);
  store.setVotes(when.id, "u1", [pick.id]);
  store.closePoll(when.id, "u-admin");
  return round.id;
}
