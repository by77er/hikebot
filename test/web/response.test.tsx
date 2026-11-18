import { describe, expect, it } from "vitest";
import { Layout } from "../../src/web/layout";
import { htmlResponse } from "../../src/web/response";
import { EXPECTED_PAGE_HEADERS, outline, pageHeaders } from "./helpers";

const ATTACK = "<script>alert(1)</script>";

describe("htmlResponse", () => {
  it("sets the content type and every security header", () => {
    const response = htmlResponse(<Layout title="Test">text</Layout>);
    expect(response.status).toBe(200);
    expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
  });

  it("allows no inline code and no third-party host but Discord's CDN for images", () => {
    const csp =
      htmlResponse(<Layout title="Test">text</Layout>).headers.get(
        "Content-Security-Policy",
      ) ?? "";
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    const hosts = csp.match(/https?:\/\/[^\s;]+/g);
    expect(hosts).toEqual(["https://cdn.discordapp.com"]);
    expect(csp).toMatch(
      /(^|; )img-src 'self' data: https:\/\/cdn\.discordapp\.com(;|$)/,
    );
  });

  it("keeps extra headers and the status, but not over the page headers", () => {
    const response = htmlResponse(<Layout title="Test">text</Layout>, {
      status: 418,
      headers: { Allow: "GET", "Cache-Control": "public, max-age=60" },
    });
    expect(response.status).toBe(418);
    expect(response.headers.get("Allow")).toBe("GET");
    expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
  });

  it("starts with the doctype", async () => {
    const html = await htmlResponse(<Layout title="Test">text</Layout>).text();
    expect(html.startsWith("<!doctype html><html")).toBe(true);
  });

  it("escapes text passed into the title and the body", async () => {
    const html = await htmlResponse(
      <Layout title={ATTACK}>
        <p>{ATTACK}</p>
        <a href={`/search?q=${ATTACK}"`}>{ATTACK}</a>
      </Layout>,
    ).text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
    const page = await outline(html);
    expect(page.scripts).toBe(0);
    expect(page.title).toBe("&lt;script>alert(1)&lt;/script>");
    expect(page.text).toContain("&lt;script>alert(1)&lt;/script>");
    expect(html).toContain(
      'href="/search?q=&lt;script>alert(1)&lt;/script>&quot;"',
    );
  });
});
