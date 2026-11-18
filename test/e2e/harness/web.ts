/**
 * A browser-like client for the Worker's web pages. It requests a path from
 * the Worker under test and returns the status, headers and body as they
 * came, without following redirects, and keeps the cookies the Worker sets
 * in a jar, sending them back on later requests as a browser would.
 */

export interface PageResponse {
  status: number;
  headers: Headers;
  body: string;
  /** For a redirect, the `Location` header resolved against the request. */
  location: URL | null;
}

export interface PageRequest {
  method?: string;
  headers?: Record<string, string>;
  /** A form body, sent as `application/x-www-form-urlencoded`. */
  form?: Record<string, string>;
}

export class PageClient {
  /** Cookies by name, as the Worker last set them. */
  readonly cookies = new Map<string, string>();

  /** `base` is where the Worker listens, such as `e2e.url`. */
  constructor(private readonly base: URL) {}

  get(path: string): Promise<PageResponse> {
    return this.request(path);
  }

  async request(path: string, init: PageRequest = {}): Promise<PageResponse> {
    const url = new URL(path, this.base);
    const headers = new Headers(init.headers);
    const cookie = this.cookieHeader();
    if (cookie) headers.set("Cookie", cookie);
    let body: string | undefined;
    if (init.form) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(url, {
      method: init.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
      redirect: "manual",
    });
    this.store(response.headers.getSetCookie());
    const location = response.headers.get("Location");
    return {
      status: response.status,
      headers: response.headers,
      body: await response.text(),
      location: location === null ? null : new URL(location, url),
    };
  }

  private cookieHeader(): string {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  /** Keeps each cookie set, and drops one set to expire. */
  private store(setCookies: string[]): void {
    for (const line of setCookies) {
      const [pair = "", ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      if (at < 1) continue;
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const expired = attributes.some((attribute) => {
        const [key = "", setting = ""] = attribute.split("=", 2);
        const lower = key.trim().toLowerCase();
        if (lower === "max-age") return Number(setting.trim()) <= 0;
        if (lower === "expires") return Date.parse(setting) <= Date.now();
        return false;
      });
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

/** The `href` of each stylesheet link in a page's HTML. */
export function stylesheetLinks(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /\brel="stylesheet"/.test(tag))
    .map((tag) => /\bhref="([^"]*)"/.exec(tag)?.[1] ?? "");
}
