import { describe, expect, it } from "vitest";
import { PIN_FILLS, pinScene } from "../../scripts/map-samples";
import { mapFonts } from "../../src/maps/font";
import { toPicture } from "../../src/maps/projection";
import { rasterize } from "../../src/maps/rasterize";
import { COLOURS, FURNITURE } from "../../src/maps/style";
import { buildSvg } from "../../src/maps/svg";
import { decodePng } from "./png";

const FILL_ROLE = {
  forest: "forest",
  lake: "water",
  glacier: "ice",
} as const;

describe("the pin", () => {
  it.each(PIN_FILLS)(
    "stands out from $kind with its outline and keyline",
    async (fill) => {
      const fonts = mapFonts();
      const scene = pinScene(fill, fonts);
      const png = await decodePng(
        await rasterize(buildSvg(scene), fonts.buffers),
      );
      const ratio = scene.view.pixelRatio;
      const tip = toPicture(scene.view, scene.pin.lon, scene.pin.lat);
      const middle =
        tip.y - ((FURNITURE.pinHeight + FURNITURE.pinTip) * ratio) / 2;
      const edge = tip.x + (FURNITURE.pinWidth * ratio) / 2;
      const outline = FURNITURE.pinOutline * ratio;
      const keyline = FURNITURE.pinKeyline * ratio;

      expect(png.pixel(tip.x, middle).rgb).toBe(COLOURS.pin);
      expect(png.pixel(edge + outline / 2, middle).rgb).toBe(
        COLOURS.pinOutline,
      );
      expect(png.pixel(edge + outline + keyline / 2, middle).rgb).toBe(
        COLOURS.pinKeyline,
      );
      expect(png.pixel(edge + 3 * (outline + keyline), middle).rgb).toBe(
        COLOURS[FILL_ROLE[fill.kind]],
      );
    },
  );
});
