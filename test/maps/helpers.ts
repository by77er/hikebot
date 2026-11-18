import { env } from "cloudflare:workers";
import { inject } from "vitest";
import note from "../../maps/sample/sample.json";
import {
  MANIFEST_KEY,
  type BBox,
  type ManifestArchive,
  type MapManifest,
} from "../../src/maps/manifest";

declare module "vitest" {
  export interface ProvidedContext {
    /** maps/sample/sample.pmtiles, base64; set in vitest.config.ts. */
    mapSample: string;
  }
}

/** maps/sample/sample.json: where the sample archive came from and covers. */
export const SAMPLE = note as {
  build: string;
  basemapVersion: string;
  schemaVersion: string;
  license: string;
  attribution: string;
  bbox: BBox;
  minzoom: number;
  maxzoom: number;
  point: { lon: number; lat: number };
};

export function sampleBytes(): Uint8Array {
  return Uint8Array.from(atob(inject("mapSample")), (c) => c.charCodeAt(0));
}

/** Empties the local MAPS bucket. */
export async function clearBucket(): Promise<void> {
  const listed = await env.MAPS.list();
  if (listed.objects.length > 0) {
    await env.MAPS.delete(listed.objects.map((object) => object.key));
  }
}

/** Puts the sample archive into the local MAPS bucket under `key`. */
export async function putSample(key: string): Promise<void> {
  await env.MAPS.put(key, sampleBytes());
}

export async function putManifest(manifest: MapManifest): Promise<void> {
  await env.MAPS.put(MANIFEST_KEY, JSON.stringify(manifest));
}

/** An archive entry for the sample, overridable field by field. */
export function sampleArchive(
  fields: Partial<ManifestArchive> = {},
): ManifestArchive {
  return {
    name: "region",
    key: "builds/test/region.pmtiles",
    bbox: SAMPLE.bbox,
    minzoom: SAMPLE.minzoom,
    maxzoom: SAMPLE.maxzoom,
    bytes: sampleBytes().length,
    ...fields,
  };
}

export function manifestOf(
  archives: ManifestArchive[],
  fields: Partial<MapManifest> = {},
): MapManifest {
  return {
    build: SAMPLE.build,
    basemapVersion: SAMPLE.basemapVersion,
    createdAt: "2026-11-18T00:00:00.000Z",
    attribution: SAMPLE.attribution,
    license: SAMPLE.license,
    archives,
    ...fields,
  };
}

/** A clock the test moves by hand. */
export function manualClock(start = 1_800_000_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let at = start;
  return {
    now: () => at,
    advance: (ms) => {
      at += ms;
    },
  };
}

/** The x and y of the tile at zoom `z` that holds a point. */
export function tileAt(
  lon: number,
  lat: number,
  z: number,
): { z: number; x: number; y: number } {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  );
  return { z, x, y };
}

/**
 * The layer names of a Mapbox Vector Tile: each `layers` entry (field 3 of
 * Tile) holds its name in field 1. Throws if the bytes are not protobuf.
 */
export function vectorTileLayers(bytes: Uint8Array): string[] {
  const names: string[] = [];
  forEachField(bytes, (field, value) => {
    if (field !== 3 || !(value instanceof Uint8Array)) return;
    forEachField(value, (layerField, layerValue) => {
      if (layerField === 1 && layerValue instanceof Uint8Array) {
        names.push(new TextDecoder().decode(layerValue));
      }
    });
  });
  return names;
}

function forEachField(
  bytes: Uint8Array,
  visit: (field: number, value: number | Uint8Array) => void,
): void {
  let pos = 0;
  const varint = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (pos >= bytes.length) throw new Error("truncated varint");
      const byte = bytes[pos++] ?? 0;
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
      shift += 7;
    }
  };
  while (pos < bytes.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) visit(field, varint());
    else if (wire === 2) {
      const length = varint();
      if (pos + length > bytes.length) throw new Error("truncated field");
      visit(field, bytes.subarray(pos, pos + length));
      pos += length;
    } else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else throw new Error(`unknown wire type ${String(wire)}`);
  }
}
