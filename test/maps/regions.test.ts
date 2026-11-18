import { describe, expect, it } from "vitest";
import regions from "../../maps/regions.json";
import { isBBox, type BBox } from "../../src/maps/manifest";

function inside(lon: number, lat: number, [w, s, e, n]: BBox): boolean {
  return lon >= w && lon <= e && lat >= s && lat <= n;
}

function within([w, s, e, n]: BBox, outer: BBox): boolean {
  return inside(w, s, outer) && inside(e, n, outer);
}

const archive = (name: string) => {
  const found = regions.archives.find((a) => a.name === name);
  if (!found) throw new Error(`maps/regions.json has no ${name} archive`);
  return found;
};

describe("maps/regions.json", () => {
  it("lists the world and region archives with well-formed boxes", () => {
    expect(regions.archives.map((a) => a.name).sort()).toEqual([
      "region",
      "world",
    ]);
    for (const a of regions.archives) {
      expect(isBBox(a.bbox), `${a.name} bbox`).toBe(true);
    }
    expect(isBBox(regions.sample.bbox), "sample bbox").toBe(true);
  });

  it("keeps the zooms in range", () => {
    for (const a of [...regions.archives, regions.sample]) {
      expect(Number.isInteger(a.minzoom)).toBe(true);
      expect(Number.isInteger(a.maxzoom)).toBe(true);
      expect(a.minzoom).toBeGreaterThanOrEqual(0);
      expect(a.minzoom).toBeLessThanOrEqual(a.maxzoom);
    }
    expect(archive("region").maxzoom).toBeLessThanOrEqual(14);
    expect(archive("world").maxzoom).toBeLessThan(archive("region").maxzoom);
    // The region starts where the world stops, so no zoom is stored twice
    // and none is missing.
    expect(archive("region").minzoom).toBe(archive("world").maxzoom + 1);
    expect(regions.sample.maxzoom).toBeLessThanOrEqual(15);
  });

  it("sets a budget of 5 GB and a sample under 2 MB", () => {
    expect(regions.budgetBytes).toBe(5_000_000_000);
    expect(regions.sample.maxBytes).toBeLessThanOrEqual(2_000_000);
  });

  it("puts the sample point inside the sample area, and both inside the region", () => {
    const { lon, lat } = regions.samplePoint;
    const sample = regions.sample.bbox as BBox;
    const region = archive("region").bbox as BBox;
    expect(inside(lon, lat, sample)).toBe(true);
    expect(inside(lon, lat, region)).toBe(true);
    expect(within(sample, region)).toBe(true);
  });

  it("records the attribution and licence the manifest carries", () => {
    expect(regions.attribution).toContain("OpenStreetMap");
    expect(regions.license).toContain("ODbL");
  });
});
