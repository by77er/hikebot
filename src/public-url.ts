/**
 * Builds the Worker's own absolute URLs from the `PUBLIC_URL` var, for
 * links that leave the Worker: OAuth redirect URIs, calendar addresses,
 * links in Discord messages.
 */

/**
 * Returns `path` on the Worker's public origin, such as
 * `https://hiking.bitcru.sh/calendar/x.ics` for `/calendar/x.ics`. A
 * trailing slash on `PUBLIC_URL` is ignored. `path` must start with a single
 * `/` and hold no backslash or control character, which the URL parser would
 * read as a slash or drop; it may carry a query and a fragment. Throws
 * rather than return a URL on another origin.
 */
export function absoluteUrl(env: { PUBLIC_URL: string }, path: string): string {
  const refuse = (): Error =>
    new Error(
      `absoluteUrl needs a path starting with a single "/", with no backslash or control character, got ${JSON.stringify(path)}`,
    );
  // eslint-disable-next-line no-control-regex
  if (!/^\/(?!\/)[^\\\u0000-\u001f\u007f]*$/.test(path)) throw refuse();
  const base = new URL(env.PUBLIC_URL);
  const basePath = base.pathname.replace(/\/+$/, "");
  const url = new URL(basePath + path, base.origin);
  if (url.origin !== base.origin || !url.pathname.startsWith(`${basePath}/`)) {
    throw refuse();
  }
  return url.href;
}
