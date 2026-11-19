/**
 * A weather forecast as the bot keeps it: the hours Open-Meteo gave for a
 * point, in the units the server asked for, with the days' sunrise and
 * sunset. Plain data, so it can be stored as JSON with the round and cross
 * the guild object's RPC boundary.
 */
import type { Point } from "../geo/coordinates";

/**
 * The server's units: `imperial` is °F, mph, inches of precipitation and
 * snow, and feet; `metric` is °C, km/h, millimetres of precipitation,
 * centimetres of snow, and metres.
 */
export type Units = "imperial" | "metric";

export const UNITS: readonly Units[] = ["imperial", "metric"];

/** The units of a server that has not picked any. */
export const DEFAULT_UNITS: Units = "imperial";

/**
 * One hour of the forecast. Each value is null when Open-Meteo had none.
 * As Open-Meteo defines them, the temperatures, the wind speed, the code
 * and the freezing level hold at `at`; the chance and amount of
 * precipitation, the gusts, the snowfall and the UV index cover the hour
 * before it.
 */
export interface ForecastHour {
  /** The hour, in milliseconds since the epoch. */
  at: number;
  /** The WMO weather code. */
  code: number | null;
  temperature: number | null;
  feelsLike: number | null;
  /** Chance of more than 0.1 mm of precipitation, in percent. */
  precipitationChance: number | null;
  /** Rain, showers and snow together: inches or millimetres. */
  precipitation: number | null;
  /** mph or km/h. */
  wind: number | null;
  /** mph or km/h. */
  gusts: number | null;
  /** Inches or centimetres. */
  snowfall: number | null;
  /** Height of the 0 °C level above sea level: feet or metres. */
  freezingLevel: number | null;
  uvIndex: number | null;
}

export interface Forecast {
  /** The point the forecast was asked for. */
  point: Point;
  units: Units;
  /** Height above sea level of the point Open-Meteo forecast for: feet or metres. */
  elevation: number | null;
  /** The hours, in order. */
  hours: ForecastHour[];
  /** Each day's sunrise and sunset, in milliseconds since the epoch. */
  days: { sunrise: number | null; sunset: number | null }[];
}

/** A forecast as stored with its round. */
export interface StoredForecast {
  forecast: Forecast;
  /** When it was last fetched. */
  fetchedAt: number;
  /** When what it shows last changed: the "Updated" time on the surfaces. */
  updatedAt: number;
}
