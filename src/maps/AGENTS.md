# Working in src/maps

## Read map tiles in a feature

1. Keep one `MapReader` per isolate, in a module-level variable created on
   first use, so the manifest and the archives' directories stay in memory
   between requests. Pass the `MAPS` binding and the caller's clock:

   ```ts
   import { MapReader } from "../maps/reader";

   let maps: MapReader | undefined;
   function mapReader(env: Env, now: () => number): MapReader {
     maps ??= new MapReader(env.MAPS, { now });
     return maps;
   }
   ```

2. Call `tile(z, x, y)` for a tile's decompressed vector tile bytes,
   `zoomsAt(lon, lat)` for the zooms that have data at a point, and
   `attribution()` for the text to print with every map. Each answers
   `undefined` or `[]` when there is no data; show the feature without the
   map then.
3. Test it as "Test code that reads map tiles" says.

## Test code that reads map tiles

1. In a unit test, empty the local bucket before each test, put the sample
   archive under a key and a manifest that names it, using the helpers in
   `test/maps/helpers.ts`:

   ```ts
   beforeEach(async () => {
     await clearBucket();
   });

   it("draws the trail", async () => {
     await putSample("builds/test/region.pmtiles");
     await putManifest(manifestOf([sampleArchive()]));
     const map = new MapReader(env.MAPS, { now: manualClock().now });
     const { z, x, y } = tileAt(SAMPLE.point.lon, SAMPLE.point.lat, 14);
     expect(await map.tile(z, x, y)).toBeInstanceOf(Uint8Array);
   });
   ```

   To test another point, take its coordinates from
   `maps/sample/sample.json` and keep it inside the sample's `bbox`.

2. In an end-to-end scenario, call `useE2E()` and read the archive at
   `MAP_SAMPLE_KEY` from `test/e2e/harness/maps.ts` rather than putting map
   data into the bucket yourself.
3. Run the tests:

   ```sh
   npx vitest run test/maps
   ```

## Change the manifest format

1. Change `MapManifest` and `parseManifest` in `src/maps/manifest.ts`.
2. Change the `jq` program that writes `manifest.json` in the step "Upload
   the archives, then the manifest" of `.github/workflows/map-data.yml`, and
   the manifest `seedMaps` writes in `test/e2e/harness/maps.ts`.
3. Update the cases in `test/maps/manifest.test.ts` and `manifestOf` in
   `test/maps/helpers.ts`, then check:

   ```sh
   npx vitest run test/maps
   npx vitest run --project e2e test/e2e/maps-seed.test.ts
   actionlint .github/workflows/*.yml
   ```

4. Rebuild the bucket so it holds the new format, as "Rebuild the map data"
   in `maps/AGENTS.md` says.
