/**
 * Map pictures: a PNG of the map round a point, with a pin on it, drawn from
 * the vector tiles in the `MAPS` bucket and kept there for the next request.
 * Drawing takes more CPU time than a Worker request gets on the Free plan, so
 * call it inside a Durable Object; the Worker and other objects ask
 * `MapPainter` (`./map-painter.ts`).
 */
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { mapFonts } from "./font";
import { coveringTiles, viewportAt } from "./projection";
import { rasterize } from "./rasterize";
import type { MapReader } from "./reader";
import { STYLE_VERSION } from "./style";
import { buildSvg, type DecodedTile, type Scene, type Units } from "./svg";

export type { Units } from "./svg";

export interface MapPictureRequest {
  lon: number;
  lat: number;
  /** Defaults to `DEFAULT_PICTURE.zoom`. */
  zoom?: number;
  /** Physical pixels; default `DEFAULT_PICTURE.width` by `.height`. */
  width?: number;
  height?: number;
  /** Physical pixels per logical pixel; defaults to 2. */
  pixelRatio?: number;
  /** Of the scale bar and elevations; defaults to metric. */
  units?: Units;
}

export interface MapPicture {
  png: Uint8Array;
  /** Where the picture is kept in the bucket. */
  key: string;
}

export const DEFAULT_PICTURE = {
  zoom: 12,
  width: 1200,
  height: 800,
  pixelRatio: 2,
  units: "metric",
} as const satisfies Required<Omit<MapPictureRequest, "lon" | "lat">>;

const UNITS = ["metric", "imperial"] as const;

/** The bucket prefix under which drawn pictures are kept. */
export const PICTURE_PREFIX = "pictures/";

export interface MapPictureDeps {
  reader: MapReader;
  /** Where pictures are kept: the `MAPS` bucket. */
  bucket: R2Bucket;
  /** Draws a scene; tests pass one that counts. */
  draw?: (scene: Scene) => Promise<Uint8Array>;
}

/**
 * The picture of the map round a point, from the bucket if it was drawn
 * before, else drawn and kept. Undefined when the map data does not cover
 * the point. Where only coarser tiles exist the picture is drawn at most one
 * zoom above them.
 */
export async function mapPicture(
  deps: MapPictureDeps,
  request: MapPictureRequest,
): Promise<MapPicture | undefined> {
  const options = checkRequest(request);
  const { reader, bucket } = deps;
  const lon = round(options.lon);
  const lat = round(options.lat);
  const zooms = await reader.zoomsAt(lon, lat);
  const [build, attribution] = await Promise.all([
    reader.build(),
    reader.attribution(),
  ]);
  if (zooms.length === 0 || !build || !attribution) return undefined;
  const { zoom, tileZoom } = drawingZooms(
    options.zoom,
    zooms,
    options.pixelRatio,
  );
  const key = pictureKey({ ...options, lon, lat, zoom, build });

  const kept = await bucket.get(key);
  if (kept) return { png: new Uint8Array(await kept.arrayBuffer()), key };

  const view = viewportAt({ lon, lat }, { ...options, zoom, tileZoom });
  const tiles: DecodedTile[] = [];
  const read = await Promise.all(
    coveringTiles(view).map(async (tile) => ({
      tile,
      bytes: await reader.tile(tile.z, tile.x, tile.y),
    })),
  );
  for (const { tile, bytes } of read) {
    if (bytes) tiles.push({ tile, data: new VectorTile(new PbfReader(bytes)) });
  }
  if (tiles.length === 0) return undefined;
  const fonts = mapFonts();
  const scene: Scene = {
    view,
    tiles,
    pin: { lon, lat },
    units: options.units,
    attribution,
    fonts,
  };
  const draw =
    deps.draw ?? ((s: Scene) => rasterize(buildSvg(s), fonts.buffers));
  const png = await draw(scene);
  await bucket.put(key, png, { httpMetadata: { contentType: "image/png" } });
  return { png, key };
}

/**
 * The zoom to draw at and the zoom of the tiles to draw from, given the
 * requested zoom, the zooms that have data at the point (ascending,
 * non-empty) and the pixel ratio. The picture is drawn at most one zoom
 * above the finest data. Its tiles are one zoom finer per doubling of the
 * pixel ratio where they exist, so a 2x picture gets the detail its pixels
 * can show (at zoom 12 that includes most trails).
 */
export function drawingZooms(
  requested: number,
  zooms: number[],
  pixelRatio: number,
): { zoom: number; tileZoom: number } {
  const finest = zooms[zooms.length - 1] ?? 0;
  const coarsest = zooms[0] ?? 0;
  const finer = Math.floor(Math.log2(pixelRatio));
  const zoom = Math.max(Math.min(requested, finest + 1), coarsest - finer);
  const below = zooms.filter((z) => z <= zoom + finer);
  return { zoom, tileZoom: below[below.length - 1] ?? coarsest };
}

/** The bucket key of a picture: everything that changes what it shows. */
export function pictureKey(picture: {
  lon: number;
  lat: number;
  zoom: number;
  width: number;
  height: number;
  pixelRatio: number;
  units: Units;
  build: string;
}): string {
  const { lon, lat, zoom, width, height, pixelRatio, units, build } = picture;
  return (
    `${PICTURE_PREFIX}style-${String(STYLE_VERSION)}/build-${build}/` +
    `z${String(zoom)}-${String(width)}x${String(height)}@${String(pixelRatio)}x-${units}/` +
    `${lat.toFixed(5)},${lon.toFixed(5)}.png`
  );
}

function checkRequest(request: MapPictureRequest): Required<MapPictureRequest> {
  const { lon, lat } = request;
  const { zoom, width, height, pixelRatio, units } = {
    ...DEFAULT_PICTURE,
    ...withoutUndefined(request),
  };
  if (!(Number.isFinite(lon) && lon >= -180 && lon <= 180)) {
    throw new RangeError(`longitude ${String(lon)} is not in -180..180`);
  }
  if (!(Number.isFinite(lat) && lat >= -85 && lat <= 85)) {
    throw new RangeError(`latitude ${String(lat)} is not in -85..85`);
  }
  if (!(Number.isInteger(zoom) && zoom >= 0 && zoom <= 16)) {
    throw new RangeError(`zoom ${String(zoom)} is not a whole 0..16`);
  }
  for (const [name, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (!(Number.isInteger(value) && value >= 64 && value <= 2048)) {
      throw new RangeError(`${name} ${String(value)} is not a whole 64..2048`);
    }
  }
  if (!(pixelRatio === 1 || pixelRatio === 2 || pixelRatio === 3)) {
    throw new RangeError(`pixel ratio ${String(pixelRatio)} is not 1, 2 or 3`);
  }
  if (!(UNITS as readonly string[]).includes(units)) {
    throw new RangeError(`units ${units} are not metric or imperial`);
  }
  return { lon, lat, zoom, width, height, pixelRatio, units };
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** Five decimals: about a metre, and part of the key. */
function round(degrees: number): number {
  return Math.round(degrees * 1e5) / 1e5;
}
