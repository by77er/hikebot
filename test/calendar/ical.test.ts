import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  escapeText,
  foldLine,
  MAX_LINE_OCTETS,
  utcDateTime,
  type CalendarEvent,
} from "../../src/calendar/ical";

const STAMP = Date.UTC(2030, 0, 2, 3, 4, 5);

function hike(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: "hike-7-220000000000000101@hikebot",
    start: Date.UTC(2030, 5, 15, 18, 0),
    end: Date.UTC(2030, 5, 15, 22, 0),
    summary: "Hike: Ridge",
    location: "Ridge",
    description: "Steep\n\nHike thread: https://discord.com/channels/1/2",
    url: "https://discord.com/channels/1/2",
    ...overrides,
  };
}

function octets(line: string): number {
  return new TextEncoder().encode(line).length;
}

/** The physical lines of a document, without their CRLFs. */
function physicalLines(text: string): string[] {
  expect(text.endsWith("\r\n")).toBe(true);
  return text.slice(0, -2).split("\r\n");
}

/** The content lines of a document, unfolded. */
function contentLines(text: string): string[] {
  return text.slice(0, -2).replaceAll("\r\n ", "").split("\r\n");
}

describe("buildCalendar", () => {
  it("writes one hike as this exact text", () => {
    expect(
      buildCalendar({ name: "Hikes", stamp: STAMP, events: [hike()] }),
    ).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//hikebot//Hike calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "NAME:Hikes",
        "X-WR-CALNAME:Hikes",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
        "BEGIN:VEVENT",
        "UID:hike-7-220000000000000101@hikebot",
        "DTSTAMP:20300102T030405Z",
        "DTSTART:20300615T180000Z",
        "DTEND:20300615T220000Z",
        "SUMMARY:Hike: Ridge",
        "LOCATION:Ridge",
        "DESCRIPTION:Steep\\n\\nHike thread: https://discord.com/channels/1/2",
        "URL:https://discord.com/channels/1/2",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  });

  it("leaves out URL for a hike without one", () => {
    const text = buildCalendar({
      name: "Hikes",
      stamp: STAMP,
      events: [hike({ url: null })],
    });
    expect(text).not.toContain("URL:");
  });

  it("writes a valid calendar with no events for a guild without hikes", () => {
    const text = buildCalendar({ name: "Hikes", stamp: STAMP, events: [] });
    expect(text).not.toContain("VEVENT");
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(text.endsWith("X-PUBLISHED-TTL:PT1H\r\nEND:VCALENDAR\r\n")).toBe(
      true,
    );
    const calendar = new ICAL.Component(ICAL.parse(text));
    expect(calendar.getAllSubcomponents("vevent")).toEqual([]);
    expect(calendar.getFirstPropertyValue("version")).toBe("2.0");
  });

  it("ends every line in CRLF and has no bare CR or LF", () => {
    const text = buildCalendar({
      name: "Hikes",
      stamp: STAMP,
      events: [hike({ description: "one\ntwo\r\nthree\rfour" })],
    });
    expect(text.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
    expect(text).toContain("DESCRIPTION:one\\ntwo\\nthree\\nfour\r\n");
  });

  it("escapes backslash, semicolon, comma and newline in the location and details", () => {
    const label = "Ridge, North; Peak \\ Summit";
    const text = buildCalendar({
      name: "Hikes",
      stamp: STAMP,
      events: [
        hike({
          summary: `Hike: ${label}`,
          location: label,
          description: "Bring water; snacks, and\na map \\ compass",
        }),
      ],
    });
    const lines = contentLines(text);
    expect(lines).toContain("SUMMARY:Hike: Ridge\\, North\\; Peak \\\\ Summit");
    expect(lines).toContain("LOCATION:Ridge\\, North\\; Peak \\\\ Summit");
    expect(lines).toContain(
      "DESCRIPTION:Bring water\\; snacks\\, and\\na map \\\\ compass",
    );
  });

  it("keeps every line within 75 octets and splits no character, for ASCII and multi-byte text", () => {
    const label = `Größer Säntis ${"é".repeat(40)} ,;\\ 山の道 ${"🥾".repeat(30)}`;
    const details = `${"x".repeat(200)}\n${"ü".repeat(100)}`;
    const text = buildCalendar({
      name: "Hikes",
      stamp: STAMP,
      events: [
        hike({
          summary: `Hike: ${label}`,
          location: label,
          description: details,
        }),
      ],
    });
    const lines = physicalLines(text);
    for (const line of lines) {
      expect(octets(line)).toBeLessThanOrEqual(MAX_LINE_OCTETS);
      // A split character would decode to U+FFFD or a lone surrogate.
      expect(line).not.toMatch(/�|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(line).not.toMatch(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    expect(lines.some((line) => octets(line) > 70)).toBe(true);
    expect(contentLines(text)).toContain(`LOCATION:${escapeText(label)}`);
    expect(contentLines(text)).toContain(
      `DESCRIPTION:${"x".repeat(200)}\\n${"ü".repeat(100)}`,
    );
  });
});

describe("foldLine", () => {
  it("leaves a line of 75 octets as it is and folds one of 76", () => {
    expect(foldLine("a".repeat(75))).toBe("a".repeat(75));
    expect(foldLine("a".repeat(76))).toBe(`${"a".repeat(75)}\r\n a`);
  });

  it("starts each continuation with a space and keeps it within 75 octets", () => {
    const folded = foldLine("b".repeat(75 + 74 + 3));
    expect(folded).toBe(
      `${"b".repeat(75)}\r\n ${"b".repeat(74)}\r\n ${"b".repeat(3)}`,
    );
  });

  it("breaks before a multi-byte character that would cross the limit", () => {
    // 74 octets of ASCII, then "é" (2 octets) would make 76.
    const folded = foldLine(`${"a".repeat(74)}é`);
    expect(folded).toBe(`${"a".repeat(74)}\r\n é`);
    // "🥾" is 4 octets: after 73 it would make 77.
    expect(foldLine(`${"a".repeat(73)}🥾`)).toBe(`${"a".repeat(73)}\r\n 🥾`);
    // 25 three-octet characters fill 75 octets exactly.
    expect(foldLine("山".repeat(26))).toBe(`${"山".repeat(25)}\r\n 山`);
  });
});

describe("escapeText", () => {
  it("escapes each special character once", () => {
    expect(escapeText(",;\\")).toBe("\\,\\;\\\\");
    expect(escapeText("a\nb")).toBe("a\\nb");
    expect(escapeText("tab\there")).toBe("tab\there");
    expect(escapeText("bell\u0007")).toBe("bell");
  });
});

describe("utcDateTime", () => {
  it("writes a UTC DATE-TIME without separators or milliseconds", () => {
    expect(utcDateTime(Date.UTC(2030, 11, 31, 23, 59, 58, 999))).toBe(
      "20301231T235958Z",
    );
  });
});

describe("parsed with ical.js", () => {
  it("yields the events, their summaries, places, descriptions and UTC times", () => {
    const label = "Säntis, Gipfel; \\ 山";
    const text = buildCalendar({
      name: "Hikes",
      stamp: STAMP,
      events: [
        hike(),
        hike({
          uid: "hike-8-220000000000000101@hikebot",
          start: Date.UTC(2030, 0, 5, 19, 0),
          end: Date.UTC(2030, 0, 5, 23, 0),
          summary: `Hike: ${label}`,
          location: label,
          description: `${"Long details ".repeat(20)}\nwith ,;\\`,
          url: null,
        }),
      ],
    });
    const calendar = new ICAL.Component(ICAL.parse(text));
    expect(calendar.getFirstPropertyValue("method")).toBe("PUBLISH");
    expect(calendar.getFirstPropertyValue("x-wr-calname")).toBe("Hikes");
    const events = calendar
      .getAllSubcomponents("vevent")
      .map((vevent) => new ICAL.Event(vevent));
    expect(
      events.map((event) => ({
        uid: event.uid,
        summary: event.summary,
        location: event.location,
        description: event.description,
        start: event.startDate.toJSDate().getTime(),
        end: event.endDate.toJSDate().getTime(),
        utc: event.startDate.zone?.tzid,
      })),
    ).toEqual([
      {
        uid: "hike-7-220000000000000101@hikebot",
        summary: "Hike: Ridge",
        location: "Ridge",
        description: "Steep\n\nHike thread: https://discord.com/channels/1/2",
        start: Date.UTC(2030, 5, 15, 18, 0),
        end: Date.UTC(2030, 5, 15, 22, 0),
        utc: "UTC",
      },
      {
        uid: "hike-8-220000000000000101@hikebot",
        summary: `Hike: ${label}`,
        location: label,
        description: `${"Long details ".repeat(20)}\nwith ,;\\`,
        start: Date.UTC(2030, 0, 5, 19, 0),
        end: Date.UTC(2030, 0, 5, 23, 0),
        utc: "UTC",
      },
    ]);
    expect(
      calendar
        .getAllSubcomponents("vevent")[0]
        ?.getFirstPropertyValue("dtstamp")
        ?.toString(),
    ).toBe("2030-01-02T03:04:05Z");
  });
});
