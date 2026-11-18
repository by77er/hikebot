import { describe, expect, it } from "vitest";
import {
  coveringTiles,
  metresPerPixel,
  project,
  tilePixels,
  toPicture,
  unproject,
  viewportAt,
} from "../../src/maps/projection";
import { tileAt } from "./helpers";

describe("project", () => {
  it.each([
    { lon: -180, lat: 0, zoom: 0, x: 0, y: 256 },
    { lon: 0, lat: 0, zoom: 0, x: 256, y: 256 },
    { lon: 180, lat: 0, zoom: 0, x: 512, y: 256 },
    { lon: 0, lat: 85.0511287798, zoom: 0, x: 256, y: 0 },
    { lon: 0, lat: -85.0511287798, zoom: 0, x: 256, y: 512 },
    { lon: 90, lat: 0, zoom: 1, x: 768, y: 512 },
    { lon: 0, lat: 89.9, zoom: 0, x: 256, y: 0 },
  ])("puts $lon,$lat at zoom $zoom at $x,$y", ({ lon, lat, zoom, x, y }) => {
    const point = project(lon, lat, zoom);
    expect(point.x).toBeCloseTo(x, 6);
    expect(point.y).toBeCloseTo(y, 6);
  });

  it.each([
    { lon: -121.7232, lat: 47.4881, zoom: 12 },
    { lon: 151.2093, lat: -33.8688, zoom: 14 },
    { lon: 0, lat: 0, zoom: 3 },
  ])("is undone by unproject at $lon,$lat", ({ lon, lat, zoom }) => {
    const back = unproject(project(lon, lat, zoom), zoom);
    expect(back.lon).toBeCloseTo(lon, 9);
    expect(back.lat).toBeCloseTo(lat, 9);
  });

  it.each([
    { lon: -121.7232, lat: 47.4881, z: 14 },
    { lon: -121.7232, lat: 47.4881, z: 9 },
    { lon: 2.3522, lat: 48.8566, z: 12 },
  ])("agrees with the tile index of $lon,$lat at $z", ({ lon, lat, z }) => {
    const { x, y } = tileAt(lon, lat, z);
    const point = project(lon, lat, z);
    expect(Math.floor(point.x / 512)).toBe(x);
    expect(Math.floor(point.y / 512)).toBe(y);
  });
});

describe("metresPerPixel", () => {
  it.each([
    { lat: 0, zoom: 0, metres: 78271.517 },
    { lat: 0, zoom: 12, metres: 19.109 },
    { lat: 60, zoom: 12, metres: 9.555 },
  ])("is $metres at latitude $lat, zoom $zoom", ({ lat, zoom, metres }) => {
    expect(metresPerPixel(lat, zoom)).toBeCloseTo(metres, 2);
  });
});

describe("coveringTiles", () => {
  const view = (
    lon: number,
    lat: number,
    zoom: number,
    tileZoom: number,
    width = 1200,
    height = 800,
    pixelRatio = 2,
  ) => viewportAt({ lon, lat }, { zoom, tileZoom, width, height, pixelRatio });

  it.each([
    // At 2x a z12 tile is 1024 pixels, a z13 tile 512 and a z12 tile at
    // zoom 13 2048: a 1200x800 picture spans parts of that many columns and
    // rows round a tile corner, and fits in one tile round a tile's middle.
    {
      name: "z12 from z12 tiles round a corner",
      zoom: 12,
      tileZoom: 12,
      offset: 0,
      count: 4,
    },
    {
      name: "z12 from z13 tiles round a corner",
      zoom: 12,
      tileZoom: 13,
      offset: 0,
      count: 8,
    },
    {
      name: "z13 from z12 tiles round a corner",
      zoom: 13,
      tileZoom: 12,
      offset: 0,
      count: 4,
    },
    {
      name: "z13 from z12 tiles round a middle",
      zoom: 13,
      tileZoom: 12,
      offset: 256,
      count: 1,
    },
  ])("covers $name with $count tiles", ({ zoom, tileZoom, offset, count }) => {
    const centre = unproject(
      { x: 512 * 600 + offset, y: 512 * 1400 + offset },
      12,
    );
    const tiles = coveringTiles(view(centre.lon, centre.lat, zoom, tileZoom));
    expect(tiles).toHaveLength(count);
    expect(
      new Set(tiles.map((t) => `${String(t.x)}/${String(t.y)}`)).size,
    ).toBe(count);
  });

  it("places each tile where its pixels fall on the picture", () => {
    const v = view(-121.7232, 47.4881, 12, 13);
    const size = tilePixels(v);
    expect(size).toBe(512);
    for (const tile of coveringTiles(v)) {
      expect(tile.left + v.left).toBeCloseTo(tile.x * size, 6);
      expect(tile.top + v.top).toBeCloseTo(tile.y * size, 6);
      expect(tile.left).toBeLessThan(v.width);
      expect(tile.left + size).toBeGreaterThan(0);
      expect(tile.top).toBeLessThan(v.height);
      expect(tile.top + size).toBeGreaterThan(0);
    }
  });

  it("holds the tile of the centre point", () => {
    const v = view(-121.7232, 47.4881, 12, 13);
    const { x, y } = tileAt(-121.7232, 47.4881, 13);
    expect(coveringTiles(v)).toContainEqual(
      expect.objectContaining({ z: 13, x, y }),
    );
    const centre = toPicture(v, -121.7232, 47.4881);
    expect(centre.x).toBeCloseTo(600, 6);
    expect(centre.y).toBeCloseTo(400, 6);
  });

  it("wraps round the antimeridian", () => {
    const tiles = coveringTiles(view(179.99, 0, 3, 3));
    const columns = new Set(tiles.map((tile) => tile.x));
    expect(columns).toEqual(new Set([7, 0]));
  });

  it("leaves out rows beyond the poles", () => {
    const tiles = coveringTiles(view(0, 85, 2, 2));
    expect(tiles.every((tile) => tile.y >= 0 && tile.y < 4)).toBe(true);
    expect(tiles.some((tile) => tile.y === 0)).toBe(true);
  });
});
