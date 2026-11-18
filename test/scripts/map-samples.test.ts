import { describe, expect, it, vi } from "vitest";
import regions from "../../maps/regions.json";
import {
  SAMPLE_VIEWS,
  drawSamples,
  type Paint,
} from "../../scripts/map-samples";

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
