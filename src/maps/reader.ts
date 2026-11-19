/**
 * Reads map tiles from the PMTiles archives in the `MAPS` bucket. The
 * manifest says which archives exist; the reader picks the most detailed
 * archive that covers a tile and reads only the byte ranges it needs. Keep
 * one `MapReader` per isolate: it holds the manifest for at most
 * `manifestTtlMs` and each archive's header and directories in memory.
 *
 * Every read that finds no data (no manifest, a missing or corrupt archive,
 * a tile outside every archive) answers undefined and never throws.
 */
import {
  Compression,
  EtagMismatch,
  PMTiles,
  ResolvedValueCache,
  type RangeResponse,
  type Source,
} from "pmtiles";
import {
  MANIFEST_KEY,
  parseManifest,
  type BBox,
  type ManifestArchive,
  type MapManifest,
} from "./manifest";

/** How long a manifest read from the bucket is used before reading it again. */
export const MANIFEST_TTL_MS = 5 * 60 * 1000;

/** Headers and directories kept per reader, across all its archives. */
const DIRECTORY_CACHE_ENTRIES = 64;

export interface MapReaderOptions {
  /** Milliseconds since the epoch. */
  now: () => number;
  /** At most `MANIFEST_TTL_MS`. */
  manifestTtlMs?: number;
}

export class MapReader {
  private readonly now: () => number;
  private readonly manifestTtlMs: number;
  private manifest: { value: MapManifest | undefined; readAt: number } | null =
    null;
  private readonly archives = new Map<string, PMTiles>();
  private readonly cache = new ResolvedValueCache(
    DIRECTORY_CACHE_ENTRIES,
    undefined,
    decompress,
  );

  constructor(
    private readonly bucket: R2Bucket,
    options: MapReaderOptions,
  ) {
    this.now = options.now;
    this.manifestTtlMs = Math.min(
      options.manifestTtlMs ?? MANIFEST_TTL_MS,
      MANIFEST_TTL_MS,
    );
  }

