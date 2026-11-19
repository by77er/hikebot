import { env } from "cloudflare:workers";
import { Compression } from "pmtiles";
import { beforeEach, describe, expect, it } from "vitest";
import { MANIFEST_KEY } from "../../src/maps/manifest";
import {
  MANIFEST_TTL_MS,
  MapReader,
  tileBounds,
  tileBytes,
} from "../../src/maps/reader";
import {
  SAMPLE,
  clearBucket,
  manifestOf,
  manualClock,
  putManifest,
  putSample,
  sampleArchive,
  sampleBytes,
  tileAt,
  vectorTileLayers,
} from "./helpers";

const WORLD_BBOX: [number, number, number, number] = [
  -180, -85.0511, 180, 85.0511,
];
const { lon, lat } = SAMPLE.point;
const [west, south, east, north] = SAMPLE.bbox;
const middle = (west + east) / 2;

function reader(bucket: R2Bucket = env.MAPS, now = manualClock().now) {
  return new MapReader(bucket, { now });
}

/** Records the options of every `get` the reader makes on the bucket. */
function recordingBucket(): {
  bucket: R2Bucket;
  gets: { key: string; options?: R2GetOptions }[];
} {
  const gets: { key: string; options?: R2GetOptions }[] = [];
  const bucket = {
    get: (key: string, options?: R2GetOptions) => {
      gets.push({ key, options });
      return env.MAPS.get(key, options);
    },
  } as unknown as R2Bucket;
  return { bucket, gets };
}

beforeEach(async () => {
  await clearBucket();
});

