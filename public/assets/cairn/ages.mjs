/**
 * Keeps every age on the page true ("Age" in src/web/components/age.tsx):
 * rewrites each `time[data-age]` from its `datetime` and the browser's
 * clock, in the words of src/web/age.ts ("just now", "12 s ago",
 * "14 min ago", "3 h ago", and from a day on "Thu, 3 Dec 2026 · 07:00" in
 * its `data-zone`), now and every 15 seconds. Only the words change.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `at` as the bot writes a date and time in `timeZone`. */
function dateTime(at, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const part = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")} · ${part("hour")}:${part("minute")}`;
}

function ageText(at, now, timeZone) {
  const age = Math.max(0, now - at);
  if (age < 5 * SECOND) return "just now";
  if (age < MINUTE) return `${String(Math.floor(age / SECOND))} s ago`;
  if (age < HOUR) return `${String(Math.floor(age / MINUTE))} min ago`;
  if (age < DAY) return `${String(Math.floor(age / HOUR))} h ago`;
  return dateTime(at, timeZone);
}

function update() {
  const now = Date.now();
  for (const time of document.querySelectorAll("time[data-age]")) {
    const at = Date.parse(time.dateTime);
    if (Number.isNaN(at)) continue;
    const text = ageText(at, now, time.dataset.zone || "UTC");
    if (time.textContent !== text) time.textContent = text;
  }
}

update();
setInterval(update, 15 * SECOND);
