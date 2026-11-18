/**
 * Builds the SVG of a map picture from decoded vector tiles: fills, water,
 * buildings, roads and paths, labels, the pin, a scale bar and the
 * attribution. It reads the Protomaps basemap tile schema 4 (layers
 * `earth`, `landcover`, `landuse`, `water`, `buildings`, `roads`, `pois`,
 * `places`) and draws with the roles in `./style.ts` only: no colour, width
 * or size is written here.
 */
import type { VectorTile, VectorTileFeature } from "@mapbox/vector-tile";
import { clipLine, clipRing, type Rect } from "./clip";
import type { FontFace, MapFonts } from "./font";
import { overlaps, placeLabels, type Box, type LabelCandidate } from "./labels";
import {
  metresPerPixel,
  tilePixels,
  toPicture,
  type CoveringTile,
  type Point,
  type Viewport,
} from "./projection";
import {
  COLOURS,
  DASHES,
  FURNITURE,
  LABEL_COLOURS,
  LABEL_FONTS,
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

export type Units = "metric" | "imperial";

export interface DecodedTile {
  tile: CoveringTile;
  data: VectorTile;
}

export interface Scene {
  view: Viewport;
  tiles: DecodedTile[];
  pin: { lon: number; lat: number };
  units: Units;
  attribution: string;
  fonts: Pick<MapFonts, "family" | "metrics">;
}

type FillRole =
  | "settled"
  | "grass"
  | "forest"
  | "bareRock"
  | "ice"
  | "park"
  | "water"
  | "protectedArea"
  | "building";

type LineRole =
  | "protectedAreaOutline"
  | "river"
  | "stream"
  | "roadMotorway"
  | "roadMajor"
  | "roadMinor"
  | "rail"
  | "path"
  | "track";

/** Fills in drawing order, bottom first. */
const FILL_ORDER: FillRole[] = [
  "settled",
  "grass",
  "forest",
  "bareRock",
  "ice",
  "park",
  "water",
  "protectedArea",
  "building",
];

const ROADS = ["roadMinor", "roadMajor", "roadMotorway"] as const;

const CASINGS: Record<(typeof ROADS)[number], ColourRole> = {
  roadMinor: "roadMinorCasing",
  roadMajor: "roadMajorCasing",
  roadMotorway: "roadMotorwayCasing",
};

const LANDUSE_FILLS: Record<string, FillRole> = {
  forest: "forest",
  wood: "forest",
  grass: "grass",
  grassland: "grass",
  meadow: "grass",
  scrub: "grass",
  heath: "grass",
  wetland: "grass",
  village_green: "grass",
  bare_rock: "bareRock",
  scree: "bareRock",
  sand: "bareRock",
  beach: "bareRock",
  barren: "bareRock",
  glacier: "ice",
  park: "park",
  garden: "park",
  golf_course: "park",
  playground: "park",
  dog_park: "park",
  pitch: "park",
  recreation_ground: "park",
  nature_reserve: "protectedArea",
  national_park: "protectedArea",
  protected_area: "protectedArea",
  residential: "settled",
  commercial: "settled",
  industrial: "settled",
  retail: "settled",
  school: "settled",
  kindergarten: "settled",
  university: "settled",
  college: "settled",
  hospital: "settled",
  military: "settled",
  railway: "settled",
  urban_area: "settled",
};

const PATH_DETAILS = new Set(["path", "bridleway", "cycleway"]);
const FOOTWAY_DETAILS = new Set(["footway", "steps"]);

interface Paths {
  fills: Map<FillRole, string[]>;
  lines: Map<LineRole, string[]>;
}

/** The SVG document of the scene, sized in physical pixels. */
export function buildSvg(scene: Scene): string {
  const { view } = scene;
  const ratio = view.pixelRatio;
  const zoom = view.zoom;
  const px = (stops: ZoomStops) => atZoom(stops, zoom) * ratio;
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(view.width)}" height="${num(view.height)}" viewBox="0 0 ${num(view.width)} ${num(view.height)}">`,
  );
  const defs: string[] = [];
  out.push(`<rect width="100%" height="100%"${fill("land")}/>`);

  const perTile = scene.tiles.map((decoded) => tilePaths(decoded, view));
  const each = (
    pick: (paths: Paths) => string[] | undefined,
    attributes: string,
  ) => {
    const d = perTile.map((paths) => pick(paths)?.join("") ?? "").join("");
    if (d) out.push(`<path d="${d}"${attributes}/>`);
  };
  const round = ` stroke-linecap="round" stroke-linejoin="round" fill="none"`;

  for (const role of FILL_ORDER) {
    if (role === "building" && zoom < MIN_ZOOM.building) continue;
    each((paths) => paths.fills.get(role), fill(role));
    if (role === "water") {
      each(
        (paths) => paths.lines.get("river"),
        `${stroke("water", px(WIDTHS.river))}${round}`,
      );
      if (zoom >= MIN_ZOOM.stream) {
        each(
          (paths) => paths.lines.get("stream"),
          `${stroke("water", px(WIDTHS.stream))}${round}`,
        );
      }
    }
    if (role === "protectedArea") {
      const width = px(WIDTHS.protectedAreaOutline);
      each(
        (paths) => paths.lines.get("protectedAreaOutline"),
        ` fill="none"${stroke("protectedAreaOutline", width)}${dash(DASHES.protectedAreaOutline, width)}`,
      );
    }
  }

  const casing = px(WIDTHS.roadCasing);
  const roadWidth = (role: (typeof ROADS)[number]) => px(WIDTHS[role]);
  const roadsShown = ROADS.filter(
    (role) => role !== "roadMinor" || zoom >= MIN_ZOOM.roadMinor,
  );
  for (const role of roadsShown) {
    each(
      (paths) => paths.lines.get(role),
      `${stroke(CASINGS[role], roadWidth(role) + 2 * casing)}${round}`,
    );
  }
  for (const role of roadsShown) {
    each(
      (paths) => paths.lines.get(role),
      `${stroke(role, roadWidth(role))}${round}`,
    );
  }
  if (zoom >= MIN_ZOOM.rail) {
    const width = px(WIDTHS.rail);
    each(
      (paths) => paths.lines.get("rail"),
      `${stroke("rail", width)}${dash([3, 2], width)} fill="none"`,
    );
  }
  for (const role of ["track", "path"] as const) {
    if (zoom < MIN_ZOOM[role]) continue;
    const width = px(WIDTHS[role]);
    const halo = px(WIDTHS.pathHalo);
    each(
      (paths) => paths.lines.get(role),
      `${stroke("pathHalo", width + 2 * halo)}${round} stroke-opacity="0.85"`,
    );
    each(
      (paths) => paths.lines.get(role),
      `${stroke(role, width)}${dash(DASHES[role], width)} stroke-linejoin="round" fill="none"`,
    );
  }

  const furniture = drawFurniture(scene);
  const labels = drawLabels(scene, furniture, defs);
  out.push(...labels, ...furniture.svg);
  const frame = FURNITURE.frame * ratio;
  out.push(
    `<rect x="${num(frame / 2)}" y="${num(frame / 2)}" width="${num(view.width - frame)}" height="${num(view.height - frame)}" fill="none"${stroke("frame", frame)}/>`,
  );
  out.splice(1, 0, `<defs>${defs.join("")}</defs>`);
  out.push("</svg>");
  return out.join("");
}

