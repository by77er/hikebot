import { env } from "cloudflare:workers";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { beforeEach, describe, expect, it } from "vitest";
import { FALLBACK_FAMILY, FAMILY, mapFonts } from "../../src/maps/font";
import {
  coveringTiles,
  tilePixels,
  viewportAt,
} from "../../src/maps/projection";
import { MapReader } from "../../src/maps/reader";
import { COLOURS } from "../../src/maps/style";
import { buildSvg, scaleBar, type Scene } from "../../src/maps/svg";
import clipSource from "../../src/maps/clip.ts?raw";
import fontSource from "../../src/maps/font.ts?raw";
import labelsSource from "../../src/maps/labels.ts?raw";
import pictureSource from "../../src/maps/picture.ts?raw";
import svgSource from "../../src/maps/svg.ts?raw";
import {
  clearBucket,
  manifestOf,
  manualClock,
  putManifest,
  putSample,
  sampleArchive,
} from "./helpers";

/** Mount Si's summit: a peak with a name and an elevation, in forest. */
const SUMMIT = { lon: -121.739, lat: 47.5069 };

beforeEach(async () => {
  await clearBucket();
  await putSample("builds/test/region.pmtiles");
  await putManifest(manifestOf([sampleArchive()]));
});

/** The scene of the sample's tiles round `at`, as the picture draws it. */
async function sceneAt(
  at: { lon: number; lat: number },
  zoom: number,
  fields: Partial<Scene> = {},
): Promise<Scene> {
  const reader = new MapReader(env.MAPS, { now: manualClock().now });
  const view = viewportAt(at, {
    zoom,
    tileZoom: Math.min(zoom + 1, 14),
    width: 1200,
    height: 800,
    pixelRatio: 2,
  });
  const tiles = [];
  for (const tile of coveringTiles(view)) {
    const bytes = await reader.tile(tile.z, tile.x, tile.y);
    if (bytes) tiles.push({ tile, data: new VectorTile(new PbfReader(bytes)) });
  }
  return {
    view,
    tiles,
    pin: at,
    units: "metric",
    attribution: "© OpenStreetMap contributors",
    fonts: mapFonts(),
    ...fields,
  };
}

const fillsOf = (svg: string) =>
  new Set([...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]));
