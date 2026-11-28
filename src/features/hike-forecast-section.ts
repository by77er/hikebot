/**
 * The planned hike's forecast in the web view (`src/guild/web-view.ts`):
 * the forecast the `weather:refresh` job stored with the round, as the hike
 * thread shows it (the same hours, sunrise and sunset and notes, in the
 * guild's units and time zone), or why there is none, in the thread's
 * words; with when it was last fetched (the page's "Checked", not the
 * thread's "Updated", which is when it last changed), how often it is
 * fetched, whether fetching it again has been failing, and which of the
 * hike's hours it does not reach yet.
 * The read makes no weather request.
 */
import type { WebViewSource } from "../guild/web-view";
import { timeIn } from "../polls/dates";
import type { StoredForecast, Units } from "../weather/forecast";
import {
  forecastNotes,
  hikeSunTimes,
  forecastWindow,
  hourlyHours,
  unitLabels,
  type HikeHours,
  type UnitLabels,
} from "../weather/format";
import { conditions } from "../weather/wmo";
import { WEATHER_REFRESH_MS } from "./weather";
import { plannedHikeSection } from "./planned-hike-section";
import {
  hikeWeather,
  NO_FORECAST_TEXT,
  type NoForecastReason,
} from "./weather-state";

/** One hour of the forecast. Each value is null when Open-Meteo had none. */
export interface WebForecastHour {
  /** The hour, in milliseconds since the epoch. */
  at: number;
  /** The hour in the guild's time zone: `09:00`. */
  time: string;
  /** The WMO weather code. */
  code: number | null;
  /** The conditions in words, as the thread writes them: `Light rain`. */
  conditions: string;
  temperature: number | null;
  feelsLike: number | null;
  /** In percent. */
  precipitationChance: number | null;
  /** Rain, showers and snow together, in `labels.precipitation`. */
  precipitation: number | null;
  wind: number | null;
  gusts: number | null;
}

export type WebHikeForecast =
  | {
      kind: "none";
      reason: NoForecastReason;
      /** What the thread says instead of a forecast. */
      text: string;
    }
  | {
      kind: "forecast";
      units: Units;
      /** How the values are written in `units`: `°F`, `mph`, `in`. */
      labels: UnitLabels;
      /** The guild's IANA time zone, which `time` and the sun times are in. */
      timeZone: string;
      /** The thread's hours: two hours before the start to two after the end. */
      hours: WebForecastHour[];
      /** The hike day's sunrise and sunset, `07:30`; null when unknown. */
      sunrise: string | null;
      sunset: string | null;
      /** The thread's notes: freezing level, UV index, snowfall. */
      notes: string[];
      /**
       * When it was last fetched: the age of what the page shows, which
       * it writes as "Checked 14 min ago". (The thread's "Updated" is when
       * what it shows last changed, `StoredForecast.updatedAt`: another
       * fact, so the page does not call this one "Updated".)
       */
      fetchedAt: number;
      /** How often the bot fetches it again, in words: `every hour`. */
      refresh: string;
      /**
       * Whether fetching it again has failed for longer than
       * `STALE_AFTER_MS`, so it is older than it should be.
       */
      stale: boolean;
      /**
       * The hours shown, `09:00` to `15:00`, when the forecast does not yet
       * reach the end of the thread's hours (they are too far ahead);
       * null when it covers them all.
       */
      partial: { from: string; to: string } | null;
    };

/**
 * A forecast not fetched for this long while the hike is planned means
 * fetching it has been failing: the job tries every `WEATHER_REFRESH_MS`.
 */
export const STALE_AFTER_MS = 3 * WEATHER_REFRESH_MS;

/** The planned hike's forecast, or why it has none; null with no planned hike. */
export function hikeForecastSection(
  source: WebViewSource,
): WebHikeForecast | null {
  const planned = plannedHikeSection(source);
  const round = planned && source.store.getRound(planned.roundId);
  if (!round) return null;
  const timeZone = source.settings.timezone;
  const weather = hikeWeather(round, timeZone, source.now);
  if (weather === null) return null;
  if (weather.kind === "none") {
    return {
      kind: "none",
      reason: weather.reason,
      text: NO_FORECAST_TEXT[weather.reason],
    };
  }
  return webForecast(weather.stored, weather.hike, timeZone, source.now);
}

/**
 * `stored` as the web view gives it at `now` for a hike of `hike`'s hours
 * in `timeZone`: the thread's hours, sun times and notes, how old it is,
 * and what it is missing.
 */
export function webForecast(
  stored: StoredForecast,
  hike: HikeHours,
  timeZone: string,
  now: number,
): WebHikeForecast {
  const { forecast, fetchedAt } = stored;
  const hours = hourlyHours(forecast, hike);
  const last = hours.at(-1);
  const first = hours[0];
  const { to } = forecastWindow(hike);
  const sun = hikeSunTimes(forecast, hike, timeZone);
  return {
    kind: "forecast",
    units: forecast.units,
    labels: unitLabels(forecast.units),
    timeZone,
    hours: hours.map((hour) => ({
      at: hour.at,
      time: timeIn(timeZone, hour.at),
      code: hour.code,
      conditions: conditions(hour.code),
      temperature: hour.temperature,
      feelsLike: hour.feelsLike,
      precipitationChance: hour.precipitationChance,
      precipitation: hour.precipitation,
      wind: hour.wind,
      gusts: hour.gusts,
    })),
    sunrise: sun?.sunrise ?? null,
    sunset: sun?.sunset ?? null,
    notes: forecastNotes(forecast, hours),
    fetchedAt,
    refresh: refreshText(WEATHER_REFRESH_MS),
    stale: now - fetchedAt > STALE_AFTER_MS,
    partial:
      first !== undefined && last !== undefined && last.at + HOUR_MS <= to
        ? { from: timeIn(timeZone, first.at), to: timeIn(timeZone, last.at) }
        : null,
  };
}

const HOUR_MS = 3_600_000;

/** `every hour`, `every 2 h`, `every 30 min`: how often `ms` comes round. */
export function refreshText(ms: number): string {
  if (ms === HOUR_MS) return "every hour";
  return ms % HOUR_MS === 0
    ? `every ${String(ms / HOUR_MS)} h`
    : `every ${String(Math.round(ms / 60_000))} min`;
}
