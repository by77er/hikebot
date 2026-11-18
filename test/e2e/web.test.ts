/**
 * The Worker's web pages as a browser gets them from the real bundle: the
 * landing page and the stylesheet it links, the health line, and the HTML
 * 404 page.
 */
import { describe, expect, it } from "vitest";
import { PageClient, stylesheetLinks } from "./harness/web";
import { useE2E } from "./harness/worker";

const e2e = useE2E();

const CSP =
  "default-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self' data: https://cdn.discordapp.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function expectPageHeaders(headers: Headers): void {
  expect(Object.fromEntries(headers)).toMatchObject({
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "strict-transport-security": expect.stringMatching(/^max-age=\d+/),
    "cache-control": "no-store",
  });
}

describe("the landing page", () => {
  it("is a whole HTML page with no inline script or style", async () => {
    const page = await new PageClient(e2e.url).get("/");
    expect(page.status).toBe(200);
    expectPageHeaders(page.headers);
    expect(page.body).toMatch(/^<!doctype html><html lang="en">/);
    expect(page.body).toContain("<title>hikebot</title>");
    expect(page.body).toContain('<a class="skip-link" href="#main">');
    for (const tag of ["<header>", '<main id="main">', "<footer>"]) {
      expect(page.body).toContain(tag);
    }
    expect(page.body).not.toMatch(/<script|<style|\sstyle=|\son[a-z]+=/i);
  });

  it("links a stylesheet the Worker serves as cacheable CSS", async () => {
    const client = new PageClient(e2e.url);
    const page = await client.get("/");
    const [href, ...others] = stylesheetLinks(page.body);
    expect(others).toEqual([]);
    expect(href).toMatch(/^\/assets\//);
    const css = await client.get(href ?? "");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(css.headers.get("cache-control")).toBe("public, max-age=300");
    expect(css.body).toContain("font-family");
  });
});

describe("the health line", () => {
  it("answers GET /healthz", async () => {
    const health = await new PageClient(e2e.url).get("/healthz");
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(health.body).toBe("hikebot is running\n");
  });

  it("answers HEAD /healthz with no body", async () => {
    const health = await new PageClient(e2e.url).request("/healthz", {
      method: "HEAD",
    });
    expect(health.status).toBe(200);
    expect(health.body).toBe("");
  });
});

describe("unknown paths", () => {
  it.each(["/nope", "/assets/missing.css", "/UNDERCURRENT.md", "/_headers"])(
    "answer %s with the HTML 404 page",
    async (path) => {
      const page = await new PageClient(e2e.url).get(path);
      expect(page.status).toBe(404);
      expectPageHeaders(page.headers);
      expect(page.body).toContain("<title>Page not found · hikebot</title>");
      expect(page.body).toContain('<main id="main">');
    },
  );

  it("answers a wrong method with 405 and Allow", async () => {
    const page = await new PageClient(e2e.url).request("/", {
      method: "POST",
      form: { anything: "1" },
    });
    expect(page.status).toBe(405);
    expect(page.headers.get("allow")).toBe("GET, HEAD");
    expectPageHeaders(page.headers);
  });
});
