# Working in src/geo

## Read coordinates or build a map link

1. Read a point a member wrote with `parseCoordinates(text)` from
   `src/geo/coordinates.ts`, or the first point in several fields with
   `firstCoordinates([field, name, details])`. Both return `null` when
   there is none; they never make a request, so do not expand short links.
2. Build links with `osmLink(point)`, `googleLink(point)` or
   `placeLine(point, name)` from `src/geo/links.ts`, and end any message
   that shows place data with `withAttribution(lines)` (or
   `OSM_ATTRIBUTION` as its last line).
3. To read a new kind of map link, add its pattern to `PATTERNS` in
   `src/geo/coordinates.ts`, most specific first, and add a row to the
   `reads %s` table in `test/geo/coordinates.test.ts` (and a row to the
   `returns nothing for %s` table for an out-of-range variant). Run:

   ```sh
   npx vitest run test/geo
   ```

## Call an outside service from the guild object

The geocoder client (`src/geo/nominatim.ts`) and the `geo:locate` job
(`src/features/locate.ts`) are the worked example; replace `trail` with your
service's name.

1. Write the client in a directory of its own under `src/`. Take its base
   address from a Worker var with a default, its `fetch` and timeout from
   options, send a User-Agent that names hikebot and the repository, give
   up after a timeout with `AbortSignal.timeout`, and throw one error class
   for an error status, an unreadable answer or no answer:

   ```ts
   export function trailApi(
     env: { TRAIL_BASE?: string },
     options: Omit<TrailOptions, "baseUrl"> = {},
   ): TrailApi {
     return new TrailApi({ baseUrl: env.TRAIL_BASE || undefined, ...options });
   }
   ```

2. Declare the var in `wrangler.jsonc` with the production address, as
   "Change wrangler.jsonc" in the root `AGENTS.md` says, and point the unit
   tests at a host that never answers, in `miniflare.bindings` in
   `vitest.config.ts` (`TRAIL_BASE: "https://trail.test"`), so no test
   reaches the real service.
3. Never call the service while answering an interaction. In the handler,
   store what is to be fetched as pending (a status column or a storage
   key) and schedule a job, as "Add a scheduled job" in
   `src/guild/AGENTS.md` says. The job takes one pending item per run,
   keeps the service's rate limit by storing the time of its last request
   and scheduling itself for the next free slot when it runs early, records
   the answer or schedules a retry with a growing delay, and gives up after
   a few attempts. A follow-up job that needs the answer for its reply (as
   the home area does) waits for its slot with `reserveLookupSlot` first.
4. Test the client against a stubbed `fetch` in `test/<dir>/`: the request
   it builds, its User-Agent, an empty answer, error statuses and a timeout
   (a `fetch` that rejects when the client's signal aborts). Test the job
   with real alarms and the clock set with
   `vi.useFakeTimers({ toFake: ["Date"] })`, as `test/features/locate.test.ts`
   does, and check that a handler answers without calling the service:

   ```sh
   npx vitest run test/geo test/features/locate.test.ts
   ```

5. Add a fake of the service to the end-to-end harness: a `node:http`
   server in `test/e2e/harness/fake-<service>.ts` that answers as the
   service's documentation says (quote the sentence and link the page above
   each behaviour, or say that the service's own pages do not state it),
   can fail, answer slowly (hold until released) and records requests.
   Start it in `useE2E` (`test/e2e/harness/worker.ts`), pass its address as
   the var in `vars`, expose it on the `E2E` object and fail a test whose
   requests it refused. Self-test it in `test/e2e/fake-<service>.test.ts`
   and use it in a scenario, then run:

   ```sh
   npx vitest run --project e2e test/e2e/fake-nominatim.test.ts test/e2e/locate.test.ts
   pgrep -x workerd || echo "no workerd left"
   ```

6. Describe the service, its usage limits and how the bot keeps them in
   `docs/design.md`.
