/**
 * Turns a forecast into the text the hike's surfaces show: the hike
 * thread's hourly block, the Discord event's compact version and the
 * one-line summary of the hike-day announcement. Pure: everything it needs
 * is passed in, and it writes times in the server's time zone.
 */
import { dateTimeIn, timeIn, todayIn } from "../polls/dates";
import type { Forecast, ForecastHour, StoredForecast, Units } from "./forecast";
import { conditions } from "./wmo";

const HOUR_MS = 60 * 60 * 1000;

/** How far before the start and after the end the hourly block reaches. */
export const FORECAST_PADDING_HOURS = 2;

/** The credit Open-Meteo's licence asks for, with its link, for messages. */
export const OPEN_METEO_CREDIT =
  "[Weather data by Open-Meteo.com](https://open-meteo.com/)";

/** The same credit as plain text, where links are written out. */
export const OPEN_METEO_CREDIT_PLAIN =
  "Weather data by Open-Meteo.com: https://open-meteo.com/";

/** What a surface says when the hike is too far ahead for a forecast. */
export const FORECAST_TOO_FAR = "The forecast appears 16 days before the hike.";

/** What a surface says when the hike has no map pin. */
export const FORECAST_NO_PIN =
  "No forecast: this hike has no map pin. An admin can set one from /hike admin.";

/** What a surface says before the first forecast has arrived. */
export const FORECAST_PENDING = "No forecast yet. It is checked every hour.";

/** The thread block's heading. */
export const FORECAST_HEADING = "### Weather";

/**
 * A freezing level this far above the forecast point or less is within
 * reach of a hike there, so the block names it: metres, or feet.
 */
export const FREEZING_REACH: Record<Units, number> = {
  metric: 1500,
  imperial: 5000,
};

/** The UV index from which the block warns: "high" on the WHO's scale. */
export const HIGH_UV = 6;

/** When the hike starts and ends, in milliseconds since the epoch. */
export interface HikeHours {
  start: number;
  end: number;
}

/** How a forecast's units are written. */
export interface UnitLabels {
  temperature: string;
  wind: string;
  precipitation: string;
  /** The precipitation unit written out. */
  precipitationName: string;
  snow: string;
  height: string;
  /** Decimals of a precipitation amount. */
  decimals: number;
}

const LABELS: Record<Units, UnitLabels> = {
  imperial: {
    temperature: "°F",
    wind: "mph",
    precipitation: "in",
    precipitationName: "inches",
    snow: "in",
    height: "ft",
    decimals: 2,
  },
  metric: {
    temperature: "°C",
    wind: "km/h",
    precipitation: "mm",
    precipitationName: "mm",
    snow: "cm",
    height: "m",
    decimals: 1,
  },
};

/** How the values of a forecast in `units` are written. */
export function unitLabels(units: Units): UnitLabels {
  return LABELS[units];
}

/** From two hours before the start to two hours after the end. */
export function forecastWindow({ start, end }: HikeHours): {
  from: number;
  to: number;
} {
  return {
    from: start - FORECAST_PADDING_HOURS * HOUR_MS,
    to: end + FORECAST_PADDING_HOURS * HOUR_MS,
  };
}

/**
 * The hours the thread's hourly block shows: from two hours before the
 * start to two hours after the end (`forecastWindow`).
 */
export function hourlyHours(
  forecast: Forecast,
  hike: HikeHours,
): ForecastHour[] {
  const { from, to } = forecastWindow(hike);
  return hoursBetween(forecast, from, to);
}

/**
 * The forecast's hours from the one `from` falls in to the last one at or
 * before `to`.
 */
export function hoursBetween(
  forecast: Forecast,
  from: number,
  to: number,
): ForecastHour[] {
  return forecast.hours.filter(
    (hour) => hour.at > from - HOUR_MS && hour.at <= to,
  );
}

function whole(value: number | null): string {
  return value === null ? "–" : String(Math.round(value));
}

function amount(value: number | null, decimals: number): string {
  return value === null ? "–" : value.toFixed(decimals);
}