/** The tile's fills and lines as SVG path data, in picture pixels. */
function tilePaths({ tile, data }: DecodedTile, view: Viewport): Paths {
  const fills = new Map<FillRole, string[]>();
  const lines = new Map<LineRole, string[]>();
  const size = tilePixels(view);
  // Each tile's own square, overlapping its neighbours by a pixel so no seam
  // shows, and no further than a margin beyond the picture.
  const margin = 24 * view.pixelRatio;
  const clip: Rect = {
    left: Math.max(tile.left - 1, -margin),
    top: Math.max(tile.top - 1, -margin),
    right: Math.min(tile.left + size + 1, view.width + margin),
    bottom: Math.min(tile.top + size + 1, view.height + margin),
  };
  if (clip.left >= clip.right || clip.top >= clip.bottom)
    return { fills, lines };
  const add = <K>(map: Map<K, string[]>, key: K, d: string) => {
    if (!d) return;
    const list = map.get(key);
    if (list) list.push(d);
    else map.set(key, [d]);
  };
  for (const [name, layer] of Object.entries(data.layers)) {
    const scale = size / layer.extent;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const role =
        feature.type === 3
          ? fillRole(name, feature)
          : feature.type === 2
            ? lineRole(name, feature, view.zoom)
            : undefined;
      if (!role) continue;
      const shapes = feature.loadGeometry().map((ring) =>
        ring.map((p) => ({
          x: tile.left + p.x * scale,
          y: tile.top + p.y * scale,
        })),
      );
      if (feature.type === 3) {
        add(
          fills,
          role as FillRole,
          pathData(
            shapes.map((ring) => clipRing(ring, clip)),
            true,
          ),
        );
        if (role === "protectedArea") {
          const outlines = shapes.flatMap((ring) =>
            clipLine([...ring, ring[0] ?? { x: 0, y: 0 }], clip),
          );
          add(lines, "protectedAreaOutline", pathData(outlines, false));
        }
      } else {
        add(
          lines,
          role as LineRole,
          pathData(
            shapes.flatMap((line) => clipLine(line, clip)),
            false,
          ),
        );
      }
    }
  }
  return { fills, lines };
}

