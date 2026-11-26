/**
 * The interactive map's style: a MapLibre GL style document made from the
 * same style data as the map picture (`./style.ts`) and the same reading of
 * the Protomaps basemap schema (`./svg.ts`), so the map on the web pages and
 * the picture in Discord look alike. `GET /maps/style.json` serves it; the
 * browser draws the tiles of `GET /tiles/<z>/<x>/<y>.mvt` with it.
 *
 * The style names no glyph ranges, so MapLibre draws every label in the
 * browser with the page's own typeface, Public Sans from Cairn's
 * stylesheet, and nothing more is downloaded for text.
 *
 * Only the roles are read from `./style.ts`: no colour, width or size is
 * written here.
 */
import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import type { BBox } from "./manifest";
import {
  COLOURS,
  DASHES,
  FURNITURE,
  LABEL_COLOURS,
  LABEL_FONTS,
  LABEL_PRIORITY,
  LABEL_SIZES,
  LABEL_ZOOM_LEAD,
  MIN_ZOOM,
  OPACITY,
  WIDTHS,
  atZoom,
  type ColourRole,
  type LabelRole,
  type ZoomStops,
} from "./style";
import {
  FILL_ORDER,
  FOOTWAY_DETAILS,
  LANDUSE_FILLS,
  PATH_DETAILS,
  type FillRole,
} from "./svg";

/** The id of the one vector source. */
export const SOURCE = "hikebot";

/** The image the browser's map script draws for peaks' triangles. */
export const PEAK_IMAGE = "peak";

/**
 * The labels' font stacks, by weight and style. MapLibre draws a label with
 * the CSS families of its stack, in the weight or style it reads from the
 * first name, so each stack starts with that word and then names the
 * page's typeface, "Public Sans Variable" from `cairn.css`; characters
 * Public Sans lacks come from the browser's sans-serif.
 */
export const FONT_STACKS = {
  regular: ["Regular", "Public Sans Variable"],
  semibold: ["SemiBold", "Public Sans Variable"],
  italic: ["Italic", "Public Sans Variable"],
} as const;

export interface BrowserStyleOptions {
  /** The tile URL template, `{z}`, `{x}` and `{y}` included. */
  tiles: string;
  /** `MapReader.attribution()`. */
  attribution: string;
  /** Where the archives have tiles: their boxes together, and zooms. */
  bounds: BBox;
  minzoom: number;
  maxzoom: number;
}

/** The style document for MapLibre GL JS. */
export function browserStyle(options: BrowserStyleOptions): StyleSpecification {
  return {
    version: 8,
    name: "Cairn map",
    metadata: {
      // The browser's map script draws the peaks' triangle from these.
      "hikebot:peak": {
        image: PEAK_IMAGE,
        size: FURNITURE.peakSize,
        fill: COLOURS.peak,
        halo: COLOURS.labelHalo,
      },
    },
    sources: {
      [SOURCE]: {
        type: "vector",
        tiles: [options.tiles],
        bounds: options.bounds,
        minzoom: options.minzoom,
        maxzoom: options.maxzoom,
        attribution: options.attribution,
      },
    },
    layers: [
      {
        id: "land",
        type: "background",
        paint: { "background-color": COLOURS.land },
      },
      ...fillLayers(),
      ...roadLayers(),
      ...trailLayers(),
      ...labelLayers(),
    ],
  };
}

/** The fills, bottom first, with water's lines and protected areas' edges. */
function fillLayers(): LayerSpecification[] {
  const layers: LayerSpecification[] = [];
  for (const role of FILL_ORDER) {
    layers.push(...fill(role));
    if (role !== "water") continue;
    layers.push(
      line("river", "water", {
        sourceLayer: "water",
        filter: kindIn(["river", "canal"]),
        width: WIDTHS.river,
      }),
      line("stream", "water", {
        sourceLayer: "water",
        filter: kindIn(["stream", "ditch", "drain"]),
        width: WIDTHS.stream,
        minzoom: MIN_ZOOM.stream,
      }),
    );
    // Protected areas are tinted under the water and outlined over it.
    for (const sourceLayer of ["landuse", "landcover"]) {
      layers.push(
        line(`protected-area-outline-${sourceLayer}`, "protectedAreaOutline", {
          sourceLayer,
          filter: [
            "all",
            ["==", ["geometry-type"], "Polygon"],
            kindIn(kindsOf("protectedArea")),
          ],
          width: WIDTHS.protectedAreaOutline,
          dash: DASHES.protectedAreaOutline,
          cap: "butt",
        }),
      );
    }
  }
  return layers;
}

