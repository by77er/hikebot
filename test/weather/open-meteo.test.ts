import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPEN_METEO_BASE,
  ForecastError,
  OPEN_METEO_USER_AGENT,
  OpenMeteo,
  openMeteo,
  readForecast,
  type ForecastQuery,
} from "../../src/weather/open-meteo";
import benNevis from "./fixtures/ben-nevis-metric.json";
import bergen from "./fixtures/bergen-metric.json";
import paradise from "./fixtures/paradise-snow-imperial.json";

const QUERY: ForecastQuery = {
  point: { lat: 46.78591, lon: -121.73532 },
  timeZone: "America/Los_Angeles",
  startDate: "2026-11-21",
  endDate: "2026-11-22",
  units: "imperial",
};

/** A stub Open-Meteo: answers each request with `answer` and keeps it. */
function stub(answer: (request: Request) => Promise<Response> | Response) {
  const requests: Request[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    return Promise.resolve(answer(request));
  };
  return { fetch, requests };
}

describe("OpenMeteo", () => {
  it("asks for the hourly and daily variables the formatter reads, between the dates, in the time zone and the units", async () => {
    const { fetch, requests } = stub(() => Response.json(paradise));
    await new OpenMeteo({ baseUrl: "https://weather.test/", fetch }).forecast(
      QUERY,
    );
    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://weather.test/v1/forecast");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: "46.7859",
      longitude: "-121.7353",
      hourly:
        "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,snowfall,freezing_level_height,uv_index",
      daily: "sunrise,sunset",
      timezone: "America/Los_Angeles",
      start_date: "2026-11-21",
      end_date: "2026-11-22",
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph",
      precipitation_unit: "inch",
    });
    expect(requests[0]?.headers.get("User-Agent")).toBe(OPEN_METEO_USER_AGENT);
    expect(OPEN_METEO_USER_AGENT).toMatch(
      /hikebot.*github\.com\/by77er\/hikebot/,
    );
  });

  it("asks for °C, km/h and mm in metric", async () => {
    const { fetch, requests } = stub(() => Response.json(benNevis));
    await new OpenMeteo({ fetch }).forecast({ ...QUERY, units: "metric" });
    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin).toBe(DEFAULT_OPEN_METEO_BASE);
    expect(url.searchParams.get("temperature_unit")).toBe("celsius");
    expect(url.searchParams.get("wind_speed_unit")).toBe("kmh");
    expect(url.searchParams.get("precipitation_unit")).toBe("mm");
  });

  it("takes the base address from OPEN_METEO_BASE", async () => {
    const { fetch, requests } = stub(() => Response.json(paradise));
    await openMeteo(
      { OPEN_METEO_BASE: "http://127.0.0.1:9/" },
      { fetch },
    ).forecast(QUERY);
    expect(requests[0]?.url).toMatch(
      /^http:\/\/127\.0\.0\.1:9\/v1\/forecast\?/,
    );
    await openMeteo({ OPEN_METEO_BASE: "" }, { fetch }).forecast(QUERY);
    expect(requests[1]?.url).toMatch(
      /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/,
    );
  });

  it("throws a ForecastError with Open-Meteo's reason for HTTP 400", async () => {
    const { fetch } = stub(() =>
      Response.json(
        {
          error: true,
          reason:
            "Parameter 'start_date' is out of allowed range from 2026-08-20 to 2026-12-03",
        },
        { status: 400 },
      ),
    );
    await expect(
      new OpenMeteo({ fetch }).forecast(QUERY),
    ).rejects.toMatchObject({
      status: 400,
      message:
        "answered HTTP 400: Parameter 'start_date' is out of allowed range from 2026-08-20 to 2026-12-03",
    });
  });

  it.each([429, 502])("throws a ForecastError for HTTP %i", async (status) => {
    const { fetch } = stub(() => new Response("busy", { status }));
    const error = await new OpenMeteo({ fetch })
      .forecast(QUERY)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForecastError);
    expect(error).toMatchObject({
      status,
      message: `answered HTTP ${String(status)}`,
    });
  });

  it.each([
    ["not JSON", () => new Response("<html>")],
    ["no hourly data", () => Response.json({ utc_offset_seconds: 0 })],
    ["temperatures in °C when °F was asked for", () => Response.json(benNevis)],
  ])("throws a ForecastError for an answer with %s", async (_name, answer) => {
    const { fetch } = stub(answer);
    await expect(
      new OpenMeteo({ fetch }).forecast(QUERY),
    ).rejects.toBeInstanceOf(ForecastError);
  });

  it("gives up when there is no answer within the timeout", async () => {
    // Answers only when the client's own timeout aborts the request.
    const fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason as Error);
        });
      })) as typeof globalThis.fetch;
    await expect(
      new OpenMeteo({ fetch, timeoutMs: 20 }).forecast(QUERY),
    ).rejects.toMatchObject({
      status: null,
      message: "no answer within 0.02 seconds",
    });
  });

  it("throws a ForecastError when Open-Meteo cannot be reached", async () => {
    const fetch = (() =>
      Promise.reject(new TypeError("fetch failed"))) as typeof globalThis.fetch;
    await expect(
      new OpenMeteo({ fetch }).forecast(QUERY),
    ).rejects.toMatchObject({
      status: null,
      message: "could not be reached",
    });
  });
});

