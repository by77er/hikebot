/**
 * The one way the Worker answers with an HTML page. `htmlResponse` renders a
 * page's JSX to a string, so text in it is escaped, and sets the headers
 * every page carries: a Content-Security-Policy that loads styles, scripts,
 * fonts and connections from the Worker's own origin only (images also from
 * `data:` URLs and Discord's CDN, for avatars), and no caching. See "Web
 * pages" in docs/design.md.
 */
import type { VNode } from "preact";
import { renderToString } from "preact-render-to-string";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'self'",
  "script-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data: https://cdn.discordapp.com",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** The headers of every HTML response. */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cache-Control": "no-store",
};

export interface PageInit {
  /** Defaults to 200. */
  status?: number;
  /** Extra headers, such as `Allow`; they cannot replace `PAGE_HEADERS`. */
  headers?: HeadersInit;
}

/** Renders `page` (a whole document, from `Layout`) as an HTML response. */
export function htmlResponse(page: VNode, init: PageInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(PAGE_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(`<!doctype html>${renderToString(page)}`, {
    status: init.status ?? 200,
    headers,
  });
}