function fill(role: FillRole): LayerSpecification[] {
  const paint = {
    "fill-color": COLOURS[role],
    ...(OPACITY[role] !== undefined && { "fill-opacity": OPACITY[role] }),
  };
  if (role === "water") {
    return [
      {
        id: "water",
        type: "fill",
        source: SOURCE,
        "source-layer": "water",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint,
      },
    ];
  }
  if (role === "building") {
    return [
      {
        id: "building",
        type: "fill",
        source: SOURCE,
        "source-layer": "buildings",
        minzoom: MIN_ZOOM.building,
        paint,
      },
    ];
  }
  // A style layer reads one source layer, so each fill is drawn from
  // landcover and then from land use, as the picture draws both.
  return ["landcover", "landuse"].map((sourceLayer) => ({
    id: `${kebab(role)}-${sourceLayer}`,
    type: "fill",
    source: SOURCE,
    "source-layer": sourceLayer,
    filter: kindIn(kindsOf(role)),
    paint,
  }));
}

/** Roads by rank, all casings under all roads, then railways. */
function roadLayers(): LayerSpecification[] {
  const notTunnel: ExpressionSpecification = ["!=", ["get", "is_tunnel"], true];
  const ranks = [
    {
      role: "roadMinor",
      casing: "roadMinorCasing",
      filter: [
        "any",
        kindIn(["minor_road", "other"]),
        [
          "all",
          ["==", ["get", "kind"], "path"],
          ["==", ["get", "kind_detail"], "pedestrian"],
        ],
      ],
      minzoom: MIN_ZOOM.roadMinor,
    },
    {
      role: "roadMajor",
      casing: "roadMajorCasing",
      filter: kindIn(["major_road"]),
    },
    {
      role: "roadMotorway",
      casing: "roadMotorwayCasing",
      filter: kindIn(["highway"]),
    },
  ] as const satisfies readonly {
    role: "roadMinor" | "roadMajor" | "roadMotorway";
    casing: ColourRole;
    filter: ExpressionSpecification;
    minzoom?: number;
  }[];
  const layers: LayerSpecification[] = [];
  for (const rank of ranks) {
    layers.push(
      line(`${kebab(rank.role)}-casing`, rank.casing, {
        filter: ["all", notTunnel, rank.filter],
        width: widened(WIDTHS[rank.role], WIDTHS.roadCasing),
        ...("minzoom" in rank && { minzoom: rank.minzoom }),
      }),
    );
  }
  for (const rank of ranks) {
    layers.push(
      line(kebab(rank.role), rank.role, {
        filter: ["all", notTunnel, rank.filter],
        width: WIDTHS[rank.role],
        ...("minzoom" in rank && { minzoom: rank.minzoom }),
      }),
    );
  }
  layers.push(
    line("rail", "rail", {
      filter: [
        "all",
        notTunnel,
        ["==", ["get", "kind"], "rail"],
        [
          "in",
          ["coalesce", ["get", "kind_detail"], ""],
          ["literal", ["", "rail"]],
        ],
      ],
      width: WIDTHS.rail,
      dash: [3, 2],
      cap: "butt",
      minzoom: MIN_ZOOM.rail,
    }),
  );
  return layers;
}