function fillRole(
  layer: string,
  feature: VectorTileFeature,
): FillRole | undefined {
  const kind = String(feature.properties.kind ?? "");
  if (layer === "water") return "water";
  if (layer === "buildings") return "building";
  if (layer === "landuse" || layer === "landcover") return LANDUSE_FILLS[kind];
  return undefined;
}

function lineRole(
  layer: string,
  feature: VectorTileFeature,
  zoom: number,
): LineRole | undefined {
  const kind = String(feature.properties.kind ?? "");
  const detail = String(feature.properties.kind_detail ?? "");
  if (layer === "water") {
    if (kind === "river" || kind === "canal") return "river";
    if (kind === "stream" || kind === "ditch" || kind === "drain") {
      return "stream";
    }
    return undefined;
  }
  if (layer !== "roads") return undefined;
  if (feature.properties.is_tunnel === true) return undefined;
  switch (kind) {
    case "highway":
      return "roadMotorway";
    case "major_road":
      return "roadMajor";
    case "minor_road":
    case "other":
      return "roadMinor";
    case "rail":
      return detail === "" || detail === "rail" ? "rail" : undefined;
    case "path":
      if (detail === "track") return "track";
      if (detail === "pedestrian") return "roadMinor";
      if (FOOTWAY_DETAILS.has(detail)) {
        return zoom >= MIN_ZOOM.footway ? "path" : undefined;
      }
      return PATH_DETAILS.has(detail) ? "path" : undefined;
    default:
      return undefined;
  }
}

/** SVG path data of rings or lines, dropping sub-pixel steps. */
function pathData(shapes: Point[][], closed: boolean): string {
  const parts: string[] = [];
  for (const shape of shapes) {
    let last: Point | undefined;
    const points: string[] = [];
    for (const [index, { x, y }] of shape.entries()) {
      const final = index === shape.length - 1;
      if (last && !final && Math.abs(x - last.x) + Math.abs(y - last.y) < 0.7) {
        continue;
      }
      last = { x, y };
      points.push(`${num(x)} ${num(y)}`);
    }
    if (points.length < (closed ? 3 : 2)) continue;
    parts.push(`M${points.join("L")}${closed ? "Z" : ""}`);
  }
  return parts.join("");
}

