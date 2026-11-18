/**
 * Builds an iCalendar (RFC 5545) document from plain data: no clock, no
 * storage and no Discord code. Lines end in CRLF, text values are escaped,
 * and every line longer than 75 octets is folded without splitting a
 * character. "Calendar feed" in docs/design.md says what goes in it.
 */

/** Product identifier of the calendars hikebot publishes. */
export const PRODID = "-//hikebot//Hike calendar//EN";

/** How often calendar apps are asked to fetch the feed again. */
export const REFRESH_INTERVAL = "PT1H";

/** The longest a line may be, in octets, without its CRLF. */
export const MAX_LINE_OCTETS = 75;

export interface CalendarEvent {
  /** Globally unique and the same on every build for the same hike. */
  uid: string;
  /** Milliseconds since the epoch. */
  start: number;
  /** Milliseconds since the epoch, after `start`. */
  end: number;
  summary: string;
  location: string;
  description: string;
  /** An absolute URL, or null for none. */
  url: string | null;
}

export interface Calendar {
  /** The calendar's name, as calendar apps show it. */
  name: string;
  /** The build time, milliseconds since the epoch: every event's DTSTAMP. */
  stamp: number;
  events: readonly CalendarEvent[];
}

/** The calendar as an iCalendar document. */
export function buildCalendar(calendar: Calendar): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `NAME:${escapeText(calendar.name)}`,
    `X-WR-CALNAME:${escapeText(calendar.name)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}`,
    `X-PUBLISHED-TTL:${REFRESH_INTERVAL}`,
  ];
  for (const event of calendar.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${utcDateTime(calendar.stamp)}`,
      `DTSTART:${utcDateTime(event.start)}`,
      `DTEND:${utcDateTime(event.end)}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `LOCATION:${escapeText(event.location)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      ...(event.url === null ? [] : [`URL:${event.url}`]),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map((line) => `${foldLine(line)}\r\n`).join("");
}

/**
 * A TEXT value as RFC 5545 section 3.3.11 writes it: backslash, semicolon
 * and comma escaped with a backslash, and each line break (CRLF, CR or LF)
 * as `\n`. Other control characters, which TEXT may not hold, are dropped.
 */
export function escapeText(text: string): string {
  return (
    text
      .replace(/[\\;,]/g, (char) => `\\${char}`)
      .replace(/\r\n|\r|\n/g, "\\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, "")
  );
}

/**
 * Folds a content line (without its CRLF) as RFC 5545 section 3.1 says:
 * after at most 75 octets of UTF-8, a CRLF and one space, so each physical
 * line, the space included, stays within 75 octets. It breaks between
 * characters only, never inside a multi-byte character or a surrogate pair.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let part = "";
  let octets = 0;
  // A continuation line starts with a space, which counts toward its 75.
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const size = utf8Length(char);
    if (octets + size > limit) {
      parts.push(part);
      part = "";
      octets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    part += char;
    octets += size;
  }
  parts.push(part);
  return parts.join("\r\n ");
}

/** A UTC DATE-TIME value, such as `20300615T160000Z`. */
export function utcDateTime(at: number): string {
  return new Date(at)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}
