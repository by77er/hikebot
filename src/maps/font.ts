/**
 * The typeface of map labels, loaded in this one place: Public Sans, Cairn's
 * typeface (SIL Open Font License 1.1, `./fonts/PublicSans-OFL.txt`), in
 * regular, semibold and italic, subset to Latin with its extensions. Public
 * Sans has no IPA and few combining marks, so a text with a character it
 * lacks, such as `Mount Si / q̓əlbc̓`, is set wholly in Noto Sans (OFL,
 * `./fonts/NotoSans-OFL.txt`), subset to Latin with its extensions, IPA and
 * combining marks: the rasterizer would draw a missing mark from another
 * font beside its letter instead of on it. To change the typeface, replace
 * the files in `./fonts/`, the imports and the families here, as "Change
 * the map style" in `src/maps/AGENTS.md` says.
 */
import fallbackItalic from "./fonts/NotoSans-Italic.ttf";
import fallbackRegular from "./fonts/NotoSans-Regular.ttf";
import fallbackSemiBold from "./fonts/NotoSans-SemiBold.ttf";
import italic from "./fonts/PublicSans-Italic.ttf";
import regular from "./fonts/PublicSans-Regular.ttf";
import semiBold from "./fonts/PublicSans-SemiBold.ttf";
import {
  readFontMetrics,
  type LabelFont,
  type SceneFonts,
} from "./font-metrics";
import { FALLBACK_FAMILY, FAMILY } from "./style";

export { FALLBACK_FAMILY, FAMILY } from "./style";

export type { FontFace, LabelFont } from "./font-metrics";

/** Public Sans, falling back to Noto Sans for a text it cannot set. */
export interface MapFonts extends SceneFonts {
  /** Every font file, for the rasterizer. */
  buffers: Uint8Array[];
}

let loaded: MapFonts | undefined;

function family(
  name: string,
  files: { regular: Uint8Array; semiBold: Uint8Array; italic: Uint8Array },
): LabelFont {
  const metrics = {
    regular: readFontMetrics(files.regular),
    semiBold: readFontMetrics(files.semiBold),
    italic: readFontMetrics(files.italic),
  };
  return {
    family: name,
    metrics: (face) =>
      face.italic
        ? metrics.italic
        : face.weight === 600
          ? metrics.semiBold
          : metrics.regular,
  };
}

/** The label fonts; parsed once per isolate. */
export function mapFonts(): MapFonts {
  if (loaded) return loaded;
  const files = {
    regular: new Uint8Array(regular),
    semiBold: new Uint8Array(semiBold),
    italic: new Uint8Array(italic),
  };
  const fallbackFiles = {
    regular: new Uint8Array(fallbackRegular),
    semiBold: new Uint8Array(fallbackSemiBold),
    italic: new Uint8Array(fallbackItalic),
  };
  const main = family(FAMILY, files);
  const fallback = family(FALLBACK_FAMILY, fallbackFiles);
  const cmap = main.metrics({ weight: 400, italic: false });
  loaded = {
    ...main,
    buffers: [...Object.values(files), ...Object.values(fallbackFiles)],
    forText: (text) => (cmap.covers(text) ? main : fallback),
  };
  return loaded;
}
