import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { mapPainter } from "../../src/maps/map-painter";
import {
  SAMPLE,
  clearBucket,
  manifestOf,
  putManifest,
  putSample,
  sampleArchive,
} from "./helpers";
import { decodePng } from "./png";

beforeEach(async () => {
  await clearBucket();
});

it("draws a picture inside the Durable Object and keeps it in the bucket", async () => {
  await putSample("builds/test/region.pmtiles");
  await putManifest(manifestOf([sampleArchive()]));
  const picture = await mapPainter(env).picture({
    ...SAMPLE.point,
    zoom: 13,
    width: 600,
    height: 400,
  });
  if (!picture) throw new Error("no picture");

  const png = await decodePng(picture.png);
  expect([png.width, png.height]).toEqual([600, 400]);
  expect(await env.MAPS.head(picture.key)).not.toBeNull();
});

it("answers nothing without map data", async () => {
  expect(await mapPainter(env).picture(SAMPLE.point)).toBeUndefined();
});
