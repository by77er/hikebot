import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PICTURE,
  drawingZooms,
  mapPicture,
  pictureKey,
  type MapPictureDeps,
} from "../../src/maps/picture";
import { toPicture, viewportAt } from "../../src/maps/projection";
import { MapReader } from "../../src/maps/reader";
import { COLOURS, FURNITURE, STYLE_VERSION } from "../../src/maps/style";
import type { Scene } from "../../src/maps/svg";
import {
  SAMPLE,
  clearBucket,
  manifestOf,
  manualClock,
  putManifest,
  putSample,
  sampleArchive,
} from "./helpers";
import { colourDistance, decodePng } from "./png";

beforeEach(async () => {
  await clearBucket();
});

async function seed(): Promise<void> {
  await putSample("builds/test/region.pmtiles");
  await putManifest(manifestOf([sampleArchive()]));
}

function deps(fields: Partial<MapPictureDeps> = {}): MapPictureDeps {
  return {
    reader: new MapReader(env.MAPS, { now: manualClock().now }),
    bucket: env.MAPS,
    ...fields,
  };
}

describe("drawingZooms", () => {
  const world = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const region = [...world, 9, 10, 11, 12, 13, 14];
  it.each([
    {
      name: "a 2x picture in the region",
      requested: 12,
      zooms: region,
      ratio: 2,
      zoom: 12,
      tileZoom: 13,
    },
    {
      name: "a 1x picture in the region",
      requested: 12,
      zooms: region,
      ratio: 1,
      zoom: 12,
      tileZoom: 12,
    },
    {
      name: "the region's finest zoom",
      requested: 14,
      zooms: region,
      ratio: 2,
      zoom: 14,
      tileZoom: 14,
    },
    {
      name: "past the region's finest zoom",
      requested: 16,
      zooms: region,
      ratio: 2,
      zoom: 15,
      tileZoom: 14,
    },
    {
      name: "a point only the world covers",
      requested: 12,
      zooms: world,
      ratio: 2,
      zoom: 9,
      tileZoom: 8,
    },
    {
      name: "a coarse zoom over the world",
      requested: 3,
      zooms: world,
      ratio: 2,
      zoom: 3,
      tileZoom: 4,
    },
    {
      name: "a 3x picture",
      requested: 12,
      zooms: region,
      ratio: 3,
      zoom: 12,
      tileZoom: 13,
    },
    {
      name: "a zoom below every archive",
      requested: 5,
      zooms: [10, 11, 12, 13, 14],
      ratio: 2,
      zoom: 9,
      tileZoom: 10,
    },
  ])(
    "draws $name at $zoom from $tileZoom tiles",
    ({ requested, zooms, ratio, zoom, tileZoom }) => {
      expect(drawingZooms(requested, zooms, ratio)).toEqual({ zoom, tileZoom });
    },
  );
});

describe("pictureKey", () => {
  const picture = {
    lon: -121.7232,
    lat: 47.4881,
    zoom: 12,
    width: 1200,
    height: 800,
    pixelRatio: 2,
    units: "metric" as const,
    build: "20261118",
  };

  it("names the style version, build, zoom, size, units and point", () => {
    expect(pictureKey(picture)).toBe(
      `pictures/style-${String(STYLE_VERSION)}/build-20261118/z12-1200x800@2x-metric/47.48810,-121.72320.png`,
    );
  });

  it.each([
    ["lon", { lon: -121.7233 }],
    ["lat", { lat: 47.4882 }],
    ["zoom", { zoom: 13 }],
    ["width", { width: 600 }],
    ["height", { height: 600 }],
    ["pixelRatio", { pixelRatio: 1 }],
    ["units", { units: "imperial" as const }],
    ["build", { build: "20261219" }],
  ])("changes with %s", (_, change) => {
    expect(pictureKey({ ...picture, ...change })).not.toBe(pictureKey(picture));
  });
});

