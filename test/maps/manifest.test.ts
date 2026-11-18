import { describe, expect, it } from "vitest";
import { isBBox, parseManifest } from "../../src/maps/manifest";

const VALID = {
  build: "20261117",
  basemapVersion: "4.13.0",
  createdAt: "2026-11-18T06:00:00.000Z",
  attribution: "© OpenStreetMap contributors",
  license: "ODbL",
  archives: [
    {
      name: "world",
      key: "builds/20261117-x/world.pmtiles",
      bbox: [-180, -85.0511, 180, 85.0511],
      minzoom: 0,
      maxzoom: 8,
      bytes: 1000,
    },
  ],
};

describe("parseManifest", () => {
  it("reads a manifest", () => {
    expect(parseManifest(JSON.stringify(VALID))).toEqual(VALID);
  });

  it.each([
    ["not JSON", "{"],
    ["an array", "[]"],
    ["no attribution", JSON.stringify({ ...VALID, attribution: "" })],
    ["no archives list", JSON.stringify({ ...VALID, archives: undefined })],
    [
      "a reversed box",
      JSON.stringify({
        ...VALID,
        archives: [{ ...VALID.archives[0], bbox: [10, 0, 0, 10] }],
      }),
    ],
    [
      "minzoom above maxzoom",
      JSON.stringify({
        ...VALID,
        archives: [{ ...VALID.archives[0], minzoom: 9 }],
      }),
    ],
    [
      "an empty key",
      JSON.stringify({
        ...VALID,
        archives: [{ ...VALID.archives[0], key: "" }],
      }),
    ],
  ])("rejects %s", (_name, text) => {
    expect(parseManifest(text)).toBeUndefined();
  });
});

describe("isBBox", () => {
  it.each([
    [[-125, 32, -114, 49.5], true],
    [[-125, 32, -114], false],
    [[-125, 49.5, -114, 32], false],
    [[-190, 32, -114, 49.5], false],
    [[-125, 32, -114, Number.NaN], false],
    ["-125,32,-114,49.5", false],
  ])("%j is a box: %s", (bbox, expected) => {
    expect(isBBox(bbox)).toBe(expected);
  });
});
