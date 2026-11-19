import { describe, expect, it } from "vitest";
import {
  CADENCE_WINDOW_DAYS,
  DEFAULT_HIKE_TIME,
  DEFAULT_TIMEZONE,
  addDays,
  cadenceDateCandidates,
  cadenceDateVoteClose,
  cadenceWindow,
  clockIn,
  dateTimeIn,
  defaultDateCandidates,
  hikeStart,
  nextCadenceInstant,
  nextDailyInstant,
  normalizeTimeZone,
  parseDateOption,
  previousCadenceInstant,
  timeIn,
  todayIn,
  weekdayOf,
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

describe("timeIn and dateTimeIn", () => {
  it.each([
    [
      "2026-11-18T19:42:00Z",
      "America/Los_Angeles",
      "11:42",
      "Wed, 18 Nov 2026 · 11:42",
    ],
    [
      "2026-11-19T08:00:00Z",
      "America/Los_Angeles",
      "00:00",
      "Thu, 19 Nov 2026 · 00:00",
    ],
    [
      "2026-11-18T19:42:00Z",
      "Asia/Kolkata",
      "01:12",
      "Thu, 19 Nov 2026 · 01:12",
    ],
    // The second 01:30 of the night the clocks go back in Los Angeles.
    [
      "2026-11-01T09:30:00Z",
      "America/Los_Angeles",
      "01:30",
      "Sun, 1 Nov 2026 · 01:30",
    ],
  ])("at %s in %s is %s, %s", (iso, zone, time, written) => {
    expect(timeIn(zone, Date.parse(iso))).toBe(time);
    expect(dateTimeIn(zone, Date.parse(iso))).toBe(written);
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

describe("addDays", () => {
  it.each([
    ["2026-11-18", 0, "2026-11-18"],
    ["2026-11-18", 31, "2026-12-19"],
    ["2026-11-18", -1, "2026-11-17"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2027-02-28", 1, "2027-03-01"],
    ["2026-01-31", 31, "2026-03-03"],
  ])("%s plus %i days is %s", (day, days, expected) => {
    expect(addDays(day, days)).toBe(expected);
  });
});

describe("defaultDateCandidates", () => {
  it("offers the next two weekends after a Wednesday at the default time", () => {
    expect(defaultDateCandidates("2026-11-18")).toEqual([
      "2026-11-21 11:00",
      "2026-11-22 11:00",
      "2026-11-28 11:00",
      "2026-11-29 11:00",
    ]);
  });

  it.each([
    ["Sun", "2026-11-15", "2026-11-21"],
    ["Mon", "2026-11-16", "2026-11-21"],
    ["Tue", "2026-11-17", "2026-11-21"],
    ["Wed", "2026-11-18", "2026-11-21"],
    ["Thu", "2026-11-19", "2026-11-21"],
    ["Fri", "2026-11-20", "2026-11-21"],
    // A weekend in progress is not offered.
    ["Sat", "2026-11-21", "2026-11-28"],
    ["Sun", "2026-11-22", "2026-11-28"],
  ])("on a %s (%s) starts on Saturday %s", (_weekday, today, saturday) => {
    const candidates = defaultDateCandidates(today);
    expect(candidates).toHaveLength(4);
    expect(candidates[0]).toBe(`${saturday} ${DEFAULT_HIKE_TIME}`);
    expect(candidates[2]).toBe(`${addDays(saturday, 7)} ${DEFAULT_HIKE_TIME}`);
    expect(
      candidates.map((c) => parseDateOption(c)?.label.slice(0, 3)),
    ).toEqual(["Sat", "Sun", "Sat", "Sun"]);
  });

  it("crosses a month end and a year end", () => {
    expect(defaultDateCandidates("2026-11-25")).toEqual([
      "2026-11-28 11:00",
      "2026-11-29 11:00",
      "2026-12-05 11:00",
      "2026-12-06 11:00",
    ]);
    expect(defaultDateCandidates("2026-12-30")).toEqual([
      "2027-01-02 11:00",
      "2027-01-03 11:00",
      "2027-01-09 11:00",
      "2027-01-10 11:00",
    ]);
    expect(defaultDateCandidates("2027-12-27")).toEqual([
      "2028-01-01 11:00",
      "2028-01-02 11:00",
      "2028-01-08 11:00",
      "2028-01-09 11:00",
    ]);
  });

  it("follows today in the guild's zone, not in UTC", () => {
    // 03:00 UTC on Sat 21 Nov 2026 is still Friday evening in Los Angeles.
    const now = Date.UTC(2026, 10, 21, 3);
    expect(defaultDateCandidates(todayIn("UTC", now))[0]).toBe(
      "2026-11-28 11:00",
    );
    expect(defaultDateCandidates(todayIn("America/Los_Angeles", now))[0]).toBe(
      "2026-11-21 11:00",
    );
  });
});

/**
 * The schedule's time functions, in Los Angeles across both of its 2026
 * clock changes (8 March, clocks forward; 1 November, clocks back) and in
 * Kolkata, which has none. 09:00 is 17:00 UTC in Los Angeles in winter and
 * 16:00 UTC in summer, and 03:30 UTC in Kolkata all year.
 */
const LA = "America/Los_Angeles";
const KOLKATA = "Asia/Kolkata";
const WED_0900 = { weekday: 3, time: "09:00" };
const utc = (iso: string) => Date.parse(`${iso}Z`);

describe("weekdayOf", () => {
  it.each([
    ["2026-11-18", 3],
    ["2026-11-22", 0],
    ["2026-11-21", 6],
    ["2028-02-29", 2],
  ])("%s is day %i", (day, weekday) => {
    expect(weekdayOf(day)).toBe(weekday);
  });
});

describe("nextCadenceInstant", () => {
  it.each([
    // [zone, cadence, after, next]
    [
      "a week before spring",
      LA,
      WED_0900,
      "2026-03-04T17:00",
      "2026-03-11T16:00",
    ],
    [
      "the day before, spring",
      LA,
      WED_0900,
      "2026-03-10T12:00",
      "2026-03-11T16:00",
    ],
    [
      "a minute before, spring",
      LA,
      WED_0900,
      "2026-03-11T15:59",
      "2026-03-11T16:00",
    ],
    [
      "at the instant, spring",
      LA,
      WED_0900,
      "2026-03-11T16:00",
      "2026-03-18T16:00",
    ],
    [
      "a week before autumn",
      LA,
      WED_0900,
      "2026-10-28T16:00",
      "2026-11-04T17:00",
    ],
    [
      "on the change, autumn",
      LA,
      WED_0900,
      "2026-11-01T09:30",
      "2026-11-04T17:00",
    ],
    // 21:00 Wednesday in LA is Thursday in UTC; the next Wednesday is local.
    [
      "late on the day, in UTC tomorrow",
      LA,
      WED_0900,
      "2026-11-19T05:00",
      "2026-11-25T17:00",
    ],
    [
      "a Sunday cadence over spring",
      LA,
      { weekday: 0, time: "09:00" },
      "2026-03-01T17:00",
      "2026-03-08T16:00",
    ],
    [
      "a Sunday cadence over autumn",
      LA,
      { weekday: 0, time: "09:00" },
      "2026-10-25T16:00",
      "2026-11-01T17:00",
    ],
    // 02:30 does not exist on 8 March 2026: it is read as 03:30 PDT.
    [
      "a skipped time",
      LA,
      { weekday: 0, time: "02:30" },
      "2026-03-07T00:00",
      "2026-03-08T10:30",
    ],
    // 01:30 happens twice on 1 November 2026: the first, still PDT.
    [
      "a repeated time",
      LA,
      { weekday: 0, time: "01:30" },
      "2026-10-31T00:00",
      "2026-11-01T08:30",
    ],
    [
      "no clock change, spring",
      KOLKATA,
      WED_0900,
      "2026-03-04T03:30",
      "2026-03-11T03:30",
    ],
    [
      "no clock change, autumn",
      KOLKATA,
      WED_0900,
      "2026-10-28T03:30",
      "2026-11-04T03:30",
    ],
    [
      "no clock change, a minute before",
      KOLKATA,
      WED_0900,
      "2026-11-04T03:29",
      "2026-11-04T03:30",
    ],
  ])("%s", (_name, zone, cadence, after, next) => {
    expect(nextCadenceInstant(cadence, zone, utc(after))).toBe(utc(next));
  });

  it("keeps 09:00 local every week through a year in Los Angeles", () => {
    let at = utc("2026-01-01T00:00");
    for (let week = 0; week < 53; week++) {
      at = nextCadenceInstant(WED_0900, LA, at);
      expect(clockIn(LA, at)).toBe("Wed 09:00");
    }
  });
});

describe("previousCadenceInstant", () => {
  it.each([
    ["at the instant", LA, WED_0900, "2026-03-11T16:00", "2026-03-11T16:00"],
    [
      "a minute before, over spring",
      LA,
      WED_0900,
      "2026-03-11T15:59",
      "2026-03-04T17:00",
    ],
    [
      "a minute before, over autumn",
      LA,
      WED_0900,
      "2026-11-04T16:59",
      "2026-10-28T16:00",
    ],
    [
      "the Saturday after",
      LA,
      WED_0900,
      "2026-11-07T20:00",
      "2026-11-04T17:00",
    ],
    [
      "no clock change",
      KOLKATA,
      WED_0900,
      "2026-03-11T03:29",
      "2026-03-04T03:30",
    ],
  ])("%s", (_name, zone, cadence, at, previous) => {
    expect(previousCadenceInstant(cadence, zone, utc(at))).toBe(utc(previous));
  });
});

describe("nextDailyInstant", () => {
  it.each([
    ["into spring", LA, "2026-03-07T17:00", "2026-03-08T16:00"],
    ["into autumn", LA, "2026-10-31T16:00", "2026-11-01T17:00"],
    ["later the same day", LA, "2026-11-20T08:00", "2026-11-20T17:00"],
    ["no clock change", KOLKATA, "2026-03-07T03:30", "2026-03-08T03:30"],
  ])("%s", (_name, zone, after, next) => {
    expect(nextDailyInstant("09:00", zone, utc(after))).toBe(utc(next));
  });
});

describe("cadenceDateVoteClose", () => {
  it.each([
    // [name, zone, opened, days, closes]
    ["two days, winter", LA, "2026-03-04T17:00", 2, "2026-03-06T17:00"],
    ["three days over spring", LA, "2026-03-05T17:00", 3, "2026-03-08T16:00"],
    ["three days over autumn", LA, "2026-10-30T16:00", 3, "2026-11-02T17:00"],
    ["one day", LA, "2026-11-18T17:00", 1, "2026-11-19T17:00"],
    // 23:30 on Wednesday in LA is Thursday in UTC: days count from Wednesday.
    [
      "opened late, in UTC the next day",
      LA,
      "2026-03-05T07:30",
      2,
      "2026-03-06T17:00",
    ],
    ["no clock change", KOLKATA, "2026-03-04T03:30", 2, "2026-03-06T03:30"],
  ])("%s", (_name, zone, opened, days, closes) => {
    expect(cadenceDateVoteClose(utc(opened), "09:00", days, zone)).toBe(
      utc(closes),
    );
  });
});

describe("cadenceWindow", () => {
  it.each([
    ["a Friday close", LA, "2026-03-06T17:00", "2026-03-07", "2026-03-20"],
    ["a close over autumn", LA, "2026-10-30T16:00", "2026-10-31", "2026-11-13"],
    [
      "a close late in the local day",
      LA,
      "2026-11-21T07:00",
      "2026-11-21",
      "2026-12-04",
    ],
    [
      "no clock change",
      KOLKATA,
      "2026-03-06T03:30",
      "2026-03-07",
      "2026-03-20",
    ],
  ])("%s", (_name, zone, closes, first, last) => {
    expect(cadenceWindow(utc(closes), zone)).toEqual({ first, last });
    expect(addDays(first, CADENCE_WINDOW_DAYS - 1)).toBe(last);
  });
});

describe("cadenceDateCandidates", () => {
  it.each([
    [
      "a Friday close: two whole weekends",
      LA,
      "2026-03-06T17:00",
      ["2026-03-07", "2026-03-08", "2026-03-14", "2026-03-15"],
    ],
    [
      "a Saturday close: the Sunday, a weekend, the last Saturday",
      LA,
      "2026-03-07T17:00",
      ["2026-03-08", "2026-03-14", "2026-03-15", "2026-03-21"],
    ],
    [
      "a Sunday close over autumn",
      LA,
      "2026-11-01T17:00",
      ["2026-11-07", "2026-11-08", "2026-11-14", "2026-11-15"],
    ],
    [
      "no clock change",
      KOLKATA,
      "2026-11-20T03:30",
      ["2026-11-21", "2026-11-22", "2026-11-28", "2026-11-29"],
    ],
  ])("%s", (_name, zone, closes, days) => {
    expect(cadenceDateCandidates(utc(closes), zone)).toEqual(
      days.map((day) => `${day} ${DEFAULT_HIKE_TIME}`),
    );
  });
});
