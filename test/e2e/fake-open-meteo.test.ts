/**
 * Self-tests of the fake Open-Meteo forecast API: it answers a forecast
 * request the way Open-Meteo does, in the requested units and time zone
 * with only the variables asked for, fails and holds its answers when told
 * to, refuses the requests and User-Agents Open-Meteo's documentation does
 * not allow, and records every request. No Worker runs here; the tests call
 * the fake over HTTP.
 */
import { request } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_WEATHER, FakeOpenMeteo } from "./harness/fake-open-meteo";

const USER_AGENT = "hikebot (+https://github.com/by77er/hikebot)";
const ZONE = "America/Los_Angeles";

const HOURLY =
  "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,snowfall,freezing_level_height,uv_index";

let weather: FakeOpenMeteo;

beforeAll(async () => {
  weather = new FakeOpenMeteo();
  await weather.listen();
});

afterEach(() => {
  weather.clearFailures();
  weather.setWeather({});
  expect(weather.takeRejections()).toEqual([]);
});

afterAll(async () => {
  await weather.close();
});

/** The UTC offset of `ZONE` now, in seconds, from the real clock. */
function zoneOffsetSeconds(): number {
  const name =
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      timeZoneName: "shortOffset",
    })
      .formatToParts(Date.now())
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /^GMT([+-])(\d{1,2})$/.exec(name);
  if (!match) throw new Error(`unexpected offset ${name}`);
  return (match[1] === "-" ? -1 : 1) * Number(match[2]) * 3600;
}

