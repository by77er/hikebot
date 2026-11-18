import { describe, expect, it } from "vitest";
import { parseDateOption } from "../../src/polls/dates";

describe("parseDateOption", () => {
  it.each([
    ["2026-12-05", "2026-12-05", "Sat, 5 Dec 2026"],
    ["2026-12-05 09:00", "2026-12-05 09:00", "Sat, 5 Dec 2026 · 09:00"],
    ["  2026-12-05   23:59 ", "2026-12-05 23:59", "Sat, 5 Dec 2026 · 23:59"],
    ["2026-11-18", "2026-11-18", "Wed, 18 Nov 2026"],
    ["2026-01-01 00:00", "2026-01-01 00:00", "Thu, 1 Jan 2026 · 00:00"],
    ["2028-02-29", "2028-02-29", "Tue, 29 Feb 2028"],
    ["2000-02-29", "2000-02-29", "Tue, 29 Feb 2000"],
    ["2027-03-28 02:30", "2027-03-28 02:30", "Sun, 28 Mar 2027 · 02:30"],
  ])("accepts %j", (line, value, label) => {
    expect(parseDateOption(line)).toEqual({ value, label });
  });

  it.each([
    "2026-02-30",
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-12-00",
    "2026-12-05 25:00",
    "2026-12-05 24:00",
    "2026-12-05 09:60",
    "2026/12/05",
    "2026.12.05",
    "05-12-2026",
    "2026-12-5",
    "2026-12-05T09:00",
    "2026-12-05 9:00",
    "2026-12-05 09.00",
    "2026-12-05 09:00:00",
    "2026-12-05 9am",
    "next saturday",
    "",
  ])("rejects %j", (line) => {
    expect(parseDateOption(line)).toBeNull();
  });

  it("gives the weekday of the calendar date for every day of a year", () => {
    const day = new Date(Date.UTC(2026, 0, 1));
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = 0; i < 366; i++) {
      const iso = day.toISOString().slice(0, 10);
      const parsed = parseDateOption(iso);
      expect(parsed?.label.slice(0, 3)).toBe(weekdays[day.getUTCDay()]);
      day.setUTCDate(day.getUTCDate() + 1);
    }
  });
});
