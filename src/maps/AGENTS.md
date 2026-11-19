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

1. Ask the `MapPainter` Durable Object for the picture through
   `mapPainter(env).picture(...)`. Pass `zoom`, `width`, `height`,
   `pixelRatio` or `units` only to override `DEFAULT_PICTURE` in
   `src/maps/picture.ts`:

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

1. Read "Cairn map" in `docs/design-system.md` and keep the hierarchy it
   sets for the roles you change.
2. Change the opacities, widths, dashes, zooms, label sizes, priorities or
   furniture in `src/maps/style.ts`. To change a role's colour, edit its
   recipe in `RECIPES` there: name a Cairn token, or mix a share of one
   token into another. For a new kind of feature, add a role to `RECIPES`
   and draw it from that role in `src/maps/svg.ts`.
3. For each role whose colour you changed or added, print the colours the
   recipes make and copy the role's line into the map group at the end of
   `:root` in `public/assets/cairn/tokens.css`:

   ```sh
   npx tsx -e 'import("./src/maps/style.ts").then(({ COLOURS }) => { for (const [role, colour] of Object.entries(COLOURS)) console.log(`--map-${role.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}: ${colour};`); })'
   ```

   A new role also gets its swatch line at the end of
   `public/assets/cairn/pages/styleguide.css`, an entry in
   `MAP_ROLE_GROUPS` in `src/web/pages/styleguide/map.tsx` and a row in the
   table of "Cairn map" in `docs/design-system.md`. If a Cairn colour the
   recipes read changed in `tokens.css`, change it in `CAIRN` too. Check
   that the style, the tokens and the contrast of trails and the pin agree:

   ```sh
   npx vitest run test/maps/style-tokens.test.ts
   ```

4. To change the typeface, put its TrueType files (regular, semibold and
   italic) and its licence in `src/maps/fonts/`, then change the imports in
   `src/maps/font.ts` and `FAMILY` in `src/maps/style.ts`. Subset each file
   first, with the same ranges as the files there, using fontTools in a
   virtual environment, and give a semibold file the typographic family
   name, or the rasterizer does not find it for weight 600:

   ```sh
   python3 -m venv /tmp/fonttools && /tmp/fonttools/bin/pip install fonttools
   /tmp/fonttools/bin/pyftsubset <Font>-Regular.ttf --unicodes="U+0020-007E,U+00A0-024F,U+0250-02FF,U+0300-036F,U+1E00-1EFF,U+2010-2027,U+2030-205E,U+20AC,U+2116,U+2122,U+2190-2193,U+2212" --layout-features='kern,liga,ccmp,locl,mark,mkmk' --no-hinting --desubroutinize --output-file=src/maps/fonts/<Font>-Regular.ttf
   /tmp/fonttools/bin/python -c 'import sys; from fontTools.ttLib import TTFont; f = TTFont(sys.argv[1]); f["name"].setName(sys.argv[2], 16, 3, 1, 0x409); f["name"].setName("SemiBold", 17, 3, 1, 0x409); f.save(sys.argv[1])' src/maps/fonts/<Font>-SemiBold.ttf "<Family>"
   npx vitest run test/maps/font-metrics.test.ts
   ```

5. Add 1 to `STYLE_VERSION` in `src/maps/style.ts`, so pictures drawn in the
   old style are drawn again instead of served from the bucket.
6. Keep the samples from before the change, draw them again, and put each
   one, before and after, at 400 pixels wide on Discord's dark (`#313338`)
   and light (`#ffffff`) backgrounds, as Discord shows them on a phone. Look
   at every file in `public/assets/maps/samples/` that way and at full size.
   Check that the trail, the road to the trailhead, water and the summit's
   name and height come first, that the pin stands out on forest, water and
   snow, that labels are legible and do not crowd, and that the scale bar
   and the attribution read:

   ```sh
   mkdir -p /tmp/before && cp public/assets/maps/samples/*.png /tmp/before/
   npm run maps:samples
   git status --short public/assets/maps/samples
   ```

7. Run the map tests, take the screenshots of `/styleguide/map` and
   `/styleguide/map-view` (the map drawn in the browser, from the same
   style through `src/maps/browser-style.ts`) as "Take the screenshots" in
   `src/web/AGENTS.md` says, and commit the style, the tokens, the fonts
   and the samples together:

   ```sh
   npx vitest run test/maps test/web
   npm run screenshots
   git add src/maps public/assets docs/screenshots
   ```

8. Put the samples before and after under `## Screenshots` in the pull
   request's description and your findings under `## Design review`, as
   "Review your own UI change as a designer" in `src/web/AGENTS.md` says.
