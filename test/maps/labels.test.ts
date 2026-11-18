import { describe, expect, it } from "vitest";
import {
  overlaps,
  placeLabels,
  type Box,
  type LabelCandidate,
} from "../../src/maps/labels";

const BOUNDS: Box = { left: 0, top: 0, right: 600, bottom: 400 };
const box = (
  left: number,
  top: number,
  width: number,
  height: number,
): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

/** A repeatable sequence of numbers in [0, 1). */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("placeLabels", () => {
  it("places no label over another, over an obstacle or outside the picture", () => {
    const next = sequence(7);
    const pin = box(290, 160, 20, 40);
    const candidates: LabelCandidate<number>[] = Array.from(
      { length: 300 },
      (_, i) => {
        const x = next() * 600;
        const y = next() * 400;
        const width = 20 + next() * 120;
        const height = 10 + next() * 10;
        return {
          priority: next() * 100,
          positions: [
            [box(x - width / 2, y - height / 2, width, height)],
            [box(x + 4, y - height / 2, width, height)],
            [
              box(x - 4 - width, y - height / 2, width, height),
              box(x - 3, y - 3, 6, 6),
            ],
          ],
          value: i,
        };
      },
    );
    const placed = placeLabels(candidates, {
      bounds: BOUNDS,
      obstacles: [pin],
      padding: 2,
    });

    expect(placed.length).toBeGreaterThan(20);
    const boxes = placed.flatMap((label) => label.boxes);
    for (const [i, a] of boxes.entries()) {
      expect(overlaps(a, pin)).toBe(false);
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.right).toBeLessThanOrEqual(600);
      expect(a.top).toBeGreaterThanOrEqual(0);
      expect(a.bottom).toBeLessThanOrEqual(400);
      for (const b of boxes.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    }
  });

  it("keeps the padding between labels and round obstacles", () => {
    const placed = placeLabels(
      [
        { priority: 1, positions: [[box(10, 10, 50, 10)]], value: "a" },
        { priority: 1, positions: [[box(61, 10, 50, 10)]], value: "too close" },
        {
          priority: 1,
          positions: [[box(200, 10, 50, 10)]],
          value: "beside the pin",
        },
      ],
      { bounds: BOUNDS, obstacles: [box(251, 10, 10, 10)], padding: 2 },
    );
    expect(placed.map((label) => label.value)).toEqual(["a"]);
  });

  it("places the more important label first", () => {
    const spot = [[box(100, 100, 80, 12)]];
    const placed = placeLabels(
      [
        { priority: 10, positions: spot, value: "village" },
        { priority: 90, positions: spot, value: "town" },
      ],
      { bounds: BOUNDS, obstacles: [], padding: 2 },
    );
    expect(placed.map((label) => label.value)).toEqual(["town"]);
  });

  it("tries the next position when the first is taken", () => {
    const placed = placeLabels(
      [
        { priority: 2, positions: [[box(100, 100, 80, 12)]], value: "first" },
        {
          priority: 1,
          positions: [[box(120, 100, 80, 12)], [box(120, 130, 80, 12)]],
          value: "second",
        },
      ],
      { bounds: BOUNDS, obstacles: [], padding: 2 },
    );
    expect(placed).toEqual([
      { value: "first", position: 0, boxes: [box(100, 100, 80, 12)] },
      { value: "second", position: 1, boxes: [box(120, 130, 80, 12)] },
    ]);
  });

  it("leaves out a label that does not fit inside the picture", () => {
    const placed = placeLabels(
      [{ priority: 1, positions: [[box(560, 10, 80, 12)]], value: "edge" }],
      { bounds: BOUNDS, obstacles: [], padding: 2 },
    );
    expect(placed).toEqual([]);
  });
});
