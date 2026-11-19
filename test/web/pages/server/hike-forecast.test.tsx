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

function shown(forecast: ReturnType<typeof forecastOf>) {
  return render(
    <HikeForecast
      view={baseView({ plannedHike: plannedHike(), hikeForecast: forecast })}
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
    expect(text).toContain("Time Conditions Temperature Rain or snow Wind");
    expect([...html.matchAll(/<th scope="row"/g)]).toHaveLength(9);
    expect(text).toContain("Clear");
    expect(html).toContain('href="https://open-meteo.com/"');
    expect(text).toContain("Weather data by Open-Meteo.com");
    expect(text).toMatch(/Sunrise \d\d:\d\d Sunset \d\d:\d\d/);
    expect(text).toContain(`(${RECORDED_ZONE}) · checked every hour`);
  });

  it("shows a wet and windy day in °C, mm and km/h, with the thread's freezing level note", async () => {
    const html = shown(forecastOf(hohStorm, "metric", "2026-11-24 10:00"));
    const text = await spokenText(html);
    expect(text).toContain("35 km/h gusts 74");
    expect(text).toContain("Heavy rain");
    expect(text).toContain(
      "11:00 Heavy rain 9°C feels 7° 95% 4.6 mm 35 km/h gusts 74",
    );
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
