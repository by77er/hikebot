/**
 * The interactive map's data, for anyone (the map data is public, so no
 * session is needed):
 *
 * - `GET /tiles/<z>/<x>/<y>.mvt` answers a vector tile from the map reader:
 *   the bytes as the archive stores them (gzip) when the browser accepts
 *   that, else decompressed; 204 for a tile some archive covers but has
 *   nothing in; 404 outside every archive, without map data, or for a path
 *   that names no tile. A request naming the current build
 *   (`?build=<build>`, as the style's tile address does) may be cached for
 *   a year, since a new build gets new addresses; any other for five
 *   minutes.
 * - `GET /maps/style.json` answers the map's style (`browserStyle` in
 *   `src/maps/browser-style.ts`), pointing at those tiles, or 404 without
 *   map data.
 *
 * "Map data" in docs/design.md describes both.
 */
import { Compression } from "pmtiles";
import { systemNow } from "../clock";
import { browserStyle } from "../maps/browser-style";
import { MapReader, tileBytes } from "../maps/reader";
import { IMMUTABLE_CACHE_CONTROL } from "./assets";

export const TILE_CONTENT_TYPE = "application/vnd.mapbox-vector-tile";

/** For a tile of another build than the current, and for the style. */
export const SHORT_CACHE_CONTROL = "public, max-age=300";

let reader: MapReader | undefined;

/** The isolate's one map reader. */
function mapReader(env: Env): MapReader {
  reader ??= new MapReader(env.MAPS, { now: systemNow });
  return reader;
}

/** `GET /tiles/<z>/<x>/<y>.mvt`. */
export async function tileRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/tiles\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.mvt$/.exec(
    url.pathname,
  );
  if (!match) return noTile();
  const [z, x, y] = match.slice(1).map(Number) as [number, number, number];
  const maps = mapReader(env);
  const build = await maps.build();
  const tile = await maps.storedTile(z, x, y);
  if (build === undefined || tile === undefined) return noTile();
  const headers = new Headers({
    "Cache-Control":
      url.searchParams.get("build") === build
        ? IMMUTABLE_CACHE_CONTROL
        : SHORT_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
    Vary: "Accept-Encoding",
  });
  if (tile === "empty") {
    return new Response(null, { status: 204, headers });
  }
  const gzip = tile.compression === Compression.Gzip && acceptsGzip(request);
  const etag = `"${build}${gzip ? "-gzip" : ""}"`;
  headers.set("ETag", etag);
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  headers.set("Content-Type", TILE_CONTENT_TYPE);
  if (gzip) {
    headers.set("Content-Encoding", "gzip");
    return new Response(tile.data, { headers, encodeBody: "manual" });
  }
  return new Response(await tileBytes(tile), { headers });
}

/** `GET /maps/style.json`. */
export async function styleRoute(
  request: Request,
  env: Env,
): Promise<Response> {
  const coverage = await mapReader(env).coverage();
  if (!coverage) return noTile();
  const { origin } = new URL(request.url);
  const style = browserStyle({
    tiles: `${origin}/tiles/{z}/{x}/{y}.mvt?build=${encodeURIComponent(coverage.build)}`,
    attribution: coverage.attribution,
    bounds: coverage.bounds,
    minzoom: coverage.minzoom,
    maxzoom: coverage.maxzoom,
  });
  return Response.json(style, {
    headers: {
      "Cache-Control": SHORT_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function acceptsGzip(request: Request): boolean {
  return (request.headers.get("Accept-Encoding") ?? "")
    .split(",")
    .some((coding) => {
      const [name = "", ...params] = coding.trim().toLowerCase().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return name.trim() === "gzip" && (!q || Number(q.trim().slice(2)) > 0);
    });
}

function noTile(): Response {
  return new Response("No such tile.\n", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": SHORT_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