/** Tracks, then paths, each over a light halo: the strongest lines. */
function trailLayers(): LayerSpecification[] {
  const notTunnel: ExpressionSpecification = ["!=", ["get", "is_tunnel"], true];
  const detailIn = (details: Iterable<string>): ExpressionSpecification => [
    "all",
    ["==", ["get", "kind"], "path"],
    ["in", ["get", "kind_detail"], ["literal", [...details]]],
  ];
  const kinds = [
    { role: "track", filter: detailIn(["track"]), minzoom: MIN_ZOOM.track },
    { role: "path", filter: detailIn(PATH_DETAILS), minzoom: MIN_ZOOM.path },
    {
      role: "path",
      id: "footway",
      filter: detailIn(FOOTWAY_DETAILS),
      minzoom: MIN_ZOOM.footway,
    },
  ] as const;
  const layers: LayerSpecification[] = [];
  for (const kind of kinds) {
    const id = "id" in kind ? kind.id : kind.role;
    layers.push(
      line(`${id}-halo`, "pathHalo", {
        filter: ["all", notTunnel, kind.filter],
        width: widened(WIDTHS[kind.role], WIDTHS.pathHalo),
        opacity: 0.85,
        minzoom: kind.minzoom,
      }),
      line(id, kind.role, {
        filter: ["all", notTunnel, kind.filter],
        width: WIDTHS[kind.role],
        dash: DASHES[kind.role],
        cap: "butt",
        minzoom: kind.minzoom,
      }),
    );
  }
  return layers;
}

/**
 * Labels, lowest priority first: MapLibre places the top layer's labels
 * first, so peaks win every overlap, then water, towns, villages and
 * neighbourhoods, as `LABEL_PRIORITY` orders them for the picture.
 */
function labelLayers(): LayerSpecification[] {
  const roles = (Object.keys(LABEL_PRIORITY) as LabelRole[]).sort(
    (a, b) => LABEL_PRIORITY[a] - LABEL_PRIORITY[b],
  );
  return roles.flatMap((role) => {
    switch (role) {
      case "neighbourhood":
        return [placeLabel(role, kindIn(["neighbourhood"]))];
      case "village":
        return [
          placeLabel(role, [
            "all",
            ["==", ["get", "kind"], "locality"],
            ["!", detailIn(["city", "town"])],
          ]),
        ];
      case "town":
        return [
          placeLabel(role, [
            "all",
            ["==", ["get", "kind"], "locality"],
            detailIn(["city", "town"]),
          ]),
        ];
      case "water":
        return waterLabels();
      case "peak":
        return [peakLabel()];
    }
  });
}

function placeLabel(
  role: "town" | "village" | "neighbourhood",
  filter: ExpressionSpecification,
): LayerSpecification {
  return {
    id: `label-${role}`,
    type: "symbol",
    source: SOURCE,
    "source-layer": "places",
    filter: ["all", ["==", ["geometry-type"], "Point"], shown(role), filter],
    layout: {
      ...text(role),
      "symbol-sort-key": [
        "-",
        0,
        ["coalesce", ["to-number", ["get", "population_rank"]], 0],
      ],
      "text-variable-anchor": ["center", "bottom", "top", "left", "right"],
      "text-radial-offset": 0.6,
    },
    paint: textPaint(role),
  };
}

function waterLabels(): LayerSpecification[] {
  const role = "water";
  return [
    {
      id: "label-water-line",
      type: "symbol",
      source: SOURCE,
      "source-layer": "water",
      filter: [
        "all",
        ["==", ["geometry-type"], "LineString"],
        shown(role),
        ["any", ["!=", ["get", "kind"], "stream"], [">=", ["zoom"], 13]],
      ],
      layout: {
        ...text(role),
        "symbol-placement": "line",
        "text-max-angle": 50,
      },
      paint: textPaint(role),
    },
    ...(["water", "pois"] as const).map((sourceLayer): LayerSpecification => ({
      id: `label-water-${sourceLayer}`,
      type: "symbol",
      source: SOURCE,
      "source-layer": sourceLayer,
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        shown(role),
        ...(sourceLayer === "pois"
          ? [["==", ["get", "kind"], "water"] as ExpressionSpecification]
          : []),
      ],
      layout: text(role),
      paint: textPaint(role),
    })),
  ];
}

