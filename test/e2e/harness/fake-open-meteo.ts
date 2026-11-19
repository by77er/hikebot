/**
 * A fake Open-Meteo forecast API on a local HTTP port. The Worker under test
 * reaches it through OPEN_METEO_BASE. It answers `GET /v1/forecast` the way
 * Open-Meteo does, with the weather a test set for every hour of every
 * requested day converted to the requested units, records every request
 * with the time it arrived, and refuses what Open-Meteo's documentation
 * does not allow (400) and a request without an identifying User-Agent
 * (403). Tests can make it fail with a status of their choice and hold its
 * answers.
 *
 * Each behaviour cites the sentence of Open-Meteo's documentation it
 * follows: the forecast API page (https://open-meteo.com/en/docs), the
 * licence page (https://open-meteo.com/en/licence) and the terms
 * (https://open-meteo.com/en/terms). A refusal's reason names the page that
 * states the rule it broke. The data is CC BY 4.0, credited as "Weather
 * data by Open-Meteo.com" (https://open-meteo.com/en/licence). Free
 * non-commercial use is limited to "Less than 10'000 API calls per day,
 * 5'000 per hour and 600 per minute." (https://open-meteo.com/en/terms);
 * the fake does not enforce these limits, and scenarios count calls through
 * `requests`.
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

const FORECAST_DOCS = "https://open-meteo.com/en/docs";

/**
 * User-Agents that HTTP libraries send by default. Open-Meteo's own pages
 * do not state that a request must identify the application; the fake
 * refuses a stock one as the fake Nominatim does, so a test notices the
 * bot calling without its own User-Agent.
 */
const STOCK_USER_AGENTS =
  /^(?:node|undici|python|curl|go-http-client|wget|axios|java|okhttp|libwww-perl|ruby|php)\b/i;

/** One day in milliseconds, for date arithmetic on `YYYY-MM-DD`. */
const DAY_MS = 86_400_000;

/**
 * forecast_days: "Up to 16 days of forecast are possible."
 * (https://open-meteo.com/en/docs): the last day a request may ask for is
 * today plus 15, today in the requested time zone.
 */
export const MAX_FORECAST_DAYS = 16;

/**
 * past_days goes from 0 to 92 (https://open-meteo.com/en/docs): the first
 * day a request may ask for is today minus 92.
 */
export const MAX_PAST_DAYS = 92;

/**
 * The weather the fake gives for every hour of every requested day, in
 * Open-Meteo's metric units; the fake converts it to the units a request
 * asks for.
 */
export interface FakeWeather {
  /** WMO weather code. */
  code: number;
  /** Temperature at 2 m, °C. */
  temperature: number;
  /** Apparent temperature, °C. */
  feelsLike: number;
  /** Precipitation probability, %. */
  chance: number;
  /** Precipitation of the preceding hour, mm. */
  precipitation: number;
  /** Wind speed at 10 m, km/h. */
  wind: number;
  /** Wind gusts at 10 m, km/h. */
  gusts: number;
  /** Snowfall of the preceding hour, cm. */
  snowfall: number;
  /** Freezing level height, m. */
  freezingLevel: number;
  uv: number;
  /** The point's elevation, m. */
  elevation: number;
  /** Local sunrise and sunset, `HH:MM`, the same every day. */
  sunrise: string;
  sunset: string;
}

/** An overcast, cool, mostly dry day: what the fake gives until `setWeather`. */
export const DEFAULT_WEATHER: Readonly<FakeWeather> = {
  code: 3,
  temperature: 10,
  feelsLike: 8,
  chance: 20,
  precipitation: 0.2,
  wind: 10,
  gusts: 20,
  snowfall: 0,
  freezingLevel: 2000,
  uv: 1,
  elevation: 500,
  sunrise: "07:30",
  sunset: "16:30",
};

/** One request the fake received. */
export interface OpenMeteoRequest {
  /** `Date.now()` when the request arrived. */
  at: number;
  method: string;
  /** The path, without the query string. */
  path: string;
  /** The query parameters; a repeated parameter keeps its last value. */
  query: Record<string, string>;
  userAgent: string | undefined;
  status: number;
  /** What the fake answered (parsed JSON). */
  response: unknown;
}

type Waiter = {
  match: (request: OpenMeteoRequest) => boolean;
  resolve: (request: OpenMeteoRequest) => void;
};

interface Reply {
  status: number;
  body: unknown;
  /** A refusal of a request Open-Meteo would not accept. */
  rejected?: boolean;
}

