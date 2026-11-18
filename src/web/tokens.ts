/**
 * Cairn's tokens as data: reads the custom properties out of
 * `public/assets/cairn/tokens.css` for each colour scheme, computes WCAG
 * contrast ratios, and lists the colour pairings the design system allows
 * with the minimum each must meet. The contrast test checks every pairing
 * in both schemes; the style guide shows them. "Colour" and "Accessibility"
 * in docs/design-system.md explain the pairings.
 */

export type Scheme = "light" | "dark";

/** Token name (without `--`) to its value, for one scheme. */
export type TokenValues = Record<string, string>;

export type SchemeTokens = Record<Scheme, TokenValues>;

interface Block {
  prelude: string;
  declarations: string;
  children: Block[];
}

/** Splits CSS into nested blocks; enough for the tokens file's shape. */
function parseBlocks(css: string): Block[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let at = 0;
  const read = (): Block[] => {
    const blocks: Block[] = [];
    let start = at;
    while (at < text.length) {
      const char = text[at];
      if (char === "{") {
        const prelude = text.slice(start, at).trim().split(";").pop() ?? "";
        at += 1;
        const bodyStart = at;
        const children = read();
        const body = text.slice(bodyStart, at - 1);
        blocks.push({
          prelude: prelude.trim(),
          declarations: children.length === 0 ? body : "",
          children,
        });
        start = at;
      } else if (char === "}") {
        at += 1;
        return blocks;
      } else {
        at += 1;
      }
    }
    return blocks;
  };
  return read();
}

function customProperties(declarations: string): TokenValues {
  const values: TokenValues = {};
  for (const match of declarations.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name = "", value = ""] = match;
    values[name] = value.replace(/\s+/g, " ").trim();
  }
  return values;
}

/**
 * The tokens of each scheme: the `:root` values, with the ones in the
 * `prefers-color-scheme: dark` block replacing them for dark.
 */
export function parseTokens(css: string): SchemeTokens {
  const light: TokenValues = {};
  const dark: TokenValues = {};
  const visit = (blocks: Block[], media: string) => {
    for (const block of blocks) {
      if (block.prelude.startsWith("@media")) {
        visit(block.children, block.prelude);
      } else if (block.prelude.startsWith("@layer")) {
        visit(block.children, media);
      } else if (block.prelude === ":root") {
        const values = customProperties(block.declarations);
        if (media === "") Object.assign(light, values);
        else if (/prefers-color-scheme:\s*dark/.test(media)) {
          Object.assign(dark, values);
        }
      }
    }
  };
  visit(parseBlocks(css), "");
  return { light, dark: { ...light, ...dark } };
}

/** The `color-*` tokens of a scheme, in the order the file gives them. */
export function colourTokens(values: TokenValues): [string, string][] {
  return Object.entries(values).filter(([name]) => name.startsWith("color-"));
}

function channel(hex: string, index: number): number {
  const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`${hex} is not a #rrggbb colour`);
  }
  return (
    0.2126 * channel(hex, 0) +
    0.7152 * channel(hex, 1) +
    0.0722 * channel(hex, 2)
  );
}

/** The WCAG 2 contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

export type PairingKind = "text" | "large-text" | "non-text";

/** WCAG 2.2 AA: 1.4.3 for text, 1.4.11 for controls, focus and graphics. */
export const MINIMUM: Record<PairingKind, number> = {
  text: 4.5,
  "large-text": 3,
  "non-text": 3,
};

export interface Pairing {
  /** The token drawn on top: text, a border, a ring, a mark. */
  foreground: string;
  /** The token it is drawn on. */
  background: string;
  kind: PairingKind;
  /** What the pairing is for, as docs/design-system.md names it. */
  use: string;
}

const SURFACES = [
  "color-bg",
  "color-surface",
  "color-surface-raised",
  "color-surface-subtle",
];

const TONES = ["info", "success", "warning", "danger"];

function onSurfaces(
  foreground: string,
  kind: PairingKind,
  use: string,
): Pairing[] {
  return SURFACES.map((background) => ({ foreground, background, kind, use }));
}

/** Every colour pairing the design system allows. */
export const PAIRINGS: Pairing[] = [
  ...onSurfaces("color-text", "text", "Body text"),
  ...onSurfaces("color-text-muted", "text", "Secondary text"),
  ...onSurfaces("color-link", "text", "Links"),
  ...onSurfaces("color-primary", "text", "Secondary and quiet buttons"),
  ...onSurfaces("color-danger", "text", "Error text"),
  ...onSurfaces("color-info", "text", "Status text"),
  ...onSurfaces("color-success", "text", "Status text"),
  ...onSurfaces("color-warning", "text", "Status text"),
  ...onSurfaces("color-text", "large-text", "Headings"),
  ...["color-primary", "color-primary-hover", "color-primary-active"].map(
    (background): Pairing => ({
      foreground: "color-on-primary",
      background,
      kind: "text",
      use: "Primary button label",
    }),
  ),
  ...["color-danger", "color-danger-hover", "color-danger-active"].map(
    (background): Pairing => ({
      foreground: "color-on-danger",
      background,
      kind: "text",
      use: "Danger button label",
    }),
  ),
  ...TONES.flatMap((tone): Pairing[] => [
    {
      foreground: "color-text",
      background: `color-${tone}-subtle`,
      kind: "text",
      use: "Banner text",
    },
    {
      foreground: "color-link",
      background: `color-${tone}-subtle`,
      kind: "text",
      use: "Banner link",
    },
    {
      foreground: `color-${tone}`,
      background: `color-${tone}-subtle`,
      kind: "non-text",
      use: "Banner icon and border",
    },
  ]),
  ...onSurfaces("color-border-strong", "non-text", "Control boundary"),
  ...["color-bg", "color-surface"].flatMap((background): Pairing[] => [
    {
      foreground: "color-primary",
      background,
      kind: "non-text",
      use: "Primary button boundary",
    },
    {
      foreground: "color-danger",
      background,
      kind: "non-text",
      use: "Danger button boundary",
    },
  ]),
  ...onSurfaces("color-focus", "non-text", "Focus ring"),
  ...onSurfaces("color-accent", "non-text", "Trail blaze"),
];

export interface PairingResult extends Pairing {
  scheme: Scheme;
  ratio: number;
  minimum: number;
  passes: boolean;
}

/** Every pairing's ratio in both schemes. */
export function checkPairings(tokens: SchemeTokens): PairingResult[] {
  return (["light", "dark"] as const).flatMap((scheme) =>
    PAIRINGS.map((pairing) => {
      const foreground = tokens[scheme][pairing.foreground];
      const background = tokens[scheme][pairing.background];
      if (foreground === undefined || background === undefined) {
        throw new Error(
          `${scheme}: ${pairing.foreground} on ${pairing.background} names a token tokens.css does not define`,
        );
      }
      const ratio = contrastRatio(foreground, background);
      const minimum = MINIMUM[pairing.kind];
      return { ...pairing, scheme, ratio, minimum, passes: ratio >= minimum };
    }),
  );
}
