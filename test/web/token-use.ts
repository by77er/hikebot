/**
 * The check behind token-use.test.ts: finds raw values in CSS that should
 * be tokens, and raw colours in TSX attributes. A finding gives the line
 * and the text, so a failing test says where to look.
 */

export interface Finding {
  line: number;
  text: string;
}

const NAMED_COLOURS =
  "aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen";

/** A raw colour: hex, a colour function or a named colour. */
const RAW_COLOUR = new RegExp(
  `#[0-9a-f]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(|\\b(?:${NAMED_COLOURS})\\b`,
  "i",
);

/** A number with a length, angle-free unit or a duration. */
const RAW_SIZE =
  /(?<![\w-])-?\d*\.?\d+(?:px|rem|em|ch|ex|vw|vh|vmin|vmax|dvh|svh|lvh|pt|cm|mm|in|ms|s)\b/i;

/** A font-family that is not a token. */
const RAW_FONT = /\bfont-family\s*:(?!\s*var\()/i;

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/**
 * The declarations in `css` that use a raw value: a colour (`colours`),
 * or a colour, size, duration or font family (`all`). Comments, selectors,
 * custom-property names, `url()`s and `@media` conditions are not values.
 */
export function findRawValues(
  css: string,
  check: "colours" | "all",
): Finding[] {
  const blanked = css
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/url\([^)]*\)/g, (url) => url.replace(/[^\n]/g, " "))
    .replace(/@media[^{]*/g, (media) => media.replace(/[^\n]/g, " "))
    .replace(/@font-face\s*\{[^}]*\}/g, (face) => face.replace(/[^\n]/g, " "));
  const findings: Finding[] = [];
  for (const match of blanked.matchAll(/([\w-]+)\s*:\s*([^;{}]+)[;}]/g)) {
    const [whole, property = "", value = ""] = match;
    // A token's name is not a value; a fallback after its comma is.
    const values = value.replace(/var\(\s*--[\w-]+/g, "var(");
    const raw =
      RAW_COLOUR.test(values) ||
      (check === "all" &&
        (RAW_SIZE.test(values) || RAW_FONT.test(`${property}: ${values}`)));
    if (raw) {
      findings.push({
        line: lineAt(blanked, match.index),
        text: whole.replace(/\s+/g, " ").trim(),
      });
    }
  }
  return findings;
}

/** `style`, `fill` and `stroke` attributes in TSX that hold a raw colour. */
export function findRawColoursInMarkup(tsx: string): Finding[] {
  const findings: Finding[] = [];
  const attribute =
    /\b(style|fill|stroke|color|stop-color|stopColor)=(\{\{[^}]*\}\}|\{[^}]*\}|"[^"]*"|'[^']*')/g;
  for (const match of tsx.matchAll(attribute)) {
    const [whole, , value = ""] = match;
    if (RAW_COLOUR.test(value)) {
      findings.push({ line: lineAt(tsx, match.index), text: whole });
    }
  }
  return findings;
}
