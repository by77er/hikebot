import { Resvg } from "@resvg/resvg-wasm";
import { describe, expect, it } from "vitest";
import { FALLBACK_FAMILY, FAMILY, mapFonts } from "../../src/maps/font";
import { rasterize } from "../../src/maps/rasterize";

describe("mapFonts", () => {
  const fonts = mapFonts();

  it.each([
    { text: "Mount Si", weight: 400, italic: false },
    { text: "North Bend", weight: 600, italic: false },
    { text: "Crater Lake", weight: 400, italic: true },
    { text: "1,254 m", weight: 400, italic: false },
    { text: "WWWW", weight: 600, italic: false },
  ] as const)(
    "measures $text as the rasterizer draws it",
    async ({ text, weight, italic }) => {
      await rasterize(
        "<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>",
        [],
      );
      const size = 40;
      const measured = fonts.metrics({ weight, italic }).width(text, size);
      const renderer = new Resvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="100"><text x="10" y="60" font-family="${FAMILY}" font-size="${String(size)}" font-weight="${String(weight)}"${italic ? ' font-style="italic"' : ""}>${text}</text></svg>`,
        { font: { fontBuffers: fonts.buffers, loadSystemFonts: false } },
      );
      const drawn = renderer.innerBBox();
      renderer.free();
      if (!drawn) throw new Error("nothing drawn");
      // Ink is narrower than the advance by the side bearings; Public Sans's
      // W overhangs its advance by under 1 %, which the label halo holds.
      expect(drawn.width).toBeLessThanOrEqual(measured * 1.01 + 1);
      expect(drawn.width).toBeGreaterThan(measured * 0.85);
    },
  );

  it("sets a text in Public Sans when it has every character", () => {
    expect(fonts.forText("Mount Si 1,254 m").family).toBe(FAMILY);
    expect(fonts.forText("Mount Si / q̓əlbc̓").family).toBe(FALLBACK_FAMILY);
    expect(fonts.forText("Łeba").family).toBe(FAMILY);
  });

  it("tells whether a font has a glyph for every character", () => {
    const metrics = fonts.metrics({ weight: 400, italic: false });
    expect(metrics.covers("North Bend, 1,254 m")).toBe(true);
    expect(metrics.covers("q̓əlbc̓")).toBe(false);
    expect(metrics.covers("")).toBe(true);
  });

  it("gives combining marks no width of their own in the fallback", () => {
    const metrics = fonts.forText("q̓").metrics({ weight: 400, italic: false });
    expect(metrics.width("q̓", 20)).toBeCloseTo(metrics.width("q", 20), 6);
  });

  it("has an ascent and descent", () => {
    const metrics = fonts.metrics({ weight: 400, italic: false });
    expect(metrics.ascent).toBeGreaterThan(0.7);
    expect(metrics.descent).toBeGreaterThan(0.1);
  });
});