describe("readForecast", () => {
  it("reads each hour at its instant, from the answer's one UTC offset", () => {
    const forecast = readForecast(paradise, QUERY);
    expect(forecast.hours).toHaveLength(24);
    // "2026-11-21T00:00" at -28800 seconds is 08:00 UTC.
    expect(forecast.hours[0]).toEqual({
      at: Date.UTC(2026, 10, 21, 8),
      code: 3,
      temperature: 22.6,
      feelsLike: 16.6,
      precipitationChance: 0,
      precipitation: 0,
      wind: 1.8,
      gusts: 2,
      snowfall: 0,
      freezingLevel: 2690.289,
      uvIndex: 0,
    });
    expect(forecast.hours[23]?.at).toBe(Date.UTC(2026, 10, 22, 7));
    expect(forecast.days).toEqual([
      {
        sunrise: Date.UTC(2026, 10, 21, 15, 18),
        sunset: Date.UTC(2026, 10, 22, 0, 27),
      },
    ]);
  });

  it("gives the elevation, which Open-Meteo answers in metres, in feet in imperial", () => {
    expect(readForecast(paradise, QUERY).elevation).toBeCloseTo(5439.6, 1);
    expect(
      readForecast(benNevis, { ...QUERY, units: "metric" }).elevation,
    ).toBe(1286);
  });

  it("keeps null for values Open-Meteo has none of, and a freezing level in an unnamed unit as it is", () => {
    const forecast = readForecast(bergen, { ...QUERY, units: "metric" });
    expect(forecast.hours.every((hour) => hour.freezingLevel === null)).toBe(
      true,
    );
    expect(forecast.hours[0]?.temperature).toBe(-3.6);
  });

  it("converts snowfall and the freezing level when they come in the other system's unit", () => {
    const answer = structuredClone(paradise);
    answer.hourly_units.snowfall = "cm";
    answer.hourly_units.freezing_level_height = "m";
    const forecast = readForecast(answer, QUERY);
    expect(forecast.hours[23]?.snowfall).toBeCloseTo(0.138 / 2.54, 5);
    expect(forecast.hours[0]?.freezingLevel).toBeCloseTo(2690.289 * 3.28084, 2);
  });

  it("keeps the point it was asked for and the units", () => {
    const forecast = readForecast(paradise, QUERY);
    expect(forecast.point).toEqual(QUERY.point);
    expect(forecast.units).toBe("imperial");
  });
});
