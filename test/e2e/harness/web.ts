/**
 * A browser-like client for the Worker's web pages. It requests a path from
 * the Worker under test and returns the status, headers and body as they
 * came, without following redirects, and keeps the cookies the Worker sets
 * in a jar, sending them back on later requests as a browser would. It signs
 * in with Discord through the fake Discord API (`signIn`) and submits the
 * forms a page holds (`submitForm`), as a browser does.
 */
import {
  DISCORD_CONSENT_COOKIE,
  DISCORD_USER_COOKIE,
} from "./fake-discord-oauth";

export interface PageResponse {
  /** The address requested. */
  url: URL;
  status: number;
  headers: Headers;
  body: string;
  /** For a redirect, the `Location` header resolved against the request. */
  location: URL | null;
}

export interface SignInOptions {
  /** The page to come back to, sent as `/login?next=…`. */
  next?: string;
  /** Press Cancel on Discord's authorize page instead of Authorize. */
  cancel?: boolean;
}

export interface PageRequest {
  method?: string;
  headers?: Record<string, string>;
  /**
   * A form body, sent as `application/x-www-form-urlencoded`; a list sends
   * the field once per value, as checked boxes of one name do.
   */
  form?: Record<string, string | string[]>;
}

export class PageClient {
  /** Cookies by name, as the Worker last set them. */
  readonly cookies = new Map<string, string>();

  /** `base` is where the Worker listens, such as `e2e.url`. */
  constructor(private readonly base: URL) {}

  get(path: string): Promise<PageResponse> {
    return this.request(path);
  }

  /**
   * Signs in as the fake Discord user `user` (added with
   * `discord.addUser`), walking the redirects a browser follows: `/login`,
   * Discord's authorize page, then the Worker's `/auth/callback`, whose
   * answer it returns (a redirect into the site once signed in, or the
   * cancelled page with `cancel`).
   */
  async signIn(
    user: { id: string },
    options: SignInOptions = {},
  ): Promise<PageResponse> {
    return this.get(await this.authorize(user, options));
  }

  /**
   * Takes the first two steps of `signIn`, `/login` and Discord's authorize
   * page, and returns the path and query of the Worker's callback without
   * requesting it; the state cookie it needs is in `cookies`. The callback
   * address names the Worker's `PUBLIC_URL`, so this returns its path and
   * query, for the Worker under test.
   */
  async authorize(
    user: { id: string },
    options: SignInOptions = {},
  ): Promise<string> {
    const login = await this.get(
      options.next === undefined
        ? "/login"
        : `/login?next=${encodeURIComponent(options.next)}`,
    );
    if (login.status !== 303 || !login.location) {
      throw new Error(`GET /login answered ${String(login.status)}`);
    }
    const discordCookies = [`${DISCORD_USER_COOKIE}=${user.id}`];
    if (options.cancel) discordCookies.push(`${DISCORD_CONSENT_COOKIE}=deny`);
    const authorize = await fetch(login.location, {
      headers: { Cookie: discordCookies.join("; ") },
      redirect: "manual",
    });
    const back = authorize.headers.get("Location");
    if (authorize.status !== 302 || back === null) {
      throw new Error(
        `Discord's authorize page answered ${String(authorize.status)}: ${await authorize.text()}`,
      );
    }
    const callback = new URL(back);
    return callback.pathname + callback.search;
  }

  /**
   * Submits the form of `page` whose `action` is `action`, with its fields
   * (hidden ones included) and `fields` over them, as a browser would: a
   * POST from the page's own origin. Give a list for a field sent once per
   * value, such as the ticked boxes of a vote.
   */
  submitForm(
    page: PageResponse,
    action: string,
    fields: Record<string, string | string[]> = {},
  ): Promise<PageResponse> {
    const found = formFields(page.body, action);
    if (!found) {
      throw new Error(`the page ${page.url.pathname} has no form to ${action}`);
    }
    return this.request(new URL(action, page.url).pathname, {
      form: { ...found, ...fields },
      headers: { Origin: page.url.origin, "Sec-Fetch-Site": "same-origin" },
    });
  }

  async request(path: string, init: PageRequest = {}): Promise<PageResponse> {
    const url = new URL(path, this.base);
    const headers = new Headers(init.headers);
    const cookie = this.cookieHeader();
    if (cookie) headers.set("Cookie", cookie);
    let body: string | undefined;
    if (init.form) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
      body = new URLSearchParams(
        Object.entries(init.form).flatMap(([name, value]) =>
          (Array.isArray(value) ? value : [value]).map(
            (one): [string, string] => [name, one],
          ),
        ),
      ).toString();
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
      url,
      status: response.status,
      headers: response.headers,
      body: await response.text(),
      location: location === null ? null : new URL(location, url),
    };
  }

  /** The `Cookie` header the client sends: every cookie in the jar. */
  cookieHeader(): string {
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

/**
 * The named inputs and their values of the first `<form>` in `html` whose
 * `action` is `action`, or null when there is none.
 */
export function formFields(
  html: string,
  action: string,
): Record<string, string> | null {
  for (const [, attributes = "", inner = ""] of html.matchAll(
    /<form\b([^>]*)>([\s\S]*?)<\/form>/g,
  )) {
    if (attribute(attributes, "action") !== action) continue;
    const fields: Record<string, string> = {};
    for (const [tag] of inner.matchAll(/<input\b[^>]*>/g)) {
      const name = attribute(tag, "name");
      if (name !== null) fields[name] = attribute(tag, "value") ?? "";
    }
    return fields;
  }
  return null;
}

/** The value of attribute `name` in an HTML tag, entities decoded. */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  if (!match) return null;
  return (match[1] ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** The `href` of each stylesheet link in a page's HTML. */
export function stylesheetLinks(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /\brel="stylesheet"/.test(tag))
    .map((tag) => /\bhref="([^"]*)"/.exec(tag)?.[1] ?? "");
}

/**
 * `html` without Cairn's own modules (the press script every page loads,
 * and the ages script of a page with an age), so a check for any other
 * script, such as one injected through a member's text, finds only that.
 */
export function withoutCairnScripts(html: string): string {
  return html.replace(
    /<script type="module" src="\/assets\/v\/[\w-]+\/cairn\/(press|ages)\.mjs"><\/script>/g,
    "",
  );
}