describe("MapReader.tile", () => {
  it("returns the decompressed vector tile at a point inside the archive", async () => {
    await putSample("builds/test/region.pmtiles");
    await putManifest(manifestOf([sampleArchive()]));
    const { z, x, y } = tileAt(lon, lat, SAMPLE.maxzoom);

    const tile = await reader().tile(z, x, y);

    expect(tile).toBeInstanceOf(Uint8Array);
    // A gzip stream starts with 1f 8b; a decompressed tile does not.
    expect([tile?.[0], tile?.[1]]).not.toEqual([0x1f, 0x8b]);
    const layers = vectorTileLayers(tile ?? new Uint8Array());
    expect(layers).toEqual(expect.arrayContaining(["earth", "roads", "water"]));
  });

  it("returns nothing for a tile outside the archive's box", async () => {
    await putSample("builds/test/region.pmtiles");
    await putManifest(manifestOf([sampleArchive()]));
    const { z, x, y } = tileAt(lon + 20, lat, SAMPLE.maxzoom);

    expect(await reader().tile(z, x, y)).toBeUndefined();
  });

  it("returns nothing above the archive's maxzoom", async () => {
    await putSample("builds/test/region.pmtiles");
    await putManifest(manifestOf([sampleArchive()]));
    const map = reader();
    const above = tileAt(lon, lat, SAMPLE.maxzoom + 1);

    expect(await map.tile(above.z, above.x, above.y)).toBeUndefined();
  });

  it("returns nothing above the archive's own maxzoom when the manifest claims more", async () => {
    await putSample("builds/test/region.pmtiles");
    await putManifest(
      manifestOf([sampleArchive({ maxzoom: SAMPLE.maxzoom + 1 })]),
    );
    const above = tileAt(lon, lat, SAMPLE.maxzoom + 1);

    expect(await reader().tile(above.z, above.x, above.y)).toBeUndefined();
  });

  it("returns nothing for coordinates that are not a tile", async () => {
    await putSample("builds/test/region.pmtiles");
    await putManifest(manifestOf([sampleArchive()]));
    const map = reader();

    expect(await map.tile(2, 4, 0)).toBeUndefined();
    expect(await map.tile(-1, 0, 0)).toBeUndefined();
    expect(await map.tile(1.5, 0, 0)).toBeUndefined();
  });

  it("uses the world archive where the region does not cover", async () => {
    await putSample("builds/test/world.pmtiles");
    await putSample("builds/test/region.pmtiles");
    const worldMaxzoom = SAMPLE.maxzoom - 1;
    await putManifest(
      manifestOf([
        sampleArchive({
          name: "world",
          key: "builds/test/world.pmtiles",
          bbox: WORLD_BBOX,
          maxzoom: worldMaxzoom,
        }),
        sampleArchive({ bbox: [middle, south, east, north] }),
      ]),
    );
    const map = reader();
    const westLon = west + (middle - west) / 8;
    const eastLon = east - (east - middle) / 8;
    const westTile = tileAt(westLon, lat, worldMaxzoom);
    // The west tile lies wholly outside the region's box.
    expect(tileBounds(westTile.z, westTile.x, westTile.y)[2]).toBeLessThan(
      middle,
    );

    expect(await map.tile(westTile.z, westTile.x, westTile.y)).toBeInstanceOf(
      Uint8Array,
    );
    const westDeep = tileAt(westLon, lat, SAMPLE.maxzoom);
    expect(await map.tile(westDeep.z, westDeep.x, westDeep.y)).toBeUndefined();
    const eastDeep = tileAt(eastLon, lat, SAMPLE.maxzoom);
    expect(await map.tile(eastDeep.z, eastDeep.x, eastDeep.y)).toBeInstanceOf(
      Uint8Array,
    );
  });

  it("falls back to the world archive when the region's object is missing", async () => {
    await putSample("builds/test/world.pmtiles");
    await putManifest(
      manifestOf([
        sampleArchive({
          name: "world",
          key: "builds/test/world.pmtiles",
          bbox: WORLD_BBOX,
          maxzoom: SAMPLE.maxzoom - 1,
        }),
        sampleArchive({ key: "builds/test/missing.pmtiles" }),
      ]),
    );
    const map = reader();
    const covered = tileAt(lon, lat, SAMPLE.maxzoom - 1);
    const deep = tileAt(lon, lat, SAMPLE.maxzoom);

    expect(await map.tile(covered.z, covered.x, covered.y)).toBeInstanceOf(
      Uint8Array,
    );
    expect(await map.tile(deep.z, deep.x, deep.y)).toBeUndefined();
  });

  it("returns nothing when the bucket has no manifest", async () => {
    await putSample("builds/test/region.pmtiles");
    const { z, x, y } = tileAt(lon, lat, SAMPLE.maxzoom);
    const map = reader();

    expect(await map.tile(z, x, y)).toBeUndefined();
    expect(await map.zoomsAt(lon, lat)).toEqual([]);
    expect(await map.attribution()).toBeUndefined();
    expect(await map.build()).toBeUndefined();
  });

  it("names the build the manifest is from", async () => {
    await putSample("builds/test/region.pmtiles");
    await putManifest(manifestOf([sampleArchive()], { build: "20261231" }));

    expect(await reader().build()).toBe("20261231");
  });

  it("returns nothing when the manifest is not a manifest", async () => {
    await putSample("builds/test/region.pmtiles");
    await env.MAPS.put(MANIFEST_KEY, "{ not json");
    const { z, x, y } = tileAt(lon, lat, SAMPLE.maxzoom);

    expect(await reader().tile(z, x, y)).toBeUndefined();
  });

  it("returns nothing when the archive's header is corrupt", async () => {
    const corrupt = sampleBytes().slice();
    corrupt.fill(0, 0, 127);
    await env.MAPS.put("builds/test/region.pmtiles", corrupt);
    await putManifest(manifestOf([sampleArchive()]));
    const { z, x, y } = tileAt(lon, lat, SAMPLE.maxzoom);

    expect(await reader().tile(z, x, y)).toBeUndefined();
  });

  it("returns nothing when the archive object is not an archive at all", async () => {
    await env.MAPS.put("builds/test/region.pmtiles", "hello");
    await putManifest(manifestOf([sampleArchive()]));
    const { z, x, y } = tileAt(lon, lat, SAMPLE.maxzoom);

    expect(await reader().tile(z, x, y)).toBeUndefined();
  });

  it("reads byte ranges and keeps the header and directories in memory", async () => {
    await putSample("builds/test/region.pmtiles");
    await putManifest(manifestOf([sampleArchive()]));
    const { bucket, gets } = recordingBucket();
    const map = reader(bucket);
    const { z, x, y } = tileAt(lon, lat, SAMPLE.maxzoom);

    await map.tile(z, x, y);
    const archiveGets = gets.filter((get) => get.key !== MANIFEST_KEY);
    expect(archiveGets.length).toBeGreaterThan(0);
    for (const get of archiveGets) {
      const range = get.options?.range as { length: number } | undefined;
      expect(range?.length).toBeLessThan(sampleBytes().length);
    }

    gets.length = 0;
    expect(await map.tile(z, x, y)).toBeInstanceOf(Uint8Array);
    // Only the tile's own bytes are read again.
    expect(gets).toHaveLength(1);
  });

  it("picks up a changed manifest once the cache time has passed", async () => {
    await putSample("builds/test/region.pmtiles");
    const clock = manualClock();
    const map = reader(env.MAPS, clock.now);
    const { z, x, y } = tileAt(lon, lat, SAMPLE.maxzoom);
    expect(await map.tile(z, x, y)).toBeUndefined();

    await putManifest(
      manifestOf([sampleArchive()], { attribution: "© First" }),
    );
    clock.advance(MANIFEST_TTL_MS - 1);
    expect(await map.tile(z, x, y)).toBeUndefined();

    clock.advance(1);
    expect(await map.tile(z, x, y)).toBeInstanceOf(Uint8Array);
    expect(await map.attribution()).toBe("© First");

    await putManifest(
      manifestOf([sampleArchive()], { attribution: "© Second" }),
    );
    expect(await map.attribution()).toBe("© First");
    clock.advance(MANIFEST_TTL_MS);
    expect(await map.attribution()).toBe("© Second");
  });

  it("reads the manifest again after a failed read, keeping the last one meanwhile", async () => {
    await putSample("builds/test/region.pmtiles");
    await putManifest(manifestOf([sampleArchive()]));
    let failing = false;
    const bucket = {
      get: (key: string, options?: R2GetOptions) =>
        failing
          ? Promise.reject(new Error("R2 is unavailable"))
          : env.MAPS.get(key, options),
    } as unknown as R2Bucket;
    const clock = manualClock();
    const map = reader(bucket, clock.now);
    expect(await map.attribution()).toBe(SAMPLE.attribution);

    failing = true;
    clock.advance(MANIFEST_TTL_MS);
    expect(await map.attribution()).toBe(SAMPLE.attribution);

    failing = false;
    await putManifest(manifestOf([sampleArchive()], { attribution: "© New" }));
    clock.advance(1);
    expect(await map.attribution()).toBe("© New");
  });

  it("returns nothing when the bucket cannot be read", async () => {
    const bucket = {
      get: () => Promise.reject(new Error("R2 is unavailable")),
    } as unknown as R2Bucket;
    const { z, x, y } = tileAt(lon, lat, SAMPLE.maxzoom);

    expect(await reader(bucket).tile(z, x, y)).toBeUndefined();
  });

  it("never keeps the manifest longer than five minutes", async () => {
    const clock = manualClock();
    const map = new MapReader(env.MAPS, {
      now: clock.now,
      manifestTtlMs: 60 * 60 * 1000,
    });
    expect(await map.attribution()).toBeUndefined();

    await putManifest(manifestOf([sampleArchive()]));
    clock.advance(MANIFEST_TTL_MS);
    expect(await map.attribution()).toBe(SAMPLE.attribution);
  });
});

