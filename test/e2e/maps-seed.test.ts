import { expect, it } from "vitest";
import {
  MAP_MANIFEST_KEY,
  MAP_SAMPLE_KEY,
  type MapsBucket,
} from "./harness/maps";
import { useE2E } from "./harness/worker";

const e2e = useE2E();

it("starts the Worker with the sample map archive and its manifest in MAPS", async () => {
  const env = await e2e.harness.getWorker<{ MAPS: MapsBucket }>().getEnv();

  const manifest = JSON.parse(
    (await (await env.MAPS.get(MAP_MANIFEST_KEY))?.text()) ?? "null",
  ) as { attribution: string; archives: { key: string; maxzoom: number }[] };
  expect(manifest.attribution).toBe("© OpenStreetMap contributors");
  expect(manifest.archives).toEqual([
    expect.objectContaining({ key: MAP_SAMPLE_KEY, maxzoom: 14 }),
  ]);

  const archive = await env.MAPS.get(MAP_SAMPLE_KEY);
  const magic = new Uint8Array(
    (await archive?.arrayBuffer()) ?? new ArrayBuffer(0),
  );
  // Every PMTiles v3 archive starts with "PMTiles" and the version byte 3.
  expect(new TextDecoder().decode(magic.subarray(0, 7))).toBe("PMTiles");
  expect(magic[7]).toBe(3);
});
