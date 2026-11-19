import { describe, expect, it } from "vitest";
import { assetPath } from "../../../src/web/assets";
import {
  coordinates,
  MAP_SCRIPT,
  MAP_STYLE,
  MapView,
  PLACE_ZOOM,
  type MapConfig,
} from "../../../src/web/components/map-view";
import { outline } from "../helpers";
import { render, spokenText } from "./render";

const PIN = { lat: 47.4881, lon: -121.7232, label: "Mount Si" };

/** The settings the browser script reads from the figure. */
async function config(html: string): Promise<MapConfig | null> {
  let data: string | null = null;
  await new HTMLRewriter()
    .on("figure", {
      element(element) {
        data = element.getAttribute("data-map");
      },
    })
    .transform(new Response(html))
    .text();
  if (data === null) return null;
  // HTMLRewriter gives the attribute as written, with its entities.
  const text = (data as string)
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return JSON.parse(text) as MapConfig;
}

describe("MapView", () => {
  it("shows the stored picture with the place's name, the caption and the map's settings", async () => {
    const html = render(
      <MapView
        title="Map of Mount Si"
        markers={[PIN]}
        picture="/g/1/map.png"
        caption="Mount Si: 47.4881° N, 121.7232° W"
      />,
    );
    expect(html).toContain(
      '<img class="map-view__picture" src="/g/1/map.png" alt="Map of Mount Si" width="600" height="400"/>',
    );
    expect(html).not.toMatch(/<figure[^>]*hidden/);
    expect(await config(html)).toEqual({
      style: MAP_STYLE,
      title: "Map of Mount Si",
      zoom: PLACE_ZOOM,
      markers: [PIN],
    });
    expect(await spokenText(html)).toContain(
      "Mount Si: 47.4881° N, 121.7232° W",
    );
  });

  it("loads only its own script, from this site, as a module", async () => {
    const html = render(<MapView title="Map" markers={[PIN]} />);
    expect(html).toContain(
      `<script type="module" src="${assetPath(MAP_SCRIPT)}"></script>`,
    );
    const page = await outline(html);
    expect(page.scripts).toBe(1);
    expect(page.styleAttributes).toBe(0);
    expect(page.eventAttributes).toBe(0);
  });

  it("names its zoom buttons, which wait hidden for the map", async () => {
    const html = render(<MapView title="Map" markers={[PIN]} />);
    expect(html).toMatch(/<div class="map-view__zoom" hidden/);
    const text = await spokenText(html);
    expect(text).toContain("Zoom in");
    expect(text).toContain("Zoom out");
    expect([...html.matchAll(/type="button"/g)]).toHaveLength(2);
  });

  it("says the map needs JavaScript where it has no picture, in the frame the map takes", async () => {
    const html = render(<MapView title="Map" markers={[PIN]} />);
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/<figure[^>]*hidden/);
    expect(html).toContain(
      '<div class="map-view__frame"><p class="map-view__picture map-view__fallback">',
    );
    expect(await spokenText(html)).toContain(
      "Turn on JavaScript to see the map.",
    );
  });

  it("lists numbered places under the map, in their order, with their coordinates", async () => {
    const html = render(
      <MapView
        title="Map of the proposed locations"
        markers={[
          { ...PIN, number: 1 },
          { lat: 47.4987, lon: -121.756, label: "Little Si", number: 2 },
        ]}
      />,
    );
    const text = await spokenText(html);
    expect(text).toContain(
      "Places on the map Mount Si 47.4881° N, 121.7232° W Little Si 47.4987° N, 121.7560° W",
    );
    expect(html).toContain('<ol class="map-view__legend list-reset"');
  });

  it("shows nothing without a marker", () => {
    expect(render(<MapView title="Map" markers={[]} />)).toBe("");
  });

  it("puts names with markup in them in as text", async () => {
    const markup = "<script>alert(1)</script>";
    const html = render(
      <MapView
        title={`Map of ${markup}`}
        markers={[{ ...PIN, label: markup, number: 1 }]}
        picture="/g/1/map.png"
      />,
    );
    expect((await outline(html)).scripts).toBe(1);
    expect(html).not.toContain("<script>alert");
    expect((await config(html))?.markers[0]?.label).toBe(markup);
  });
});

describe("coordinates", () => {
  it("writes latitude and longitude with their hemispheres", () => {
    expect(coordinates({ lat: 47.4881, lon: -121.7232 })).toBe(
      "47.4881° N, 121.7232° W",
    );
    expect(coordinates({ lat: -33.85, lon: 151.2 })).toBe(
      "33.8500° S, 151.2000° E",
    );
  });
});
