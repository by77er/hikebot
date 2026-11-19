import { describe, expect, it } from "vitest";
import { hikeStart } from "../../src/polls/dates";
import type { StoredForecast, Units } from "../../src/weather/forecast";
import {
  FORECAST_PENDING,
  eventForecast,
  forecastNotice,
  forecastSummary,
  forecastWindow,
  hoursBetween,
  threadForecast,
} from "../../src/weather/format";
import { readForecast } from "../../src/weather/open-meteo";
import benNevis from "./fixtures/ben-nevis-metric.json";
import hohStorm from "./fixtures/hoh-storm-metric-edited.json";
import joshuaTree from "./fixtures/joshua-tree-dry-imperial.json";
import mountSi from "./fixtures/mount-si-two-days-imperial.json";
import paradise from "./fixtures/paradise-snow-imperial.json";

const HOUR = 60 * 60 * 1000;
const LA = "America/Los_Angeles";
const POINT = { lat: 47.4875, lon: -121.7234 };

/**
 * The forecast read from a recorded answer, as stored a day before a
 * four-hour hike starting at `date` in `timeZone`.
 */
function setUp(answer: unknown, units: Units, date: string, timeZone = LA) {
  const start = hikeStart(date, timeZone);
  const stored: StoredForecast = {
    forecast: readForecast(answer, { point: POINT, units }),
    fetchedAt: start - 26 * HOUR,
    updatedAt: start - 26 * HOUR,
  };
  return { stored, hike: { start, end: start + 4 * HOUR } };
}

const updated = (stored: StoredForecast) =>
  `-# Updated <t:${String(stored.updatedAt / 1000)}:f> · checked every hour · [Weather data by Open-Meteo.com](https://open-meteo.com/)`;

const IMPERIAL_LEGEND =
  "Times in America/Los_Angeles; temperature/feels-like (°F), chance and amount of rain or snow (inches), wind/gusts (mph).";

