/**
 * Coordinates a member wrote: decimal `lat, lon`, a `geo:` address, or a
 * link from Google Maps, OpenStreetMap or Apple Maps. Pure: no network
 * request is made, so short links (`maps.app.goo.gl/…`) are not expanded.
 */

/** A point on the globe, in decimal degrees (WGS 84). */
export interface Point {
  lat: number;
  lon: number;
}

const NUMBER = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

/**
 * The patterns, most specific first: a link names the place it pins in
 * `!3d…!4d…` (Google's place), then in its query (`q=`, `query=`, `ll=`,
 * `mlat`/`mlon`), then in the view (`@lat,lon`, `#map=z/lat/lon`).
 */
const PATTERNS: readonly { re: RegExp; lat: number; lon: number }[] = [
  // Google Maps place: …!3d47.4875!4d-121.7234
  { re: new RegExp(`!3d(${NUMBER})!4d(${NUMBER})`), lat: 1, lon: 2 },
  // Google Maps ?q= / ?query=, Apple Maps ?ll= / ?q=, ?daddr=.
  {
    re: new RegExp(
      `[?&](?:q|query|ll|daddr|sll)=(${NUMBER})(?:,|%2C)\\s*(${NUMBER})(?![\\d.])`,
      "i",
    ),
    lat: 1,
    lon: 2,
  },
  // OpenStreetMap marker: ?mlat=…&mlon=…
  {
    re: new RegExp(`[?&]mlat=(${NUMBER})&mlon=(${NUMBER})`, "i"),
    lat: 1,
    lon: 2,
  },
  {
    re: new RegExp(`[?&]mlon=(${NUMBER})&mlat=(${NUMBER})`, "i"),
    lat: 2,
    lon: 1,
  },
  // Google Maps view: /@47.4875,-121.7234,15z
  { re: new RegExp(`/@(${NUMBER}),(${NUMBER})(?![\\d.])`), lat: 1, lon: 2 },
  // OpenStreetMap view: #map=15/47.4875/-121.7234
  {
    re: new RegExp(`#map=\\d{1,2}/(${NUMBER})/(${NUMBER})(?![\\d.])`),
    lat: 1,
    lon: 2,
  },
  // geo:47.4875,-121.7234 (RFC 5870), with optional altitude or params.
  {
    re: new RegExp(`\\bgeo:(${NUMBER}),(${NUMBER})(?![\\d.])`, "i"),
    lat: 1,
    lon: 2,
  },
];

/** A text that is nothing but `lat, lon`, with any number of decimals. */
const PAIR = new RegExp(`^\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*$`);

/**
 * Plain decimal `lat, lon` inside other text, with at least two decimals
 * each, so "Trail 3, 5 miles" is not read as a point.
 */
const DECIMAL =
  /(?<![\w.:/@=-])([-+]?\d{1,2}\.\d{2,})\s*,\s*([-+]?\d{1,3}\.\d{2,})(?![\w.])/;

function inRange(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

/**
 * The point `text` names, or null when it names none or names one out of
 * range (latitude beyond ±90, longitude beyond ±180). The first pattern
 * that matches decides; an out-of-range match is not passed over for a
 * later one.
 */
export function parseCoordinates(text: string): Point | null {
  for (const { re, lat, lon } of PATTERNS) {
    const match = re.exec(text);
    if (match) return point(match[lat], match[lon]);
  }
  const match = PAIR.exec(text) ?? DECIMAL.exec(text);
  return match ? point(match[1], match[2]) : null;
}

function point(latText?: string, lonText?: string): Point | null {
  const lat = Number(latText);
  const lon = Number(lonText);
  return inRange(lat, lon) ? { lat, lon } : null;
}

/** The first point found in `texts`, in order; null texts are skipped. */
export function firstCoordinates(
  texts: readonly (string | null | undefined)[],
): Point | null {
  for (const text of texts) {
    const found = text ? parseCoordinates(text) : null;
    if (found) return found;
  }
  return null;
}