interface TextLabel {
  role: LabelRole;
  /** One or two lines; the second line is drawn smaller. */
  lines: string[];
  /** The centre of the text block, by position. */
  centres: Point[];
  marker?: Point;
}

interface CurvedLabel {
  role: LabelRole;
  text: string;
  /** The path the text follows, by position, left to right. */
  paths: Point[][];
}

type Label = { text: TextLabel } | { curved: CurvedLabel };

function drawLabels(
  scene: Scene,
  furniture: { obstacles: Box[]; pin: Box },
  defs: string[],
): string[] {
  const { view, fonts } = scene;
  const ratio = view.pixelRatio;
  const zoom = view.zoom;
  const size = (role: LabelRole) => atZoom(LABEL_SIZES[role], zoom) * ratio;
  const face = (role: LabelRole): FontFace => LABEL_FONTS[role];
  const halo = atZoom(WIDTHS.labelHalo, zoom) * ratio;
  const candidates: LabelCandidate<Label>[] = [];
  const shown = (role: LabelRole, feature: VectorTileFeature) => {
    const minZoom = Number(feature.properties.min_zoom ?? 0);
    return minZoom <= zoom + LABEL_ZOOM_LEAD[role];
  };
  const textBox = (role: LabelRole, lines: string[], centre: Point): Box => {
    const metrics = fonts.metrics(face(role));
    const heights = lines.map((_, i) => lineSize(size(role), i));
    const width = Math.max(
      ...lines.map((line, i) => metrics.width(line, heights[i] ?? 0)),
    );
    const height = heights.reduce(
      (sum, h) => sum + h * (metrics.ascent + metrics.descent),
      0,
    );
    return {
      left: centre.x - width / 2 - halo,
      right: centre.x + width / 2 + halo,
      top: centre.y - height / 2,
      bottom: centre.y + height / 2,
    };
  };
  const seen = new Set<string>();
  const curves = new Map<
    string,
    { role: LabelRole; line: Point[]; length: number }
  >();

  for (const { tile, data } of scene.tiles) {
    const scale = tilePixels(view);
    for (const [layerName, layer] of Object.entries(data.layers)) {
      if (!["places", "pois", "water"].includes(layerName)) continue;
      const toPoint = (p: { x: number; y: number }): Point => ({
        x: tile.left + (p.x / layer.extent) * scale,
        y: tile.top + (p.y / layer.extent) * scale,
      });
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        const name = String(feature.properties.name ?? "").trim();
        if (!name) continue;
        const kind = String(feature.properties.kind ?? "");
        if (feature.type === 2 && layerName === "water") {
          const role: LabelRole = "water";
          if (!shown(role, feature)) continue;
          if (kind === "stream" && zoom < 13) continue;
          for (const line of feature.loadGeometry()) {
            const points = line.map(toPoint);
            const length = polylineLength(points);
            const best = curves.get(name);
            if (!best || best.length < length) {
              curves.set(name, { role, line: points, length });
            }
          }
          continue;
        }
        if (feature.type !== 1) continue;
        const raw = feature.loadGeometry()[0]?.[0];
        if (!raw || raw.x < 0 || raw.y < 0) continue;
        if (raw.x >= layer.extent || raw.y >= layer.extent) continue;
        const at = toPoint(raw);
        const role = pointRole(layerName, feature);
        if (!role || !shown(role, feature)) continue;
        // The same place can come from two layers or two tiles' buffers.
        if (seen.has(`${role}:${name}`)) continue;
        seen.add(`${role}:${name}`);
        const priority = labelPriority(role, feature);
        if (role === "peak") {
          const elevation = Number(feature.properties.elevation);
          const lines =
            Number.isFinite(elevation) && elevation > 0
              ? [name, formatElevation(elevation, scene.units)]
              : [name];
          const marker = (FURNITURE.peakSize * ratio) / 2;
          const markerBox: Box = {
            left: at.x - marker,
            right: at.x + marker,
            top: at.y - marker,
            bottom: at.y + marker,
          };
          const probe = textBox(role, lines, { x: 0, y: 0 });
          const w = probe.right - probe.left;
          const h = probe.bottom - probe.top;
          const gap = marker + 2 * ratio;
          const centres = [
            { x: at.x + gap + w / 2, y: at.y },
            { x: at.x - gap - w / 2, y: at.y },
            { x: at.x, y: at.y - gap - h / 2 },
            { x: at.x, y: at.y + gap + h / 2 },
          ];
          // A peak under the pin is labelled beside it; its marker is hidden.
          const markers = overlaps(markerBox, furniture.pin) ? [] : [markerBox];
          candidates.push({
            priority,
            positions: centres.map((c) => [
              ...markers,
              textBox(role, lines, c),
            ]),
            value: {
              text: {
                role,
                lines,
                centres,
                ...(markers.length > 0 ? { marker: at } : {}),
              },
            },
          });
          continue;
        }
        const lines = [name];
        const box = textBox(role, lines, at);
        const h = box.bottom - box.top;
        const w = box.right - box.left;
        const centres = [
          at,
          { x: at.x, y: at.y - h },
          { x: at.x, y: at.y + h },
          { x: at.x + w / 2 + h / 2, y: at.y },
          { x: at.x - w / 2 - h / 2, y: at.y },
        ];
        candidates.push({
          priority,
          positions: centres.map((c) => [textBox(role, lines, c)]),
          value: { text: { role, lines, centres } },
        });
      }
    }
  }

  for (const [name, { role, line }] of curves) {
    const fontSize = size(role);
    const width = fonts.metrics(face(role)).width(name, fontSize) + 2 * halo;
    const paths: Point[][] = [];
    const positions: Box[][] = [];
    for (const share of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const piece = alongLine(line, share, width);
      if (!piece || !straightEnough(piece)) continue;
      const ordered =
        (piece[0]?.x ?? 0) > (piece[piece.length - 1]?.x ?? 0)
          ? [...piece].reverse()
          : piece;
      paths.push(ordered);
      positions.push(boxesAlong(ordered, fontSize));
    }
    if (positions.length === 0) continue;
    candidates.push({
      priority: 30,
      positions,
      value: { curved: { role, text: name, paths } },
    });
  }

  const placed = placeLabels(candidates, {
    bounds: { left: 0, top: 0, right: view.width, bottom: view.height },
    obstacles: furniture.obstacles,
    padding: FURNITURE.labelPadding * ratio,
  });

  const out: string[] = [];
  const markers: string[] = [];
  placed.forEach(({ value, position }, index) => {
    if ("curved" in value) {
      const { role, text, paths } = value.curved;
      const path = paths[position] ?? [];
      const id = `l${String(index)}`;
      defs.push(
        `<path id="${id}" d="M${path.map((p) => `${num(p.x)} ${num(p.y)}`).join("L")}"/>`,
      );
      out.push(
        `<text${textAttributes(scene, role, size(role), halo)} dy="${num(size(role) * 0.35)}"><textPath xlink:href="#${id}" startOffset="50%" text-anchor="middle">${escape(text)}</textPath></text>`,
      );
      return;
    }
    const { role, lines, centres, marker } = value.text;
    const centre = centres[position] ?? centres[0] ?? { x: 0, y: 0 };
    const metrics = fonts.metrics(face(role));
    const box = textBox(role, lines, centre);
    let y = box.top;
    const anchor =
      marker && position === 0
        ? "start"
        : marker && position === 1
          ? "end"
          : "middle";
    const x =
      anchor === "start"
        ? box.left + halo
        : anchor === "end"
          ? box.right - halo
          : centre.x;
    const tspans = lines.map((line, i) => {
      const lineHeight = lineSize(size(role), i);
      const baseline = y + metrics.ascent * lineHeight;
      y += lineHeight * (metrics.ascent + metrics.descent);
      return `<tspan x="${num(x)}" y="${num(baseline)}" font-size="${num(lineHeight)}">${escape(line)}</tspan>`;
    });
    out.push(
      `<text${textAttributes(scene, role, size(role), halo)} text-anchor="${anchor}">${tspans.join("")}</text>`,
    );
    if (marker) {
      const r = (FURNITURE.peakSize * ratio) / 2;
      markers.push(
        `M${num(marker.x)} ${num(marker.y - r)}L${num(marker.x + r)} ${num(marker.y + r * 0.8)}L${num(marker.x - r)} ${num(marker.y + r * 0.8)}Z`,
      );
    }
  });
  if (markers.length > 0) {
    out.unshift(
      `<path d="${markers.join("")}"${fill("peak")}${stroke("labelHalo", ratio)} paint-order="stroke"/>`,
    );
  }
  return out;
}

