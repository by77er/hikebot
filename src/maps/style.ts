/**
 * The map pictures' style, as data: a colour for each role a map feature can
 * play, the line widths and label sizes per zoom, and the typeface's weights.
 * The drawing code reads only these roles; to restyle the map, change this
 * file (and the font in `./font.ts`), bump `STYLE_VERSION` and redraw the
 * samples, as "Change the map style" in `src/maps/AGENTS.md` says.
 */

/**
 * Part of every stored picture's key, so a new style draws new pictures
 * instead of serving ones drawn in the old style.
 */
export const STYLE_VERSION = 2;

/**
 * The light-scheme values of the Cairn tokens the map is drawn from, as
 * `public/assets/cairn/tokens.css` gives them in `:root`. A picture has one
 * look whatever the viewer's scheme: it is posted into Discord, where both
 * themes show the same image. A unit test fails when a value here differs
 * from the stylesheet.
 */
export const CAIRN = {
  "color-bg": "#faf8f3",
  "color-surface": "#ffffff",
  "color-surface-subtle": "#efeae0",
  "color-text": "#1f2421",
  "color-text-muted": "#566059",
  "color-border": "#ddd6c8",
  "color-border-strong": "#7d8781",
  "color-primary": "#1f5d45",
  "color-accent": "#d9541e",
  "color-info": "#1d5e86",
  "color-success": "#2c6a35",
} as const;

export type CairnToken = keyof typeof CAIRN;

/**
 * How a role's colour comes from the tokens: the token itself, or `amount`
 * of it mixed into `into` (`color-bg`, the paper, unless given), as CSS
 * `color-mix(in srgb, var(--<token>) <amount>%, var(--<into>))` computes it.
 */
export interface ColourRecipe {
  token: CairnToken;
  /** The share of `token`, from 0 to 1; 1 when not given. */
  amount?: number;
  into?: CairnToken;
}

/**
 * A recipe per role. Each role's colour is also the map token
 * `--map-<role in kebab case>` in `tokens.css`, so the style guide can show
 * it; "Cairn map" in `docs/design-system.md` gives the reasons.
 */
export const RECIPES = {
  /** Everything that is not water or another fill: the paper. */
  land: { token: "color-bg" },
  forest: { token: "color-success", amount: 0.22 },
  /** Grass, meadow, scrub and wetland. */
  grass: { token: "color-success", amount: 0.1 },
  /** Bare rock, scree and sand. */
  bareRock: { token: "color-border", amount: 0.7 },
  /** Glaciers and permanent snow: whiter than the paper, a hint of lake. */
  ice: { token: "color-info", amount: 0.06, into: "color-surface" },
  /** Towns' built-up areas. */
  settled: { token: "color-border", amount: 0.45 },
  /** Parks, gardens and pitches. */
  park: { token: "color-success", amount: 0.15 },
  /** National parks, nature reserves and other protected areas. */
  protectedArea: { token: "color-primary" },
  protectedAreaOutline: { token: "color-primary", amount: 0.55 },
  water: { token: "color-info", amount: 0.5, into: "color-surface" },
  waterLabel: { token: "color-info" },
  roadMotorway: { token: "color-border-strong", amount: 0.35 },
  roadMotorwayCasing: { token: "color-border-strong" },
  roadMajor: { token: "color-surface" },
  roadMajorCasing: { token: "color-text-muted" },
  roadMinor: { token: "color-surface" },
  roadMinorCasing: { token: "color-border-strong", amount: 0.65 },
  rail: { token: "color-text-muted" },
  /** Footpaths and trails, what a hiker looks for: the blaze, weathered. */
  path: { token: "color-accent", amount: 0.6, into: "color-text" },
  /** Unpaved tracks and forest roads. */
  track: { token: "color-accent", amount: 0.35, into: "color-text-muted" },
  /** A light line under paths and tracks, so they read over any fill. */
  pathHalo: { token: "color-bg" },
  building: { token: "color-border-strong" },
  label: { token: "color-text" },
  labelHalo: { token: "color-bg" },
  /** Peaks' triangles. */
  peak: { token: "color-text" },
  /** The pin: the trail blaze. */
  pin: { token: "color-accent" },
  pinOutline: { token: "color-surface" },
  /** A thin dark line round the pin's outline, for snow and pale fills. */
  pinKeyline: { token: "color-text" },
  /** The scale bar, the attribution and the frame round the picture. */
  furniture: { token: "color-text" },
  furnitureBackground: { token: "color-surface" },
  frame: { token: "color-border-strong" },
} as const satisfies Record<string, ColourRecipe>;

