/**
 * The hike's weather forecast, from Open-Meteo: when the date vote closes,
 * a close step plans the round's weather and runs the `weather:refresh`
 * job, which fetches the forecast for the decided location's map pin,
 * stores it with the round and brings the hike thread's first message and
 * the Discord event's description up to date. It runs every hour while the
 * hike has a pin, is within Open-Meteo's 16 days and has not ended; a hike
 * further ahead gets its first run the day its forecast appears. A surface
 * is edited only when its text changed, and one that was deleted is left
 * alone. Setting the map pin, or the server's units, runs it again at once.
 */
import { DiscordApiError } from "../discord/api";
import { GuildConfig } from "../guild/config";
import type { HandlerContext, JobHandler, Router } from "../guild/router";
import { schedule } from "../guild/schedule";
import { PollStore, type RoundView } from "../polls/store";
import type { Units } from "../weather/forecast";
import {
  eventForecast,
  forecastWindow,
  threadForecast,
} from "../weather/format";
import { openMeteo } from "../weather/open-meteo";
import { editEventDescription } from "./hike-event";
import { editThreadMessage } from "./hike-thread";
import type { MapPinHook } from "./map-pin";
import { errorText, type CloseStep } from "./poll-ui";
import {
  WEATHER_JOB,
  clearWeather,
  forecastDates,
  forecastOpensAt,
  hikeHoursOf,
  markGone,
  planWeather,
  roundPoint,
  weatherRecords,
  weatherTexts,
  withinForecast,
  type Surface,
  type WeatherRecord,
} from "./weather-state";

/** How often a forecast is fetched again. */
export const WEATHER_REFRESH_MS = 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Fetches the forecast of round `round`'s hike for its map pin in
 * `timeZone` and `units`, keeps the hours of the hourly block (and an hour
 * on each side) and stores it with the round. The "Updated" time moves only
 * when what the thread or the event would show changed. Returns false,
 * keeping the forecast stored before, when the round has no pin or
 * Open-Meteo gave no forecast; the failure is logged.
 */
export async function updateForecast(
  context: HandlerContext,
  round: RoundView,
  timeZone: string,
  units: Units,
): Promise<boolean> {
  const store = new PollStore(context.storage);
  const point = roundPoint(round);
  const hike = hikeHoursOf(round, timeZone);
  if (point === null || hike === null) return false;
  let forecast;
  try {
    forecast = await openMeteo(context.env).forecast({
      point,
      timeZone,
      ...forecastDates(hike, timeZone),
      units,
    });
  } catch (error) {
    console.error(
      `fetching the forecast of round ${String(round.id)} failed: ${errorText(error)}`,
    );
    return false;
  }
  const { from, to } = forecastWindow(hike);
  forecast.hours = forecast.hours.filter(
    (hour) => hour.at >= from - HOUR_MS && hour.at <= to + HOUR_MS,
  );
  const now = store.now();
  const before = store.getRound(round.id)?.forecast ?? null;
  const same =
    before !== null &&
    [threadForecast, eventForecast].every(
      (render) =>
        render(before, hike, timeZone) ===
        render({ ...before, forecast }, hike, timeZone),
    );
  store.setRoundForecast(round.id, {
    forecast,
    fetchedAt: now,
    updatedAt: same ? before.updatedAt : now,
  });
  return true;
}

/** Whether Discord's error says the thing is gone. */
function isGone(error: unknown): boolean {
  return error instanceof DiscordApiError && error.status === 404;
}

/**
 * Edits each surface of `round` whose weather text changed since it was
 * last shown, unless it is gone; a 404 marks it gone, so it is never tried
 * again, and any other failure is logged and tried again on the next run.
 */
async function showWeather(
  context: HandlerContext,
  round: RoundView,
  record: WeatherRecord,
  timeZone: string,
): Promise<void> {
  const store = new PollStore(context.storage);
  const texts = weatherTexts(round, timeZone, store.now());
  if (texts === null) return;
  const surfaces: {
    surface: Surface;
    id: string | null;
    edit: typeof editThreadMessage;
  }[] = [
    { surface: "thread", id: round.threadId, edit: editThreadMessage },
    { surface: "event", id: round.eventId, edit: editEventDescription },
  ];
  for (const { surface, id, edit } of surfaces) {
    const state = record[surface];
    if (id === null || state.gone || state.shown === texts[surface]) continue;
    try {
      await edit(round, record.guildId, timeZone, context);
    } catch (error) {
      if (isGone(error)) {
        markGone(context.storage, round.id, surface);
        console.warn(
          `the hike ${surface} of round ${String(round.id)} is gone; its forecast is no longer updated`,
        );
      } else {
        console.error(
          `showing the forecast in the hike ${surface} of round ${String(round.id)} failed: ${errorText(error)}`,
        );
      }
    }
  }
}

/**
 * The `weather:refresh` job: for every round with a weather record,
 * forgets it once the round is not a completed hike or the hike is over;
 * fetches the forecast when the hike has a pin and is within Open-Meteo's
 * 16 days; then brings the surfaces up to date. Schedules itself an hour
 * later while a hike with a pin within the 16 days has not ended, or for
 * the day the forecast of one further ahead appears.
 */
export const refreshWeather: JobHandler = async (context) => {
  const { storage } = context;
  const store = new PollStore(storage);
  const { timezone: timeZone, units } = new GuildConfig(storage).get();
  let next = Infinity;
  for (const [roundId, record] of weatherRecords(storage)) {
    const now = store.now();
    let round = store.getRound(roundId);
    const hike = round && hikeHoursOf(round, timeZone);
    if (!round || !hike || round.status !== "complete" || !(hike.end > now)) {
      clearWeather(storage, roundId);
      continue;
    }
    if (roundPoint(round) !== null) {
      if (withinForecast(hike, timeZone, now)) {
        await updateForecast(context, round, timeZone, units);
        round = store.getRound(roundId) ?? round;
        if (now + WEATHER_REFRESH_MS < hike.end) {
          next = Math.min(next, now + WEATHER_REFRESH_MS);
        }
      } else {
        next = Math.min(next, forecastOpensAt(hike, timeZone));
      }
    }
    await showWeather(context, round, record, timeZone);
  }
  if (next !== Infinity) await schedule(storage, WEATHER_JOB, next);
};

/**
 * Runs `weather:refresh` at once, for example after the units changed.
 */
export async function refreshWeatherNow(
  storage: DurableObjectStorage,
): Promise<void> {
  await schedule(storage, WEATHER_JOB, new PollStore(storage).now());
}

/**
 * The date vote's close step, after the thread and the event: plans the
 * round's weather and runs the job at once for its first forecast.
 */
export const planWeatherStep: CloseStep = {
  name: "plan the forecast",
  run: async ({ round, guildId }, context) => {
    if (round === null) return {};
    planWeather(context.storage, round.id, guildId);
    await refreshWeatherNow(context.storage);
    return {};
  },
};

/**
 * After the map pin changed on a planned hike: runs the job at once, so
 * the forecast for the new pin appears.
 */
export const refreshWeatherPin: MapPinHook = {
  name: "update the forecast",
  run: async ({ round, guildId }, context) => {
    if (round.status !== "complete") return;
    planWeather(context.storage, round.id, guildId);
    await refreshWeatherNow(context.storage);
  },
};

/** Registers the job. */
export function registerWeather(router: Router): Router {
  router.job(WEATHER_JOB, refreshWeather);
  return router;
}
