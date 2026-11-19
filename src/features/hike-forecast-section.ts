/**
 * The planned hike's forecast in the web view (`src/guild/web-view.ts`):
 * the forecast the `weather:refresh` job stored with the round, as the hike
 * thread shows it (the same hours, sunrise and sunset, notes and updated
 * time, in the guild's units and time zone), or why there is none, in the
 * thread's words. The read makes no weather request.
 */
import type { WebViewSource } from "../guild/web-view";
import { dateTimeIn, timeIn } from "../polls/dates";
import type { StoredForecast, Units } from "../weather/forecast";
import {
  forecastNotes,
  hikeSunTimes,
  hourlyHours,
  unitLabels,
  type HikeHours,
  type UnitLabels,
} from "../weather/format";
import { conditions } from "../weather/wmo";
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
      /** When what the forecast shows last changed. */
      updatedAt: number;
      /** `updatedAt` in the guild's time zone: `Sat, 21 Nov 2026 · 14:05`. */
      updatedLabel: string;
    };

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
  return webForecast(weather.stored, weather.hike, timeZone);
}

/**
 * `stored` as the web view gives it for a hike of `hike`'s hours in
 * `timeZone`: the thread's hours, sun times and notes.
 */
export function webForecast(
  stored: StoredForecast,
  hike: HikeHours,
  timeZone: string,
): WebHikeForecast {
  const { forecast, updatedAt } = stored;
  const hours = hourlyHours(forecast, hike);
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
    updatedAt,
    updatedLabel: dateTimeIn(timeZone, updatedAt),
  };
}