describe("mapPicture", () => {
  it("draws a 1200x800 PNG at zoom 12 centred on the pin by default", async () => {
    await seed();
    const picture = await mapPicture(deps(), SAMPLE.point);
    if (!picture) throw new Error("no picture");

    expect(picture.key).toContain("/z12-1200x800@2x-metric/");
    expect(picture.png.length).toBeLessThan(1_000_000);
    const png = await decodePng(picture.png);
    expect([png.width, png.height]).toEqual([
      DEFAULT_PICTURE.width,
      DEFAULT_PICTURE.height,
    ]);
    // The pin's blaze, its light outline and its dark keyline, right of it.
    const middle = 400 - ((FURNITURE.pinHeight + FURNITURE.pinTip) * 2) / 2;
    const edge = 600 + FURNITURE.pinWidth;
    expect(png.pixel(600, middle).rgb).toBe(COLOURS.pin);
    expect(png.pixel(edge + FURNITURE.pinOutline, middle).rgb).toBe(
      COLOURS.pinOutline,
    );
    expect(
      png.pixel(edge + 2 * FURNITURE.pinOutline + FURNITURE.pinKeyline, middle)
        .rgb,
    ).toBe(COLOURS.pinKeyline);
  });

  it("draws water in the water's colour", async () => {
    await seed();
    // Crater Lake, east of Dixie Peak; its name may be printed on it, so
    // look for water round the lake's middle.
    const lake = { lon: -121.7223, lat: 47.5203 };
    const centre = { lon: -121.7147, lat: 47.5213 };
    const picture = await mapPicture(deps(), { ...centre, zoom: 14 });
    if (!picture) throw new Error("no picture");
    const png = await decodePng(picture.png);
    const view = viewportAt(centre, {
      zoom: 14,
      tileZoom: 14,
      width: 1200,
      height: 800,
      pixelRatio: 2,
    });
    const at = toPicture(view, lake.lon, lake.lat);
    const around: number[] = [];
    for (let dx = -40; dx <= 40; dx += 8) {
      for (let dy = -40; dy <= 40; dy += 8) {
        around.push(
          colourDistance(png.pixel(at.x + dx, at.y + dy).rgb, COLOURS.water),
        );
      }
    }
    expect(Math.min(...around)).toBeLessThanOrEqual(8);
    expect(
      colourDistance(png.pixel(at.x - 300, at.y).rgb, COLOURS.water),
    ).toBeGreaterThan(8);
  });

  it("returns nothing where the map data does not reach", async () => {
    await seed();
    expect(await mapPicture(deps(), { lon: 2.35, lat: 48.85 })).toBeUndefined();
  });

  it("returns nothing without map data", async () => {
    expect(await mapPicture(deps(), SAMPLE.point)).toBeUndefined();
  });

  it("keeps the picture and serves it again without drawing", async () => {
    await seed();
    const draw = vi.fn((scene: Scene) =>
      Promise.resolve(new Uint8Array([scene.view.zoom, 1, 2, 3])),
    );
    const first = await mapPicture(deps({ draw }), SAMPLE.point);
    const second = await mapPicture(deps({ draw }), SAMPLE.point);

    expect(draw).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    const kept = await env.MAPS.get(first?.key ?? "");
    expect(kept?.httpMetadata?.contentType).toBe("image/png");
    expect(
      new Uint8Array((await kept?.arrayBuffer()) ?? new ArrayBuffer(0)),
    ).toEqual(new Uint8Array([12, 1, 2, 3]));
  });

  it("draws again rather than serve a picture of the previous style", async () => {
    await seed();
    const draw = vi.fn(() => Promise.resolve(new Uint8Array([2])));
    const key = (await mapPicture(deps({ draw }), SAMPLE.point))?.key ?? "";
    await clearBucket();
    await seed();
    const old = key.replace(
      `/style-${String(STYLE_VERSION)}/`,
      `/style-${String(STYLE_VERSION - 1)}/`,
    );
    expect(old).not.toBe(key);
    await env.MAPS.put(old, new Uint8Array([1]));

    const picture = await mapPicture(deps({ draw }), SAMPLE.point);

    expect(draw).toHaveBeenCalledTimes(2);
    expect(picture?.png).toEqual(new Uint8Array([2]));
    expect(await env.MAPS.head(old)).not.toBeNull();
  });

  it("draws again for another zoom, size, units or build", async () => {
    await seed();
    const draw = vi.fn(() => Promise.resolve(new Uint8Array([1])));
    await mapPicture(deps({ draw }), SAMPLE.point);
    await mapPicture(deps({ draw }), { ...SAMPLE.point, zoom: 13 });
    await mapPicture(deps({ draw }), {
      ...SAMPLE.point,
      width: 600,
      height: 400,
    });
    await mapPicture(deps({ draw }), { ...SAMPLE.point, units: "imperial" });
    await putManifest(manifestOf([sampleArchive()], { build: "20261219" }));
    await mapPicture(deps({ draw }), SAMPLE.point);

    expect(draw).toHaveBeenCalledTimes(5);
  });

  it.each([
    { lon: 200, lat: 0 },
    { lon: 0, lat: 89 },
    { lon: Number.NaN, lat: 0 },
    { lon: 0, lat: 0, zoom: 12.5 },
    { lon: 0, lat: 0, width: 10 },
    { lon: 0, lat: 0, pixelRatio: 4 },
    { lon: 0, lat: 0, units: "nautical" as "metric" },
  ])("refuses %o", async (request) => {
    await seed();
    await expect(mapPicture(deps(), request)).rejects.toThrow(RangeError);
  });
});
