import { describe, expect, it } from "vitest";
import {
  OSM_ATTRIBUTION,
  formatDegrees,
  formatPoint,
  googleLink,
  mapLinks,
  osmLink,
  placeLine,
  withAttribution,
} from "../../src/geo/links";

const SI = { lat: 47.4875, lon: -121.7234 };

describe("formatDegrees", () => {
  it.each([
    [47.4875, "47.4875"],
    [-121.723456789, "-121.72346"],
    [12, "12"],
    [12.5, "12.5"],
    [0.000001, "0"],
    [-0.000001, "0"],
    [-180, "-180"],
  ])("writes %s as %s", (value, text) => {
    expect(formatDegrees(value)).toBe(text);
  });
});

describe("map links", () => {
  it.each([
    [
      "OpenStreetMap with a marker and the view",
      osmLink(SI),
      "https://www.openstreetmap.org/?mlat=47.4875&mlon=-121.7234#map=13/47.4875/-121.7234",
    ],
    [
      "OpenStreetMap short, with the marker only",
      osmLink(SI, true),
      "https://www.openstreetmap.org/?mlat=47.4875&mlon=-121.7234",
    ],
    [
      "Google Maps search",
      googleLink(SI),
      "https://www.google.com/maps/search/?api=1&query=47.4875,-121.7234",
    ],
    [
      "both, as markdown",
      mapLinks(SI),
      "[OpenStreetMap](https://www.openstreetmap.org/?mlat=47.4875&mlon=-121.7234#map=13/47.4875/-121.7234) · [Google Maps](https://www.google.com/maps/search/?api=1&query=47.4875,-121.7234)",
    ],
    ["the point for a modal", formatPoint(SI), "47.4875, -121.7234"],
  ])("builds %s", (_name, built, expected) => {
    expect(built).toBe(expected);
  });

  it("shows the place name before the links when there is one", () => {
    expect(placeLine(SI, "Mount Si, King County")).toBe(
      `📍 Mount Si, King County · ${mapLinks(SI)}`,
    );
    expect(placeLine(SI, null)).toBe(`📍 ${mapLinks(SI)}`);
  });

  it("adds the attribution only under a place", () => {
    expect(withAttribution(["a", placeLine(SI, null)])).toEqual([
      "a",
      placeLine(SI, null),
      OSM_ATTRIBUTION,
    ]);
    expect(withAttribution(["a", "b"])).toEqual(["a", "b"]);
    expect(OSM_ATTRIBUTION).toBe("-# © OpenStreetMap contributors");
  });
});
