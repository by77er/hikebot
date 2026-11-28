/**
 * Ages as "Content rules" in docs/design-system.md write them: "just now"
 * under 5 s, then "12 s ago", "14 min ago", "3 h ago", and from a day on
 * the date and time as the bot writes them, in the server's time zone
 * ("Thu, 3 Dec 2026 · 07:00"). `public/assets/cairn/ages.mjs` writes the
 * same words in the browser, so an age stays true on a page left open.
 */
import { dateTimeIn } from "../polls/dates";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long before `now` the instant `at` was, in words. An instant after
 * `now` (a clock running behind) is "just now".
 */
export function ageText(at: number, now: number, timeZone: string): string {
  const age = Math.max(0, now - at);
  if (age < 5 * SECOND) return "just now";
  if (age < MINUTE) return `${String(Math.floor(age / SECOND))} s ago`;
  if (age < HOUR) return `${String(Math.floor(age / MINUTE))} min ago`;
  if (age < DAY) return `${String(Math.floor(age / HOUR))} h ago`;
  return dateTimeIn(timeZone, at);
}
