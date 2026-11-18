import { env } from "cloudflare:workers";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { beforeEach, expect, it } from "vitest";
import { rasterize } from "../../src/maps/rasterize";
import { MapReader } from "../../src/maps/reader";
import {
  SAMPLE,
  clearBucket,
  manifestOf,
  manualClock,
  putManifest,
  putSample,
  sampleArchive,
  tileAt,
} from "./helpers";

beforeEach(async () => {
  await clearBucket();
});

it("draws a tile from the local bucket as a PNG", async () => {
  await putSample("builds/test/region.pmtiles");
  await putManifest(manifestOf([sampleArchive()]));
  const map = new MapReader(env.MAPS, { now: manualClock().now });
  const { z, x, y } = tileAt(SAMPLE.point.lon, SAMPLE.point.lat, 12);
  const bytes = await map.tile(z, x, y);
  if (!bytes) throw new Error("no tile");
  const tile = new VectorTile(new PbfReader(bytes));
  const water = tile.layers.water;
  if (!water) throw new Error("no water layer");
  const scale = 256 / water.extent;
  const paths: string[] = [];
  for (let i = 0; i < water.length; i++) {
    const rings = water.feature(i).loadGeometry();
    paths.push(
      rings
        .map(
          (ring) =>
            "M" +
            ring
              .map((p) => `${String(p.x * scale)} ${String(p.y * scale)}`)
              .join("L"),
        )
        .join(""),
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#fff"/><path d="${paths.join("")}" fill="none" stroke="#00f"/></svg>`;
  const png = await rasterize(svg, []);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset);
  expect(view.getUint32(16)).toBe(256);
  expect(view.getUint32(20)).toBe(256);
});