/** The second line of a label (a peak's elevation) is drawn smaller. */
function lineSize(size: number, line: number): number {
  return line === 0 ? size : size * 0.85;
}

function pointRole(
  layer: string,
  feature: VectorTileFeature,
): LabelRole | undefined {
  const kind = String(feature.properties.kind ?? "");
  const detail = String(feature.properties.kind_detail ?? "");
  if (layer === "pois") {
    if (kind === "peak" || kind === "volcano") return "peak";
    return kind === "water" ? "water" : undefined;
  }
  if (layer === "water") return "water";
  if (layer !== "places") return undefined;
  if (kind === "locality") {
    return detail === "city" || detail === "town" ? "town" : "village";
  }
  if (kind === "neighbourhood") return "neighbourhood";
  return undefined;
}

function labelPriority(role: LabelRole, feature: VectorTileFeature): number {
  const rank = Number(feature.properties.population_rank ?? 0) || 0;
  const elevation = Number(feature.properties.elevation ?? 0) || 0;
  switch (role) {
    case "town":
      return 90 + rank;
    case "peak":
      return 60 + Math.min(elevation, 9000) / 1000;
    case "water":
      return 50;
    case "village":
      return 40 + rank;
    case "neighbourhood":
      return 10;
  }
}

function formatElevation(metres: number, units: Units): string {
  if (units === "imperial") {
    return `${groupThousands(Math.round(metres * 3.28084))} ft`;
  }
  return `${groupThousands(Math.round(metres))} m`;
}

