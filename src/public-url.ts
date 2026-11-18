/**
 * Builds the Worker's own absolute URLs from the `PUBLIC_URL` var, for
 * links that leave the Worker: OAuth redirect URIs, calendar addresses,
 * links in Discord messages.
 */

/**
 * Returns `path` on the Worker's public origin, such as
 * `https://hiking.bitcru.sh/calendar/x.ics` for `/calendar/x.ics`. A
 * trailing slash on `PUBLIC_URL` is ignored. `path` must start with a single
 * `/`; it may carry a query and a fragment.
 */
export function absoluteUrl(env: { PUBLIC_URL: string }, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(
      `absoluteUrl needs a path starting with a single "/", got ${JSON.stringify(path)}`,
    );
  }
  const base = new URL(env.PUBLIC_URL);
  const url = new URL(base.pathname.replace(/\/+$/, "") + path, base.origin);
  return url.href;
}