describe("the thread's hourly block", () => {
  it("shows a dry day hour by hour from two hours before the start to two after the end, in °F, inches and mph", () => {
    const { stored, hike } = setUp(joshuaTree, "imperial", "2026-11-22 09:00");
    expect(threadForecast(stored, hike, LA).split("\n")).toEqual([
      "### Weather",
      IMPERIAL_LEGEND,
      "```",
      "           °F rain    in    mph",
      "07:00   47/41   0%  0.00    2/1  Clear",
      "08:00   52/45   0%  0.00    3/2  Clear",
      "09:00   54/47   0%  0.00    3/4  Clear",
      "10:00   56/49   0%  0.00    4/5  Clear",
      "11:00   57/51   0%  0.00    4/6  Clear",
      "12:00   58/52   0%  0.00    5/7  Clear",
      "13:00   59/52   0%  0.00    6/6  Clear",
      "14:00   60/51   0%  0.00    7/5  Clear",
      "15:00   59/51   0%  0.00    7/5  Clear",
      "```",
      // No notes: the freezing level is far above, the UV index moderate.
      "Sunrise 06:22 · Sunset 16:36",
      updated(stored),
    ]);
  });

  it("shows a wet and windy day in °C, mm and km/h, with the freezing level within reach", () => {
    const { stored, hike } = setUp(hohStorm, "metric", "2026-11-24 10:00");
    expect(threadForecast(stored, hike, LA).split("\n")).toEqual([
      "### Weather",
      "Times in America/Los_Angeles; temperature/feels-like (°C), chance and amount of rain or snow (mm), wind/gusts (km/h).",
      "```",
      "           °C rain    mm   km/h",
      "08:00     6/3  77%   1.2  25/54  Rain",
      "09:00     7/4  85%   2.4  28/62  Rain",
      "10:00     8/5  90%   3.1  31/68  Rain",
      "11:00     9/7  95%   4.6  35/74  Heavy rain",
      "12:00    10/8  95%   5.2  38/85  Heavy rain",
      "13:00    11/9  95%   3.8  37/80  Rain",
      "14:00    10/8  90%   2.9  32/68  Showers",
      "15:00     9/7  85%   1.7  28/58  Showers",
      "16:00     8/6  80%   0.9  23/47  Light showers",
      "```",
      "Sunrise 07:34 · Sunset 16:29",
      "Freezing level down to 1,460 m (the forecast point is at 187 m)",
      updated(stored),
    ]);
  });

  it("adds up the snowfall and names a freezing level below the forecast point", () => {
    const { stored, hike } = setUp(paradise, "imperial", "2026-11-21 13:00");
    const lines = threadForecast(stored, hike, LA).split("\n");
    expect(lines.slice(4, 13)).toEqual([
      "11:00   31/23  14%  0.00    6/5  Overcast",
      "12:00   32/24  14%  0.00    7/5  Overcast",
      "13:00   32/23  14%  0.00    7/6  Overcast",
      "14:00   31/22  14%  0.00    7/6  Overcast",
      "15:00   29/21  14%  0.00    6/7  Overcast",
      "16:00   27/20  14%  0.00    6/7  Overcast",
      "17:00   26/18  31%  0.00    6/7  Light snow",
      "18:00   26/18  31%  0.00    6/7  Overcast",
      "19:00   25/17  31%  0.00    5/7  Light snow",
    ]);
    expect(lines.slice(14)).toEqual([
      "Sunrise 07:18 · Sunset 16:27",
      "Freezing level down to 3,150 ft (the forecast point is at 5,440 ft)",
      "Snowfall: 0.06 in over these hours",
      updated(stored),
    ]);
  });

  it("follows a hike across midnight into the next day, with the sunrise and sunset of its first day", () => {
    const { stored, hike } = setUp(mountSi, "imperial", "2026-11-21 22:00");
    const lines = threadForecast(stored, hike, LA).split("\n");
    expect(lines.slice(4, 13)).toEqual([
      "20:00   41/34  26%  0.00   6/11  Overcast",
      "21:00   41/35  26%  0.00   6/11  Overcast",
      "22:00   41/36  26%  0.00   3/10  Overcast",
      "23:00   40/36  24%  0.00    3/9  Light drizzle",
      "00:00   40/35  24%  0.00    3/8  Light drizzle",
      "01:00   39/35  24%  0.01    3/8  Light drizzle",
      "02:00   38/35  24%  0.02    3/7  Drizzle",
      "03:00   38/34  24%  0.04    3/5  Dense drizzle",
      "04:00   39/35  24%  0.01    3/3  Light drizzle",
    ]);
    expect(lines[13]).toBe("```");
    expect(lines[14]).toBe("Sunrise 07:20 · Sunset 16:24");
  });

  it("warns of a high UV index", () => {
    const { stored, hike } = setUp(joshuaTree, "imperial", "2026-11-22 09:00");
    stored.forecast.hours = stored.forecast.hours.map((hour) => ({
      ...hour,
      uvIndex: hour.uvIndex === null ? null : hour.uvIndex * 2,
    }));
    expect(threadForecast(stored, hike, LA)).toContain(
      "\nUV index up to 9 (very high)\n",
    );
  });

  it("writes the hours in the server's time zone across a change of the clocks, which Open-Meteo's single offset ignores", () => {
    // Open-Meteo answers in the offset of the time of the request, PST,
    // for Sun 14 Mar 2027, when Los Angeles goes to PDT at 02:00. Its
    // "2027-03-14T10:00" is 18:00 UTC: 11:00 on that day's clocks.
    const answer = structuredClone(paradise);
    answer.hourly.time = answer.hourly.time.map((t) =>
      t.replace("2026-11-21", "2027-03-14"),
    );
    answer.daily.sunrise = ["2027-03-14T06:18"];
    answer.daily.sunset = ["2027-03-14T18:10"];
    const { stored, hike } = setUp(answer, "imperial", "2027-03-14 13:00");
    const lines = threadForecast(stored, hike, LA).split("\n");
    expect(lines[4]).toBe("11:00   29/21   1%  0.00    5/5  Overcast");
    expect(lines.at(-4)).toBe("Sunrise 07:18 · Sunset 19:10");
  });

  it("says the forecast is pending when the answer has none of the hike's hours", () => {
    const { stored, hike } = setUp(paradise, "imperial", "2026-11-25 11:00");
    expect(threadForecast(stored, hike, LA)).toBe(
      forecastNotice(FORECAST_PENDING),
    );
  });
});

