# Working in src/weather

## Record an Open-Meteo answer for the tests

The formatter's tests in `test/weather/format.test.ts` read answers
recorded from Open-Meteo in `test/weather/fixtures/`. The example records
Paradise on Mount Rainier in imperial units; use your point, zone, dates
and units.

1. Ask Open-Meteo for the variables the client asks for (see
   `HOURLY_VARIABLES` and `DAILY_VARIABLES` in `src/weather/open-meteo.ts`),
   for a day within the next 16 days, and keep the answer as it came:

   ```sh
   curl -fsS "https://api.open-meteo.com/v1/forecast?latitude=46.7859&longitude=-121.7353&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,snowfall,freezing_level_height,uv_index&daily=sunrise,sunset&timezone=America%2FLos_Angeles&start_date=2026-11-21&end_date=2026-11-21&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch" -o test/weather/fixtures/paradise-snow-imperial.json
   ```

   For metric, ask with `temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm`.
   Name the file after the place, the weather it shows and the units. If you
   change values by hand to get weather the forecast does not have, add
   `-edited` to the name.

2. Import it in the test and render it with `setUp(<answer>, "<units>",
"<YYYY-MM-DD HH:MM>")`, giving a start whose block falls in the
   recorded day, then write the lines you expect, as "shows a dry day hour
   by hour" does.
3. Run the tests:

   ```sh
   npx vitest run test/weather
   ```

## Change what the forecast shows

1. Change the text in `src/weather/format.ts`: `threadForecast` for the
   hike thread's block, `eventForecast` for the event's description,
   `forecastSummary` for the one line the event and the hike-day
   announcement start with. Words for a weather code are in
   `src/weather/wmo.ts`. Keep every function pure: take the time zone and
   the times as arguments.
2. Update the expected lines in `test/weather/format.test.ts`, and the
   texts the job's tests look for in `test/features/weather.test.ts`.
3. Check the lengths: "Discord's limits" in `test/features/weather.test.ts`
   renders the longest thread message and event description with the
   forecast. Run both, then the scenario:

   ```sh
   npx vitest run test/weather test/features/weather.test.ts
   npx vitest run --project e2e test/e2e/weather.test.ts
   pgrep -x workerd || echo "no workerd left"
   ```

## Ask Open-Meteo for another variable

1. Look the variable up in Open-Meteo's documentation
   (https://open-meteo.com/en/docs): its name, its unit in each unit system
   and whether it holds at the hour or covers the hour before.
2. Add its name to `HOURLY_VARIABLES` (or `DAILY_VARIABLES`) in
   `src/weather/open-meteo.ts`, a field for it to `ForecastHour` in
   `src/weather/forecast.ts`, and read it in `readForecast`, converting it
   when Open-Meteo's unit can differ from the server's units.
3. Record answers that have it, as "Record an Open-Meteo answer for the
   tests" says, and teach the fake in
   `test/e2e/harness/fake-open-meteo.ts` to answer it.
4. Run the client's tests and the fake's:

   ```sh
   npx vitest run test/weather
   npx vitest run --project e2e test/e2e/fake-open-meteo.test.ts
   ```