function grouped(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function maxOf(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : Math.max(...known);
}

function minOf(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : Math.min(...known);
}

/** The columns' widths, so the header and the rows line up. */
const COLUMNS = { time: 5, temperature: 7, chance: 4, amount: 5, wind: 6 };

function row(cells: string[]): string {
  const [
    time = "",
    temperature = "",
    chance = "",
    rain = "",
    wind = "",
    words = "",
  ] = cells;
  return [
    time.padEnd(COLUMNS.time),
    temperature.padStart(COLUMNS.temperature),
    chance.padStart(COLUMNS.chance),
    rain.padStart(COLUMNS.amount),
    wind.padStart(COLUMNS.wind),
    ` ${words}`,
  ]
    .join(" ")
    .trimEnd();
}

/** The fixed-width block: a header, then one row per hour. */
function hourlyTable(
  hours: ForecastHour[],
  timeZone: string,
  labels: UnitLabels,
): string {
  const lines = [
    row(["", labels.temperature, "rain", labels.precipitation, labels.wind]),
    ...hours.map((hour) =>
      row([
        timeIn(timeZone, hour.at),
        `${whole(hour.temperature)}/${whole(hour.feelsLike)}`,
        hour.precipitationChance === null
          ? "–"
          : `${whole(hour.precipitationChance)}%`,
        amount(hour.precipitation, labels.decimals),
        `${whole(hour.wind)}/${whole(hour.gusts)}`,
        conditions(hour.code),
      ]),
    ),
  ];
  return ["```", ...lines, "```"].join("\n");
}

/**
 * The hike day's sunrise and sunset in `timeZone` (`07:30`), each null when
 * the forecast lacks it; null when the forecast has no such day.
 */
export function hikeSunTimes(
  forecast: Forecast,
  hike: HikeHours,
  timeZone: string,
): { sunrise: string | null; sunset: string | null } | null {
  const date = todayIn(timeZone, hike.start);
  const day = forecast.days.find(
    (d) => d.sunrise !== null && todayIn(timeZone, d.sunrise) === date,
  );
  if (!day) return null;
  return {
    sunrise: day.sunrise === null ? null : timeIn(timeZone, day.sunrise),
    sunset: day.sunset === null ? null : timeIn(timeZone, day.sunset),
  };
}

/** The hike day's sunrise and sunset, if the forecast has them. */
function sunLine(
  forecast: Forecast,
  hike: HikeHours,
  timeZone: string,
): string | null {
  const sun = hikeSunTimes(forecast, hike, timeZone);
  if (!sun) return null;
  const parts = [
    ...(sun.sunrise === null ? [] : [`Sunrise ${sun.sunrise}`]),
    ...(sun.sunset === null ? [] : [`Sunset ${sun.sunset}`]),
  ];
  return parts.length === 0 ? null : parts.join(" · ");
}

/** The UV index's words on the WHO's scale, from "high" up. */
function uvWords(uv: number): string {
  if (uv >= 11) return "extreme";
  if (uv >= 8) return "very high";
  return "high";
}

/**
 * The notes under the block: the freezing level when it comes within
 * `FREEZING_REACH` of the forecast point, the UV index when it reaches
 * `HIGH_UV`, and snowfall when there is any.
 */
export function forecastNotes(
  forecast: Forecast,
  hours: ForecastHour[],
): string[] {
  const labels = LABELS[forecast.units];
  const lines: string[] = [];
  const freezing = minOf(hours.map((h) => h.freezingLevel));
  if (
    freezing !== null &&
    forecast.elevation !== null &&
    freezing <= forecast.elevation + FREEZING_REACH[forecast.units]
  ) {
    lines.push(
      `Freezing level down to ${grouped(Math.max(0, freezing))} ${labels.height} (the forecast point is at ${grouped(forecast.elevation)} ${labels.height})`,
    );
  }
  const uv = maxOf(hours.map((h) => h.uvIndex));
  if (uv !== null && uv >= HIGH_UV) {
    lines.push(`UV index up to ${whole(uv)} (${uvWords(uv)})`);
  }
  const snow = hours.reduce((sum, h) => sum + (h.snowfall ?? 0), 0);
  if (snow > 0) {
    lines.push(
      `Snowfall: ${snow.toFixed(labels.decimals)} ${labels.snow} over these hours`,
    );
  }
  return lines;
}

/**
 * The hike thread's forecast: one row per hour from two hours before the
 * start to two hours after the end (time in `timeZone`, temperature and
 * feels-like, chance and amount of precipitation, wind and gusts,
 * conditions in words), then sunrise and sunset, the notes, and the
 * updated time with Open-Meteo's credit. `FORECAST_PENDING` under the
 * heading when the forecast has none of those hours.
 */
export function threadForecast(
  stored: StoredForecast,
  hike: HikeHours,
  timeZone: string,
): string {
  const { forecast } = stored;
  const labels = LABELS[forecast.units];
  const hours = hourlyHours(forecast, hike);
  if (hours.length === 0) return forecastNotice(FORECAST_PENDING);
  const sun = sunLine(forecast, hike, timeZone);
  return [
    FORECAST_HEADING,
    `Times in ${timeZone}; temperature/feels-like (${labels.temperature}), chance and amount of rain or snow (${labels.precipitationName}), wind/gusts (${labels.wind}).`,
    hourlyTable(hours, timeZone, labels),
    ...(sun === null ? [] : [sun]),
    ...forecastNotes(forecast, hours),
    `-# Updated <t:${String(Math.floor(stored.updatedAt / 1000))}:f> · checked every hour · ${OPEN_METEO_CREDIT}`,
  ].join("\n");
}

/** The thread's block when there is no forecast to show: why, under the heading. */
export function forecastNotice(text: string): string {
  return `${FORECAST_HEADING}\n${text}`;
}

/**
 * `45 to 52°F, up to 40% chance of rain, gusts up to 18 mph` over the hike's hours, from
 * its start to its end; null when the forecast has none of them.
 */
export function forecastSummary(
  forecast: Forecast,
  hike: HikeHours,
): string | null {
  const labels = LABELS[forecast.units];
  const hours = hoursBetween(forecast, hike.start, hike.end);
  if (hours.length === 0) return null;
  const parts: string[] = [];
  const low = minOf(hours.map((h) => h.temperature));
  const high = maxOf(hours.map((h) => h.temperature));
  if (low !== null && high !== null) {
    parts.push(
      whole(low) === whole(high)
        ? `${whole(low)}${labels.temperature}`
        : `${whole(low)} to ${whole(high)}${labels.temperature}`,
    );
  }
  const chance = maxOf(hours.map((h) => h.precipitationChance));
  if (chance !== null) {
    parts.push(
      whole(chance) === "0"
        ? "0% chance of rain"
        : `up to ${whole(chance)}% chance of rain`,
    );
  }
  const gusts = maxOf(hours.map((h) => h.gusts));
  if (gusts !== null) parts.push(`gusts up to ${whole(gusts)} ${labels.wind}`);
  return parts.length === 0 ? null : parts.join(", ");
}

/**
 * The event's compact forecast: the summary, one line per two hours from
 * the start to the end, then the updated time written out in `timeZone`
 * and Open-Meteo's credit with its link. `FORECAST_PENDING` when the
 * forecast has none of the hike's hours.
 */
export function eventForecast(
  stored: StoredForecast,
  hike: HikeHours,
  timeZone: string,
): string {
  const { forecast } = stored;
  const labels = LABELS[forecast.units];
  const summary = forecastSummary(forecast, hike);
  if (summary === null) return `Weather: ${FORECAST_PENDING}`;
  const lines = hoursBetween(forecast, hike.start, hike.end)
    .filter((_, i) => i % 2 === 0)
    .map((hour) => {
      const parts = [
        `${timeIn(timeZone, hour.at)} ${conditions(hour.code)}`,
        `${whole(hour.temperature)}${labels.temperature}`,
        ...(hour.precipitationChance === null
          ? []
          : [`rain ${whole(hour.precipitationChance)}%`]),
        ...(hour.gusts === null
          ? []
          : [`gusts ${whole(hour.gusts)} ${labels.wind}`]),
      ];
      return parts.join(", ");
    });
  return [
    `Weather: ${summary}`,
    ...lines,
    `Updated ${dateTimeIn(timeZone, stored.updatedAt)} (${timeZone})`,
    OPEN_METEO_CREDIT_PLAIN,
  ].join("\n");
}