function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function textAttributes(
  scene: Scene,
  role: LabelRole,
  size: number,
  halo: number,
): string {
  const face = LABEL_FONTS[role];
  return (
    ` font-family="${scene.fonts.family}" font-size="${num(size)}" font-weight="${String(face.weight)}"` +
    (face.italic ? ` font-style="italic"` : "") +
    `${fill(LABEL_COLOURS[role])}${stroke("labelHalo", halo)} stroke-linejoin="round" paint-order="stroke"`
  );
}

function polylineLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

/**
 * The part of `line` of length `width` centred at `share` of its length, or
 * undefined when the line is too short.
 */
function alongLine(
  line: Point[],
  share: number,
  width: number,
): Point[] | undefined {
  const total = polylineLength(line);
  if (total < width * 1.2) return undefined;
  const start = Math.max(0, total * share - width / 2);
  const end = start + width;
  if (end > total) return undefined;
  const out: Point[] = [];
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (!a || !b) continue;
    const step = Math.hypot(b.x - a.x, b.y - a.y);
    const from = walked;
    walked += step;
    if (walked < start || step === 0) continue;
    const at = (d: number) => ({
      x: a.x + ((b.x - a.x) * (d - from)) / step,
      y: a.y + ((b.y - a.y) * (d - from)) / step,
    });
    if (out.length === 0) out.push(at(start));
    if (walked >= end) {
      out.push(at(end));
      break;
    }
    out.push(b);
  }
  return out.length >= 2 ? out : undefined;
}

