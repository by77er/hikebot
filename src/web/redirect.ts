/** Redirects for the web routes. */

/**
 * A `303 See Other` to `location`, a path on this site or an address the
 * caller built, never a value taken from the request unchecked. Extra
 * headers, such as `Set-Cookie`, are kept in order.
 */
export function seeOther(
  location: string,
  headers: [string, string][] = [],
): Response {
  const response = new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
  for (const [name, value] of headers) response.headers.append(name, value);
  return response;
}
