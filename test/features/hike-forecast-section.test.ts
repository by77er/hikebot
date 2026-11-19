import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebForecastHour } from "../../src/features/hike-forecast-section";
import { hikeStart } from "../../src/polls/dates";
import type { StoredForecast, Units } from "../../src/weather/forecast";
import {
  FORECAST_NO_PIN,
  FORECAST_PENDING,
  FORECAST_TOO_FAR,
} from "../../src/weather/format";
import { readForecast } from "../../src/weather/open-meteo";
import { completeRound } from "../polls/helpers";
import hohStorm from "../weather/fixtures/hoh-storm-metric-edited.json";
import joshuaTree from "../weather/fixtures/joshua-tree-dry-imperial.json";
import paradise from "../weather/fixtures/paradise-snow-imperial.json";
import { pinRound, viewAfter } from "./view-after";

const HOUR = 60 * 60 * 1000;
const LA = "America/Los_Angeles";
const POINT = { lat: 47.4875, lon: -121.7234 };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The recorded answer as the job stores it, a day before the hike at `date`. */
function stored(answer: unknown, units: Units, date: string): StoredForecast {
  const start = hikeStart(date, LA);
  return {
    forecast: readForecast(answer, { point: POINT, units }),
    fetchedAt: start - 26 * HOUR,
    updatedAt: start - 26 * HOUR,
  };
}

/** The view of a hike at `date`, pinned at POINT, with `forecast` stored. */
async function forecastView(
  date: string,
  forecast: StoredForecast | null,
  point: typeof POINT | null = POINT,
) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 10, 20, 12));
  const { view } = await viewAfter(801, (store) => {
    const round = completeRound(store, "Ridge", date);
    pinRound(store, round, point);
    if (forecast !== null) store.setRoundForecast(round, forecast);
  });
  return view.hikeForecast;
}

/** An hour as the thread's row shows it: the figures rounded. */
function row(hour: WebForecastHour): string {
  const whole = (value: number | null) =>
    value === null ? "–" : String(Math.round(value));
  return [
    hour.time,
    `${whole(hour.temperature)}/${whole(hour.feelsLike)}`,
    `${whole(hour.precipitationChance)}%`,
    hour.precipitation?.toFixed(2),
    `${whole(hour.wind)}/${whole(hour.gusts)}`,
    hour.conditions,
  ].join(" ");
}

describe("the web view's forecast of the planned hike", () => {
  it("has the thread's hours of a dry day in °F, inches and mph, with the sun's times and the updated time", async () => {
    const forecast = stored(joshuaTree, "imperial", "2026-11-22 09:00");
    const view = await forecastView("2026-11-22 09:00", forecast);
    if (view?.kind !== "forecast") throw new Error("no forecast");
    expect(view.hours.map(row)).toEqual([
      "07:00 47/41 0% 0.00 2/1 Clear",
      "08:00 52/45 0% 0.00 3/2 Clear",
      "09:00 54/47 0% 0.00 3/4 Clear",
      "10:00 56/49 0% 0.00 4/5 Clear",
      "11:00 57/51 0% 0.00 4/6 Clear",
      "12:00 58/52 0% 0.00 5/7 Clear",
      "13:00 59/52 0% 0.00 6/6 Clear",
      "14:00 60/51 0% 0.00 7/5 Clear",
      "15:00 59/51 0% 0.00 7/5 Clear",
    ]);
    expect(view).toMatchObject({
      units: "imperial",
      labels: { temperature: "°F", wind: "mph", precipitation: "in" },
      timeZone: LA,
      sunrise: "06:22",
      sunset: "16:36",
      notes: [],
      updatedAt: forecast.updatedAt,
      // 26 hours before 09:00 on the 22nd.
      updatedLabel: "Sat, 21 Nov 2026 · 07:00",
    });
    expect(view.hours[0]?.code).toBe(0);
    expect(structuredClone(view)).toEqual(view);
  });

  it("has a wet and windy day in °C, mm and km/h, with the freezing level the thread notes", async () => {
    const view = await forecastView(
      "2026-11-24 10:00",
      stored(hohStorm, "metric", "2026-11-24 10:00"),
    );
    if (view?.kind !== "forecast") throw new Error("no forecast");
    expect(view.labels).toMatchObject({
      temperature: "°C",
      wind: "km/h",
      precipitation: "mm",
    });
    expect(view.hours.map(row).slice(2, 5)).toEqual([
      "10:00 8/5 90% 3.10 31/68 Rain",
      "11:00 9/7 95% 4.60 35/74 Heavy rain",
      "12:00 10/8 95% 5.20 38/85 Heavy rain",
    ]);
    expect(view.notes).toEqual([
      "Freezing level down to 1,460 m (the forecast point is at 187 m)",
    ]);
  });

  it("has the snow notes of a snowy day", async () => {
    const view = await forecastView(
      "2026-11-21 13:00",
      stored(paradise, "imperial", "2026-11-21 13:00"),
    );
    if (view?.kind !== "forecast") throw new Error("no forecast");
    expect(view.hours.map((hour) => hour.conditions)).toContain("Light snow");
    expect(view.notes).toEqual([
      "Freezing level down to 3,150 ft (the forecast point is at 5,440 ft)",
      "Snowfall: 0.06 in over these hours",
    ]);
  });

  it("says, in the thread's words, that the forecast appears 16 days before the hike", async () => {
    expect(await forecastView("2026-12-20 09:00", null)).toEqual({
      kind: "none",
      reason: "too_far",
      text: FORECAST_TOO_FAR,
    });
  });

  it("says the hike has no map pin", async () => {
    expect(await forecastView("2026-11-22 09:00", null, null)).toEqual({
      kind: "none",
      reason: "no_pin",
      text: FORECAST_NO_PIN,
    });
  });

  it("says the forecast is still to come within the 16 days, and for a pin that moved", async () => {
    expect(await forecastView("2026-11-22 09:00", null)).toMatchObject({
      reason: "pending",
      text: FORECAST_PENDING,
    });
    const moved = stored(joshuaTree, "imperial", "2026-11-22 09:00");
    moved.forecast.point = { lat: 46, lon: -121 };
    expect(await forecastView("2026-11-22 09:00", moved)).toMatchObject({
      reason: "pending",
    });
  });

  it("is null with no planned hike", async () => {
    const { view } = await viewAfter(801, () => undefined);
    expect(view.hikeForecast).toBeNull();
  });
});
