import { describe, expect, it } from "vitest";
import {
  ForecastTable,
  type ForecastTableHour,
} from "../../../src/web/components/forecast-table";
import { render, spokenText } from "./render";

const NINE = Date.UTC(2030, 5, 15, 16);

function hour(overrides: Partial<ForecastTableHour> = {}): ForecastTableHour {
  return {
    at: NINE,
    time: "09:00",
    code: 61,
    conditions: "Light rain",
    temperature: 49.6,
    feelsLike: 45.2,
    precipitationChance: 40,
    precipitation: 0.014,
    wind: 9.4,
    gusts: 21.6,
    ...overrides,
  };
}

const IMPERIAL = {
  temperature: "°F",
  precipitation: "in",
  wind: "mph",
  decimals: 2,
};
const METRIC = {
  temperature: "°C",
  precipitation: "mm",
  wind: "km/h",
  decimals: 1,
};

describe("ForecastTable", () => {
  it("has a row per hour, headed by its time, with each figure saying what it is", async () => {
    const html = render(
      <ForecastTable
        caption="Hourly forecast for Sat, 15 Jun 2030, times in America/Los_Angeles"
        hours={[
          hour(),
          hour({
            at: NINE + 3_600_000,
            time: "10:00",
            code: 0,
            conditions: "Clear",
          }),
        ]}
        units={IMPERIAL}
      />,
    );
    expect(await spokenText(html)).toBe(
      "Hourly forecast for Sat, 15 Jun 2030, times in America/Los_Angeles Time Conditions Temperature Rain or snow Wind 09:00 Light rain 50°F feels 45° 40% 0.01 in 9 mph gusts 22 10:00 Clear 50°F feels 45° 40% 0.01 in 9 mph gusts 22",
    );
    expect(html).toContain(
      '<th scope="row"><time datetime="2030-06-15T16:00:00.000Z">09:00</time></th>',
    );
    // The icon is decorative: the words carry the conditions.
    expect(html).toMatch(
      /<svg class="icon icon--small"[^>]*aria-hidden="true"/,
    );
  });

  it("writes metric figures with one decimal of mm", async () => {
    const text = await spokenText(
      render(
        <ForecastTable
          caption="c"
          hours={[
            hour({
              temperature: -0.4,
              feelsLike: -6.6,
              precipitation: 3.14,
              wind: 31,
              gusts: 68,
            }),
          ]}
          units={METRIC}
        />,
      ),
    );
    expect(text).toContain(
      "09:00 Light rain 0°C feels -7° 40% 3.1 mm 31 km/h gusts 68",
    );
  });

  it("writes a dash for what the forecast lacks", async () => {
    const text = await spokenText(
      render(
        <ForecastTable
          caption="c"
          hours={[
            hour({
              code: null,
              conditions: "?",
              temperature: null,
              feelsLike: null,
              precipitationChance: null,
              precipitation: null,
              wind: null,
              gusts: null,
            }),
          ]}
          units={METRIC}
        />,
      ),
    );
    expect(text).toContain("09:00 ? – feels – – – – gusts –");
  });
});
