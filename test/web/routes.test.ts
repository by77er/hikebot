import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { webRouter } from "../../src/web/routes";
import { EXPECTED_PAGE_HEADERS, outline, pageHeaders } from "./helpers";

function get(path: string, method = "GET"): Promise<Response> {
  return webRouter.handle(
    new Request(`https://hikebot.example${path}`, { method }),
    env,
    createExecutionContext(),
  );
}

describe("GET /", () => {
  it("is the landing page in the page shell", async () => {
    const response = await get("/");
    expect(response.status).toBe(200);
    expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
    const page = await outline(await response.text());
    expect(page).toMatchObject({
      doctype: "html",
      lang: "en",
      title: "hikebot",
      viewport: "width=device-width, initial-scale=1",
      stylesheets: ["/assets/app.css"],
      firstLink: "#main",
      mainId: "main",
      scripts: 0,
      styleElements: 0,
      styleAttributes: 0,
      eventAttributes: 0,
    });
    const landmarks = page.elements.filter((name) =>
      ["header", "main", "footer"].includes(name),
    );
    expect(landmarks).toEqual(["header", "main", "footer"]);
    expect(page.text).toContain("Skip to main content");
    expect(page.text).toContain("Discord bot");
    expect(page.elements).toContain("h1");
  });

  it("links the project", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain('href="https://github.com/by77er/hikebot"');
  });

  it("answers HEAD with the headers and no body", async () => {
    const response = await get("/", "HEAD");
    expect(response.status).toBe(200);
    expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
    expect(await response.text()).toBe("");
  });

  it("answers POST with the 405 page and Allow", async () => {
    const response = await get("/", "POST");
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
    expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
    expect((await outline(await response.text())).title).toBe(
      "Method not allowed · hikebot",
    );
  });
});

describe("GET /healthz", () => {
  it("answers the plain-text health line", async () => {
    const response = await get("/healthz");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await response.text()).toBe("hikebot is running\n");
  });

  it("answers HEAD with 200 and no body", async () => {
    const response = await get("/healthz", "HEAD");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});

describe("unknown paths", () => {
  it.each(["/nope", "/healthz/", "/index.html", "/assets/missing.css"])(
    "answer %s with the HTML 404 page",
    async (path) => {
      const response = await get(path);
      expect(response.status).toBe(404);
      expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
      const page = await outline(await response.text());
      expect(page.title).toBe("Page not found · hikebot");
      expect(page.stylesheets).toEqual(["/assets/app.css"]);
      expect(page.elements).toEqual(
        expect.arrayContaining(["header", "main", "footer"]),
      );
    },
  );
});

describe("static assets", () => {
  it("serves the stylesheet the pages link, cacheable for five minutes", async () => {
    const response = await get("/assets/app.css");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/css; charset=utf-8",
    );
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(response.headers.get("ETag")).toBeTruthy();
    expect(await response.text()).toContain("font-family");
  });

  it("serves the stylesheet from the assets binding", async () => {
    const response = await env.ASSETS.fetch(
      "https://hikebot.example/assets/app.css",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/css; charset=utf-8",
    );
    await response.arrayBuffer();
  });

  it("does not serve the rule and procedure files next to the assets", async () => {
    for (const path of [
      "/_headers",
      "/.assetsignore",
      "/AGENTS.md",
      "/UNDERCURRENT.md",
    ]) {
      const response = await env.ASSETS.fetch(`https://hikebot.example${path}`);
      expect(response.status, path).toBe(404);
      await response.arrayBuffer();
    }
  });
});
