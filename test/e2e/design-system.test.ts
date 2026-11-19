/**
 * The Cairn design system as a browser gets it from the real bundle: the
 * style guide, the landing page and the 404 page carry the security
 * headers, load their stylesheet, imports, pattern and font from the
 * Worker's own origin, cacheable for a year, and reference no other host.
 */
import { describe, expect, it } from "vitest";
import { PageClient, stylesheetLinks } from "./harness/web";
import { useE2E } from "./harness/worker";

const e2e = useE2E();

const CSP =
  "default-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self' data: https://cdn.discordapp.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const IMMUTABLE = "public, max-age=31536000, immutable";

const PAGES = [
  { path: "/styleguide", status: 200, title: "Style guide · hikebot" },
  {
    path: "/styleguide/tally-vote",
    status: 200,
    title: "Tally vote · Style guide · hikebot",
  },
  { path: "/", status: 200, title: "hikebot" },
  { path: "/no-such-page", status: 404, title: "Page not found · hikebot" },
];

/** Every URL a page or stylesheet loads: src, srcset, link href, url(). */
function loadedUrls(text: string): string[] {
  const urls: string[] = [];
  for (const [, url = ""] of text.matchAll(
    /\s(?:src|srcset|poster)="([^"]*)"/g,
  )) {
    urls.push(url);
  }
  for (const [tag] of text.matchAll(/<link\b[^>]*>/g)) {
    const href = /\shref="([^"]*)"/.exec(tag)?.[1];
    if (href !== undefined) urls.push(href);
  }
  for (const [, url = ""] of text.matchAll(
    /url\(\s*["']?([^"')]+)["']?\s*\)/g,
  )) {
    urls.push(url);
  }
  return urls;
}

/** The files a stylesheet imports or refers to, resolved against it. */
function cssReferences(css: string, base: string): string[] {
  return loadedUrls(css).map((url) => new URL(url, base).pathname);
}

/**
 * The stylesheet and every file it loads, directly or through imports,
 * as paths on the Worker's origin; fails on a file that is not served.
 */
async function stylesheetFiles(
  client: PageClient,
  stylesheet: string,
): Promise<string[]> {
  const pending = [stylesheet];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop() ?? "";
    if (seen.has(file)) continue;
    seen.add(file);
    const response = await client.get(file);
    expect(response.status, file).toBe(200);
    for (const url of loadedUrls(response.body)) {
      expect(url, `${file} loads ${url}`).not.toMatch(/^(https?:)?\/\//);
    }
    if (file.endsWith(".css")) {
      pending.push(
        ...cssReferences(response.body, new URL(file, e2e.url).href),
      );
    }
  }
  return [...seen];
}

describe.each(PAGES)("$path", ({ path, status, title }) => {
  it("answers with its status and every security header", async () => {
    const page = await new PageClient(e2e.url).get(path);
    expect(page.status).toBe(status);
    expect(Object.fromEntries(page.headers)).toMatchObject({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      "cache-control": "no-store",
    });
    expect(page.body).toContain(`<title>${title}</title>`);
    expect(page.body).not.toMatch(/<script|<style|\sstyle=|\son[a-z]+=/i);
  });

  it("loads nothing from another origin", async () => {
    const client = new PageClient(e2e.url);
    const page = await client.get(path);
    const urls = loadedUrls(page.body);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url, url).toMatch(/^\/[^/]/);
    const [stylesheet = ""] = stylesheetLinks(page.body);
    const seen = await stylesheetFiles(client, stylesheet);
    expect(seen.some((file) => file.endsWith(".woff2"))).toBe(true);
  });
});

describe("the design system's files", () => {
  it("serve the stylesheet, its imports, the pattern and the font for a year", async () => {
    const client = new PageClient(e2e.url);
    const page = await client.get("/styleguide");
    const [stylesheet = ""] = stylesheetLinks(page.body);
    const files = await stylesheetFiles(client, stylesheet);
    const types = new Map<string, string>();
    for (const file of files) {
      const response = await client.get(file);
      expect(response.status, file).toBe(200);
      expect(response.headers.get("cache-control"), file).toBe(IMMUTABLE);
      expect(response.headers.get("x-content-type-options"), file).toBe(
        "nosniff",
      );
      types.set(
        file.replace(/^.*\./, ""),
        response.headers.get("content-type") ?? "",
      );
    }
    expect(Object.fromEntries(types)).toEqual({
      css: "text/css; charset=utf-8",
      svg: "image/svg+xml",
      woff2: "font/woff2",
    });
  });

  it("preload the font file the stylesheet uses", async () => {
    const client = new PageClient(e2e.url);
    const page = await client.get("/");
    const preload =
      /<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin="anonymous"\/>/.exec(
        page.body,
      )?.[1];
    expect(preload).toMatch(
      /^\/assets\/v\/[\w-]+\/fonts\/public-sans-[\d.]+-latin-wght-normal\.woff2$/,
    );
    const [stylesheet = ""] = stylesheetLinks(page.body);
    expect(await stylesheetFiles(client, stylesheet)).toContain(preload);
  });
});

describe("the style guide's hike components", () => {
  const COMPONENTS = [
    ["empty-state", "Empty state", '<section class="empty-state"'],
    ["hike-card", "Hike card", '<article class="hike-card hike-card--full'],
    ["round-stepper", "Round stepper", 'aria-current="step"'],
    ["status-pill", "Status pill", "status-pill--cancelled"],
    ["tally-list", "Tally list", '<ol class="tally-list__rows"'],
    ["tally-row", "Tally row", '<p class="tally-row__tie">'],
    ["tally-vote", "Tally vote", '<form class="tally-vote" method="post"'],
  ];

  it("lists every hike component, each linking to its own page", async () => {
    const page = await new PageClient(e2e.url).get("/styleguide");
    for (const [id = "", title = ""] of COMPONENTS) {
      expect(page.body).toContain(`<a href="/styleguide/${id}">${title}</a>`);
    }
  });

  it.each(COMPONENTS)(
    "shows %s in its states on /styleguide/%s",
    async (id, title, marker) => {
      const page = await new PageClient(e2e.url).get(`/styleguide/${id}`);
      expect(page.status).toBe(200);
      expect(page.body).toContain(
        `<title>${title} · Style guide · hikebot</title>`,
      );
      expect(page.body).toContain(
        `<section class="styleguide-section" id="${id}"`,
      );
      expect(page.body).toContain(marker);
    },
  );

  it("shows the 25-option votable tally as a form that posts without JavaScript", async () => {
    const page = await new PageClient(e2e.url).get("/styleguide/tally-vote");
    const forms = page.body.split('<form class="tally-vote"').slice(1);
    const longest =
      forms
        .map((form) => form.slice(0, form.indexOf("</form>")))
        .sort((a, b) => b.length - a.length)[0] ?? "";
    expect(longest.match(/type="checkbox"/g)).toHaveLength(25);
    expect(longest).toContain('type="submit"');
    expect(page.body).not.toMatch(/<script/);
  });

  it("answers 404 for a section without a page of its own", async () => {
    const page = await new PageClient(e2e.url).get("/styleguide/colour");
    expect(page.status).toBe(404);
  });
});