/** True when the line turns less than 50 degrees in all. */
function straightEnough(line: Point[]): boolean {
  let turned = 0;
  for (let i = 2; i < line.length; i++) {
    const a = line[i - 2];
    const b = line[i - 1];
    const c = line[i];
    if (!a || !b || !c) continue;
    const first = Math.atan2(b.y - a.y, b.x - a.x);
    const second = Math.atan2(c.y - b.y, c.x - b.x);
    let turn = Math.abs(second - first);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    turned += turn;
  }
  return turned < (50 * Math.PI) / 180;
}

/** Square boxes of the text's size along a line, one per size of length. */
function boxesAlong(line: Point[], size: number): Box[] {
  const boxes: Box[] = [];
  const total = polylineLength(line);
  const half = size * 0.7;
  for (let d = 0; d <= total; d += size * 0.8) {
    const p = pointAt(line, d);
    boxes.push({
      left: p.x - half,
      right: p.x + half,
      top: p.y - half,
      bottom: p.y + half,
    });
  }
  return boxes;
}

function pointAt(line: Point[], distance: number): Point {
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (!a || !b) continue;
    const step = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + step >= distance && step > 0) {
      const t = (distance - walked) / step;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += step;
  }
  return line[line.length - 1] ?? { x: 0, y: 0 };
}

/** The pin, the scale bar and the attribution, and the room they take. */
function drawFurniture(scene: Scene): {
  svg: string[];
  obstacles: Box[];
  pin: Box;
} {
  const { view, fonts } = scene;
  const ratio = view.pixelRatio;
  const svg: string[] = [];
  const margin = FURNITURE.margin * ratio;
  const metrics = fonts.metrics({ weight: 400, italic: false });
  const pad = 3 * ratio;
  const text = (size: number) => ({
    size,
    height: size * (metrics.ascent + metrics.descent),
    /** The baseline for text whose box ends at `bottom`. */
    baseline: (bottom: number) => bottom - metrics.descent * size,
    attributes: ` font-family="${fonts.family}" font-size="${num(size)}"${fill("furniture")}`,
  });

  // The pin: a teardrop whose tip is on the point.
  const tip = toPicture(view, scene.pin.lon, scene.pin.lat);
  const r = FURNITURE.pinRadius * ratio;
  const head = { x: tip.x, y: tip.y - FURNITURE.pinHeight * ratio };
  const outline = FURNITURE.pinOutline * ratio;
  const spread = Math.asin(r / (tip.y - head.y));
  const side = (sign: number) => ({
    x: head.x + sign * r * Math.cos(spread),
    y: head.y + r * Math.sin(spread),
  });
  const left = side(-1);
  const right = side(1);
  svg.push(
    `<path d="M${num(tip.x)} ${num(tip.y)}L${num(left.x)} ${num(left.y)}A${num(r)} ${num(r)} 0 1 1 ${num(right.x)} ${num(right.y)}Z"${fill("pin")}${stroke("pinOutline", outline)} stroke-linejoin="round" paint-order="stroke"/>`,
    `<circle cx="${num(head.x)}" cy="${num(head.y)}" r="${num(r * 0.38)}"${fill("pinOutline")}/>`,
  );
  const pin: Box = {
    left: head.x - r - outline,
    right: head.x + r + outline,
    top: head.y - r - outline,
    bottom: tip.y + outline,
  };

  // The attribution, bottom right.
  const attribution = text(FURNITURE.attributionText * ratio);
  const attributionWidth = metrics.width(scene.attribution, attribution.size);
  const attributionBox: Box = {
    right: view.width - margin,
    left: view.width - margin - attributionWidth - 2 * pad,
    bottom: view.height - margin,
    top: view.height - margin - attribution.height - pad,
  };
  svg.push(
    background(attributionBox, ratio),
    `<text x="${num(attributionBox.right - pad)}" y="${num(attribution.baseline(attributionBox.bottom - pad / 2))}" text-anchor="end"${attribution.attributes}>${escape(scene.attribution)}</text>`,
  );

  // The scale bar, bottom left.
  const scale = scaleBar(
    metresPerPixel(scene.pin.lat, view.zoom) / ratio,
    FURNITURE.scaleBarMaxLength * ratio,
    scene.units,
  );
  const scaleText = text(FURNITURE.scaleBarText * ratio);
  const barHeight = 4 * ratio;
  const labelWidth = metrics.width(scale.label, scaleText.size);
  const scaleBox: Box = {
    left: margin,
    bottom: view.height - margin,
    right: margin + Math.max(scale.pixels, labelWidth) + 2 * pad,
    top: view.height - margin - scaleText.height - barHeight - 2 * pad,
  };
  const barLeft = scaleBox.left + pad;
  const barBottom = scaleBox.bottom - pad;
  const width = ratio * 1.2;
  svg.push(
    background(scaleBox, ratio),
    `<path d="M${num(barLeft)} ${num(barBottom - barHeight)}V${num(barBottom)}H${num(barLeft + scale.pixels)}V${num(barBottom - barHeight)}" fill="none"${stroke("furniture", width)} stroke-linecap="square"/>`,
    `<text x="${num(barLeft)}" y="${num(scaleText.baseline(barBottom - barHeight - pad / 2))}"${scaleText.attributes}>${escape(scale.label)}</text>`,
  );
  return { svg, obstacles: [pin, attributionBox, scaleBox], pin };
}