export type ColourRole = keyof typeof RECIPES;

/** The colour a recipe makes, as `#rrggbb` in lower case. */
export function mixRecipe(
  recipe: ColourRecipe,
  tokens: Record<CairnToken, string> = CAIRN,
): string {
  const { token, amount = 1, into = "color-bg" } = recipe;
  const a = tokens[token];
  const b = tokens[into];
  let out = "#";
  for (let i = 1; i < 7; i += 2) {
    const channel =
      parseInt(a.slice(i, i + 2), 16) * amount +
      parseInt(b.slice(i, i + 2), 16) * (1 - amount);
    out += Math.round(channel).toString(16).padStart(2, "0");
  }
  return out;
}

/** A colour per role, as `#rrggbb`, made from its recipe. */
export const COLOURS = Object.fromEntries(
  Object.entries(RECIPES).map(([role, recipe]) => [role, mixRecipe(recipe)]),
) as Record<ColourRole, string>;

/** Opacity per role that is drawn see-through; every other role is opaque. */
export const OPACITY: Partial<Record<ColourRole, number>> = {
  protectedArea: 0.08,
  building: 0.4,
  furnitureBackground: 0.8,
};

/**
 * A value that changes with zoom: `[zoom, value]` stops in ascending zoom,
 * interpolated linearly between them and held beyond the first and last.
 */
export type ZoomStops = readonly (readonly [number, number])[];

/** Line widths in logical pixels. */
export const WIDTHS = {
  roadMotorway: [
    [8, 1],
    [12, 3],
    [14, 5],
    [16, 9],
  ],
  roadMajor: [
    [8, 0.8],
    [12, 2.6],
    [14, 4.4],
    [16, 8],
  ],
  roadMinor: [
    [11, 0.8],
    [12, 1.2],
    [14, 2.8],
    [16, 5],
  ],
  /** Added to a road's width on each side for its casing. */
  roadCasing: [
    [10, 0.4],
    [14, 0.8],
    [16, 1],
  ],
  rail: [
    [10, 0.4],
    [14, 1],
  ],
  path: [
    [11, 2.8],
    [12, 2.5],
    [14, 2.6],
    [16, 3.2],
  ],
  track: [
    [11, 1.1],
    [13, 1.5],
    [16, 2.4],
  ],
  /** Added to a path's or track's width on each side for its halo. */
  pathHalo: [
    [11, 0.8],
    [16, 1.2],
  ],
  river: [
    [8, 0.6],
    [12, 1.4],
    [14, 3],
    [16, 6],
  ],
  stream: [
    [11, 0.3],
    [13, 0.8],
    [16, 1.6],
  ],
  protectedAreaOutline: [
    [8, 0.6],
    [14, 1.2],
  ],
  /** Text halos, round each glyph. */
  labelHalo: [[0, 2.5]],
} as const satisfies Record<string, ZoomStops>;

/** Dash patterns, in multiples of the line's width. */
export const DASHES = {
  path: [2.6, 1.6],
  track: [5, 2],
  protectedAreaOutline: [4, 2],
} as const;

/** Zoom from which each kind of line or fill is drawn. */
export const MIN_ZOOM = {
  roadMinor: 11,
  path: 11,
  track: 11,
  /** Footways and steps, mostly in towns. */
  footway: 14,
  rail: 10,
  stream: 11,
  /** Buildings, drawn faintly. */
  building: 14,
} as const;

