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
  it("has a row per hour, headed by its time, with each column's unit once in its head", async () => {
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
      "Hourly forecast for Sat, 15 Jun 2030, times in America/Los_Angeles Time Conditions Temperature, °F Chance of rain or snow, % Rain or snow, in Wind, mph 09:00 Light rain 50 feels 45 40 0.01 9 gusts 22 10:00 Clear 50 feels 45 40 0.01 9 gusts 22",
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
      "c Time Conditions Temperature, °C Chance of rain or snow, % Rain or snow, mm Wind, km/h 09:00 Light rain 0 feels -7 40 3.1 31 gusts 68",
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

  it("aligns every number column right, head and cells, with bare figures", () => {
    const html = render(
      <ForecastTable caption="c" hours={[hour()]} units={METRIC} />,
    );
    const heads = [...html.matchAll(/<th scope="col"( class="[^"]*")?>/g)];
    expect(heads.map(([, cls]) => cls ?? "")).toEqual([
      "",
      "",
      ' class="forecast-table__number"',
      ' class="forecast-table__number"',
      ' class="forecast-table__number"',
      ' class="forecast-table__number"',
    ]);
    expect(html.match(/<td class="forecast-table__number">/g)).toHaveLength(4);
    for (const unit of ["°C", "%", "mm", "km/h"]) {
      expect(html).toContain(
        `<span class="forecast-table__unit">${unit}</span>`,
      );
      // In the head only (shown, and read out with the name), never in a cell.
      expect(html.split(unit)).toHaveLength(3);
    }
  });
});
