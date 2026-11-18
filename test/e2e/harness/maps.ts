/**
 * Seeds the Worker's local `MAPS` bucket with the committed sample map
 * archive (`maps/sample/`) and a manifest naming it, as the `Map data`
 * workflow's build leaves the real bucket: the archive under a build prefix,
 * then `manifest.json`. The manifest's shape is the one the Worker's map
 * reader parses (`MapManifest`), written out here because the end-to-end
 * suite reaches the Worker's code only over HTTP.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SAMPLE_DIR = fileURLToPath(
  new URL("../../../maps/sample/", import.meta.url),
);

export const MAP_MANIFEST_KEY = "manifest.json";
export const MAP_SAMPLE_KEY = "builds/sample/region.pmtiles";

/** The part of an R2 binding the seeding uses, as `getEnv()` returns it. */
export interface MapsBucket {
  put(key: string, value: Uint8Array | string): Promise<unknown>;
  get(key: string): Promise<{
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
}

interface SampleNote {
  build: string;
  basemapVersion: string;
  license: string;
  attribution: string;
  bbox: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
}

/** Puts the sample archive, then the manifest, into `bucket`. */
export async function seedMaps(bucket: MapsBucket): Promise<void> {
  const [archive, noteText] = await Promise.all([
    readFile(`${SAMPLE_DIR}sample.pmtiles`),
    readFile(`${SAMPLE_DIR}sample.json`, "utf8"),
  ]);
  const note = JSON.parse(noteText) as SampleNote;
  await bucket.put(MAP_SAMPLE_KEY, new Uint8Array(archive));
  const manifest = {
    build: note.build,
    basemapVersion: note.basemapVersion,
    createdAt: "2026-11-18T00:00:00Z",
    attribution: note.attribution,
    license: note.license,
    archives: [
      {
        name: "region",
        key: MAP_SAMPLE_KEY,
        bbox: note.bbox,
        minzoom: note.minzoom,
        maxzoom: note.maxzoom,
        bytes: archive.length,
      },
    ],
  };
  await bucket.put(MAP_MANIFEST_KEY, JSON.stringify(manifest));
}
