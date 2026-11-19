import { describe, expect, it } from "vitest";
import {
  LABEL_PRIORITY,
  WIDTHS,
  atZoom,
  type ZoomStops,
} from "../../src/maps/style";

describe("atZoom", () => {
  const stops: ZoomStops = [
    [8, 1],
    [12, 3],
    [16, 11],
  ];

  it.each([
    { name: "below the first stop", zoom: 4, value: 1 },
    { name: "on the first stop", zoom: 8, value: 1 },
    { name: "between the first two stops", zoom: 10, value: 2 },
    { name: "on a middle stop", zoom: 12, value: 3 },
    { name: "between the last two stops", zoom: 13, value: 5 },
    { name: "on the last stop", zoom: 16, value: 11 },
    { name: "above the last stop", zoom: 20, value: 11 },
  ])("is $value $name", ({ zoom, value }) => {
    expect(atZoom(stops, zoom)).toBeCloseTo(value, 9);
  });

  it("holds a single stop at every zoom", () => {
    expect(atZoom([[0, 2.5]], 3)).toBe(2.5);
    expect(atZoom([[10, 2.5]], 3)).toBe(2.5);
  });

  it("is 0 without stops", () => {
    expect(atZoom([], 12)).toBe(0);
  });

  it("interpolates the style's own widths", () => {
    expect(atZoom(WIDTHS.roadMajor, 13)).toBeCloseTo(3.5, 9);
  });
});

describe("LABEL_PRIORITY", () => {
  it("keeps summits, then water, before the places a hiker drives through", () => {
    const order = Object.entries(LABEL_PRIORITY)
      .sort(([, a], [, b]) => b - a)
      .map(([role]) => role);
    expect(order).toEqual([
      "peak",
      "water",
      "town",
      "village",
      "neighbourhood",
    ]);
  });

  it("leaves room for a town's population rank below water", () => {
    // Protomaps ranks populations from 0 to 15.
    expect(LABEL_PRIORITY.town + 15).toBeLessThan(LABEL_PRIORITY.water);
    expect(LABEL_PRIORITY.village + 15).toBeLessThan(LABEL_PRIORITY.town);
  });
});
