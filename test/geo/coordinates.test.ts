import { describe, expect, it } from "vitest";
import { firstCoordinates, parseCoordinates } from "../../src/geo/coordinates";

describe("parseCoordinates", () => {
  it.each([
    ["decimal lat, lon", "47.4875, -121.7234", [47.4875, -121.7234]],
    ["decimal without a space", "47.4875,-121.7234", [47.4875, -121.7234]],
    [
      "decimal inside text",
      "Trailhead at 47.48, -121.72 by the lot",
      [47.48, -121.72],
    ],
    ["southern and eastern", "-33.8568, 151.2153", [-33.8568, 151.2153]],
    ["explicit plus signs", "+47.4875, +121.7234", [47.4875, 121.7234]],
    ["geo: address", "geo:47.4875,-121.7234", [47.4875, -121.7234]],
    [
      "geo: with altitude and params",
      "geo:47.4875,-121.7234,500;u=35",
      [47.4875, -121.7234],
    ],
    [
      "Google Maps @lat,lon view",
      "https://www.google.com/maps/@47.4875,-121.7234,15z",
      [47.4875, -121.7234],
    ],
    [
      "Google Maps ?q=",
      "https://maps.google.com/?q=47.4875,-121.7234",
      [47.4875, -121.7234],
    ],
    [
      "Google Maps search ?api=1&query=",
      "https://www.google.com/maps/search/?api=1&query=47.4875%2C-121.7234",
      [47.4875, -121.7234],
    ],
    [
      "Google Maps place !3d!4d wins over the @ view",
      "https://www.google.com/maps/place/Mount+Si/@47.5,-121.8,13z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d47.4875!4d-121.7234",
      [47.4875, -121.7234],
    ],
    [
      "OpenStreetMap #map=z/lat/lon",
      "https://www.openstreetmap.org/#map=15/47.4875/-121.7234",
      [47.4875, -121.7234],
    ],
    [
      "OpenStreetMap mlat/mlon marker wins over the view",
      "https://www.openstreetmap.org/?mlat=47.4875&mlon=-121.7234#map=13/47.5/-121.8",
      [47.4875, -121.7234],
    ],
    [
      "OpenStreetMap mlon before mlat",
      "https://www.openstreetmap.org/?mlon=-121.7234&mlat=47.4875",
      [47.4875, -121.7234],
    ],
    [
      "Apple Maps ll=",
      "https://maps.apple.com/?ll=47.4875,-121.7234&q=Mount%20Si",
      [47.4875, -121.7234],
    ],
    ["the edges of the ranges", "-90.00, 180.00", [-90, 180]],
  ])("reads %s", (_name, text, [lat, lon]) => {
    expect(parseCoordinates(text)).toEqual({ lat, lon });
  });

  it.each([
    ["latitude over 90", "90.01, 10.00"],
    ["longitude over 180", "47.00, 180.01"],
    [
      "a link with latitude out of range",
      "https://www.google.com/maps/@91.5,-121.7,15z",
    ],
    ["geo: out of range", "geo:47.48,-200.5"],
    ["#map out of range", "https://www.openstreetmap.org/#map=15/95.1/10.2"],
    ["small whole numbers", "Trail 3, 5 miles"],
    ["one decimal each", "Loop 2.5, 3.5 hours"],
    ["a lone number", "47.4875"],
    ["a name", "Mount Si"],
    ["an empty string", ""],
    ["a short link, not opened", "https://maps.app.goo.gl/abc123XYZ"],
    ["a Google search by name", "https://maps.google.com/?q=Mount+Si"],
    ["a malformed geo: address", "geo:47.48"],
    ["a version number", "v1.2.30, 4.5.60"],
  ])("returns nothing for %s", (_name, text) => {
    expect(parseCoordinates(text)).toBeNull();
  });
});

describe("firstCoordinates", () => {
  it("takes the first text that names a point, skipping empty ones", () => {
    expect(
      firstCoordinates([
        undefined,
        "",
        "Mount Si",
        "47.48, -121.72",
        "1.00, 2.00",
      ]),
    ).toEqual({ lat: 47.48, lon: -121.72 });
    expect(firstCoordinates([null, "Mount Si"])).toBeNull();
  });
});
