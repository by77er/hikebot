/**
 * `npm run maps:samples`: the fixed set of map pictures a style change is
 * reviewed on, drawn from the committed sample archive into
 * `docs/maps/samples/`. This module holds the views and the loop; the entry
 * file `draw-map-samples.ts` starts the Worker in local workerd and passes
 * in the Durable Object's `picture` method and a file writer.
 */
import regions from "../maps/regions.json";

export interface SampleView {
  /** The file name under docs/maps/samples/. */
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