describe("MapReader.zoomsAt", () => {
  beforeEach(async () => {
    await putManifest(
      manifestOf([
        sampleArchive({
          name: "world",
          key: "builds/test/world.pmtiles",
          bbox: WORLD_BBOX,
          minzoom: 0,
          maxzoom: 2,
        }),
        sampleArchive({ minzoom: 5, maxzoom: 7 }),
      ]),
    );
  });

  it("lists the zooms of every archive that covers the point", async () => {
    expect(await reader().zoomsAt(lon, lat)).toEqual([0, 1, 2, 5, 6, 7]);
  });

  it("lists only the world's zooms outside the region", async () => {
    expect(await reader().zoomsAt(lon + 20, lat)).toEqual([0, 1, 2]);
  });

  it("lists nothing outside every archive", async () => {
    expect(await reader().zoomsAt(lon, 89)).toEqual([]);
  });
});

describe("MapReader.attribution", () => {
  it("returns the manifest's attribution", async () => {
    await putManifest(manifestOf([sampleArchive()]));

    expect(await reader().attribution()).toBe(SAMPLE.attribution);
  });
});

describe("MapReader.storedTile", () => {
  it("returns the tile as the archive stores it, gzip, with its compression", async () => {
    await putSample("builds/test/region.pmtiles");
    await putManifest(manifestOf([sampleArchive()]));
    const { z, x, y } = tileAt(lon, lat, SAMPLE.maxzoom);

    const stored = await reader().storedTile(z, x, y);

    if (stored === undefined || stored === "empty") throw new Error("no tile");
    expect(stored.compression).toBe(Compression.Gzip);
    const bytes = new Uint8Array(stored.data);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    expect(new Uint8Array(await tileBytes(stored))).toEqual(
      await reader().tile(z, x, y),
    );
  });

  it("says a tile is empty where an archive covers it but holds nothing", async () => {
    await putSample("builds/test/region.pmtiles");
    // The manifest claims a larger box than the sample's data.
    await putManifest(
      manifestOf([sampleArchive({ bbox: [-122.5, 47, -121, 48] })]),
    );
    const { z, x, y } = tileAt(-122.4, 47.9, 12);

    expect(await reader().storedTile(z, x, y)).toBe("empty");
  });

  it("returns nothing outside every archive, or when the archive cannot be read", async () => {
    await putManifest(manifestOf([sampleArchive()]));
    const inside = tileAt(lon, lat, SAMPLE.maxzoom);
    const outside = tileAt(2.35, 48.85, 12);

    expect(
      await reader().storedTile(outside.z, outside.x, outside.y),
    ).toBeUndefined();
    // The manifest names an archive the bucket does not hold.
    expect(
      await reader().storedTile(inside.z, inside.x, inside.y),
    ).toBeUndefined();
  });
});

describe("MapReader.coverage", () => {
  it("joins the archives' boxes and zooms, with the build and attribution", async () => {
    await putManifest(
      manifestOf([
        sampleArchive({
          name: "world",
          bbox: WORLD_BBOX,
          minzoom: 0,
          maxzoom: 8,
        }),
        sampleArchive(),
      ]),
    );

    expect(await reader().coverage()).toEqual({
      build: SAMPLE.build,
      attribution: SAMPLE.attribution,
      bounds: WORLD_BBOX,
      minzoom: 0,
      maxzoom: SAMPLE.maxzoom,
    });
  });

  it("returns nothing without map data", async () => {
    expect(await reader().coverage()).toBeUndefined();
    await putManifest(manifestOf([]));
    expect(await reader().coverage()).toBeUndefined();
  });
});
