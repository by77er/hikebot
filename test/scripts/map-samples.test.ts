import { describe, expect, it, vi } from "vitest";
import regions from "../../maps/regions.json";
import {
  PIN_FILLS,
  SAMPLE_VIEWS,
  drawPinSamples,
  drawSamples,
  pinScene,
  type Paint,
} from "../../scripts/map-samples";
import { COLOURS } from "../../src/maps/style";

function capture() {
  const lines: string[] = [];
  return {
    lines,
    output: {
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(line),
    },
  };
}

describe("SAMPLE_VIEWS", () => {
  const { lon, lat } = regions.samplePoint;
  it.each([11, 12, 14])("shows the sample point at zoom %i", (zoom) => {
    expect(SAMPLE_VIEWS).toContainEqual(
      expect.objectContaining({ lon, lat, zoom }),
    );
  });

  it.each(["peak", "lake", "town"])("shows a %s", (kind) => {
    expect(SAMPLE_VIEWS.some((view) => view.file.startsWith(kind))).toBe(true);
  });

  it("names each file once", () => {
    expect(new Set(SAMPLE_VIEWS.map((view) => view.file)).size).toBe(
      SAMPLE_VIEWS.length,
    );
  });
});

describe("drawSamples", () => {
  it("writes each view's picture and reports its size", async () => {
    const paint = vi.fn<Paint>(() =>
      Promise.resolve({ png: new Uint8Array(2048) }),
    );
    const written: string[] = [];
    const { lines, output } = capture();
    const views = SAMPLE_VIEWS.slice(0, 2);

    const code = await drawSamples(
      paint,
      (file) => {
        written.push(file);
        return Promise.resolve();
      },
      output,
      views,
    );

    expect(code).toBe(0);
    expect(written).toEqual(views.map((view) => view.file));
    expect(paint).toHaveBeenCalledWith({
      lon: views[0]?.lon,
      lat: views[0]?.lat,
      zoom: views[0]?.zoom,
    });
    expect(lines[0]).toBe(
      `${views[0]?.file ?? ""}: ${views[0]?.title ?? ""}, 2 KiB`,
    );
  });

  it("passes the units of a view that names them", async () => {
    const paint = vi.fn<Paint>(() =>
      Promise.resolve({ png: new Uint8Array(1) }),
    );
    const view = {
      file: "x.png",
      title: "x",
      lon: 1,
      lat: 2,
      zoom: 12,
      units: "imperial" as const,
    };
    await drawSamples(paint, () => Promise.resolve(), capture().output, [view]);
    expect(paint).toHaveBeenCalledWith({
      lon: 1,
      lat: 2,
      zoom: 12,
      units: "imperial",
    });
  });

  it("fails when a view has no map data", async () => {
    const { lines, output } = capture();
    const code = await drawSamples(
      () => Promise.resolve(undefined),
      () => Promise.resolve(),
      output,
      SAMPLE_VIEWS.slice(0, 1),
    );
    expect(code).toBe(1);
    expect(lines[0]).toContain("no map data");
  });
});

describe("PIN_FILLS and pinScene", () => {
  const fonts = {
    family: "Public Sans",
    metrics: () => ({
      width: (text: string, size: number) => text.length * size * 0.5,
      covers: () => true,
      ascent: 0.9,
      descent: 0.2,
    }),
  };

  it("checks the pin on forest, water and snow, each in a file of its own", () => {
    expect(PIN_FILLS.map(({ kind }) => kind)).toEqual([
      "forest",
      "lake",
      "glacier",
    ]);
    const files = [...SAMPLE_VIEWS, ...PIN_FILLS].map(({ file }) => file);
    expect(new Set(files).size).toBe(files.length);
  });

  it.each(PIN_FILLS)(
    "covers a full-size picture with $kind and puts the pin in its middle",
    (fill) => {
      const scene = pinScene(fill, fonts);
      expect([scene.view.width, scene.view.height]).toEqual([1200, 800]);
      expect(scene.pin).toEqual(regions.samplePoint);
      expect(scene.tiles.length).toBeGreaterThan(0);
      for (const { data } of scene.tiles) {
        const layer = data.layers[fill.layer];
        expect(layer?.length).toBe(1);
        expect(layer?.feature(0).properties.kind).toBe(fill.kind);
      }
    },
  );
});

describe("drawPinSamples", () => {
  it("renders each pin scene's SVG, writes its picture and reports its size", async () => {
    const svgs: string[] = [];
    const written: string[] = [];
    const { lines, output } = capture();
    const fonts = {
      family: "Public Sans",
      metrics: () => ({
        width: (text: string, size: number) => text.length * size * 0.5,
        covers: () => true,
        ascent: 0.9,
        descent: 0.2,
      }),
    };

    await drawPinSamples(
      (svg) => {
        svgs.push(svg);
        return new Uint8Array(3072);
      },
      (file, png) => {
        written.push(`${file} ${String(png.length)}`);
        return Promise.resolve();
      },
      output,
      fonts,
    );

    expect(written).toEqual(PIN_FILLS.map(({ file }) => `${file} 3072`));
    expect(lines).toEqual([
      "pin-on-forest.png: the pin on forest, 3 KiB",
      "pin-on-water.png: the pin on lake, 3 KiB",
      "pin-on-snow.png: the pin on glacier, 3 KiB",
    ]);
    for (const svg of svgs) {
      expect(svg).toMatch(/^<svg [^>]*width="1200" height="800"/);
      expect(svg).toContain(`fill="${COLOURS.pin}"`);
    }
  });
});
