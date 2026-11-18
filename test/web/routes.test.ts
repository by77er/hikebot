import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { assetPath, FONT, STYLESHEET } from "../../src/web/assets";
import { sessionCookie } from "../../src/web/auth/session";
import { STYLEGUIDE_SECTIONS } from "../../src/web/pages/styleguide";
import { webRouter } from "../../src/web/routes";
import {
  clearBucket,
  manifestOf,
  putManifest,
  putSample,
  sampleArchive,
} from "../maps/helpers";
import { decodePng } from "../maps/png";
import { EXPECTED_PAGE_HEADERS, outline, pageHeaders } from "./helpers";

function get(
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
): Promise<Response> {
  return webRouter.handle(
    new Request(`https://hikebot.example${path}`, { method, headers }),
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
      stylesheets: [assetPath(STYLESHEET)],
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

  it("offers sign-in with Discord and says what hikebot learns", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain('<a href="/login">Sign in with Discord</a>');
    expect((await outline(html)).text.replace(/\s+/g, " ")).toContain(
      "Signing in tells hikebot your Discord name and avatar, and which of your servers hikebot is in.",
    );
  });

  it("sends someone signed in to /servers", async () => {
    const cookie = await sessionCookie(env, {
      userId: "400000000000000001",
      name: "Ana",
      avatar: null,
      guilds: [],
      issuedAt: Date.now(),
    });
    const response = await get("/", "GET", {
      Cookie: cookie.split(";")[0] ?? "",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/servers");
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
      expect(page.stylesheets).toEqual([assetPath(STYLESHEET)]);
      expect(page.elements).toEqual(
        expect.arrayContaining(["header", "main", "footer"]),
      );
    },
  );
});

describe("static assets", () => {
  it("serves a stylesheet at its plain path, cacheable for five minutes", async () => {
    const response = await get("/assets/cairn/cairn.css");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/css; charset=utf-8",
    );
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(response.headers.get("ETag")).toBeTruthy();
    expect(await response.text()).toContain("@layer");
  });

  it("serves the stylesheet from the assets binding", async () => {
    const response = await env.ASSETS.fetch(
      "https://hikebot.example/assets/cairn/cairn.css",
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

describe("GET /maps/sample.png", () => {
  beforeEach(async () => {
    await clearBucket();
  });

  it("answers the sample point's map picture as a PNG", async () => {
    await putSample("builds/test/region.pmtiles");
    await putManifest(manifestOf([sampleArchive()]));
    const response = await get("/maps/sample.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const png = await decodePng(new Uint8Array(await response.arrayBuffer()));
    expect([png.width, png.height]).toEqual([1200, 800]);
  });

  it("answers the HTML 404 page while there is no map data", async () => {
    const response = await get("/maps/sample.png");
    expect(response.status).toBe(404);
    expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
  });
});

describe("versioned assets", () => {
  it("serves the stylesheet the pages link, cacheable for a year", async () => {
    expect(assetPath(STYLESHEET)).toBe("/assets/v/dev/cairn/cairn.css");
    const response = await get(assetPath(STYLESHEET));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/css; charset=utf-8",
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toContain('@import url("tokens.css")');
  });

  it("serves the files the stylesheet imports, under the same version", async () => {
    for (const file of [
      "cairn/tokens.css",
      "cairn/components/button.css",
      "cairn/contours.svg",
      FONT,
    ]) {
      const response = await get(assetPath(file));
      expect(response.status, file).toBe(200);
      expect(response.headers.get("Cache-Control"), file).toBe(
        "public, max-age=31536000, immutable",
      );
      await response.arrayBuffer();
    }
  });

  it("serves the font as woff2", async () => {
    const response = await get(assetPath(FONT));
    expect(response.headers.get("Content-Type")).toBe("font/woff2");
    await response.arrayBuffer();
  });

  it.each([
    "/assets/v/dev/cairn/missing.css",
    "/assets/v/dev/",
    "/assets/v/not%20a%20version/cairn/cairn.css",
  ])("answers %s with the HTML 404 page", async (path) => {
    const response = await get(path);
    expect(response.status).toBe(404);
    expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
  });

  it("preloads the font every page uses", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain(
      `<link rel="preload" href="${assetPath(FONT)}" as="font" type="font/woff2" crossorigin="anonymous"/>`,
    );
  });
});

describe("GET /styleguide", () => {
  it("is a public page in the page shell, at the overview width", async () => {
    const response = await get("/styleguide");
    expect(response.status).toBe(200);
    expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
    const html = await response.text();
    const page = await outline(html);
    expect(page).toMatchObject({
      title: "Style guide · hikebot",
      stylesheets: [assetPath(STYLESHEET)],
      scripts: 0,
      styleElements: 0,
      styleAttributes: 0,
      eventAttributes: 0,
    });
    expect(html).toContain('<body class="shell shell--overview">');
  });

  it("shows every token section and every component section", async () => {
    const html = await (await get("/styleguide")).text();
    const ids = STYLEGUIDE_SECTIONS.map(({ id }) => id);
    expect(ids).toEqual(
      expect.arrayContaining(["colour", "contrast", "typography", "button"]),
    );
    for (const id of ids) {
      expect(html).toContain(`<section class="styleguide-section" id="${id}"`);
      expect(html).toContain(`<a href="#${id}">`);
    }
  });

  it("shows each colour token with its values and each pairing's ratios", async () => {
    const text = (await outline(await (await get("/styleguide")).text())).text;
    expect(text).toContain("--color-primary");
    expect(text).toContain("#1f5d45 · #7cc4a0");
    expect(text).toMatch(/\d+\.\d\d light/);
    expect(text).not.toContain("fails");
  });

  it("shows every button variant in every state, as a button and a link", async () => {
    const html = await (await get("/styleguide")).text();
    for (const variant of ["primary", "secondary", "quiet", "danger"]) {
      for (const tag of ["<button", "<a"]) {
        const pattern = new RegExp(
          `${tag} class="button button--${variant}"[^>]*>`,
          "g",
        );
        const states = [...html.matchAll(pattern)].map(
          ([element]) =>
            /data-preview="(\w+)"/.exec(element)?.[1] ??
            (/disabled/.test(element) ? "disabled" : "default"),
        );
        expect(new Set(states), `${variant} ${tag}`).toEqual(
          new Set(["default", "hover", "focus", "active", "disabled"]),
        );
      }
    }
  });
});
