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
export const STYLE_VERSION = 1;

/** A colour per role, as `#rrggbb`. */
export const COLOURS = {
  /** Everything that is not water or another fill. */
  land: "#FAF8F3",
  forest: "#CADDBF",
  /** Grass, meadow, scrub and wetland. */
  grass: "#E2EBD3",
  /** Bare rock, scree and sand. */
  bareRock: "#E7E2D9",
  /** Glaciers and permanent snow. */
  ice: "#F1F6F8",
  /** Towns' built-up areas. */
  settled: "#EFEBE4",
  /** Parks, gardens and pitches. */
  park: "#D7E8C6",
  /** National parks, nature reserves and other protected areas. */
  protectedArea: "#4E7D51",
  protectedAreaOutline: "#6F9670",
  water: "#A8CADF",
  waterLabel: "#1D5E86",
  roadMotorway: "#C5C8CB",
  roadMotorwayCasing: "#7E848A",
  roadMajor: "#FFFFFF",
  roadMajorCasing: "#9DA3A8",
  roadMinor: "#FFFFFF",
  roadMinorCasing: "#B9BDC1",
  rail: "#9A9EA2",
  /** Footpaths and trails: what a hiker looks for. */
  path: "#6E2F1C",
  /** Unpaved tracks and forest roads. */
  track: "#7D6248",
  /** A light line under paths and tracks, so they read over any fill. */
  pathHalo: "#FAF8F3",
  building: "#CFC8BC",
  label: "#363B40",
  labelHalo: "#FAF8F3",
  /** Peaks' triangles. */
  peak: "#5B524A",
  pin: "#D9541E",
  pinOutline: "#FFFFFF",
  /** The scale bar, the attribution and the frame round the picture. */
  furniture: "#4A4F55",
  furnitureBackground: "#FFFFFF",
  frame: "#B9B3A8",
} as const;

export type ColourRole = keyof typeof COLOURS;

/** Opacity per role that is drawn see-through; every other role is opaque. */
export const OPACITY: Partial<Record<ColourRole, number>> = {
  protectedArea: 0.08,
  building: 0.55,
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
    [8, 0.6],
    [12, 2.2],
    [14, 4],
    [16, 8],
  ],
  roadMinor: [
    [11, 0.4],
    [12, 0.9],
    [14, 2.4],
    [16, 5],
  ],
  /** Added to a road's width on each side for its casing. */
  roadCasing: [
    [10, 0.3],
    [14, 0.7],
    [16, 1],
  ],
  rail: [
    [10, 0.4],
    [14, 1],
  ],
  path: [
    [11, 1.1],
    [13, 1.6],
    [16, 2.4],
  ],
  track: [
    [11, 1],
    [13, 1.4],
    [16, 2.2],
  ],
  /** Added to a path's or track's width on each side for its halo. */
  pathHalo: [
    [11, 0.6],
    [16, 1],
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
    [8, 15],
    [12, 18],
    [16, 21],
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
    [10, 13],
    [14, 14.5],
    [16, 16],
  ],
  water: [
    [10, 13],
    [14, 14.5],
    [16, 16],
  ],
} as const satisfies Record<string, ZoomStops>;

export type LabelRole = keyof typeof LABEL_SIZES;

/** The typeface's weight and style per label role. */
export const LABEL_FONTS: Record<
  LabelRole,
  { weight: 400 | 600; italic: boolean }
> = {
  town: { weight: 600, italic: false },
  village: { weight: 600, italic: false },
  neighbourhood: { weight: 400, italic: false },
  peak: { weight: 400, italic: false },
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
  /** The pin's head radius and its height from tip to head centre. */
  pinRadius: 11,
  pinHeight: 27,
  pinOutline: 2,
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

/** The value of `stops` at `zoom`. */
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
