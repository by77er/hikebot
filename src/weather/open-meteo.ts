/**
 * A small client for Open-Meteo's forecast API
 * (https://open-meteo.com/en/docs): one request for the hours and days of
 * a point between two dates, in a time zone and the server's units. The
 * base address comes from the `OPEN_METEO_BASE` var, so tests and the
 * end-to-end harness stand in a fake. Non-commercial use needs no key and
 * stays under 10,000 calls a day (https://open-meteo.com/en/terms); the
 * data is CC BY 4.0 and is credited with a link wherever it is shown
 * (https://open-meteo.com/en/licence).
 */
import type { Point } from "../geo/coordinates";
import type { Forecast, ForecastHour, Units } from "./forecast";

export const DEFAULT_OPEN_METEO_BASE = "https://api.open-meteo.com";

/** Names the application and where to reach its maintainers. */
export const OPEN_METEO_USER_AGENT =
  "hikebot (+https://github.com/by77er/hikebot)";

/** How long a request may take before it counts as failed. */
export const OPEN_METEO_TIMEOUT_MS = 10_000;

/** The hourly variables the formatter reads, in Open-Meteo's names. */
export const HOURLY_VARIABLES = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "weather_code",
  "wind_speed_10m",
  "wind_gusts_10m",
  "snowfall",
  "freezing_level_height",
  "uv_index",
] as const;

/** The daily variables the formatter reads. */
export const DAILY_VARIABLES = ["sunrise", "sunset"] as const;

/** The unit parameters of each unit system. */
export const UNIT_PARAMETERS: Record<Units, Record<string, string>> = {
  imperial: {
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
  },
  metric: {
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
  },
};

/** Feet in a metre, for the elevation, which Open-Meteo gives in metres. */
const FEET_PER_METRE = 3.28084;

/** A request that did not get a forecast: an error status, a bad answer or none. */
export class ForecastError extends Error {
  override readonly name = "ForecastError";

