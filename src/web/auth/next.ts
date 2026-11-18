/**
 * Validates `next`, the path a sign-in returns to. Only a path on this site
 * passes, so `/login?next=…` cannot send anyone to another site after
 * signing in (an open redirect).
 */

/** The longest `next` accepted, in characters. */
export const MAX_NEXT_LENGTH = 512;

/**
 * Returns `value` when it is a path on this site, such as `/servers` or
 * `/g/123?tab=hikes`, and null otherwise. A path starts with a single `/`
 * and holds no `//` after it, no backslash, no control character or space,
 * and the same holds once percent-decoded, because some browsers and servers
 * decode `%2F` and `%5C` before resolving. Anything with a scheme (such as
 * `https:` or `javascript:`) fails because it does not start with `/`.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length > MAX_NEXT_LENGTH) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!isSitePath(value) || !isSitePath(decoded)) return null;
  const base = new URL("https://next.invalid");
  const resolved = new URL(value, base);
  return resolved.origin === base.origin ? value : null;
}

function isSitePath(path: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^\/(?![/\\])[^\\\u0000- \u007f]*$/.test(path) && !path.includes("//");
}