/** One unit choice: the label Open-Meteo gives it and the conversion. */
interface Unit {
  label: string;
  convert: (metric: number) => number;
}

/**
 * Rounds `value` to `decimals`. Open-Meteo's own pages do not state the
 * precision of its values; the fake rounds each unit as Open-Meteo's
 * answers show it.
 */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * temperature_unit: "If fahrenheit is set, all temperature values are
 * converted to Fahrenheit." (https://open-meteo.com/en/docs), default
 * celsius. One decimal, as Open-Meteo's answers give it.
 */
const TEMPERATURE_UNITS: Record<string, Unit> = {
  celsius: { label: "°C", convert: (c) => round(c, 1) },
  fahrenheit: { label: "°F", convert: (c) => round((c * 9) / 5 + 32, 1) },
};

/**
 * wind_speed_unit: "Other wind speed units: ms, mph and kn."
 * (https://open-meteo.com/en/docs), default kmh. One decimal, labelled as
 * Open-Meteo's answers label them.
 */
const WIND_UNITS: Record<string, Unit> = {
  kmh: { label: "km/h", convert: (k) => round(k, 1) },
  ms: { label: "m/s", convert: (k) => round(k / 3.6, 1) },
  mph: { label: "mp/h", convert: (k) => round(k / 1.609344, 1) },
  kn: { label: "kn", convert: (k) => round(k / 1.852, 1) },
};

/**
 * precipitation_unit: "Other precipitation amount units: inch."
 * (https://open-meteo.com/en/docs), default mm. The unit also picks the
 * system of snowfall (inch or cm) and the freezing level (ft or m), as
 * Open-Meteo's answers show.
 */
const PRECIPITATION_UNITS: Record<
  string,
  { precipitation: Unit; snowfall: Unit; height: Unit }
> = {
  mm: {
    precipitation: { label: "mm", convert: (mm) => round(mm, 2) },
    snowfall: { label: "cm", convert: (cm) => round(cm, 2) },
    height: { label: "m", convert: (m) => round(m, 1) },
  },
  inch: {
    precipitation: { label: "inch", convert: (mm) => round(mm / 25.4, 3) },
    snowfall: { label: "inch", convert: (cm) => round(cm / 2.54, 3) },
    height: { label: "ft", convert: (m) => round(m * 3.28084, 3) },
  },
};

/** The hourly variables the fake answers, each with its unit and value. */
const HOURLY: Record<
  string,
  (
    w: FakeWeather,
    units: {
      temperature: Unit;
      wind: Unit;
      rain: Unit;
      snow: Unit;
      height: Unit;
    },
  ) => { unit: string; value: number }
> = {
  temperature_2m: (w, u) => ({
    unit: u.temperature.label,
    value: u.temperature.convert(w.temperature),
  }),
  apparent_temperature: (w, u) => ({
    unit: u.temperature.label,
    value: u.temperature.convert(w.feelsLike),
  }),
  precipitation_probability: (w) => ({
    unit: "%",
    value: Math.round(w.chance),
  }),
  precipitation: (w, u) => ({
    unit: u.rain.label,
    value: u.rain.convert(w.precipitation),
  }),
  weather_code: (w) => ({ unit: "wmo code", value: Math.round(w.code) }),
  wind_speed_10m: (w, u) => ({
    unit: u.wind.label,
    value: u.wind.convert(w.wind),
  }),
  wind_gusts_10m: (w, u) => ({
    unit: u.wind.label,
    value: u.wind.convert(w.gusts),
  }),
  snowfall: (w, u) => ({
    unit: u.snow.label,
    value: u.snow.convert(w.snowfall),
  }),
  freezing_level_height: (w, u) => ({
    unit: u.height.label,
    value: u.height.convert(w.freezingLevel),
  }),
  uv_index: (w) => ({ unit: "", value: round(w.uv, 2) }),
};

/** The daily variables the fake answers. */
const DAILY = ["sunrise", "sunset"] as const;
type DailyVariable = (typeof DAILY)[number];

/**
 * "a JSON error object is returned with a HTTP 400 status code", as
 * `{"error": true, "reason": "..."}` (https://open-meteo.com/en/docs). The
 * fake answers the same shape for every error status.
 */
function error(status: number, reason: string, rejected = false): Reply {
  return { status, body: { error: true, reason }, rejected };
}

function refuse(reason: string, docs: string = FORECAST_DOCS): Reply {
  return error(400, `${reason} (${docs})`, true);
}