  constructor(
    /** The HTTP status, or null when there was no answer in time. */
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

export interface OpenMeteoOptions {
  /** Defaults to {@link DEFAULT_OPEN_METEO_BASE}. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Defaults to {@link OPEN_METEO_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** What to ask for. */
export interface ForecastQuery {
  point: Point;
  /** The IANA time zone the dates are days of. */
  timeZone: string;
  /** The first and last day, `YYYY-MM-DD`, both included. */
  startDate: string;
  endDate: string;
  units: Units;
}

/** Builds a client from the Worker's environment. */
export function openMeteo(
  env: { OPEN_METEO_BASE?: string },
  options: Omit<OpenMeteoOptions, "baseUrl"> = {},
): OpenMeteo {
  return new OpenMeteo({
    baseUrl: env.OPEN_METEO_BASE || undefined,
    ...options,
  });
}

/** The answer's fields this client reads. */
interface Answer {
  utc_offset_seconds?: unknown;
  elevation?: unknown;
  hourly_units?: Record<string, unknown>;
  hourly?: Record<string, unknown>;
  daily?: Record<string, unknown>;
}

/**
 * The instant of an ISO 8601 local time (`2026-11-21T07:20`) in an answer
 * whose times are `offsetSeconds` ahead of UTC. Open-Meteo resolves the
 * offset once per request and uses it for every timestamp, "Daylight saving
 * time (DST) changes within the requested range are ignored", so this is
 * the true instant even across a change; the formatter writes it in the
 * server's time zone itself.
 */
function instant(local: unknown, offsetSeconds: number): number | null {
  if (typeof local !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match.map(Number);
  return (
    Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0) -
    offsetSeconds * 1000
  );
}

/** The factor for `unit` in `factors`, 1 for a unit not among them. */
function scale(unit: unknown, factors: Record<string, number>): number {
  return typeof unit === "string" ? (factors[unit] ?? 1) : 1;
}

function numbers(values: unknown, length: number): (number | null)[] {
  const list = Array.isArray(values) ? (values as unknown[]) : [];
  return Array.from({ length }, (_, i) => {
    const value = list[i];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  });
}

/**
 * Reads an answer into a `Forecast`, checking that it is in `units`: the
 * temperature, wind and precipitation units must be the ones asked for;
 * snowfall and the freezing level come in whatever unit Open-Meteo picked
 * for the system (inches or centimetres, feet or metres) and are converted
 * when they differ. Throws `ForecastError` for an answer it cannot read.
 */
export function readForecast(
  answer: unknown,
  query: Pick<ForecastQuery, "point" | "units">,
  status = 200,
): Forecast {
  const fail = (why: string) => new ForecastError(status, why);
  if (typeof answer !== "object" || answer === null) {
    throw fail("answered with no forecast");
  }
  const { utc_offset_seconds, elevation, hourly_units, hourly, daily } =
    answer as Answer;
  if (typeof utc_offset_seconds !== "number" || !hourly || !hourly_units) {
    throw fail("answered without hourly data");
  }
  const imperial = query.units === "imperial";
  const expected: Record<string, string[]> = {
    temperature_2m: imperial ? ["°F"] : ["°C"],
    wind_speed_10m: imperial ? ["mp/h", "mph"] : ["km/h"],
    precipitation: imperial ? ["inch"] : ["mm"],
  };
  for (const [variable, units] of Object.entries(expected)) {
    const unit = hourly_units[variable];
    if (typeof unit !== "string" || !units.includes(unit)) {
      throw fail(
        `answered ${variable} in ${String(unit)}, not ${units.join(" or ")}`,
      );
    }
  }
  // Snowfall and the freezing level follow the system Open-Meteo picked;
  // a unit it did not name (or "undefined", with no values) is left as is.
  const snowScale = scale(hourly_units.snowfall, {
    inch: imperial ? 1 : 2.54,
    cm: imperial ? 1 / 2.54 : 1,
  });
  const heightScale = scale(hourly_units.freezing_level_height, {
    ft: imperial ? 1 : 1 / FEET_PER_METRE,
    m: imperial ? FEET_PER_METRE : 1,
  });
  const times = Array.isArray(hourly.time) ? (hourly.time as unknown[]) : [];
  const length = times.length;
  const column = (name: string) => numbers(hourly[name], length);
  const scaled = (values: (number | null)[], scale: number) =>
    values.map((value) => (value === null ? null : value * scale));
  const [code, temperature, feelsLike, chance, amount, wind, gusts] = [
    "weather_code",
    "temperature_2m",
    "apparent_temperature",
    "precipitation_probability",
    "precipitation",
    "wind_speed_10m",
    "wind_gusts_10m",
  ].map(column);
  const snowfall = scaled(column("snowfall"), snowScale);
  const freezing = scaled(column("freezing_level_height"), heightScale);
  const uv = column("uv_index");
  const hours: ForecastHour[] = [];
  times.forEach((time, i) => {
    const at = instant(time, utc_offset_seconds);
    if (at === null) return;
    hours.push({
      at,
      code: code?.[i] ?? null,
      temperature: temperature?.[i] ?? null,
      feelsLike: feelsLike?.[i] ?? null,
      precipitationChance: chance?.[i] ?? null,
      precipitation: amount?.[i] ?? null,
      wind: wind?.[i] ?? null,
      gusts: gusts?.[i] ?? null,
      snowfall: snowfall[i] ?? null,
      freezingLevel: freezing[i] ?? null,
      uvIndex: uv[i] ?? null,
    });
  });
  if (hours.length === 0) throw fail("answered with no hours");
  const sunrises = Array.isArray(daily?.sunrise)
    ? (daily.sunrise as unknown[])
    : [];
  const sunsets = Array.isArray(daily?.sunset)
    ? (daily.sunset as unknown[])
    : [];
  const days = Array.from(
    { length: Math.max(sunrises.length, sunsets.length) },
    (_, i) => ({
      sunrise: instant(sunrises[i], utc_offset_seconds),
      sunset: instant(sunsets[i], utc_offset_seconds),
    }),
  );
  return {
    point: query.point,
    units: query.units,
    elevation:
      typeof elevation === "number" && Number.isFinite(elevation)
        ? imperial
          ? elevation * FEET_PER_METRE
          : elevation
        : null,
    hours,
    days,
  };
}

export class OpenMeteo {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenMeteoOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_OPEN_METEO_BASE).replace(
      /\/+$/,
      "",
    );
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? OPEN_METEO_TIMEOUT_MS;
  }

  /** The forecast URL for `query`. */
  forecastUrl(query: ForecastQuery): string {
    const params = new URLSearchParams({
      latitude: query.point.lat.toFixed(4),
      longitude: query.point.lon.toFixed(4),
      hourly: HOURLY_VARIABLES.join(","),
      daily: DAILY_VARIABLES.join(","),
      timezone: query.timeZone,
      start_date: query.startDate,
      end_date: query.endDate,
      ...UNIT_PARAMETERS[query.units],
    });
    return `${this.baseUrl}/v1/forecast?${params.toString()}`;
  }

  /**
   * The forecast for `query`. Throws `ForecastError` for an error status
   * (with Open-Meteo's `reason` when it gives one), an unreadable answer or
   * no answer within the timeout.
   */
  async forecast(query: ForecastQuery): Promise<Forecast> {
    let response: Response;
    try {
      response = await this.fetch(this.forecastUrl(query), {
        headers: {
          "User-Agent": OPEN_METEO_USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      throw new ForecastError(
        null,
        timedOut
          ? `no answer within ${String(this.timeoutMs / 1000)} seconds`
          : "could not be reached",
      );
    }
    let answer: unknown;
    try {
      answer = await response.json();
    } catch {
      throw new ForecastError(
        response.status,
        response.ok
          ? "answered with unreadable JSON"
          : `answered HTTP ${String(response.status)}`,
      );
    }
    if (!response.ok) {
      // "a JSON error object is returned with a HTTP 400 status code":
      // {"error": true, "reason": "..."}.
      const reason = (answer as { reason?: unknown } | null)?.reason;
      throw new ForecastError(
        response.status,
        `answered HTTP ${String(response.status)}${typeof reason === "string" ? `: ${reason}` : ""}`,
      );
    }
    return readForecast(answer, query, response.status);
  }
}
