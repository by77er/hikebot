/**
 * Web Mercator arithmetic for map pictures. Zoom levels follow the vector
 * map convention (as in MapLibre): at zoom `z` the world is `TILE_SIZE * 2^z`
 * logical pixels wide, and a picture's physical pixels are its logical
 * pixels times its pixel ratio.
 */

/** Logical pixels per tile edge at the tile's own zoom. */
export const TILE_SIZE = 512;

/** The latitude where Web Mercator stops, in degrees. */
export const MAX_LATITUDE = 85.0511287798;

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export interface Point {
  x: number;
  y: number;
}

/** A point's position in logical pixels from the world's top-left corner. */
export function project(lon: number, lat: number, zoom: number): Point {
  const size = TILE_SIZE * 2 ** zoom;
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** The longitude and latitude of a logical pixel position at `zoom`. */
export function unproject(
  point: Point,
  zoom: number,
): { lon: number; lat: number } {
  const size = TILE_SIZE * 2 ** zoom;
  const lon = (point.x / size) * 360 - 180;
  const n = Math.PI * (1 - (2 * point.y) / size);
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return { lon, lat };
}

/** Ground metres per logical pixel at a latitude and zoom. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (
    (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) /
    (TILE_SIZE * 2 ** zoom)
  );
}

/** What a picture shows and at which scale, in physical pixels. */
export interface Viewport {
  /** The zoom the picture is drawn at. */
  zoom: number;
  /** The zoom of the tiles it is drawn from: at most `zoom`. */
  tileZoom: number;
  /** Physical pixels per logical pixel. */
  pixelRatio: number;
  /** Physical width and height. */
  width: number;
  height: number;
  /** The world position, in physical pixels, of the picture's top-left. */
  left: number;
  top: number;
}

export function viewportAt(
  center: { lon: number; lat: number },
  options: {
    zoom: number;
    tileZoom: number;
    width: number;
    height: number;
    pixelRatio: number;
  },
): Viewport {
  const { x, y } = project(center.lon, center.lat, options.zoom);
  const { width, height, pixelRatio } = options;
  return {
    ...options,
    left: x * pixelRatio - width / 2,
    top: y * pixelRatio - height / 2,
  };
}

/** Physical pixels per tile edge for the viewport's tiles. */
export function tilePixels(view: Viewport): number {
  return TILE_SIZE * 2 ** (view.zoom - view.tileZoom) * view.pixelRatio;
}

/** A position on the picture, in physical pixels, of a lon/lat. */
export function toPicture(view: Viewport, lon: number, lat: number): Point {
  const { x, y } = project(lon, lat, view.zoom);
  return {
    x: x * view.pixelRatio - view.left,
    y: y * view.pixelRatio - view.top,
  };
}

export interface CoveringTile {
  z: number;
  /** The tile's column to read, wrapped into the world. */
  x: number;
  y: number;
  /** The tile's top-left corner on the picture, in physical pixels. */
  left: number;
  top: number;
}

/**
 * The tiles at `view.tileZoom` that the picture overlaps, row by row. A
 * picture that crosses the antimeridian gets the tiles from the other side;
 * rows beyond the poles are left out.
 */
export function coveringTiles(view: Viewport): CoveringTile[] {
  const size = tilePixels(view);
  const n = 2 ** view.tileZoom;
  const firstColumn = Math.floor(view.left / size);
  const lastColumn = Math.ceil((view.left + view.width) / size) - 1;
  const firstRow = Math.max(0, Math.floor(view.top / size));
  const lastRow = Math.min(
    n - 1,
    Math.ceil((view.top + view.height) / size) - 1,
  );
  const tiles: CoveringTile[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      tiles.push({
        z: view.tileZoom,
        x: ((column % n) + n) % n,
        y: row,
        left: column * size - view.left,
        top: row * size - view.top,
      });
    }
  }
  return tiles;
}
