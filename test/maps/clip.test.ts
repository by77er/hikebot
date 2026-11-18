import { describe, expect, it } from "vitest";
import { clipLine, clipRing } from "../../src/maps/clip";

const RECT = { left: 0, top: 0, right: 10, bottom: 10 };
const pts = (...xy: number[]) =>
  Array.from({ length: xy.length / 2 }, (_, i) => ({
    x: xy[2 * i] ?? 0,
    y: xy[2 * i + 1] ?? 0,
  }));

function area(ring: { x: number; y: number }[]): number {
  let sum = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    sum += p.x * q.y - q.x * p.y;
  });
  return Math.abs(sum) / 2;
}

describe("clipRing", () => {
  it.each([
    { name: "inside", ring: pts(2, 2, 8, 2, 8, 8, 2, 8), area: 36 },
    {
      name: "covering the rectangle",
      ring: pts(-5, -5, 15, -5, 15, 15, -5, 15),
      area: 100,
    },
    { name: "half out", ring: pts(5, 0, 15, 0, 15, 10, 5, 10), area: 50 },
    { name: "outside", ring: pts(20, 20, 30, 20, 30, 30), area: 0 },
    {
      name: "a triangle over a corner",
      ring: pts(-2, 8, 8, -2, 8, 8),
      area: 46,
    },
  ])("keeps what is inside of a ring $name", ({ ring, area: expected }) => {
    const clipped = clipRing(ring, RECT);
    expect(area(clipped)).toBeCloseTo(expected, 6);
    for (const p of clipped) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(10);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(10);
    }
  });
});

describe("clipLine", () => {
  it.each([
    { name: "inside", line: pts(1, 1, 9, 9), parts: [pts(1, 1, 9, 9)] },
    { name: "crossing", line: pts(-5, 5, 15, 5), parts: [pts(0, 5, 10, 5)] },
    { name: "outside", line: pts(-5, -5, -1, 20), parts: [] },
    {
      name: "leaving and coming back",
      line: pts(2, 2, 2, 20, 8, 20, 8, 2),
      parts: [pts(2, 2, 2, 10), pts(8, 10, 8, 2)],
    },
    {
      name: "bending inside",
      line: pts(1, 1, 5, 5, 9, 1),
      parts: [pts(1, 1, 5, 5, 9, 1)],
    },
  ])("keeps the parts inside of a line $name", ({ line, parts }) => {
    expect(clipLine(line, RECT)).toEqual(parts);
  });
});
