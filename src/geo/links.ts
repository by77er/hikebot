/**
 * Links to a point on public maps, which need no key, and the attribution
 * OpenStreetMap's data asks for wherever it is shown.
 */
import type { Point } from "./coordinates";

/** The attribution line, in Discord's small text. */
export const OSM_ATTRIBUTION = "-# © OpenStreetMap contributors";

/** Degrees to five decimals (about a metre), without trailing zeros. */
export function formatDegrees(value: number): string {
  const fixed = value.toFixed(5).replace(/\.?0+$/, "");
  return fixed === "-0" ? "0" : fixed;
}

/** `47.4875, -121.7234`, as the Set map pin modal shows the pin. */
export function formatPoint({ lat, lon }: Point): string {
  return `${formatDegrees(lat)}, ${formatDegrees(lon)}`;
}

/**
 * The point on openstreetmap.org with a marker, at zoom 13. `short` leaves
 * out the view, which then centres on the marker at the site's default
 * zoom: the link the poll message uses, where room is scarce.
 */
export function osmLink({ lat, lon }: Point, short = false): string {
  const la = formatDegrees(lat);
  const lo = formatDegrees(lon);
  const marker = `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}`;
  return short ? marker : `${marker}#map=13/${la}/${lo}`;
}

/** The point on Google Maps, through its documented search URL. */
export function googleLink({ lat, lon }: Point): string {
  return `https://www.google.com/maps/search/?api=1&query=${formatDegrees(lat)},${formatDegrees(lon)}`;
}

/** `[OpenStreetMap](…) · [Google Maps](…)`, for messages. */
export function mapLinks(point: Point): string {
  return `[OpenStreetMap](${osmLink(point)}) · [Google Maps](${googleLink(point)})`;
}
