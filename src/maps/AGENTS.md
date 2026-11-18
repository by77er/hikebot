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

## Draw a map picture in a feature

1. Ask the `MapPainter` Durable Object for the picture; it draws it once and
   then answers from the bucket. Leave out `zoom`, `width`, `height` and
   `units` for the default 1200 by 800 picture at zoom 12 in metric units:

   ```ts
   import { mapPainter } from "../maps/map-painter";

   const picture = await mapPainter(env).picture({
     lon,
     lat,
     units: "imperial",
   });
   if (picture) {
     // picture.png is the PNG's bytes; picture.key is where the bucket keeps it.
   }
   ```

2. Show the feature without the picture when it answers `undefined`: the map
   data does not cover the point, or has not been built yet.
3. In a unit test, put the sample archive and a manifest into the bucket as
   "Test code that reads map tiles" says, and call it through `env`:

   ```ts
   const picture = await mapPainter(env).picture(SAMPLE.point);
   ```

4. Run the map tests:

   ```sh
   npx vitest run test/maps
   ```

## Change the map style

1. Change the roles' colours, opacities, widths, dashes, zooms, label sizes
   or furniture in `src/maps/style.ts`. Put every colour there, under a
   role. For a new kind of feature, add a role to `COLOURS` in
   `src/maps/style.ts` and draw it from that role in `src/maps/svg.ts`.
2. To change the typeface, put its TrueType files (regular, semibold and
   italic) and its licence in `src/maps/fonts/`, then change the imports and
   `FAMILY` in `src/maps/font.ts`. Subset each file first, with the same
   ranges as the files there, using fontTools in a virtual environment:

   ```sh
   python3 -m venv /tmp/fonttools && /tmp/fonttools/bin/pip install fonttools
   /tmp/fonttools/bin/pyftsubset <Font>-Regular.ttf --unicodes="U+0020-007E,U+00A0-024F,U+0250-02FF,U+0300-036F,U+1E00-1EFF,U+2010-2027,U+2030-205E,U+20AC,U+2116,U+2122,U+2190-2193,U+2212" --layout-features='kern,liga,ccmp,locl,mark,mkmk' --no-hinting --desubroutinize --output-file=src/maps/fonts/<Font>-Regular.ttf
   ```

3. Add 1 to `STYLE_VERSION` in `src/maps/style.ts`, so pictures drawn in the
   old style are drawn again instead of served from the bucket.
4. Draw the samples again and look at every file in `docs/maps/samples/`
   at full size and at about 400 pixels wide on a dark (`#313338`) and a
   white background, as Discord shows them. Check that the trails and the
   pin stand out, that labels are legible and do not crowd, and that the
   scale bar and the attribution read:

   ```sh
   npm run maps:samples
   ```

5. Run the map tests and commit the style, the fonts and the samples
   together:

   ```sh
   npx vitest run test/maps
   git add src/maps docs/maps/samples
   ```

6. Put the samples under `## Screenshots` in the pull request's description
   and your findings under `## Design review`.
