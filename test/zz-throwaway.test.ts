import { describe, expect, it } from "vitest";

describe("throwaway unit failure", () => {
  it("compares two objects that differ", () => {
    expect({ trail: "Mount Si", miles: 8 }).toEqual({
      trail: "Mount Si",
      miles: 9,
    });
  });
});
