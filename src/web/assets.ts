/**
 * Versioned paths to the design system's static files. A page links the
 * stylesheet at `/assets/v/<version>/cairn/cairn.css`, where the version is
 * the deployed Worker version's id, so every deploy gets new URLs and the
 * files can be cached for a year. The stylesheet's relative `@import`s and
 * `url()`s resolve under the same versioned path. `versionedAsset` answers
 * those paths with the file from `public/assets/` and the long-lived
 * `Cache-Control`; plain `/assets/...` paths keep the five-minute caching of
 * `public/_headers`.
 */

/** The prefix of versioned asset paths; the version follows it. */
export const VERSIONED_PREFIX = "/assets/v/";

export const STYLESHEET = "cairn/cairn.css";
export const FONT = "fonts/public-sans-5.3.0-latin-wght-normal.woff2";

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Before the first request sets it: unit tests and local renders. */
const DEFAULT_VERSION = "dev";

let version = DEFAULT_VERSION;

/**
 * Sets the version from the Worker's version metadata. Every isolate runs
 * one Worker version, so all its requests set the same value.
 */
export function setAssetVersion(id: string): void {
  version = /^[A-Za-z0-9-]+$/.test(id) ? id : DEFAULT_VERSION;
}

/** The versioned path of `file`, a path under `public/assets/`. */
export function assetPath(file: string): string {
  return `${VERSIONED_PREFIX}${version}/${file}`;
}

/**
 * Answers a versioned path with the file it names from `public/assets/`
 * (or 304 when the browser's copy is current), cacheable for a year, or
 * null when there is no such file.
 */
export async function versionedAsset(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/assets\/v\/[A-Za-z0-9-]+\/(.+)$/.exec(url.pathname);
  if (!match) return null;
  url.pathname = `/assets/${match[1] ?? ""}`;
  const asset = await env.ASSETS.fetch(new Request(url, request));
  if (asset.status !== 200 && asset.status !== 304) {
    await asset.body?.cancel();
    return null;
  }
  const response = new Response(asset.body, asset);
  response.headers.set("Cache-Control", IMMUTABLE_CACHE_CONTROL);
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
