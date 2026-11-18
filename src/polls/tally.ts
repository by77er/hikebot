/** Same contract as `crypto.getRandomValues`, for a `Uint32Array`. */
export type RandomSource = (array: Uint32Array) => Uint32Array;

export const defaultRandom: RandomSource = (array) =>
  crypto.getRandomValues(array);

/** A uniformly random integer in `[0, n)`, without modulo bias. */
export function randomIndex(n: number, random: RandomSource): number {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) {
    throw new RangeError(`randomIndex: bad range ${String(n)}`);
  }
  const limit = 2 ** 32 - (2 ** 32 % n);
  const buffer = new Uint32Array(1);
  for (;;) {
    const value = random(buffer)[0] ?? 0;
    if (value < limit) return value % n;
  }
}

export interface OptionCount {
  optionId: number;
  votes: number;
}

export interface TallyResult {
  winnerOptionId: number;
  /** Every option that shared the top count, in input order. */
  topOptionIds: number[];
  /** True when the winner was drawn from more than one top option. */
  tieBroken: boolean;
}

/**
 * Picks the option with the most votes, drawing uniformly at random among
 * the options that share the top count. `counts` must not be empty.
 */
export function pickWinner(
  counts: readonly OptionCount[],
  random: RandomSource,
): TallyResult {
  if (counts.length === 0) throw new RangeError("pickWinner: no options");
  const top = Math.max(...counts.map((count) => count.votes));
  const topOptionIds = counts
    .filter((count) => count.votes === top)
    .map((count) => count.optionId);
  const index =
    topOptionIds.length === 1 ? 0 : randomIndex(topOptionIds.length, random);
  return {
    winnerOptionId: topOptionIds[index] ?? 0,
    topOptionIds,
    tieBroken: topOptionIds.length > 1,
  };
}

/**
 * The options ordered for display: most votes first, ties in the order the
 * options were added (lower id first). Does not change `options`.
 */
export function rankOptions<T extends { id: number; votes: number }>(
  options: readonly T[],
): T[] {
  return [...options].sort((a, b) => b.votes - a.votes || a.id - b.id);
}