function background(box: Box, ratio: number): string {
  return `<rect x="${num(box.left)}" y="${num(box.top)}" width="${num(box.right - box.left)}" height="${num(box.bottom - box.top)}" rx="${num(2 * ratio)}"${fill("furnitureBackground")}/>`;
}

/**
 * The longest round length that fits in `maxPixels`: 1, 2 or 5 times a power
 * of ten in metres or kilometres, or in feet or miles.
 */
export function scaleBar(
  metresPerPixel: number,
  maxPixels: number,
  units: Units,
): { pixels: number; label: string } {
  const maxMetres = metresPerPixel * maxPixels;
  if (units === "imperial") {
    const FOOT = 0.3048;
    const MILE = 1609.344;
    const miles = roundDown(maxMetres / MILE);
    if (miles >= 0.1) {
      return {
        pixels: (miles * MILE) / metresPerPixel,
        label: `${formatNumber(miles)} mi`,
      };
    }
    const feet = roundDown(maxMetres / FOOT);
    return {
      pixels: (feet * FOOT) / metresPerPixel,
      label: `${formatNumber(feet)} ft`,
    };
  }
  const metres = roundDown(maxMetres);
  return {
    pixels: metres / metresPerPixel,
    label:
      metres >= 1000
        ? `${formatNumber(metres / 1000)} km`
        : `${formatNumber(metres)} m`,
  };
}

/** The largest 1, 2 or 5 times a power of ten that is at most `value`. */
function roundDown(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [5, 2, 1]) {
    if (step * power <= value) return step * power;
  }
  return power;
}

function formatNumber(value: number): string {
  return String(Number(value.toPrecision(3)));
}

function fill(role: ColourRole): string {
  const opacity = OPACITY[role];
  return ` fill="${COLOURS[role]}"${opacity === undefined ? "" : ` fill-opacity="${String(opacity)}"`}`;
}

function stroke(role: ColourRole, width: number): string {
  const opacity = OPACITY[role];
  return ` stroke="${COLOURS[role]}" stroke-width="${num(width)}"${opacity === undefined ? "" : ` stroke-opacity="${String(opacity)}"`}`;
}

function dash(pattern: readonly number[], width: number): string {
  return ` stroke-dasharray="${pattern.map((n) => num(n * width)).join(" ")}"`;
}

function num(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