/** Label font sizes in logical pixels. */
export const LABEL_SIZES = {
  /** Cities and towns. */
  town: [
    [8, 14],
    [12, 16],
    [16, 19],
  ],
  /** Villages and hamlets. */
  village: [
    [10, 13],
    [14, 15],
    [16, 16],
  ],
  neighbourhood: [
    [12, 12],
    [16, 14],
  ],
  peak: [
    [10, 15.5],
    [14, 16],
    [16, 17],
  ],
  water: [
    [10, 13.5],
    [14, 15],
    [16, 16],
  ],
} as const satisfies Record<string, ZoomStops>;

export type LabelRole = keyof typeof LABEL_SIZES;

/** The family name the label font files carry (`./font.ts` loads them). */
export const FAMILY = "Public Sans";
/** The family of the fallback, for texts Public Sans has no glyph for. */
export const FALLBACK_FAMILY = "Noto Sans";

/** The typeface's weight and style per label role. */
export const LABEL_FONTS: Record<
  LabelRole,
  { weight: 400 | 600; italic: boolean }
> = {
  town: { weight: 400, italic: false },
  village: { weight: 600, italic: false },
  neighbourhood: { weight: 400, italic: false },
  peak: { weight: 600, italic: false },
  water: { weight: 400, italic: true },
};

/** Label colour roles, text and halo. */
export const LABEL_COLOURS: Record<LabelRole, ColourRole> = {
  town: "label",
  village: "label",
  neighbourhood: "label",
  peak: "label",
  water: "waterLabel",
};

/**
 * Which label keeps its place when two would overlap: the higher wins.
 * Peaks gain a point per 1,000 m of elevation, towns and villages their
 * population rank. Summits and water come first on a hike map, then the
 * places a hiker drives through.
 */
export const LABEL_PRIORITY: Record<LabelRole, number> = {
  peak: 100,
  water: 80,
  town: 60,
  village: 40,
  neighbourhood: 10,
};

/**
 * A label is shown up to this many zooms before the zoom its data marks as
 * its first (`min_zoom`): peaks and water matter more on a hike map than
 * the basemap ranks them.
 */
export const LABEL_ZOOM_LEAD: Record<LabelRole, number> = {
  town: 0,
  village: 0.5,
  neighbourhood: 0,
  peak: 2,
  water: 2,
};

/** Sizes of the drawn furniture, in logical pixels. */
export const FURNITURE = {
  /**
   * The pin, a blaze on a pointer: its width, its height from the tip to
   * the top, the pointer's length, the blaze's corner radius, the light
   * outline and the dark keyline round it.
   */
  pinWidth: 13,
  pinHeight: 36,
  pinTip: 8,
  pinCorner: 2,
  pinOutline: 2,
  pinKeyline: 1,
  /** The peak triangle's side. */
  peakSize: 9,
  /** Room kept between labels and round the pin. */
  labelPadding: 2,
  /** The scale bar's longest length and its text size. */
  scaleBarMaxLength: 120,
  scaleBarText: 13,
  attributionText: 11,
  /** Distance of the scale bar and attribution from the picture's edges. */
  margin: 6,
  frame: 1,
} as const;

/**
 * The value of `stops` at `zoom`: linear between the two stops round it, the
 * first or last stop's value beyond them, and 0 when there are no stops.
 */
export function atZoom(stops: ZoomStops, zoom: number): number {
  const first = stops[0];
  if (!first) return 0;
  if (zoom <= first[0]) return first[1];
  for (let i = 1; i < stops.length; i++) {
    const [z1, v1] = stops[i] ?? first;
    const [z0, v0] = stops[i - 1] ?? first;
    if (zoom <= z1) return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0);
  }
  return (stops[stops.length - 1] ?? first)[1];
}
