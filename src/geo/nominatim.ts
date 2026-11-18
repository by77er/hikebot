/**
 * A small client for Nominatim, OpenStreetMap's geocoder: one free-form
 * search, one result. The base address comes from the `NOMINATIM_BASE` var,
 * so tests and the end-to-end harness stand in a fake. The usage policy
 * (https://operations.osmfoundation.org/policies/nominatim/) asks for an
 * identifying User-Agent, at most one request per second for the whole
 * application, cached results and no autocomplete; callers pace and cache,
 * this client identifies itself and gives up after a timeout.
 */
import type { Point } from "./coordinates";

export const DEFAULT_NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

/** Names the application and where to reach its maintainers. */
export const NOMINATIM_USER_AGENT =
  "hikebot (+https://github.com/by77er/hikebot)";

/** How long a search may take before it counts as failed. */
export const NOMINATIM_TIMEOUT_MS = 5_000;

/** Place names longer than this are cut at a comma, then with "…". */
export const MAX_PLACE_NAME = 80;

/** Half the side of the box searches are focused on, in degrees. */
export const VIEWBOX_HALF_SIDE = 1;

/** What a search found. */
export interface Place {
  point: Point;
  /** The place's name, shortened from Nominatim's `display_name`. */
  name: string;
}

/** A search that did not get an answer: an error status or a timeout. */
export class GeocodeError extends Error {
  override readonly name = "GeocodeError";

  constructor(
    /** The HTTP status, or null when there was no answer in time. */
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

export interface NominatimOptions {
  /** Defaults to {@link DEFAULT_NOMINATIM_BASE}. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Defaults to {@link NOMINATIM_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** One result of a jsonv2 search, with the fields this client reads. */
interface SearchResult {
  lat?: unknown;
  lon?: unknown;
  display_name?: unknown;
}

/** Builds a client from the Worker's environment. */
export function nominatim(
  env: { NOMINATIM_BASE?: string },
  options: Omit<NominatimOptions, "baseUrl"> = {},
): Nominatim {
  return new Nominatim({
    baseUrl: env.NOMINATIM_BASE || undefined,
    ...options,
  });
}

/**
 * The first parts of `displayName` (Nominatim's comma-separated address,
 * place first) that fit in `max` characters; the first part alone is cut
 * with "…" if it is longer.
 */
export function shortPlaceName(
  displayName: string,
  max = MAX_PLACE_NAME,
): string {
  const parts = displayName
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  let name = "";
  for (const part of parts.slice(0, 3)) {
    const next = name === "" ? part : `${name}, ${part}`;
    if (next.length > max) break;
    name = next;
  }
  if (name !== "") return name;
  const first = parts[0] ?? "";
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The viewbox of about two degrees around `near`, as Nominatim reads it:
 * `<x1>,<y1>,<x2>,<y2>`, x being longitude, clamped to the globe.
 */
export function viewbox(near: Point): string {
  const clamp = (value: number, limit: number) =>
    Math.max(-limit, Math.min(limit, value));
  const west = clamp(near.lon - VIEWBOX_HALF_SIDE, 180);
  const east = clamp(near.lon + VIEWBOX_HALF_SIDE, 180);
  const north = clamp(near.lat + VIEWBOX_HALF_SIDE, 90);
  const south = clamp(near.lat - VIEWBOX_HALF_SIDE, 90);
  return [west, north, east, south].map((n) => String(n)).join(",");
}

export class Nominatim {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: NominatimOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_NOMINATIM_BASE).replace(
      /\/+$/,
      "",
    );
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? NOMINATIM_TIMEOUT_MS;
  }

  /** The search URL for `text`, focused on the box around `near` if given. */
  searchUrl(text: string, near: Point | null = null): string {
    const params = new URLSearchParams({
      q: text,
      format: "jsonv2",
      limit: "1",
    });
    if (near !== null) {
      params.set("viewbox", viewbox(near));
      params.set("bounded", "0");
    }
    return `${this.baseUrl}/search?${params.toString()}`;
  }

  /**
   * The best match for `text`, or null when Nominatim has none. Near a
   * home point, matches inside the box around it come first, but places
   * outside it are still found. Throws `GeocodeError` for an error status,
   * an unreadable answer or no answer within the timeout.
   */
  async search(text: string, near: Point | null = null): Promise<Place | null> {
    let response: Response;
    try {
      response = await this.fetch(this.searchUrl(text, near), {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      throw new GeocodeError(
        null,
        timedOut
          ? `no answer within ${String(this.timeoutMs / 1000)} seconds`
          : "could not be reached",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new GeocodeError(
        response.status,
        `answered HTTP ${String(response.status)}`,
      );
    }
    let results: unknown;
    try {
      results = await response.json();
    } catch {
      throw new GeocodeError(response.status, "answered with unreadable JSON");
    }
    if (!Array.isArray(results)) {
      throw new GeocodeError(response.status, "answered with no result list");
    }
    const first = results[0] as SearchResult | undefined;
    if (first === undefined) return null;
    const lat = Number(first.lat);
    const lon = Number(first.lon);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      throw new GeocodeError(response.status, "answered without coordinates");
    }
    const name =
      typeof first.display_name === "string"
        ? shortPlaceName(first.display_name)
        : "";
    return { point: { lat, lon }, name: name === "" ? text : name };
  }
}
