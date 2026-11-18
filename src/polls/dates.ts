/** The time zone of a guild that has not set one. */
export const DEFAULT_TIMEZONE = "America/Los_Angeles";

/** The start time of a date typed without one, `HH:MM`. */
export const DEFAULT_HIKE_TIME = "11:00";

/** How long a hike is planned to last, from its start. */
export const HIKE_DURATION_HOURS = 4;

export interface ParsedDate {
  /** `YYYY-MM-DD HH:MM`; sorts chronologically as text. */
  value: string;
  /** For display, e.g. `Sat, 5 Dec 2026 · 09:00`. */
  label: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?: +(\d{2}):(\d{2}))?$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Parses `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` (24-hour) as a calendar date and
 * wall-clock time in the guild's time zone; a date without a time starts at
 * `DEFAULT_HIKE_TIME`. Returns null for anything else, including dates and
 * times that do not exist on the calendar.
 */
export function parseDateOption(line: string): ParsedDate | null {
  const match = PATTERN.exec(line.trim());
  if (!match) return null;
  const [, y = "", m = "", d = "", hh, mm] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  const weekday = WEEKDAYS[date.getUTCDay()] ?? "";
  const time =
    hh !== undefined && mm !== undefined ? `${hh}:${mm}` : DEFAULT_HIKE_TIME;
  if (Number(time.slice(0, 2)) > 23 || Number(time.slice(3)) > 59) return null;
  return {
    value: `${y}-${m}-${d} ${time}`,
    label: `${weekday}, ${String(day)} ${MONTHS[month - 1] ?? ""} ${y} · ${time}`,
  };
}

/** Short names members type for the zones most groups use. */
const TIMEZONE_ALIASES: Record<string, string> = {
  PT: "America/Los_Angeles",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  MT: "America/Denver",
  MST: "America/Denver",
  MDT: "America/Denver",
  CT: "America/Chicago",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  ET: "America/New_York",
  EST: "America/New_York",
  EDT: "America/New_York",
  UTC: "UTC",
  GMT: "UTC",
};

/**
 * The canonical IANA name of a time zone typed in any case
 * (`america/denver` is `America/Denver`), or of one of the aliases PT, MT,
 * CT, ET (with their standard and daylight forms), UTC and GMT. Null when
 * it names no zone; offsets such as `+05:00` are refused too.
 */
export function normalizeTimeZone(input: string): string | null {
  const name = input.trim();
  const alias = TIMEZONE_ALIASES[name.toUpperCase()];
  if (alias !== undefined) return alias;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(name)) return null;
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat("en-US", {
      timeZone: name,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  return CURRENT_NAMES[resolved] ?? resolved;
}

/**
 * The current IANA names of zones the runtime's ICU still calls by an older
 * name: it resolves `Asia/Kolkata` (and `asia/calcutta`) to `Asia/Calcutta`.
 */
const CURRENT_NAMES: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  return format;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The calendar date and clock time in `timeZone` at the instant `at`. */
function wallClock(timeZone: string, at: number): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** The wall clock read as if it were UTC, in milliseconds. */
function asUtc(clock: WallClock): number {
  return Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
}

/** How far `timeZone`'s clock is ahead of UTC at `at`, in milliseconds. */
function offsetAt(timeZone: string, at: number): number {
  return asUtc(wallClock(timeZone, at)) - Math.floor(at / 1000) * 1000;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant, in milliseconds since the epoch, at which a stored date
 * value (`YYYY-MM-DD HH:MM`, or `YYYY-MM-DD` read as `DEFAULT_HIKE_TIME`)
 * happens in `timeZone`. A time skipped when the clocks go forward maps to
 * the instant one hour later on the clock (the offset from before the
 * change); a time that happens twice when they go back maps to the first.
 * NaN when the value is not a date.
 */
export function hikeStart(dateValue: string, timeZone: string): number {
  const match = PATTERN.exec(dateValue.trim());
  if (!match) return NaN;
  const [, y = "", m = "", d = "", hh, mm] = match;
  const [hour, minute] = (
    hh !== undefined && mm !== undefined
      ? [hh, mm]
      : DEFAULT_HIKE_TIME.split(":")
  ).map(Number);
  const wanted = Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    hour ?? 0,
    minute ?? 0,
  );
  const before = wanted - offsetAt(timeZone, wanted - DAY_MS);
  const after = wanted - offsetAt(timeZone, wanted + DAY_MS);
  const matches = [before, after].filter(
    (at) => asUtc(wallClock(timeZone, at)) === wanted,
  );
  return matches.length === 0 ? before : Math.min(...matches);
}

/** The calendar day in `timeZone` at the instant `now`, as `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: number): string {
  const clock = wallClock(timeZone, now);
  return [
    String(clock.year).padStart(4, "0"),
    String(clock.month).padStart(2, "0"),
    String(clock.day).padStart(2, "0"),
  ].join("-");
}

/** How many days after today a member may propose a date for, inclusive. */
export const MAX_PROPOSAL_DAYS_AHEAD = 31;

/** The calendar day `days` after `day`, both `YYYY-MM-DD`. */
export function addDays(day: string, days: number): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d + days);
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * The date vote's default candidates for `today` (`YYYY-MM-DD`): the
 * Saturday and Sunday of the next two weekends, at `DEFAULT_HIKE_TIME`, as
 * `YYYY-MM-DD HH:MM`. The first Saturday is the first one strictly after
 * today, so a weekend in progress is not offered.
 */