const strokesOf = (svg: string) =>
  new Set([...svg.matchAll(/stroke="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]));

describe("buildSvg", () => {
  it("draws the land, forest, water, paths and the peak with its elevation", async () => {
    const svg = buildSvg(await sceneAt(SUMMIT, 13));

    expect(svg).toMatch(/^<svg [^>]*width="1200" height="800"/);
    const fills = fillsOf(svg);
    expect(fills).toContain(COLOURS.land);
    expect(fills).toContain(COLOURS.forest);
    expect(fills).toContain(COLOURS.water);
    expect(fills).toContain(COLOURS.peak);
    expect(svg).toMatch(
      new RegExp(`stroke="${COLOURS.path}"[^>]*stroke-dasharray`),
    );
    expect(svg).toContain(">Mount Si / q̓əlbc̓</tspan>");
    expect(svg).toContain(">1,254 m</tspan>");
  });

  it("gives elevations and the scale bar in the requested units", async () => {
    const metric = buildSvg(await sceneAt(SUMMIT, 13));
    const imperial = buildSvg(await sceneAt(SUMMIT, 13, { units: "imperial" }));

    expect(metric).toMatch(/>\d+ (m|km)<\/text>/);
    expect(imperial).toContain(">4,114 ft</tspan>");
    expect(imperial).toMatch(/>[\d.]+ (ft|mi)<\/text>/);
  });

  it("draws the pin as the blaze, with its tip on the point, outlined light then dark", async () => {
    const svg = buildSvg(await sceneAt(SUMMIT, 13));
    const [keyline, blaze] = [
      ...svg.matchAll(/<path d="M600 400[^"]*"([^>]*)\/>/g),
    ].map((match) => match[1]);
    expect(keyline).toContain(`stroke="${COLOURS.pinKeyline}"`);
    expect(keyline).toContain(`fill="none"`);
    expect(blaze).toContain(`fill="${COLOURS.pin}"`);
    expect(blaze).toContain(`stroke="${COLOURS.pinOutline}"`);
  });

  it("sets labels in Public Sans, and a name it cannot set wholly in Noto Sans", async () => {
    const svg = buildSvg(await sceneAt(SUMMIT, 13));
    const familyOf = (text: string) =>
      new RegExp(
        `<text font-family="([^"]*)"[^>]*><tspan[^>]*>${text}</tspan>`,
      ).exec(svg)?.[1];
    expect(familyOf("Little Si")).toBe(FAMILY);
    expect(familyOf("Mount Si / q̓əlbc̓")).toBe(FALLBACK_FAMILY);
  });

  it("prints the attribution it is given", async () => {
    const svg = buildSvg(
      await sceneAt(SUMMIT, 13, { attribution: "© Test & Co <data>" }),
    );
    expect(svg).toContain(">© Test &amp; Co &lt;data&gt;</text>");
  });

  it("draws buildings only from zoom 14", async () => {
    const town = { lon: -121.7849, lat: 47.4958 };
    expect(fillsOf(buildSvg(await sceneAt(town, 13)))).not.toContain(
      COLOURS.building,
    );
    expect(fillsOf(buildSvg(await sceneAt(town, 14)))).toContain(
      COLOURS.building,
    );
  });

  it("draws place names", async () => {
    const svg = buildSvg(await sceneAt({ lon: -121.7849, lat: 47.4958 }, 12));
    expect(svg).toContain(">North Bend</tspan>");
  });

  it("uses only the style's colours", async () => {
    const svg = buildSvg(await sceneAt({ lon: -121.7849, lat: 47.4958 }, 14));
    const allowed = new Set<string>(Object.values(COLOURS));
    for (const colour of [...fillsOf(svg), ...strokesOf(svg)]) {
      expect(allowed).toContain(colour);
    }
    expect(svg).not.toMatch(/(fill|stroke)="(?!#|none|url)/);
  });

  it("draws nothing but land without tiles", async () => {
    const svg = buildSvg(await sceneAt(SUMMIT, 13, { tiles: [] }));
    expect(svg).not.toContain(COLOURS.forest);
    expect(svg).toContain(COLOURS.pin);
  });
});

/**
 * A scene of made-up tiles that hold only point features, all at `x`
 * logical pixels from the left edge, half-way down a 600 by 400 picture,
 * with the pin far to the right.
 */
function pointsScene(
  x: number,
  features: { layer: string; properties: Record<string, unknown> }[],
): Scene {
  const view = viewportAt(SUMMIT, {
    zoom: 14,
    tileZoom: 14,
    width: 600,
    height: 400,
    pixelRatio: 1,
  });
  const size = tilePixels(view);
  const tiles = coveringTiles(view).map((tile) => {
    const extent = 4096;
    const at = {
      x: ((x - tile.left) / size) * extent,
      y: ((200 - tile.top) / size) * extent,
    };
    const inside = at.x >= 0 && at.y >= 0 && at.x < extent && at.y < extent;
    const layers: Record<string, unknown> = {};
    for (const { layer, properties } of inside ? features : []) {
      const feature = { type: 1, properties, loadGeometry: () => [[at]] };
      layers[layer] = { extent, length: 1, feature: () => feature };
    }
    return { tile, data: { layers } as unknown as VectorTile };
  });
  return {
    view,
    tiles,
    pin: { lon: SUMMIT.lon + 0.008, lat: SUMMIT.lat },
    units: "metric",
    attribution: "© OpenStreetMap contributors",
    fonts: mapFonts(),
  };
}

describe("label priority", () => {
  // At the left edge, a label fits only to the right of the point, so the
  // label that ranks higher takes that place and the other is left out.
  const town = {
    layer: "places",
    properties: {
      kind: "locality",
      kind_detail: "town",
      name: "Townsend",
      population_rank: 15,
    },
  };

  it("labels a summit before a town in its place", () => {
    const peak = {
      layer: "pois",
      properties: { kind: "peak", name: "Mount Rainier", elevation: 4392 },
    };
    const svg = buildSvg(pointsScene(12, [town, peak]));
    expect(svg).toContain(">Mount Rainier</tspan>");
    expect(svg).toContain(">4,392 m</tspan>");
    expect(svg).not.toContain(">Townsend</tspan>");
  });

  it("labels water before a town in its place", () => {
    const lake = {
      layer: "pois",
      properties: { kind: "water", name: "Rattlesnake Lake" },
    };
    const svg = buildSvg(pointsScene(12, [town, lake]));
    expect(svg).toContain(">Rattlesnake Lake</tspan>");
    expect(svg).not.toContain(">Townsend</tspan>");
  });

  it("moves a town aside for a summit where there is room for both", () => {
    const peak = {
      layer: "pois",
      properties: { kind: "peak", name: "Mount Rainier", elevation: 4392 },
    };
    const svg = buildSvg(pointsScene(300, [town, peak]));
    expect(svg).toContain(">Mount Rainier</tspan>");
    expect(svg).toContain(">Townsend</tspan>");
  });
});

describe("the drawing code", () => {
  it.each([
    ["svg.ts", svgSource],
    ["picture.ts", pictureSource],
    ["labels.ts", labelsSource],
    ["clip.ts", clipSource],
    ["font.ts", fontSource],
  ])("%s has no colour of its own", (_, source) => {
    expect(source).not.toMatch(
      /#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?\b|rgba?\(|hsla?\(/,
    );
    expect(source).not.toMatch(/\b(fill|stroke)="(?!none|url|\$\{)[a-z]/);
  });
});

describe("scaleBar", () => {
  it.each([
    {
      metresPerPixel: 6.5,
      maxPixels: 240,
      units: "metric",
      label: "1 km",
      pixels: 153.8,
    },
    {
      metresPerPixel: 1.6,
      maxPixels: 240,
      units: "metric",
      label: "200 m",
      pixels: 125,
    },
    {
      metresPerPixel: 26,
      maxPixels: 240,
      units: "metric",
      label: "5 km",
      pixels: 192.3,
    },
    {
      metresPerPixel: 6.5,
      maxPixels: 240,
      units: "imperial",
      label: "0.5 mi",
      pixels: 123.8,
    },
    {
      metresPerPixel: 1.6,
      maxPixels: 240,
      units: "imperial",
      label: "0.2 mi",
      pixels: 201.2,
    },
    {
      metresPerPixel: 0.2,
      maxPixels: 240,
      units: "imperial",
      label: "100 ft",
      pixels: 152.4,
    },
  ] as const)(
    "is $label at $metresPerPixel m per pixel in $units units",
    ({ metresPerPixel, maxPixels, units, label, pixels }) => {
      const bar = scaleBar(metresPerPixel, maxPixels, units);
      expect(bar.label).toBe(label);
      expect(bar.pixels).toBeCloseTo(pixels, 0);
      expect(bar.pixels).toBeLessThanOrEqual(maxPixels);
    },
  );
});
