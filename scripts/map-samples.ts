/**
 * `npm run maps:samples`: the fixed set of map pictures a style change is
 * reviewed on, drawn from the committed sample archive into
 * `public/assets/maps/samples/`. This module holds the views and the loop; the entry
 * file `draw-map-samples.ts` starts the Worker in local workerd and passes
 * in the Durable Object's `picture` method and a file writer.
 */
import type { VectorTile } from "@mapbox/vector-tile";
import regions from "../maps/regions.json";
import type { LabelFont } from "../src/maps/font-metrics";
import { coveringTiles, viewportAt } from "../src/maps/projection";
import { buildSvg, type Scene } from "../src/maps/svg";

export interface SampleView {
  /** The file name under public/assets/maps/samples/. */
  file: string;
  /** What the view shows, printed with the result. */
  title: string;
  lon: number;
  lat: number;
  zoom: number;
  units?: "metric" | "imperial";
}

const { lon, lat } = regions.samplePoint;

export const SAMPLE_VIEWS: SampleView[] = [
  {
    file: "trailhead-z11.png",
    title: "the sample point (Mount Si trailhead) at zoom 11",
    lon,
    lat,
    zoom: 11,
  },
  {
    file: "trailhead-z12.png",
    title: "the sample point at zoom 12, the default",
    lon,
    lat,
    zoom: 12,
  },
  {
    file: "trailhead-z12-imperial.png",
    title: "the sample point at zoom 12 in imperial units",
    lon,
    lat,
    zoom: 12,
    units: "imperial",
  },
  {
    file: "trailhead-z14.png",
    title: "the sample point at zoom 14",
    lon,
    lat,
    zoom: 14,
  },
  {
    file: "peak-z13.png",
    title: "Mount Si's summit at zoom 13",
    lon: -121.739,
    lat: 47.5069,
    zoom: 13,
  },
  {
    file: "lake-z14.png",
    title: "the shore of Crater Lake at zoom 14",
    lon: -121.7213,
    lat: 47.52,
    zoom: 14,
  },
  {
    file: "town-z14.png",
    title: "North Bend's centre at zoom 14, the densest view",
    lon: -121.7849,
    lat: 47.4958,
    zoom: 14,
  },
];

/**
 * The fills the pin must stay visible on. The sample archive has no
 * glacier, so these pictures are drawn by the real drawing code from
 * made-up tiles that hold one fill everywhere.
 */
export const PIN_FILLS = [
  { file: "pin-on-forest.png", layer: "landuse", kind: "forest" },
  { file: "pin-on-water.png", layer: "water", kind: "lake" },
  { file: "pin-on-snow.png", layer: "landcover", kind: "glacier" },
] as const;

export type PinFill = (typeof PIN_FILLS)[number];

/** The scene of a pin on one fill, at zoom 14, 1200 by 800 at 2x. */
export function pinScene(fill: PinFill, fonts: LabelFont): Scene {
  const view = viewportAt(regions.samplePoint, {
    zoom: 14,
    tileZoom: 14,
    width: 1200,
    height: 800,
    pixelRatio: 2,
  });
  const extent = 4096;
  const ring = [
    { x: -64, y: -64 },
    { x: extent + 64, y: -64 },
    { x: extent + 64, y: extent + 64 },
    { x: -64, y: extent + 64 },
    { x: -64, y: -64 },
  ];
  const feature = {
    type: 3,
    properties: { kind: fill.kind },
    loadGeometry: () => [ring],
  };
  const data = {
    layers: { [fill.layer]: { extent, length: 1, feature: () => feature } },
  } as unknown as VectorTile;
  return {
    view,
    tiles: coveringTiles(view).map((tile) => ({ tile, data })),
    pin: regions.samplePoint,
    units: "metric",
    attribution: "Made-up tiles",
    fonts: { ...fonts, forText: () => fonts },
  };
}

export interface Output {
  log: (line: string) => void;
  error: (line: string) => void;
}

export type Paint = (request: {
  lon: number;
  lat: number;
  zoom: number;
  units?: "metric" | "imperial";
}) => Promise<{ png: Uint8Array } | undefined>;

/**
 * Draws every view with `paint` and writes each picture with `write`.
 * Returns the exit code: 1 if any view had no picture.
 */
export async function drawSamples(
  paint: Paint,
  write: (file: string, png: Uint8Array) => Promise<void>,
  output: Output,
  views: SampleView[] = SAMPLE_VIEWS,
): Promise<number> {
  let failed = 0;
  for (const view of views) {
    const picture = await paint({
      lon: view.lon,
      lat: view.lat,
      zoom: view.zoom,
      ...(view.units ? { units: view.units } : {}),
    });
    if (!picture) {
      output.error(`${view.file}: no map data for ${view.title}`);
      failed++;
      continue;
    }
    await write(view.file, picture.png);
    output.log(
      `${view.file}: ${view.title}, ${String(Math.round(picture.png.length / 1024))} KiB`,
    );
  }
  return failed > 0 ? 1 : 0;
}

/**
 * Draws the pin on each fill in `PIN_FILLS` with `render`, which turns an
 * SVG into PNG bytes, and writes each picture with `write`.
 */
export async function drawPinSamples(
  render: (svg: string) => Uint8Array,
  write: (file: string, png: Uint8Array) => Promise<void>,
  output: Output,
  fonts: LabelFont,
): Promise<void> {
  for (const fill of PIN_FILLS) {
    const png = render(buildSvg(pinScene(fill, fonts)));
    await write(fill.file, png);
    output.log(
      `${fill.file}: the pin on ${fill.kind}, ${String(Math.round(png.length / 1024))} KiB`,
    );
  }
}
