# Working in maps

## Change the mapped region

1. In `maps/regions.json`, set the `region` archive's `bbox` to the new area
   as `[west, south, east, north]` in degrees. Move `sample.bbox` and
   `samplePoint` too if they would fall outside it: the sample point lies in
   the sample area, and the sample area in the region.
2. Check the file:

   ```sh
   npx vitest run test/maps/regions.test.ts
   ```

3. Commit, push and mark the pull request ready, as "Get a pull request
   checked" in the root `AGENTS.md` says. Its `Map data` check run dry-runs
   the new region at its maxzoom and one zoom either side; read the sizes as
   "Read the sizes a map-data run reported" says.
4. If the run fails with "Over budget", lower `maxzoom` of the `region`
   archive by one; if it fails with "Zoom too low", raise it by one. Push and
   read the new run's sizes, until the run passes.
5. If you moved the sample area, the run's second job, "commit the sample
   archive", pushes a new `maps/sample/sample.pmtiles` and `sample.json` to
   the branch. Commits pushed by the workflow start no checks, so pull them
   and push a commit of your own:

   ```sh
   git pull --rebase origin <branch>
   npx vitest run test/maps
   git commit --allow-empty -m "Run the checks on the refreshed map sample"
   git push origin HEAD
   ```

6. Once the pull request merges, the push to `main` starts the build. Follow
   "Rebuild the map data" from step 2 to watch it.

## Rebuild the map data

1. Start a build of `main` by hand (the monthly schedule and every merge that
   changes `maps/regions.json` start one too):

   ```sh
   gh workflow run map-data.yml --ref main
   ```

2. Find the run and wait for it. A build takes up to two hours:

   ```sh
   gh run list --workflow map-data.yml --branch main --limit 3
   gh run watch <run-id> --exit-status
   ```

3. Read its annotations as "Read the sizes a map-data run reported" says. A
   good build has a `Build` notice, one `Uploaded world` and one
   `Uploaded region` notice with each object key and size, and a `Manifest`
   notice with the total. A failed or cancelled build leaves the previous
   manifest and its archives in place, so readers keep the old data.

## Read the sizes a map-data run reported

Job logs are not readable from every machine; the run's annotations are.

1. Find the run and its jobs:

   ```sh
   gh run list --workflow map-data.yml --limit 5
   gh run view <run-id> --json jobs --jq '.jobs[] | "\(.databaseId) \(.name) \(.conclusion)"'
   ```

2. Read the annotations of the job named `map data check` or
   `map data build`:

   ```sh
   gh api repos/by77er/hikebot/check-runs/<job-id>/annotations --jq '.[] | "\(.annotation_level) \(.title): \(.message)"'
   ```

   `Dry run: world` and `Dry run: region z<n>` give each archive's tile bytes
   and the total with the world, `Total` the configured total against the
   budget, and `R2 access` and `R2 bucket` what the CI token could do. A
   `failure` line holds Cloudflare's or the tool's message. The run's page on
   GitHub shows the same numbers as a table in its summary.

## Refresh the sample archive

The check run replaces `maps/sample/` when its note no longer matches
`sample` and `samplePoint` in `maps/regions.json`, or when the newest build's
basemap major version differs from the note's.

1. To replace it anyway, delete the archive on a branch and push it in a
   ready pull request:

   ```sh
   git rm maps/sample/sample.pmtiles
   git commit -m "Refresh the map sample"
   git push origin HEAD
   ```

2. Follow "Change the mapped region" from step 5.
