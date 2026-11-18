/**
 * The map data manifest: the object `manifest.json` in the `MAPS` bucket,
 * written last by the `Map data` workflow's build, naming the archives of
 * the current build. See "Map data" in docs/design.md.
 */

/** The bucket key of the manifest. */
export const MANIFEST_KEY = "manifest.json";

/** West, south, east, north, in degrees. */
export type BBox = [number, number, number, number];

export interface ManifestArchive {
  /** `world` or `region`, as in maps/regions.json. */
  name: string;
  /** The archive's object key in the bucket. */
  key: string;
  bbox: BBox;
  minzoom: number;
  maxzoom: number;
  bytes: number;
}

export interface MapManifest {
  /** The Protomaps build the archives were extracted from, e.g. `20261117`. */
  build: string;
  /** The Protomaps basemap tileset version of that build. */
  basemapVersion: string;
  /** When the workflow wrote the manifest, as an ISO 8601 time. */
  createdAt: string;
  /** The text every surface that shows the map prints with it. */
  attribution: string;
  license: string;
  archives: ManifestArchive[];
}

/**
 * Parses the manifest's JSON text. Returns undefined when it is not JSON or
 * not a manifest, so a broken upload reads as "no map data".
 */
export function parseManifest(text: string): MapManifest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const { build, basemapVersion, createdAt, attribution, license, archives } =
    value;
  if (
    typeof build !== "string" ||
    typeof basemapVersion !== "string" ||
    typeof createdAt !== "string" ||
    typeof attribution !== "string" ||
    attribution === "" ||
    typeof license !== "string" ||
    !Array.isArray(archives)
  ) {
    return undefined;
  }
  const parsed: ManifestArchive[] = [];
  for (const archive of archives) {
    const valid = parseArchive(archive);
    if (!valid) return undefined;
    parsed.push(valid);
  }
  return {
    build,
    basemapVersion,
    createdAt,
    attribution,
    license,
    archives: parsed,
  };
}

/** True when `bbox` is four finite numbers with west < east, south < north. */
export function isBBox(bbox: unknown): bbox is BBox {
  if (!Array.isArray(bbox) || bbox.length !== 4) return false;
  if (!bbox.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return false;
  }
  const [west, south, east, north] = bbox as BBox;
  return (
    west >= -180 &&
    east <= 180 &&
    south >= -90 &&
    north <= 90 &&
    west < east &&
    south < north
  );
}

function parseArchive(value: unknown): ManifestArchive | undefined {
  if (!isRecord(value)) return undefined;
  const { name, key, bbox, minzoom, maxzoom, bytes } = value;
  if (
    typeof name !== "string" ||
    typeof key !== "string" ||
    key === "" ||
    !isBBox(bbox) ||
    !isZoom(minzoom) ||
    !isZoom(maxzoom) ||
    minzoom > maxzoom ||
    typeof bytes !== "number"
  ) {
    return undefined;
  }
  return { name, key, bbox, minzoom, maxzoom, bytes };
}

function isZoom(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 15
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
