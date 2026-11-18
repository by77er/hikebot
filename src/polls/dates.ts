export interface ParsedDate {
  /** `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`; sorts chronologically as text. */
  value: string;
  /** For display, e.g. `Sat, 5 Dec 2026` or `Sat, 5 Dec 2026 · 09:00`. */
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
 * wall-clock time, with no timezone. Returns null for anything else,
 * including dates and times that do not exist.
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
  let value = `${y}-${m}-${d}`;
  let label = `${weekday}, ${String(day)} ${MONTHS[month - 1] ?? ""} ${y}`;

  if (hh !== undefined && mm !== undefined) {
    if (Number(hh) > 23 || Number(mm) > 59) return null;
    value += ` ${hh}:${mm}`;
    label += ` · ${hh}:${mm}`;
  }
  return { value, label };
}
