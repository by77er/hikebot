import { env } from "cloudflare:workers";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { beforeEach, describe, expect, it } from "vitest";
import { mapFonts } from "../../src/maps/font";
import { coveringTiles, viewportAt } from "../../src/maps/projection";
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

  it("draws the pin, orange with a light outline, with its tip on the point", async () => {
    const svg = buildSvg(await sceneAt(SUMMIT, 13));
    const pin = svg.match(/<path d="M600 400[^"]*"([^>]*)\/>/);
    expect(pin?.[1]).toContain(`fill="${COLOURS.pin}"`);
    expect(pin?.[1]).toContain(`stroke="${COLOURS.pinOutline}"`);
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