export function defaultDateCandidates(today: string): string[] {
  const [y = 0, m = 1, d = 1] = today.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  // Saturday is 6; a Saturday today waits a whole week.
  const toSaturday = 6 - date.getUTCDay() || 7;
  return [0, 1, 7, 8].map(
    (offset) => `${addDays(today, toSaturday + offset)} ${DEFAULT_HIKE_TIME}`,
  );
}

/** The weekday names, Sunday first, as `getUTCDay` numbers them. */
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** The day of the week of `day` (`YYYY-MM-DD`): 0 is Sunday, 6 Saturday. */
export function weekdayOf(day: string): number {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getUTCDay();
}

/** A weekly moment in a guild's time zone: a weekday and a time of day. */
export interface WeeklyTime {
  /** 0 (Sunday) to 6 (Saturday). */
  weekday: number;
  /** `HH:MM`, 24-hour. */
  time: string;
}

/** How many days after the date vote closes a cadence round's hike may be. */
export const CADENCE_WINDOW_DAYS = 14;

/**
 * The instant at which the clock in `timeZone` reads `time` (`HH:MM`) on
 * `day` (`YYYY-MM-DD`), as `hikeStart` reads it across clock changes.
 */
export function instantOn(day: string, time: string, timeZone: string): number {
  return hikeStart(`${day} ${time}`, timeZone);
}

/**
 * The first instant strictly after `after` at which it is `cadence.time` on
 * `cadence.weekday` in `timeZone`.
 */
export function nextCadenceInstant(
  cadence: WeeklyTime,
  timeZone: string,
  after: number,
): number {
  const today = todayIn(timeZone, after);
  const ahead = (cadence.weekday - weekdayOf(today) + 7) % 7;
  const first = instantOn(addDays(today, ahead), cadence.time, timeZone);
  return first > after
    ? first
    : instantOn(addDays(today, ahead + 7), cadence.time, timeZone);
}

/**
 * The last instant at or before `at` at which it is `cadence.time` on
 * `cadence.weekday` in `timeZone`.
 */
export function previousCadenceInstant(
  cadence: WeeklyTime,
  timeZone: string,
  at: number,
): number {
  const today = todayIn(timeZone, at);
  const back = (weekdayOf(today) - cadence.weekday + 7) % 7;
  const last = instantOn(addDays(today, -back), cadence.time, timeZone);
  return last <= at
    ? last
    : instantOn(addDays(today, -back - 7), cadence.time, timeZone);
}

/** The first instant strictly after `after` at which it is `time` in `timeZone`. */
export function nextDailyInstant(
  time: string,
  timeZone: string,
  after: number,
): number {
  const today = todayIn(timeZone, after);
  const first = instantOn(today, time, timeZone);
  return first > after ? first : instantOn(addDays(today, 1), time, timeZone);
}

/**
 * When a date vote opened at `openedAt` closes on a cadence: at `time` in
 * `timeZone`, `days` calendar days after the day it opened.
 */
export function cadenceDateVoteClose(
  openedAt: number,
  time: string,
  days: number,
  timeZone: string,
): number {
  return instantOn(addDays(todayIn(timeZone, openedAt), days), time, timeZone);
}

/**
 * The days a cadence round's hike may fall on, both `YYYY-MM-DD` and
 * included: the `CADENCE_WINDOW_DAYS` days after the day the date vote
 * closes (`closesAt`) in `timeZone`.
 */
export function cadenceWindow(
  closesAt: number,
  timeZone: string,
): { first: string; last: string } {
  const closeDay = todayIn(timeZone, closesAt);
  return {
    first: addDays(closeDay, 1),
    last: addDays(closeDay, CADENCE_WINDOW_DAYS),
  };
}

/**
 * A cadence round's default candidates: every Saturday and Sunday in its
 * window (`cadenceWindow`), at `DEFAULT_HIKE_TIME`, as `YYYY-MM-DD HH:MM`.
 */
export function cadenceDateCandidates(
  closesAt: number,
  timeZone: string,
): string[] {
  const { first } = cadenceWindow(closesAt, timeZone);
  const days: string[] = [];
  for (let i = 0; i < CADENCE_WINDOW_DAYS; i++) {
    const day = addDays(first, i);
    const weekday = weekdayOf(day);
    if (weekday === 0 || weekday === 6) {
      days.push(`${day} ${DEFAULT_HIKE_TIME}`);
    }
  }
  return days;
}

/** The weekday and time in `timeZone` at the instant `now`: `Wed 11:42`. */
export function clockIn(timeZone: string, now: number): string {
  const clock = wallClock(timeZone, now);
  const weekday = WEEKDAYS[new Date(asUtc(clock)).getUTCDay()] ?? "";
  return `${weekday} ${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
}
