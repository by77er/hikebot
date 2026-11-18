import { describe, expect, it } from "vitest";
import {
  DEFAULT_HIKE_TIME,
  DEFAULT_TIMEZONE,
  clockIn,
  hikeStart,
  normalizeTimeZone,
  parseDateOption,
  todayIn,
} from "../../src/polls/dates";

describe("parseDateOption", () => {
  it.each([
    ["2026-12-05", "2026-12-05 11:00", "Sat, 5 Dec 2026 · 11:00"],
    ["2026-12-05 09:00", "2026-12-05 09:00", "Sat, 5 Dec 2026 · 09:00"],
    ["  2026-12-05   23:59 ", "2026-12-05 23:59", "Sat, 5 Dec 2026 · 23:59"],
    ["2026-11-18", "2026-11-18 11:00", "Wed, 18 Nov 2026 · 11:00"],
    ["2026-01-01 00:00", "2026-01-01 00:00", "Thu, 1 Jan 2026 · 00:00"],
    ["2028-02-29", "2028-02-29 11:00", "Tue, 29 Feb 2028 · 11:00"],
    ["2000-02-29", "2000-02-29 11:00", "Tue, 29 Feb 2000 · 11:00"],
    ["2026-12-05 09:30", "2026-12-05 09:30", "Sat, 5 Dec 2026 · 09:30"],
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

describe("the constants", () => {
  it("default to Pacific time and 11:00", () => {
    expect(DEFAULT_TIMEZONE).toBe("America/Los_Angeles");
    expect(DEFAULT_HIKE_TIME).toBe("11:00");
  });
});

describe("hikeStart", () => {
  it.each([
    ["2026-12-05 11:00", "America/Los_Angeles", "2026-12-05T19:00:00.000Z"],
    ["2026-07-04 11:00", "America/Los_Angeles", "2026-07-04T18:00:00.000Z"],
    ["2026-12-05", "America/Los_Angeles", "2026-12-05T19:00:00.000Z"],
    ["2026-07-04", "America/Los_Angeles", "2026-07-04T18:00:00.000Z"],
    ["2026-12-05 00:00", "America/Los_Angeles", "2026-12-05T08:00:00.000Z"],
    ["2026-12-05 23:59", "America/Los_Angeles", "2026-12-06T07:59:00.000Z"],
    // Spring forward: 02:00-03:00 is skipped, so 02:30 is read as 03:30 PDT.
    ["2026-03-08 02:30", "America/Los_Angeles", "2026-03-08T10:30:00.000Z"],
    ["2026-03-08 01:59", "America/Los_Angeles", "2026-03-08T09:59:00.000Z"],
    ["2026-03-08 03:00", "America/Los_Angeles", "2026-03-08T10:00:00.000Z"],
    // Fall back: 01:00-02:00 happens twice; the first (PDT) is taken.
    ["2026-11-01 01:30", "America/Los_Angeles", "2026-11-01T08:30:00.000Z"],
    ["2026-11-01 00:59", "America/Los_Angeles", "2026-11-01T07:59:00.000Z"],
    ["2026-11-01 02:00", "America/Los_Angeles", "2026-11-01T10:00:00.000Z"],
    ["2026-12-05 11:00", "Asia/Kolkata", "2026-12-05T05:30:00.000Z"],
    ["2026-12-05 03:00", "Asia/Kolkata", "2026-12-04T21:30:00.000Z"],
    ["2026-12-05 11:00", "UTC", "2026-12-05T11:00:00.000Z"],
    ["2026-07-04 11:00", "Europe/Berlin", "2026-07-04T09:00:00.000Z"],
    ["2026-12-05 11:00", "Pacific/Auckland", "2026-12-04T22:00:00.000Z"],
  ])("reads %s in %s as %s", (value, zone, iso) => {
    expect(new Date(hikeStart(value, zone)).toISOString()).toBe(iso);
  });

  it("is NaN for a value that is not a date", () => {
    expect(hikeStart("soon", "UTC")).toBeNaN();
  });

  it("matches the example in the design: 1796497200 for 5 Dec 2026", () => {
    expect(hikeStart("2026-12-05 11:00", "America/Los_Angeles") / 1000).toBe(
      1796497200,
    );
  });
});

describe("todayIn", () => {
  it.each([
    ["2026-12-05T07:30:00Z", "America/Los_Angeles", "2026-12-04"],
    ["2026-12-05T07:59:59Z", "America/Los_Angeles", "2026-12-04"],
    ["2026-12-05T08:00:00Z", "America/Los_Angeles", "2026-12-05"],
    ["2026-07-05T06:59:59Z", "America/Los_Angeles", "2026-07-04"],
    ["2026-07-05T07:00:00Z", "America/Los_Angeles", "2026-07-05"],
    ["2026-12-04T18:29:59Z", "Asia/Kolkata", "2026-12-04"],
    ["2026-12-04T18:30:00Z", "Asia/Kolkata", "2026-12-05"],
    ["2026-12-31T23:59:59Z", "UTC", "2026-12-31"],
    ["2027-01-01T00:00:00Z", "UTC", "2027-01-01"],
  ])("at %s in %s is %s", (iso, zone, day) => {
    expect(todayIn(zone, Date.parse(iso))).toBe(day);
  });
});

describe("clockIn", () => {
  it.each([
    ["2026-11-18T19:42:00Z", "America/Los_Angeles", "Wed 11:42"],
    ["2026-11-19T07:59:00Z", "America/Los_Angeles", "Wed 23:59"],
    ["2026-11-19T08:00:00Z", "America/Los_Angeles", "Thu 00:00"],
    ["2026-11-18T19:42:00Z", "Asia/Kolkata", "Thu 01:12"],
  ])("at %s in %s is %s", (iso, zone, text) => {
    expect(clockIn(zone, Date.parse(iso))).toBe(text);
  });
});

describe("normalizeTimeZone", () => {
  it.each([
    ["America/Los_Angeles", "America/Los_Angeles"],
    ["america/denver", "America/Denver"],
    ["  Europe/Berlin ", "Europe/Berlin"],
    ["EUROPE/BERLIN", "Europe/Berlin"],
    ["Asia/Kolkata", "Asia/Kolkata"],
    ["asia/kolkata", "Asia/Kolkata"],
    ["asia/kolKata", "Asia/Kolkata"],
    ["asia/calcutta", "Asia/Kolkata"],
    ["Europe/Kyiv", "Europe/Kyiv"],
    ["europe/kiev", "Europe/Kyiv"],
    ["America/Argentina/Buenos_Aires", "America/Argentina/Buenos_Aires"],
    ["US/Pacific", "America/Los_Angeles"],
    ["Us/Pacific", "America/Los_Angeles"],
    ["PT", "America/Los_Angeles"],
    ["pst", "America/Los_Angeles"],
    ["PDT", "America/Los_Angeles"],
    ["MT", "America/Denver"],
    ["MST", "America/Denver"],
    ["mdt", "America/Denver"],
    ["CT", "America/Chicago"],
    ["CST", "America/Chicago"],
    ["CDT", "America/Chicago"],
    ["ET", "America/New_York"],
    ["EST", "America/New_York"],
    ["EDT", "America/New_York"],
    ["UTC", "UTC"],
    ["utc", "UTC"],
    ["GMT", "UTC"],
  ])("reads %j as %s", (input, zone) => {
    expect(normalizeTimeZone(input)).toBe(zone);
  });

  it.each([
    "Mars/Olympus",
    "",
    "   ",
    "Pacific",
    "+05:00",
    "-08:00",
    "America/",
    "../etc/passwd",
    "Los Angeles",
  ])("refuses %j", (input) => {
    expect(normalizeTimeZone(input)).toBeNull();
  });
});
