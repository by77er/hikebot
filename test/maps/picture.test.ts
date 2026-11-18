import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { mapPicture } from "../../src/maps/picture";
import { MapReader } from "../../src/maps/reader";
import {
  SAMPLE,
  clearBucket,
  manifestOf,
  manualClock,
  putManifest,
  putSample,
  sampleArchive,
} from "./helpers";

beforeEach(async () => {
  await clearBucket();
});

it("draws", async () => {
  await putSample("builds/test/region.pmtiles");
  await putManifest(manifestOf([sampleArchive()]));
  const reader = new MapReader(env.MAPS, { now: manualClock().now });
  const picture = await mapPicture({ reader, bucket: env.MAPS }, SAMPLE.point);
  expect(picture?.png.length).toBeGreaterThan(1000);
});
