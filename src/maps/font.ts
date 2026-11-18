/**
 * The typeface of map labels, loaded in this one place: Noto Sans (SIL Open
 * Font License 1.1, `./fonts/OFL.txt`), subset to Latin with its extensions,
 * IPA and combining marks. To change the typeface, replace the files in
 * `./fonts/`, the imports and `FAMILY` here, as "Change the map style" in
 * `src/maps/AGENTS.md` says.
 */
import italic from "./fonts/NotoSans-Italic.ttf";
import regular from "./fonts/NotoSans-Regular.ttf";
import semiBold from "./fonts/NotoSans-SemiBold.ttf";
import { readFontMetrics, type FontMetrics } from "./font-metrics";

/** The family name the font files carry, for the SVG's `font-family`. */
export const FAMILY = "Noto Sans";

export interface FontFace {
  weight: 400 | 600;
  italic: boolean;
}

export interface MapFonts {
  family: string;
  /** Every font file, for the rasterizer. */
  buffers: Uint8Array[];
  metrics(face: FontFace): FontMetrics;
}

let loaded: MapFonts | undefined;

/** The label fonts; parsed once per isolate. */
export function mapFonts(): MapFonts {
  if (loaded) return loaded;
  const files = {
    regular: new Uint8Array(regular),
    semiBold: new Uint8Array(semiBold),
    italic: new Uint8Array(italic),
  };
  const metrics = {
    regular: readFontMetrics(files.regular),
    semiBold: readFontMetrics(files.semiBold),
    italic: readFontMetrics(files.italic),
  };
  loaded = {
    family: FAMILY,
    buffers: [files.regular, files.semiBold, files.italic],
    metrics: (face) =>
      face.italic
        ? metrics.italic
        : face.weight === 600
          ? metrics.semiBold
          : metrics.regular,
  };
  return loaded;
}