/** Today in `ZONE` plus `days`, `YYYY-MM-DD`. */
function day(days: number): string {
  const today = new Date(Date.now() + zoneOffsetSeconds() * 1000)
    .toISOString()
    .slice(0, 10);
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

interface Reply {
  status: number;
  body: unknown;
}

interface Answer {
  latitude: number;
  longitude: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
  hourly_units: Record<string, string>;
  hourly: Record<string, unknown[]>;
  daily_units?: Record<string, string>;
  daily?: Record<string, unknown[]>;
}

function forecastUrl(params: Record<string, string>): string {
  return `${weather.base}/v1/forecast?${new URLSearchParams(params).toString()}`;
}

async function forecast(
  params: Record<string, string>,
  userAgent: string = USER_AGENT,
): Promise<Reply> {
  const response = await fetch(forecastUrl(params), {
    headers: { "User-Agent": userAgent },
  });
  return { status: response.status, body: await response.json() };
}

/** A request sent without any User-Agent header, which fetch always adds. */
function forecastWithoutUserAgent(
  params: Record<string, string>,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(forecastUrl(params), (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/** What the bot sends for an imperial forecast of tomorrow and the day after. */
function imperial(): Record<string, string> {
  return {
    latitude: "47.4875",
    longitude: "-121.7234",
    hourly: HOURLY,
    daily: "sunrise,sunset",
    timezone: ZONE,
    start_date: day(1),
    end_date: day(2),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
  };
}

function metric(): Record<string, string> {
  return {
    ...imperial(),
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
  };
}

describe("forecast", () => {
  it("answers an imperial request in Fahrenheit, mph, inches and feet", async () => {
    const reply = await forecast(imperial());
    expect(reply.status).toBe(200);
    const answer = reply.body as Answer;
    expect(answer).toMatchObject({
      latitude: 47.4875,
      longitude: -121.7234,
      utc_offset_seconds: zoneOffsetSeconds(),
      timezone: ZONE,
      timezone_abbreviation: `GMT${String(zoneOffsetSeconds() / 3600)}`,
      elevation: 500,
      hourly_units: {
        time: "iso8601",
        temperature_2m: "°F",
        apparent_temperature: "°F",
        precipitation_probability: "%",
        precipitation: "inch",
        weather_code: "wmo code",
        wind_speed_10m: "mp/h",
        wind_gusts_10m: "mp/h",
        snowfall: "inch",
        freezing_level_height: "ft",
        uv_index: "",
      },
      daily_units: { time: "iso8601", sunrise: "iso8601", sunset: "iso8601" },
    });
    expect([-28_800, -25_200]).toContain(answer.utc_offset_seconds);
    const { hourly } = answer;
    expect(hourly.time).toHaveLength(48);
    expect(hourly.time?.[0]).toBe(`${day(1)}T00:00`);
    expect(hourly.time?.[23]).toBe(`${day(1)}T23:00`);
    expect(hourly.time?.[24]).toBe(`${day(2)}T00:00`);
    expect(hourly.time?.[47]).toBe(`${day(2)}T23:00`);
    expect(hourly.temperature_2m?.[0]).toBe(50);
    expect(hourly.apparent_temperature?.[0]).toBe(46.4);
    expect(hourly.precipitation_probability?.[0]).toBe(20);
    expect(hourly.precipitation?.[0]).toBe(0.008);
    expect(hourly.weather_code?.[0]).toBe(3);
    expect(hourly.wind_speed_10m?.[0]).toBe(6.2);
    expect(hourly.wind_gusts_10m?.[0]).toBe(12.4);
    expect(hourly.snowfall?.[0]).toBe(0);
    expect(hourly.freezing_level_height?.[0]).toBe(6561.68);
    expect(hourly.uv_index?.[0]).toBe(1);
    for (const values of Object.values(hourly)) expect(values).toHaveLength(48);
    expect(answer.daily).toEqual({
      time: [day(1), day(2)],
      sunrise: [`${day(1)}T07:30`, `${day(2)}T07:30`],
      sunset: [`${day(1)}T16:30`, `${day(2)}T16:30`],
    });
  });

  it("answers a metric request in the weather it was given", async () => {
    weather.setWeather({
      code: 73,
      temperature: -2.26,
      feelsLike: -7,
      chance: 90,
      precipitation: 1.234,
      wind: 25,
      gusts: 48,
      snowfall: 1.5,
      freezingLevel: 850,
      uv: 0.456,
      elevation: 1200,
      sunrise: "07:05",
      sunset: "16:40",
    });
    const reply = await forecast({
      ...metric(),
      start_date: day(3),
      end_date: day(3),
    });
    expect(reply.status).toBe(200);
    const answer = reply.body as Answer;
    expect(answer.elevation).toBe(1200);
    expect(answer.hourly_units).toMatchObject({
      temperature_2m: "°C",
      precipitation: "mm",
      wind_speed_10m: "km/h",
      snowfall: "cm",
      freezing_level_height: "m",
    });
    const { hourly } = answer;
    expect(hourly.time).toHaveLength(24);
    expect(hourly.temperature_2m?.[12]).toBe(-2.3);
    expect(hourly.apparent_temperature?.[12]).toBe(-7);
    expect(hourly.precipitation_probability?.[12]).toBe(90);
    expect(hourly.precipitation?.[12]).toBe(1.23);
    expect(hourly.weather_code?.[12]).toBe(73);
    expect(hourly.wind_speed_10m?.[12]).toBe(25);
    expect(hourly.wind_gusts_10m?.[12]).toBe(48);
    expect(hourly.snowfall?.[12]).toBe(1.5);
    expect(hourly.freezing_level_height?.[12]).toBe(850);
    expect(hourly.uv_index?.[12]).toBe(0.46);
    expect(answer.daily).toEqual({
      time: [day(3)],
      sunrise: [`${day(3)}T07:05`],
      sunset: [`${day(3)}T16:40`],
    });
  });

  it("converts snowfall to inches and keeps elevation in metres", async () => {
    weather.setWeather({ snowfall: 1.5, elevation: 1200 });
    const answer = (await forecast(imperial())).body as Answer;
    expect(answer.hourly.snowfall?.[0]).toBe(0.591);
    expect(answer.elevation).toBe(1200);
  });

  it("restores the default weather with setWeather({})", async () => {
    weather.setWeather({ temperature: 30 });
    weather.setWeather({});
    const answer = (await forecast(metric())).body as Answer;
    expect(answer.hourly.temperature_2m?.[0]).toBe(DEFAULT_WEATHER.temperature);
  });

  it("answers only the variables asked for", async () => {
    const reply = await forecast({
      latitude: "47.5",
      longitude: "-121.7",
      hourly: "temperature_2m,weather_code",
      timezone: ZONE,
      start_date: day(1),
      end_date: day(1),
    });
    expect(reply.status).toBe(200);
    const answer = reply.body as Answer;
    expect(Object.keys(answer.hourly)).toEqual([
      "time",
      "temperature_2m",
      "weather_code",
    ]);
    expect(Object.keys(answer.hourly_units)).toEqual([
      "time",
      "temperature_2m",
      "weather_code",
    ]);
    expect(answer).not.toHaveProperty("daily");
    expect(answer).not.toHaveProperty("daily_units");
  });

  it("records each request with its query, user agent and status", async () => {
    const before = Date.now();
    await forecast({ ...metric(), latitude: "12.5" }, "hikebot-test/1.0");
    const recorded = await weather.nextRequest(
      (r) => r.query.latitude === "12.5",
    );
    expect(recorded).toMatchObject({
      method: "GET",
      path: "/v1/forecast",
      query: { latitude: "12.5", timezone: ZONE, temperature_unit: "celsius" },
      userAgent: "hikebot-test/1.0",
      status: 200,
    });
    expect(recorded.at).toBeGreaterThanOrEqual(before);
    expect(recorded.at).toBeLessThanOrEqual(Date.now());
    expect(weather.requests).toContain(recorded);
  });

  it("resolves nextRequest for a request still to come", async () => {
    const next = weather.nextRequest((r) => r.query.latitude === "13.5");
    await forecast({ ...metric(), latitude: "13.5" });
    await expect(next).resolves.toMatchObject({ status: 200 });
  });

  it("rejects nextRequest when no request matches in time", async () => {
    await expect(
      weather.nextRequest((r) => r.query.latitude === "never", 50),
    ).rejects.toThrow(/fake Open-Meteo/);
  });
});

describe("failures", () => {
  it("answers 503 once after failNext, then works", async () => {
    weather.failNext(503);
    const failed = await forecast(metric());
    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({ error: true });
    expect((await forecast(metric())).status).toBe(200);
  });

  it("answers the status the given number of times", async () => {
    weather.failNext(429, 2);
    expect((await forecast(metric())).status).toBe(429);
    expect((await forecast(metric())).status).toBe(429);
    expect((await forecast(metric())).status).toBe(200);
  });

  it("answers the status until clearFailures after failAlways", async () => {
    weather.failAlways(500);
    expect((await forecast(metric())).status).toBe(500);
    expect((await forecast(metric())).status).toBe(500);
    weather.clearFailures();
    expect((await forecast(metric())).status).toBe(200);
  });
});

describe("hold", () => {
  it("holds answers until released", async () => {
    const release = weather.hold();
    const settled = Symbol("settled");
    const pending = Symbol("pending");
    const answer = forecast({ ...metric(), latitude: "14.5" }).then(
      () => settled,
    );
    await weather.nextRequest((r) => r.query.latitude === "14.5");
    expect(weather.heldRequests).toBe(1);
    expect(await Promise.race([answer, Promise.resolve(pending)])).toBe(
      pending,
    );
    release();
    expect(await answer).toBe(settled);
    expect(weather.heldRequests).toBe(0);
  });
});

/** `params` without `name`. */
function without(
  params: Record<string, string>,
  name: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => key !== name),
  );
}

describe("refusals", () => {
  const cases: [string, () => Record<string, string>, RegExp][] = [
    ["a missing latitude", () => without(metric(), "latitude"), /latitude/],
    ["latitude 91", () => ({ ...metric(), latitude: "91" }), /latitude/],
    ["longitude -181", () => ({ ...metric(), longitude: "-181" }), /longitude/],
    [
      "a latitude that is text",
      () => ({ ...metric(), latitude: "north" }),
      /latitude/,
    ],
    [
      "an unknown hourly variable",
      () => ({ ...metric(), hourly: "temperature_2m,tempeture_2m" }),
      /tempeture_2m for key hourly/,
    ],
    [
      "an unknown daily variable",
      () => ({ ...metric(), daily: "sunrise,moonrise" }),
      /moonrise for key daily/,
    ],
    [
      "daily variables without timezone",
      () => without(metric(), "timezone"),
      /parameter timezone is required/,
    ],
    [
      "an unknown time zone",
      () => ({ ...metric(), timezone: "Mars/Olympus_Mons" }),
      /timezone/,
    ],
    [
      "temperature_unit kelvin",
      () => ({ ...metric(), temperature_unit: "kelvin" }),
      /temperature_unit/,
    ],
    [
      "wind_speed_unit knots",
      () => ({ ...metric(), wind_speed_unit: "knots" }),
      /wind_speed_unit/,
    ],
    [
      "precipitation_unit cm",
      () => ({ ...metric(), precipitation_unit: "cm" }),
      /precipitation_unit/,
    ],
    [
      "a start_date that is not yyyy-mm-dd",
      () => ({ ...metric(), start_date: "21/11/2026" }),
      /start_date/,
    ],
    [
      "an end_date that is not a day",
      () => ({ ...metric(), end_date: `${day(1).slice(0, 8)}32` }),
      /end_date/,
    ],
    [
      "a start_date without an end_date",
      () => without(metric(), "end_date"),
      /together/,
    ],
    [
      "an end_date before the start_date",
      () => ({ ...metric(), start_date: day(3), end_date: day(2) }),
      /before start_date/,
    ],
    [
      "an end_date past the 16 forecast days",
      () => ({ ...metric(), end_date: day(20) }),
      new RegExp(
        `Parameter 'end_date' is out of allowed range from ${day(-92)} to ${day(15)}`,
      ),
    ],
    [
      "a start_date more than 92 past days ago",
      () => ({ ...metric(), start_date: day(-100) }),
      /Parameter 'start_date' is out of allowed range/,
    ],
  ];

  it.each(cases)("refuses %s with 400", async (_, params, reason) => {
    const query = params();
    const reply = await forecast(query);
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({
      error: true,
      reason: expect.stringMatching(reason) as string,
    });
    const refused = weather.takeRejections();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ status: 400, query });
  });

  it("accepts the last forecast day and the first past day", async () => {
    expect(
      (await forecast({ ...metric(), start_date: day(-92), end_date: day(15) }))
        .status,
    ).toBe(200);
  });

  it("refuses a path other than /v1/forecast with 400", async () => {
    const response = await fetch(`${weather.base}/v1/archive?latitude=1`, {
      headers: { "User-Agent": USER_AGENT },
    });
    expect(response.status).toBe(400);
    await response.body?.cancel();
    const refused = weather.takeRejections();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ path: "/v1/archive", status: 400 });
  });

  it("refuses a request without a User-Agent with 403", async () => {
    const reply = await forecastWithoutUserAgent(metric());
    expect(reply.status).toBe(403);
    expect(reply.body).toMatchObject({ error: true });
    const refused = weather.takeRejections();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ userAgent: undefined, status: 403 });
  });

  it.each(["node", "undici", "python-requests/2.31", "curl/8.5.0"])(
    "refuses the stock User-Agent %s with 403",
    async (agent) => {
      const reply = await forecast(metric(), agent);
      expect(reply.status).toBe(403);
      const refused = weather.takeRejections();
      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatchObject({ userAgent: agent, status: 403 });
    },
  );

  it("does not count a configured failure as a refusal", async () => {
    weather.failNext(400);
    expect((await forecast(metric())).status).toBe(400);
    expect(weather.takeRejections()).toEqual([]);
  });

  it("refuses a malformed request even while told to fail", async () => {
    weather.failNext(503);
    expect((await forecast({ ...metric(), latitude: "91" })).status).toBe(400);
    expect(weather.takeRejections()).toHaveLength(1);
    expect((await forecast(metric())).status).toBe(503);
  });
});