describe("the event's compact forecast", () => {
  it("sums up the hike's hours, then one line per two hours, the updated time written out and the credit", () => {
    const { stored, hike } = setUp(hohStorm, "metric", "2026-11-24 10:00");
    expect(eventForecast(stored, hike, LA).split("\n")).toEqual([
      "Weather: 8 to 11°C, up to 95% chance of rain, gusts up to 85 km/h",
      "10:00 Rain, 8°C, rain 90%, gusts 68 km/h",
      "12:00 Heavy rain, 10°C, rain 95%, gusts 85 km/h",
      "14:00 Showers, 10°C, rain 90%, gusts 68 km/h",
      "Updated Mon, 23 Nov 2026 · 08:00 (America/Los_Angeles)",
      "Weather data by Open-Meteo.com: https://open-meteo.com/",
    ]);
  });

  it("writes a dry day in °F and mph", () => {
    const { stored, hike } = setUp(joshuaTree, "imperial", "2026-11-22 09:00");
    expect(eventForecast(stored, hike, LA).split("\n")).toEqual([
      "Weather: 54 to 59°F, 0% chance of rain, gusts up to 7 mph",
      "09:00 Clear, 54°F, rain 0%, gusts 4 mph",
      "11:00 Clear, 57°F, rain 0%, gusts 6 mph",
      "13:00 Clear, 59°F, rain 0%, gusts 6 mph",
      "Updated Sat, 21 Nov 2026 · 07:00 (America/Los_Angeles)",
      "Weather data by Open-Meteo.com: https://open-meteo.com/",
    ]);
  });

  it("writes the updated time in the server's time zone", () => {
    const { stored, hike } = setUp(
      benNevis,
      "metric",
      "2026-11-22 10:00",
      "Europe/London",
    );
    const lines = eventForecast(stored, hike, "Europe/London").split("\n");
    expect(lines[0]).toBe(
      "Weather: -3 to -2°C, up to 2% chance of rain, gusts up to 17 km/h",
    );
    expect(lines.at(-2)).toBe(
      "Updated Sat, 21 Nov 2026 · 08:00 (Europe/London)",
    );
  });
});

describe("forecastSummary", () => {
  it("is null without the hike's hours", () => {
    const { stored, hike } = setUp(paradise, "imperial", "2026-12-01 11:00");
    expect(forecastSummary(stored.forecast, hike)).toBeNull();
  });

  it("writes one temperature when it does not change", () => {
    const { stored, hike } = setUp(paradise, "imperial", "2026-11-21 11:00");
    stored.forecast.hours = stored.forecast.hours.map((hour) => ({
      ...hour,
      temperature: 40,
    }));
    expect(forecastSummary(stored.forecast, hike)).toBe(
      "40°F, up to 14% chance of rain, gusts up to 7 mph",
    );
  });
});

describe("forecastWindow and hoursBetween", () => {
  it("reach two hours before the start and after the end, starting from the hour the start falls in", () => {
    const start = hikeStart("2026-11-21 09:30", LA);
    const window = forecastWindow({ start, end: start + 4 * HOUR });
    expect(window).toEqual({ from: start - 2 * HOUR, to: start + 6 * HOUR });
    const { forecast } = setUp(paradise, "imperial", "2026-11-21 09:30").stored;
    const hours = hoursBetween(forecast, window.from, window.to);
    // 07:30 falls in the 07:00 hour; 15:30 is after the 15:00 one.
    expect(hours.map((h) => h.at)).toEqual(
      Array.from(
        { length: 9 },
        (_, i) => hikeStart("2026-11-21 07:00", LA) + i * HOUR,
      ),
    );
  });
});
