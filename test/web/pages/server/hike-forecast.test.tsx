import { describe, expect, it } from "vitest";
import { HikeForecast } from "../../../../src/web/pages/server/hike-forecast";
import {
  FORECAST_NO_PIN,
  FORECAST_PENDING,
  FORECAST_TOO_FAR,
} from "../../../../src/weather/format";
import { render, spokenText } from "../../components/render";
import hohStorm from "../../../weather/fixtures/hoh-storm-metric-edited.json";
import joshuaTree from "../../../weather/fixtures/joshua-tree-dry-imperial.json";
import paradise from "../../../weather/fixtures/paradise-snow-imperial.json";
import {
  baseView,
  forecastOf,
  noForecast,
  plannedHike,
  RECORDED_ZONE,
} from "./view";

/**
 * The section for `forecast`, read 14 minutes after it was fetched unless
 * `now` says otherwise.
 */
function shown(forecast: ReturnType<typeof forecastOf>, now?: number) {
  const fetched =
    forecast.kind === "forecast" ? forecast.fetchedAt : Date.UTC(2030, 5, 1);
  return render(
    <HikeForecast
      view={baseView({
        now: now ?? fetched + 14 * 60_000,
        plannedHike: plannedHike(),
        hikeForecast: forecast,
      })}
    />,
  );
}

describe("HikeForecast", () => {
  it("shows a dry day hour by hour in °F, with the sun's times, the updated time and Open-Meteo's credit", async () => {
    const html = shown(forecastOf(joshuaTree, "imperial", "2026-11-22 09:00"));
    const text = await spokenText(html);
    expect(text).toContain("Weather");
    expect(text).toContain(
      `Hourly forecast for Sat, 15 Jun 2030, times in ${RECORDED_ZONE}`,
    );
    expect(text).toContain(
      "Time Temperature, °F Chance of rain or snow, % Rain or snow, in Wind, mph",
    );
    expect([...html.matchAll(/<th scope="row"/g)]).toHaveLength(9);
    expect(text).toContain("Clear");
    expect(html).toContain('href="https://open-meteo.com/"');
    expect(text).toContain("Weather data by Open-Meteo.com");
    expect(text).toMatch(/Sunrise \d\d:\d\d Sunset \d\d:\d\d/);
    expect(text).toContain(
      "Checked 14 min ago · Weather data by Open-Meteo.com",
    );
    expect(html).toMatch(
      /Checked <script type="module" src="[^"]+\/ages\.mjs"><\/script><time datetime="[^"]+Z" data-age data-zone="America\/Los_Angeles">14 min ago<\/time>/,
    );
    expect(text).not.toContain("could not fetch");
    expect(text).not.toContain("only;");
  });

  it("says how old the forecast is in the content rules' words, a day on as a date", async () => {
    const forecast = forecastOf(joshuaTree, "imperial", "2026-11-22 09:00");
    if (forecast.kind !== "forecast") throw new Error("no forecast");
    const at = forecast.fetchedAt;
    for (const [after, words] of [
      [2_000, "just now"],
      [12_000, "12 s ago"],
      [3 * 3_600_000 + 60_000, "3 h ago"],
      [2 * 86_400_000, "Sat, 21 Nov 2026 · 07:00"],
    ] as const) {
      expect(await spokenText(shown(forecast, at + after))).toContain(
        `Checked ${words} ·`,
      );
    }
  });

  it("warns, above the last forecast, when fetching a newer one has been failing", async () => {
    const forecast = forecastOf(joshuaTree, "imperial", "2026-11-22 09:00");
    if (forecast.kind !== "forecast") throw new Error("no forecast");
    const text = await spokenText(shown({ ...forecast, stale: true }));
    expect(text).toMatch(
      /^Weather Warning The bot could not fetch a newer forecast\. It tries again every hour; below is the last forecast it fetched\. Hourly forecast/,
    );
  });

  it("says which hours a forecast that does not reach the end of the hike covers", async () => {
    const forecast = forecastOf(joshuaTree, "imperial", "2026-11-22 09:00");
    if (forecast.kind !== "forecast") throw new Error("no forecast");
    const text = await spokenText(
      shown({ ...forecast, partial: { from: "07:00", to: "11:00" } }),
    );
    expect(text).toContain(
      "Forecast for 07:00 to 11:00 only; later hours are not out yet.",
    );
  });

  it("shows a wet and windy day in °C, mm and km/h, with the thread's freezing level note", async () => {
    const html = shown(forecastOf(hohStorm, "metric", "2026-11-24 10:00"));
    const text = await spokenText(html);
    expect(text).toContain("Heavy rain");
    expect(text).toContain("11:00 Heavy rain 9 feels 7 95 4.6 35 gusts 74");
    expect(text).toContain("Freezing level down to");
  });

  it("shows snow with its icon and the snowfall note", async () => {
    const html = shown(forecastOf(paradise, "imperial", "2026-11-21 13:00"));
    expect(await spokenText(html)).toContain("Light snow");
    expect(html).toContain("M8 15h.01");
    expect(await spokenText(html)).toContain("Snowfall:");
  });

  it("says why there is no forecast, in the thread's words", async () => {
    for (const [reason, words] of [
      ["too_far", FORECAST_TOO_FAR],
      ["no_pin", FORECAST_NO_PIN],
      ["pending", FORECAST_PENDING],
    ] as const) {
      const html = shown(noForecast(reason));
      expect(await spokenText(html)).toBe(`Weather ${words}`);
      expect(html).not.toContain("<table");
    }
  });

  it("shows nothing while no hike is planned", () => {
    expect(render(<HikeForecast view={baseView()} />)).toBe("");
  });
});
