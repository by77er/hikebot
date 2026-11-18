import { describe, expect, it } from "vitest";
import { defaultRandom, pickWinner, randomIndex } from "../../src/polls/tally";
import { sequence } from "./helpers";

describe("randomIndex", () => {
  it("maps the random value into range", () => {
    expect(randomIndex(3, sequence(0))).toBe(0);
    expect(randomIndex(3, sequence(4))).toBe(1);
    expect(randomIndex(3, sequence(2))).toBe(2);
  });

  it("rejects values that would bias the draw", () => {
    // 2^32 % 3 === 1, so 2^32 - 1 is the one value rejected for n = 3.
    expect(randomIndex(3, sequence(2 ** 32 - 1, 5))).toBe(2);
  });

  it("refuses an empty range", () => {
    expect(() => randomIndex(0, sequence(0))).toThrow(RangeError);
  });
});

describe("pickWinner", () => {
  it("picks the single top option without drawing", () => {
    let draws = 0;
    const result = pickWinner(
      [
        { optionId: 1, votes: 2 },
        { optionId: 2, votes: 5 },
        { optionId: 3, votes: 1 },
      ],
      (array) => {
        draws++;
        return array;
      },
    );
    expect(result).toEqual({
      winnerOptionId: 2,
      topOptionIds: [2],
      tieBroken: false,
    });
    expect(draws).toBe(0);
  });

  it("lets each tied option win and never a non-tied one", () => {
    const counts = [
      { optionId: 10, votes: 3 },
      { optionId: 11, votes: 1 },
      { optionId: 12, votes: 3 },
      { optionId: 13, votes: 3 },
    ];
    const winners = [0, 1, 2, 3, 4, 5].map(
      (value) => pickWinner(counts, sequence(value)).winnerOptionId,
    );
    expect(winners).toEqual([10, 12, 13, 10, 12, 13]);
    expect(pickWinner(counts, sequence(0))).toMatchObject({
      topOptionIds: [10, 12, 13],
      tieBroken: true,
    });
  });

  it("draws among all options when every count is zero", () => {
    const counts = [1, 2, 3].map((optionId) => ({ optionId, votes: 0 }));
    expect(pickWinner(counts, sequence(1))).toEqual({
      winnerOptionId: 2,
      topOptionIds: [1, 2, 3],
      tieBroken: true,
    });
  });

  it("is roughly uniform with the real random source", () => {
    const counts = [
      { optionId: 1, votes: 4 },
      { optionId: 2, votes: 4 },
      { optionId: 3, votes: 4 },
      { optionId: 4, votes: 2 },
    ];
    const draws = 30_000;
    const wins = new Map<number, number>();
    for (let i = 0; i < draws; i++) {
      const { winnerOptionId } = pickWinner(counts, defaultRandom);
      wins.set(winnerOptionId, (wins.get(winnerOptionId) ?? 0) + 1);
    }
    expect(wins.get(4)).toBeUndefined();
    // Expected 10,000 each with a standard deviation of about 82.
    for (const id of [1, 2, 3]) {
      expect(Math.abs((wins.get(id) ?? 0) - draws / 3)).toBeLessThan(600);
    }
  });
});
