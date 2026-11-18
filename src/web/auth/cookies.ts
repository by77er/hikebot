/**
 * Reads and writes the cookies of web sign-in. Every cookie it sets is
 * `__Host-` prefixed, `Secure`, `HttpOnly`, `SameSite=Lax` and `Path=/`, so
 * scripts cannot read it, another site's requests do not carry it on a POST,
 * and no subdomain can set or shadow it.
 */

/** The value of the cookie `name` in the request, or null. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (header === null) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/** A `Set-Cookie` value that keeps `value` for `maxAgeSeconds`. */
export function setCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  return `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

/** A `Set-Cookie` value that deletes the cookie `name`. */
export function clearCookie(name: string): string {
  return setCookie(name, "", 0);
}
