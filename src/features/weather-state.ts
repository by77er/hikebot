/**
 * The hike's weather as its surfaces show it. A completed round's forecast
 * is on the round (`setRoundForecast`); what each surface (the thread's
 * first message, the Discord event's description) last showed of it is
 * kept under `weather:<round id>` in the object's synchronous key-value
 * storage, with the guild it is for, from the close of the date vote until
 * the hike is over, so the `weather:refresh` job edits a surface only when
 * its text changed and stops editing one that was deleted. Shared by the
 * weather feature (`weather.ts`), the hike thread, the event and the
 * hike-day announcement, which render the texts from here.
 */
import type { Point } from "../geo/coordinates";
import { addDays, hikeStart, todayIn } from "../polls/dates";
import type { RoundView } from "../polls/store";
import {
  FORECAST_NO_PIN,
  FORECAST_PENDING,
  FORECAST_TOO_FAR,
  OPEN_METEO_CREDIT,
  eventForecast,
  forecastNotice,
  forecastSummary,
  forecastWindow,
  threadForecast,
  type HikeHours,
} from "../weather/format";
import { hikeDayHours } from "./hike-day-state";

/** The job that refreshes the forecasts and the surfaces that show them. */
export const WEATHER_JOB = "weather:refresh";

/** How many days Open-Meteo forecasts, today included. */
export const FORECAST_DAYS = 16;

const HOUR_MS = 60 * 60 * 1000;

const KEY_PREFIX = "weather:";

/** A surface that shows the forecast. */
export type Surface = "thread" | "event";

/** What a surface last showed, or that it is gone. */
export interface SurfaceState {
  /** The forecast text it shows, as last written. */
  shown?: string;
  /** Discord answered 404: it was deleted, so it is no longer edited. */
  gone?: true;
}

export interface WeatherRecord {
  guildId: string;
  thread: SurfaceState;
  event: SurfaceState;
}

function key(roundId: number): string {
  return `${KEY_PREFIX}${String(roundId)}`;
}

/** Every round with a weather record, by round id. */
export function weatherRecords(
  storage: DurableObjectStorage,
): Map<number, WeatherRecord> {
  const records = new Map<number, WeatherRecord>();
  for (const [name, record] of storage.kv.list<WeatherRecord>({
    prefix: KEY_PREFIX,
  })) {
    records.set(Number(name.slice(KEY_PREFIX.length)), record);
  }
  return records;
}

/** The round's record, made for `guildId` if it has none. */
export function planWeather(
  storage: DurableObjectStorage,
  roundId: number,
  guildId: string,
): WeatherRecord {
  const record = storage.kv.get<WeatherRecord>(key(roundId)) ?? {
    guildId,
    thread: {},
    event: {},
  };
  storage.kv.put(key(roundId), record);
  return record;
}

/** Records that `surface` of the round now shows `text`. */
export function noteShown(
  storage: DurableObjectStorage,
  roundId: number,
  guildId: string,
  surface: Surface,
  text: string,
): void {
  const record = planWeather(storage, roundId, guildId);
  storage.kv.put<WeatherRecord>(key(roundId), {
    ...record,
    [surface]: { shown: text },
  });
}

/** Records that `surface` of the round was deleted, so it is left alone. */
export function markGone(
  storage: DurableObjectStorage,
  roundId: number,
  surface: Surface,
): void {
  const record = storage.kv.get<WeatherRecord>(key(roundId));
  if (record === undefined) return;
  storage.kv.put<WeatherRecord>(key(roundId), {
    ...record,
    [surface]: { gone: true },
  });
}

/** Forgets the round's record: its hike is over or no longer planned. */
export function clearWeather(
  storage: DurableObjectStorage,
  roundId: number,
): void {
  storage.kv.delete(key(roundId));
}

/** When the round's hike starts and ends in `timeZone`; null without a date. */
export function hikeHoursOf(
  round: RoundView,
  timeZone: string,
): HikeHours | null {
  const { start, end } = hikeDayHours(round, timeZone);
  return Number.isNaN(start) ? null : { start, end };
}

/** The map pin of the round's decided location, if it has one. */
export function roundPoint(round: RoundView): Point | null {
  return (
    round.locationPoll?.options.find(
      (option) => option.id === round.locationOptionId,
    )?.place?.point ?? null
  );
}

/**
 * The days to ask Open-Meteo for, in `timeZone`: those of the hourly
 * block, from two hours before the start to two hours after the end, with
 * an hour more on each side, since Open-Meteo keeps one UTC offset for the
 * whole answer and its days can be an hour off across a change of the
 * clocks.
 */
export function forecastDates(
  hike: HikeHours,
  timeZone: string,
): { startDate: string; endDate: string } {
  const { from, to } = forecastWindow(hike);
  return {
    startDate: todayIn(timeZone, from - HOUR_MS),
    endDate: todayIn(timeZone, to + HOUR_MS),
  };
}

/**
 * When Open-Meteo's 16 days reach the hike's last day: midnight in
 * `timeZone` 15 days before it.
 */
export function forecastOpensAt(hike: HikeHours, timeZone: string): number {
  const { endDate } = forecastDates(hike, timeZone);
  return hikeStart(`${addDays(endDate, 1 - FORECAST_DAYS)} 00:00`, timeZone);
}

/** Whether Open-Meteo's 16 days, counted from today in `timeZone`, cover the hike. */
export function withinForecast(
  hike: HikeHours,
  timeZone: string,
  now: number,
): boolean {
  const { endDate } = forecastDates(hike, timeZone);
  return endDate <= addDays(todayIn(timeZone, now), FORECAST_DAYS - 1);
}

/**
 * The round's forecast, if it is for the decided location's current pin
 * (one fetched before the pin moved is not shown).
 */
function currentForecast(round: RoundView) {
  const point = roundPoint(round);
  const stored = round.forecast;
  return point !== null &&
    stored !== null &&
    stored.forecast.point.lat === point.lat &&
    stored.forecast.point.lon === point.lon
    ? stored
    : null;
}

/** Why there is no forecast to show at `now`, as the surfaces say it. */
function noForecast(
  round: RoundView,
  hike: HikeHours,
  timeZone: string,
  now: number,
): string {
  if (roundPoint(round) === null) return FORECAST_NO_PIN;
  if (!withinForecast(hike, timeZone, now)) return FORECAST_TOO_FAR;
  return FORECAST_PENDING;
}

/** What each surface shows of the weather. */
export interface WeatherTexts {
  /** The block of the thread's first message. */
  thread: string;
  /** The part of the event's description. */
  event: string;
  /** The hike-day announcement's lines. */
  summary: string[];
}

/**
 * What the surfaces of `round` show of its weather at `now`, in
 * `timeZone`: its forecast, or why there is none (no map pin, too far
 * ahead, not fetched yet). Null when the round has no decided date.
 */
export function weatherTexts(
  round: RoundView,
  timeZone: string,
  now: number,
): WeatherTexts | null {
  const hike = hikeHoursOf(round, timeZone);
  if (hike === null) return null;
  const stored = currentForecast(round);
  const summary = stored && forecastSummary(stored.forecast, hike);
  if (stored === null || !summary) {
    const why = noForecast(round, hike, timeZone, now);
    return {
      thread: forecastNotice(why),
      event: `Weather: ${why}`,
      summary: [`**Weather:** ${why}`],
    };
  }
  return {
    thread: threadForecast(stored, hike, timeZone),
    event: eventForecast(stored, hike, timeZone),
    summary: [`**Weather:** ${summary}`, `-# ${OPEN_METEO_CREDIT}`],
  };
}