/** A peak: its triangle, its name, and its height in metres below. */
function peakLabel(): LayerSpecification {
  const role = "peak";
  const name: ExpressionSpecification = ["get", "name"];
  const elevation: ExpressionSpecification = [
    "round",
    ["to-number", ["get", "elevation"], 0],
  ];
  return {
    id: "label-peak",
    type: "symbol",
    source: SOURCE,
    "source-layer": "pois",
    filter: [
      "all",
      ["==", ["geometry-type"], "Point"],
      kindIn(["peak", "volcano"]),
      shown(role),
    ],
    layout: {
      ...text(role),
      "text-field": [
        "case",
        [">", elevation, 0],
        [
          "format",
          name,
          {},
          "\n",
          {},
          ["concat", ["number-format", elevation, { locale: "en" }], " m"],
          { "font-scale": 0.85 },
        ],
        name,
      ],
      "symbol-sort-key": ["-", 0, elevation],
      "icon-image": PEAK_IMAGE,
      "text-variable-anchor": ["left", "right", "top", "bottom"],
      "text-radial-offset": 0.7,
      "text-justify": "auto",
      "text-optional": true,
    },
    paint: textPaint(role),
  };
}

function text(role: LabelRole) {
  const font = LABEL_FONTS[role];
  return {
    "text-field": ["get", "name"] as ExpressionSpecification,
    "text-font": [
      ...(font.italic
        ? FONT_STACKS.italic
        : font.weight === 600
          ? FONT_STACKS.semibold
          : FONT_STACKS.regular),
    ],
    "text-size": stops(LABEL_SIZES[role]),
    "text-padding": 2,
  };
}

function textPaint(role: LabelRole) {
  return {
    "text-color": COLOURS[LABEL_COLOURS[role]],
    "text-halo-color": COLOURS.labelHalo,
    "text-halo-width": atZoom(WIDTHS.labelHalo, 0),
  };
}

/**
 * A feature with a name, from its own first zoom (`min_zoom`) brought
 * forward by its role's lead, as the picture labels it.
 */
function shown(role: LabelRole): ExpressionSpecification {
  return [
    "all",
    ["has", "name"],
    [
      "<=",
      ["coalesce", ["to-number", ["get", "min_zoom"]], 0],
      ["+", ["zoom"], LABEL_ZOOM_LEAD[role]],
    ],
  ];
}

function line(
  id: string,
  colour: ColourRole,
  options: {
    sourceLayer?: string;
    filter: ExpressionSpecification;
    width: ZoomStops;
    dash?: readonly number[];
    cap?: "round" | "butt";
    opacity?: number;
    minzoom?: number;
  },
): LayerSpecification {
  return {
    id,
    type: "line",
    source: SOURCE,
    "source-layer": options.sourceLayer ?? "roads",
    filter: options.filter,
    ...(options.minzoom !== undefined && { minzoom: options.minzoom }),
    layout: {
      "line-cap": options.cap ?? "round",
      "line-join": "round",
    },
    paint: {
      "line-color": COLOURS[colour],
      "line-width": stops(options.width),
      ...(options.dash && { "line-dasharray": [...options.dash] }),
      ...(options.opacity !== undefined && {
        "line-opacity": options.opacity,
      }),
    },
  };
}

/** `[zoom, value]` stops as a MapLibre expression, held beyond the ends. */
function stops(values: ZoomStops): ExpressionSpecification | number {
  const [first] = values;
  if (!first) return 0;
  if (values.length === 1) return first[1];
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    ...values.flatMap(([zoom, value]) => [zoom, value]),
  ] as ExpressionSpecification;
}

/** `width` with `extra` added on each side, at every stop of either. */
function widened(width: ZoomStops, extra: ZoomStops): ZoomStops {
  const zooms = [...new Set([...width, ...extra].map(([zoom]) => zoom))].sort(
    (a, b) => a - b,
  );
  return zooms.map((zoom) => [
    zoom,
    atZoom(width, zoom) + 2 * atZoom(extra, zoom),
  ]);
}

function kindsOf(role: FillRole): string[] {
  return Object.entries(LANDUSE_FILLS)
    .filter(([, fill]) => fill === role)
    .map(([kind]) => kind);
}

function kindIn(kinds: string[]): ExpressionSpecification {
  return ["in", ["get", "kind"], ["literal", kinds]];
}

function detailIn(details: string[]): ExpressionSpecification {
  return ["in", ["get", "kind_detail"], ["literal", details]];
}

function kebab(role: string): string {
  return role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