/** The variables of a list parameter, given comma-separated or repeated. */
function variables(params: URLSearchParams, name: string): string[] {
  return params
    .getAll(name)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

/** `date` plus `days`, both `YYYY-MM-DD`. */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Whether `date` is a real day written `YYYY-MM-DD`. */
function isDate(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    addDays(date, 0) === date
  );
}

/**
 * The UTC offset of `timeZone` at `at` in seconds, and its abbreviation as
 * `GMT-8`, or null for a zone the time zone database does not hold.
 */
function zoneOffset(
  timeZone: string,
  at: number,
): { seconds: number; abbreviation: string } | null {
  let name: string;
  try {
    name =
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "shortOffset",
      })
        .formatToParts(at)
        .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  } catch {
    return null;
  }
  const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name);
  if (!match) return null;
  const [, sign, hours, minutes] = match;
  const seconds =
    (sign === "-" ? -1 : 1) *
    (Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60);
  return { seconds, abbreviation: name };
}

/** A coordinate parameter's value if it is a number within ±`limit`. */
function coordinate(value: string | null, limit: number): number | null {
  if (value === null || !/^\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*$/.test(value)) {
    return null;
  }
  const n = Number(value);
  return n >= -limit && n <= limit ? n : null;
}

/** A whole-number parameter within `min..max`, or null. */
function count(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

export class FakeOpenMeteo {
  /**
   * Every request the fake received, in order, with `at` the time it
   * arrived. The terms limit free use to "Less than 10'000 API calls per
   * day, 5'000 per hour and 600 per minute."
   * (https://open-meteo.com/en/terms); the fake does not refuse more, so
   * scenarios count calls through this list.
   */
  readonly requests: OpenMeteoRequest[] = [];

  private weather: FakeWeather = { ...DEFAULT_WEATHER };
  private failures: { status: number; times: number } | null = null;
  private readonly holds = new Set<Promise<void>>();
  private held = 0;
  private readonly waiters: Waiter[] = [];
  private rejections: OpenMeteoRequest[] = [];
  private server = createServer((req, res) => {
    void this.handle(req, res);
  });
  private origin = "";

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    const { port } = this.server.address() as AddressInfo;
    this.origin = `http://127.0.0.1:${String(port)}`;
  }

  /** The value for OPEN_METEO_BASE. */
  get base(): string {
    return this.origin;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  // Configuration.

  /**
   * Sets the weather of every hour of every day from now on: `weather`'s
   * fields over `DEFAULT_WEATHER`, so `setWeather({})` restores the
   * default. Values are metric; the fake converts them to the units each
   * request asks for.
   */
  setWeather(weather: Partial<FakeWeather>): void {
    this.weather = { ...DEFAULT_WEATHER, ...weather };
  }

  /**
   * Answers the next `times` valid requests with `status`, for example 429,
   * 500 or 503. Open-Meteo's own pages state only the 400 of a malformed
   * request ("a JSON error object is returned with a HTTP 400 status code",
   * https://open-meteo.com/en/docs); 429 is what a server answers past a
   * rate limit, and 5xx what any overloaded or failing server may answer.
   */
  failNext(status: number, times = 1): void {
    this.failures = { status, times };
  }

  /** Answers every valid request with `status` until `clearFailures`. */
  failAlways(status: number): void {
    this.failures = { status, times: Number.POSITIVE_INFINITY };
  }

  clearFailures(): void {
    this.failures = null;
  }

  /**
   * Holds every answer, of requests already waiting and still to come, until
   * the returned function is called; requests are recorded on arrival. Use
   * it for a slow forecast server. Open-Meteo's own pages do not state how
   * long an answer may take; the fake answers at once unless held.
   */
  hold(): () => void {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.holds.add(held);
    return () => {
      this.holds.delete(held);
      release();
    };
  }

  // Readers.

  /** How many answers `hold` is holding back now. */
  get heldRequests(): number {
    return this.held;
  }

  /**
   * Returns the requests the fake refused (400 for a request Open-Meteo
   * would not accept, 403 for a missing or stock User-Agent) since the last
   * call, and forgets them.
   */
  takeRejections(): OpenMeteoRequest[] {
    const taken = this.rejections;
    this.rejections = [];
    return taken;
  }

  /**
   * Resolves with the first recorded request (already received or still to
   * come) that `match` accepts, any request if `match` is left out. A held
   * request counts once it arrived. Fails after `timeoutMs`.
   */
  nextRequest(
    match: (request: OpenMeteoRequest) => boolean = () => true,
    timeoutMs = 5_000,
  ): Promise<OpenMeteoRequest> {
    const seen = this.requests.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve: (request) => {
          clearTimeout(deadline);
          resolve(request);
        },
      };
      const deadline = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(
          new Error(
            `no matching request reached the fake Open-Meteo within ${String(timeoutMs)} ms; it received: ${this.requests.map((r) => `${r.method} ${r.path} ${r.query.latitude ?? "?"},${r.query.longitude ?? "?"} ${r.query.start_date ?? "?"}..${r.query.end_date ?? "?"} -> ${String(r.status)}`).join(", ") || "nothing"}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  // HTTP.

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const at = Date.now();
    // A forecast request has no body; read whatever came so the connection
    // is reusable.
    req.resume();
    await new Promise((resolve) => req.once("end", resolve));
    const url = new URL(req.url ?? "/", this.origin);
    const method = req.method ?? "GET";
    const userAgent = req.headers["user-agent"];
    const reply = this.answer(method, url, userAgent, at);
    const recorded: OpenMeteoRequest = {
      at,
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      userAgent,
      status: reply.status,
      response: reply.body,
    };
    if (reply.rejected) this.rejections.push(recorded);
    this.requests.push(recorded);
    for (const waiter of [...this.waiters]) {
      if (waiter.match(recorded)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(recorded);
      }
    }
    if (this.holds.size > 0) {
      this.held += 1;
      while (this.holds.size > 0) await Promise.all([...this.holds]);
      this.held -= 1;
    }
    res.writeHead(reply.status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(reply.body));
  }

  private answer(
    method: string,
    url: URL,
    userAgent: string | undefined,
    now: number,
  ): Reply {
    /**
     * Open-Meteo's own pages do not state that a request must identify the
     * application. The fake refuses a missing or stock User-Agent with 403,
     * as the fake Nominatim does, to check that the bot names itself to
     * every service it calls.
     */
    if (userAgent === undefined || userAgent.trim() === "") {
      return error(
        403,
        "requests must send a User-Agent identifying the application (a check of the harness; Open-Meteo's own pages do not state it)",
        true,
      );
    }
    if (STOCK_USER_AGENTS.test(userAgent.trim())) {
      return error(
        403,
        `the stock User-Agent ${JSON.stringify(userAgent)} does not identify the application (a check of the harness; Open-Meteo's own pages do not state it)`,
        true,
      );
    }

    /**
     * The forecast API's URL is "https://api.open-meteo.com/v1/forecast"
     * (https://open-meteo.com/en/docs). The fake implements only that
     * endpoint, read with GET; Open-Meteo's own pages do not state the
     * status for other paths, and the fake refuses them with 400 so a test
     * notices the bot calling something it does not fake.
     */
    if (
      url.pathname !== "/v1/forecast" ||
      (method !== "GET" && method !== "HEAD")
    ) {
      return refuse(
        `the fake answers only GET /v1/forecast, not ${method} ${url.pathname}`,
      );
    }
    const params = url.searchParams;

    /**
     * latitude, longitude: "Geographical WGS84 coordinates of the
     * location." (https://open-meteo.com/en/docs). Both are required; the
     * fake refuses a missing one, one outside -90..90 or -180..180, and the
     * comma-separated list of several locations, which it does not fake.
     */
    const latitude = coordinate(params.get("latitude"), 90);
    if (latitude === null) {
      return refuse(
        `latitude must be a WGS84 latitude from -90 to 90; got ${JSON.stringify(params.get("latitude"))}`,
      );
    }
    const longitude = coordinate(params.get("longitude"), 180);
    if (longitude === null) {
      return refuse(
        `longitude must be a WGS84 longitude from -180 to 180; got ${JSON.stringify(params.get("longitude"))}`,
      );
    }

    /**
     * hourly: "For each selected weather variable, data will be returned as
     * a floating point array." An unknown variable is refused, as the
     * Errors section's example shows: "Cannot initialize WeatherVariable
     * from invalid String value tempeture_2m for key hourly"
     * (https://open-meteo.com/en/docs). The fake knows only the variables
     * it fakes and refuses the others the same way, so a test notices the
     * bot asking for one it does not fake.
     */
    const hourly = variables(params, "hourly");
    const unknownHourly = hourly.find((name) => !(name in HOURLY));
    if (unknownHourly !== undefined) {
      return refuse(
        `Cannot initialize WeatherVariable from invalid String value ${unknownHourly} for key hourly; the fake answers ${Object.keys(HOURLY).join(", ")}`,
      );
    }
    const daily = variables(params, "daily");
    const unknownDaily = daily.find(
      (name) => !DAILY.includes(name as DailyVariable),
    );
    if (unknownDaily !== undefined) {
      return refuse(
        `Cannot initialize WeatherVariable from invalid String value ${unknownDaily} for key daily; the fake answers ${DAILY.join(", ")}`,
      );
    }

    /**
     * timezone: "Any name from the time zone database is supported." and
     * "If daily weather variables are specified, parameter timezone is
     * required." (https://open-meteo.com/en/docs). Without it the times are
     * GMT. "auto resolves the time zone from the coordinates."; the fake
     * does not resolve zones and refuses auto.
     */
    const timezone = params.get("timezone");
    if (daily.length > 0 && timezone === null) {
      return refuse(
        "If daily weather variables are specified, parameter timezone is required.",
      );
    }
    if (timezone === "auto") {
      return refuse("the fake does not resolve timezone=auto; name the zone");
    }
    /**
     * "The requested timezone's UTC offset at request time is returned as
     * utc_offset_seconds", "fixed throughout the response, including across
     * daylight saving time transitions" and "Daylight saving time (DST)
     * changes within the requested range are ignored."
     * (https://open-meteo.com/en/docs). The fake works out one offset at
     * the time the request arrived and uses it for every timestamp.
     */
    const zone = zoneOffset(timezone ?? "GMT", now);
    if (zone === null) {
      return refuse(
        `timezone must be a name from the time zone database; got ${JSON.stringify(timezone)}`,
      );
    }

    /**
     * temperature_unit celsius or fahrenheit, wind_speed_unit kmh, "Other
     * wind speed units: ms, mph and kn.", precipitation_unit mm, "Other
     * precipitation amount units: inch." (https://open-meteo.com/en/docs).
     * Open-Meteo's own pages do not state the answer to another value; the
     * fake refuses it with 400, as the Errors section's example refuses an
     * unknown variable.
     */
    const temperatureUnit = params.get("temperature_unit") ?? "celsius";
    const windUnit = params.get("wind_speed_unit") ?? "kmh";
    const precipitationUnit = params.get("precipitation_unit") ?? "mm";
    for (const [name, value, allowed] of [
      ["temperature_unit", temperatureUnit, TEMPERATURE_UNITS],
      ["wind_speed_unit", windUnit, WIND_UNITS],
      ["precipitation_unit", precipitationUnit, PRECIPITATION_UNITS],
    ] as const) {
      if (!Object.hasOwn(allowed, value)) {
        return refuse(
          `${name} must be one of ${Object.keys(allowed).join(", ")}; got ${JSON.stringify(value)}`,
        );
      }
    }

    /**
     * start_date, end_date: "The time interval to get weather data. A day
     * must be specified as an ISO8601 date (e.g. 2022-06-30)."; without
     * them, forecast_days: "Per default, only 7 days are returned. Up to 16
     * days of forecast are possible.", and past_days from 0 to 92
     * (https://open-meteo.com/en/docs). Open-Meteo's own pages do not state
     * the answer to only one of the dates or an end before the start; the
     * fake refuses both with 400. A day outside today - 92 to today + 15,
     * today in the requested zone, is refused with Open-Meteo's own reason.
     */
    const today = new Date(now + zone.seconds * 1000)
      .toISOString()
      .slice(0, 10);
    const first = addDays(today, -MAX_PAST_DAYS);
    const last = addDays(today, MAX_FORECAST_DAYS - 1);
    const startDate = params.get("start_date");
    const endDate = params.get("end_date");
    let start: string;
    let end: string;
    if (startDate !== null || endDate !== null) {
      if (startDate === null || endDate === null) {
        return refuse("start_date and end_date must be given together");
      }
      for (const [name, value] of [
        ["start_date", startDate],
        ["end_date", endDate],
      ] as const) {
        if (!isDate(value)) {
          return refuse(
            `${name} must be an ISO8601 date (e.g. 2022-06-30); got ${JSON.stringify(value)}`,
          );
        }
        if (value < first || value > last) {
          return refuse(
            `Parameter '${name}' is out of allowed range from ${first} to ${last}`,
          );
        }
      }
      if (endDate < startDate) {
        return refuse(
          `end_date ${endDate} must not be before start_date ${startDate}`,
        );
      }
      start = startDate;
      end = endDate;
    } else {
      const forecastDays = count(
        params.get("forecast_days") ?? "7",
        0,
        MAX_FORECAST_DAYS,
      );
      if (forecastDays === null) {
        return refuse(
          `forecast_days must be from 0 to ${String(MAX_FORECAST_DAYS)}; got ${JSON.stringify(params.get("forecast_days"))}`,
        );
      }
      const pastDays = count(params.get("past_days") ?? "0", 0, MAX_PAST_DAYS);
      if (pastDays === null) {
        return refuse(
          `past_days must be from 0 to ${String(MAX_PAST_DAYS)}; got ${JSON.stringify(params.get("past_days"))}`,
        );
      }
      start = addDays(today, -pastDays);
      end = addDays(today, forecastDays - 1);
    }

    /**
     * A failure a test configured with `failNext` or `failAlways`, applied
     * only to requests Open-Meteo would accept, answered with the error
     * object the Errors section gives (https://open-meteo.com/en/docs).
     */
    if (this.failures) {
      const { status } = this.failures;
      this.failures.times -= 1;
      if (this.failures.times <= 0) this.failures = null;
      return error(
        status,
        `the fake Open-Meteo was told to fail (${String(status)})`,
      );
    }

    const precipitation = PRECIPITATION_UNITS[precipitationUnit];
    const temperature = TEMPERATURE_UNITS[temperatureUnit];
    const wind = WIND_UNITS[windUnit];
    if (!precipitation || !temperature || !wind) {
      return refuse("unknown unit");
    }
    return {
      status: 200,
      body: forecast({
        latitude,
        longitude,
        timezone: timezone ?? "GMT",
        zone,
        days: dateRange(start, end),
        hourly,
        daily: daily as DailyVariable[],
        weather: this.weather,
        units: {
          temperature,
          wind,
          rain: precipitation.precipitation,
          snow: precipitation.snowfall,
          height: precipitation.height,
        },
      }),
    };
  }
}

/** Every day from `start` to `end`, both included. */
function dateRange(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

/**
 * The answer to a forecast request, in the shape Open-Meteo's answers
 * have: hourly: "data will be returned as a floating point array.
 * Additionally a time array will be returned with ISO8601 timestamps.", and
 * the same for daily (https://open-meteo.com/en/docs). Timestamps are local
 * times without an offset, `2026-11-21T07:30`, every hour from 00:00 of the
 * first day to 23:00 of the last. Only the variables asked for are given.
 * `elevation` is in metres whatever the units.
 */
function forecast(input: {
  latitude: number;
  longitude: number;
  timezone: string;
  zone: { seconds: number; abbreviation: string };
  days: string[];
  hourly: string[];
  daily: DailyVariable[];
  weather: FakeWeather;
  units: {
    temperature: Unit;
    wind: Unit;
    rain: Unit;
    snow: Unit;
    height: Unit;
  };
}): Record<string, unknown> {
  const { weather, units, days } = input;
  const body: Record<string, unknown> = {
    latitude: input.latitude,
    longitude: input.longitude,
    generationtime_ms: 0.5,
    utc_offset_seconds: input.zone.seconds,
    timezone: input.timezone,
    timezone_abbreviation: input.zone.abbreviation,
    elevation: weather.elevation,
  };
  if (input.hourly.length > 0) {
    const hourlyUnits: Record<string, string> = { time: "iso8601" };
    const hourly: Record<string, unknown[]> = {
      time: days.flatMap((day) =>
        Array.from(
          { length: 24 },
          (_, hour) => `${day}T${String(hour).padStart(2, "0")}:00`,
        ),
      ),
    };
    for (const name of input.hourly) {
      const variable = HOURLY[name];
      if (!variable) continue;
      const { unit, value } = variable(weather, units);
      hourlyUnits[name] = unit;
      hourly[name] = Array.from({ length: days.length * 24 }, () => value);
    }
    body.hourly_units = hourlyUnits;
    body.hourly = hourly;
  }
  if (input.daily.length > 0) {
    const dailyUnits: Record<string, string> = { time: "iso8601" };
    const daily: Record<string, unknown[]> = { time: [...days] };
    for (const name of input.daily) {
      dailyUnits[name] = "iso8601";
      daily[name] = days.map((day) => `${day}T${weather[name]}`);
    }
    body.daily_units = dailyUnits;
    body.daily = daily;
  }
  return body;
}