  /**
   * The decompressed bytes of tile `z/x/y` (a Mapbox Vector Tile), from the
   * most detailed archive that has it, or undefined.
   */
  async tile(z: number, x: number, y: number): Promise<Uint8Array | undefined> {
    const stored = await this.storedTile(z, x, y);
    if (stored === undefined || stored === "empty") return undefined;
    try {
      return new Uint8Array(await decompress(stored.data, stored.compression));
    } catch (error) {
      console.warn(
        `map tile ${String(z)}/${String(x)}/${String(y)} unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Tile `z/x/y` as its archive stores it, with that archive's compression,
   * for serving as it is; `"empty"` when some archive covers the tile (its
   * zooms include `z` and its box overlaps the tile) but none has it, which
   * is the archives' way of saying there is nothing there; undefined
   * outside every archive, or without map data.
   */
  async storedTile(
    z: number,
    x: number,
    y: number,
  ): Promise<StoredTile | "empty" | undefined> {
    if (!isTile(z, x, y)) return undefined;
    const manifest = await this.currentManifest();
    if (!manifest) return undefined;
    const bounds = tileBounds(z, x, y);
    let covered = false;
    for (const archive of byDetail(manifest.archives)) {
      if (z < archive.minzoom || z > archive.maxzoom) continue;
      if (!overlaps(archive.bbox, bounds)) continue;
      covered = true;
      const data = await this.readTile(archive, z, x, y);
      if (data) return data;
    }
    return covered ? "empty" : undefined;
  }

  /** The zoom levels some archive covers at a point, ascending. */
  async zoomsAt(lon: number, lat: number): Promise<number[]> {
    const manifest = await this.currentManifest();
    if (!manifest) return [];
    const zooms = new Set<number>();
    for (const archive of manifest.archives) {
      if (!contains(archive.bbox, lon, lat)) continue;
      for (let z = archive.minzoom; z <= archive.maxzoom; z++) zooms.add(z);
    }
    return [...zooms].sort((a, b) => a - b);
  }

  /** The build the archives come from, or undefined without map data. */
  async build(): Promise<string | undefined> {
    return (await this.currentManifest())?.build;
  }

  /**
   * Where the archives have tiles, for a map drawn in the browser: their
   * boxes together, their zooms together, the build and the attribution;
   * undefined without map data.
   */
  async coverage(): Promise<MapCoverage | undefined> {
    const manifest = await this.currentManifest();
    const [first, ...rest] = manifest?.archives ?? [];
    if (!manifest || !first) return undefined;
    const bounds: BBox = [...first.bbox];
    let minzoom = first.minzoom;
    let maxzoom = first.maxzoom;
    for (const archive of rest) {
      bounds[0] = Math.min(bounds[0], archive.bbox[0]);
      bounds[1] = Math.min(bounds[1], archive.bbox[1]);
      bounds[2] = Math.max(bounds[2], archive.bbox[2]);
      bounds[3] = Math.max(bounds[3], archive.bbox[3]);
      minzoom = Math.min(minzoom, archive.minzoom);
      maxzoom = Math.max(maxzoom, archive.maxzoom);
    }
    return {
      build: manifest.build,
      attribution: manifest.attribution,
      bounds,
      minzoom,
      maxzoom,
    };
  }

  /** The attribution to print with the map, or undefined without map data. */
  async attribution(): Promise<string | undefined> {
    return (await this.currentManifest())?.attribution;
  }

  private async readTile(
    archive: ManifestArchive,
    z: number,
    x: number,
    y: number,
  ): Promise<StoredTile | undefined> {
    try {
      const pmtiles = this.pmtiles(archive.key);
      const response = await pmtiles.getZxy(z, x, y);
      if (!response) return undefined;
      const { tileCompression } = await pmtiles.getHeader();
      return { data: response.data, compression: tileCompression };
    } catch (error) {
      console.warn(
        `map archive ${archive.key} unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private pmtiles(key: string): PMTiles {
    let archive = this.archives.get(key);
    if (!archive) {
      // Tiles come back as stored; `tile` decompresses them.
      archive = new PMTiles(
        new R2Source(this.bucket, key),
        this.cache,
        asStored,
      );
      this.archives.set(key, archive);
    }
    return archive;
  }

  private async currentManifest(): Promise<MapManifest | undefined> {
    const at = this.now();
    if (this.manifest && at - this.manifest.readAt < this.manifestTtlMs) {
      return this.manifest.value;
    }
    const read = await this.readManifest();
    // A failed read keeps what was there; the next call tries again.
    if (!read.ok) return this.manifest?.value;
    const { value } = read;
    this.manifest = { value, readAt: at };
    const keys = new Set(value?.archives.map((archive) => archive.key));
    for (const [key, archive] of this.archives) {
      if (keys.has(key)) continue;
      this.archives.delete(key);
      await this.cache.invalidate(archive.source);
    }
    return value;
  }

  /** `ok` is false when the bucket could not be read at all. */
  private async readManifest(): Promise<
    { ok: true; value: MapManifest | undefined } | { ok: false }
  > {
    try {
      const object = await this.bucket.get(MANIFEST_KEY);
      return {
        ok: true,
        value: object ? parseManifest(await object.text()) : undefined,
      };
    } catch (error) {
      console.warn(
        `map manifest unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false };
    }
  }
}

/** What `MapReader.coverage` answers. */
export interface MapCoverage {
  build: string;
  attribution: string;
  /** West, south, east, north: every archive's box inside it. */
  bounds: BBox;
  minzoom: number;
  maxzoom: number;
}

/** A tile's bytes as its archive stores them. */
export interface StoredTile {
  data: ArrayBuffer;
  /** `Compression.Gzip` for the Protomaps archives. */
  compression: Compression;
}

/** Ranged reads of one archive object in an R2 bucket. */
class R2Source implements Source {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly key: string,
  ) {}

  getKey(): string {
    return this.key;
  }

  async getBytes(
    offset: number,
    length: number,
    _signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    const object = await this.bucket.get(this.key, {
      range: { offset, length },
      ...(etag ? { onlyIf: { etagMatches: etag } } : {}),
    });
    if (!object) throw new Error(`no object ${this.key} in the bucket`);
    // A failed etag precondition returns the object without a body.
    if (!("body" in object)) throw new EtagMismatch();
    return { data: await object.arrayBuffer(), etag: object.etag };
  }
}

/** The decompressed bytes of a stored tile. */
export function tileBytes(tile: StoredTile): Promise<ArrayBuffer> {
  return decompress(tile.data, tile.compression);
}

function asStored(data: ArrayBuffer): Promise<ArrayBuffer> {
  return Promise.resolve(data);
}

async function decompress(
  data: ArrayBuffer,
  compression: Compression,
): Promise<ArrayBuffer> {
  if (compression === Compression.None || compression === Compression.Unknown) {
    return data;
  }
  if (compression === Compression.Gzip) {
    const stream = new Response(data).body;
    if (!stream) return data;
    return new Response(
      stream.pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer();
  }
  throw new Error(`unsupported compression ${String(compression)}`);
}

function isTile(z: number, x: number, y: number): boolean {
  if (![z, x, y].every(Number.isInteger)) return false;
  if (z < 0 || z > 30) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
}

/** Most detailed first: highest maxzoom, then the smaller box. */
function byDetail(archives: ManifestArchive[]): ManifestArchive[] {
  return [...archives].sort(
    (a, b) => b.maxzoom - a.maxzoom || area(a.bbox) - area(b.bbox),
  );
}

function area([west, south, east, north]: BBox): number {
  return (east - west) * (north - south);
}

/** The tile's west, south, east and north edges in degrees. */
export function tileBounds(z: number, x: number, y: number): BBox {
  const n = 2 ** z;
  const lon = (i: number) => (i / n) * 360 - 180;
  const lat = (j: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

function overlaps(a: BBox, b: BBox): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

function contains(
  [west, south, east, north]: BBox,
  lon: number,
  lat: number,
): boolean {
  return lon >= west && lon <= east && lat >= south && lat <= north;
}
