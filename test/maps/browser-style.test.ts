import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import {
  FONT_STACKS,
  PEAK_IMAGE,
  SOURCE,
  browserStyle,
} from "../../src/maps/browser-style";
import { COLOURS, FURNITURE, OPACITY, WIDTHS } from "../../src/maps/style";
import { SAMPLE } from "./helpers";

const style = browserStyle({
  tiles: "https://hikebot.example/tiles/{z}/{x}/{y}.mvt?build=1",
  attribution: SAMPLE.attribution,
  bounds: SAMPLE.bbox,
  minzoom: SAMPLE.minzoom,
  maxzoom: SAMPLE.maxzoom,
});

/** Every string anywhere in `value` that looks like a colour. */
function colours(value: unknown): string[] {
  if (typeof value === "string")
    return /^#|^rgb|^hsl/.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(colours);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(colours);
  }
  return [];
}

describe("browserStyle", () => {
  it("is a valid MapLibre style with one vector source and no downloads besides tiles", () => {
    expect(validateStyleMin(style)).toEqual([]);
    expect(Object.keys(style.sources)).toEqual([SOURCE]);
    expect(style.glyphs).toBeUndefined();
    expect(style.sprite).toBeUndefined();
  });

  it("takes every colour from the map picture's roles", () => {
    const roles = new Set(Object.values(COLOURS));
    const used = colours(style.layers);
    expect(used.length).toBeGreaterThan(20);
    for (const colour of used) expect(roles).toContain(colour);
    expect(colours(style.metadata)).toEqual([COLOURS.peak, COLOURS.labelHalo]);
  });

  it("draws the picture's fills, roads and trails in its order, with its opacities and widths", () => {
    const ids = style.layers.map((layer) => layer.id);
    expect(ids[0]).toBe("land");
    const order = [
      "settled-landuse",
      "forest-landuse",
      "protected-area-landuse",
      "water",
      "river",
      "building",
      "road-minor-casing",
      "road-motorway-casing",
      "road-minor",
      "road-motorway",
      "rail",
      "track-halo",
      "track",
      "path-halo",
      "path",
      "label-neighbourhood",
      "label-water-line",
      "label-peak",
    ];
    const positions = order.map((id) => ids.indexOf(id));
    expect(positions).not.toContain(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Peaks are placed first, winning every overlap, as on the picture.
    expect(ids.at(-1)).toBe("label-peak");

    const layer = (id: string) => style.layers.find((l) => l.id === id);
    expect(layer("protected-area-landcover")).toMatchObject({
      paint: { "fill-opacity": OPACITY.protectedArea },
    });
    expect(layer("path")).toMatchObject({
      paint: {
        "line-color": COLOURS.path,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          ...WIDTHS.path.flat(),
        ],
      },
    });
  });

  it("sets labels in the page's typeface, by weight and style", () => {
    const fonts = (id: string) => {
      const layer = style.layers.find((l) => l.id === id);
      return layer?.type === "symbol" ? layer.layout?.["text-font"] : undefined;
    };
    expect(fonts("label-town")).toEqual(FONT_STACKS.regular);
    expect(fonts("label-peak")).toEqual(FONT_STACKS.semibold);
    expect(fonts("label-water-line")).toEqual(FONT_STACKS.italic);
    for (const stack of Object.values(FONT_STACKS)) {
      expect(stack.at(-1)).toBe("Public Sans Variable");
    }
  });

  it("names the peak triangle the browser draws, at the picture's size", () => {
    expect(style.metadata).toEqual({
      "hikebot:peak": {
        image: PEAK_IMAGE,
        size: FURNITURE.peakSize,
        fill: COLOURS.peak,
        halo: COLOURS.labelHalo,
      },
    });
  });
});
