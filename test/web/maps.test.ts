import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MANIFEST_TTL_MS } from "../../src/maps/reader";
import { IMMUTABLE_CACHE_CONTROL } from "../../src/web/assets";
import { SHORT_CACHE_CONTROL, TILE_CONTENT_TYPE } from "../../src/web/maps";
import { webRouter } from "../../src/web/routes";
import {
  SAMPLE,
  clearBucket,
  manifestOf,
  putManifest,
  putSample,
  sampleArchive,
  tileAt,
  vectorTileLayers,
} from "../maps/helpers";

const KEY = "builds/test/region.pmtiles";

function get(path: string, headers: HeadersInit = {}) {
  return webRouter.handle(
    new Request(`https://hikebot.example${path}`, { headers }),
    env,
    createExecutionContext(),
  );
}

/** The path of the sample point's tile at `z`, naming `build` if given. */
function tilePath(z: number, build?: string): string {
  const tile = tileAt(SAMPLE.point.lon, SAMPLE.point.lat, z);
  const path = `/tiles/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}.mvt`;
  return build === undefined ? path : `${path}?build=${build}`;
}

async function gunzip(data: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Response(data).body?.pipeThrough(
    new DecompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let clock = Date.now();

// The routes keep one map reader, which keeps the manifest it read for
// MANIFEST_TTL_MS: each test starts after that, so it reads the bucket.
beforeEach(async () => {
  clock += MANIFEST_TTL_MS + 1;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  await clearBucket();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /tiles/<z>/<x>/<y>.mvt", () => {
  beforeEach(async () => {
    await putSample(KEY);
    // The manifest says the archive covers more than the sample holds, so
    // a tile in the difference is covered but empty.
    await putManifest(
      manifestOf([
        sampleArchive({
          key: KEY,
          bbox: [-122.5, 47, -121, 48],
        }),
      ]),
    );
  });

  it("serves the stored gzip bytes to a browser that accepts gzip, without a session", async () => {
    const response = await get(tilePath(14, SAMPLE.build), {
      "Accept-Encoding": "gzip, deflate, br",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(TILE_CONTENT_TYPE);
    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const tile = await gunzip(await response.arrayBuffer());
    expect(vectorTileLayers(tile)).toContain("roads");
  });

  it("decompresses the tile for a client that does not accept gzip", async () => {
    for (const accept of ["identity", "gzip;q=0"]) {
      const response = await get(tilePath(14, SAMPLE.build), {
        "Accept-Encoding": accept,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Encoding")).toBeNull();
      const tile = new Uint8Array(await response.arrayBuffer());
      expect(vectorTileLayers(tile)).toContain("roads");
    }
  });

  it("is cached for a year under the current build and five minutes otherwise", async () => {
    const current = await get(tilePath(12, SAMPLE.build));
    expect(current.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE_CONTROL);
    for (const path of [tilePath(12), tilePath(12, "19990101")]) {
      const other = await get(path);
      expect(other.status).toBe(200);
      expect(other.headers.get("Cache-Control")).toBe(SHORT_CACHE_CONTROL);
    }
  });

  it("answers 304 to a browser whose copy has the build's ETag", async () => {
    const first = await get(tilePath(13, SAMPLE.build), {
      "Accept-Encoding": "gzip",
    });
    const etag = first.headers.get("ETag");
    expect(etag).toBe(`"${SAMPLE.build}-gzip"`);
    const again = await get(tilePath(13, SAMPLE.build), {
      "Accept-Encoding": "gzip",
      "If-None-Match": etag ?? "",
    });
    expect(again.status).toBe(304);
    expect(again.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  it("answers 204 for a tile the archives cover but hold nothing in", async () => {
    const { z, x, y } = tileAt(-122.4, 47.9, 12);
    const response = await get(
      `/tiles/${String(z)}/${String(x)}/${String(y)}.mvt?build=${SAMPLE.build}`,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(await response.text()).toBe("");
  });

  it("answers 404 outside the archives' box or zooms", async () => {
    const { z, x, y } = tileAt(2.35, 48.85, 12);
    const paris = await get(
      `/tiles/${String(z)}/${String(x)}/${String(y)}.mvt`,
    );
    expect(paris.status).toBe(404);
    const tooFar = await get(tilePath(SAMPLE.maxzoom + 1));
    expect(tooFar.status).toBe(404);
    const tooWide = await get(tilePath(SAMPLE.minzoom - 1));
    expect(tooWide.status).toBe(404);
  });

  it("answers 404 for a path that names no tile", async () => {
    for (const path of [
      "/tiles/12/655/1430",
      "/tiles/12/655/1430.png",
      "/tiles/12/655.mvt",
      "/tiles/a/b/c.mvt",
      "/tiles/12/-1/1430.mvt",
      "/tiles/12/4096/0.mvt",
      "/tiles/99/0/0.mvt",
      "/tiles/",
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("Content-Type")).toBe(
        "text/plain; charset=utf-8",
      );
    }
  });

  it("answers 404 without map data", async () => {
    await clearBucket();
    const response = await get(tilePath(14, SAMPLE.build));
    expect(response.status).toBe(404);
  });
});

describe("GET /maps/style.json", () => {
  it("is a valid MapLibre style over this site's tiles of the current build", async () => {
    await putSample(KEY);
    await putManifest(manifestOf([sampleArchive({ key: KEY })]));
    const response = await get("/maps/style.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe(SHORT_CACHE_CONTROL);
    const style = await response.json<{
      sources: Record<string, Record<string, unknown>>;
      glyphs?: string;
      sprite?: string;
    }>();
    expect(validateStyleMin(style as never)).toEqual([]);
    expect(style.sources.hikebot).toMatchObject({
      type: "vector",
      tiles: [
        `https://hikebot.example/tiles/{z}/{x}/{y}.mvt?build=${SAMPLE.build}`,
      ],
      bounds: SAMPLE.bbox,
      minzoom: SAMPLE.minzoom,
      maxzoom: SAMPLE.maxzoom,
      attribution: SAMPLE.attribution,
    });
    // Labels are drawn with the page's typeface: nothing more to load.
    expect(style.glyphs).toBeUndefined();
    expect(style.sprite).toBeUndefined();
  });

  it("answers 404 without map data", async () => {
    const response = await get("/maps/style.json");
    expect(response.status).toBe(404);
  });
});
