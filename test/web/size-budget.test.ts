import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { FONT, STYLESHEET } from "../../src/web/assets";
import { STYLESHEET_PATHS } from "./design-files";

/** The budgets "Size budget" in docs/design-system.md states, in bytes. */
const BUDGET = {
  font: 32 * 1024,
  stylesheetsGzip: 24 * 1024,
  contours: 12 * 1024,
  /** Everything a page loads from the design system, as transferred. */
  total: 64 * 1024,
};

async function bytes(file: string): Promise<Uint8Array> {
  const response = await env.ASSETS.fetch(
    `https://hikebot.example/assets/${file}`,
  );
  expect(response.status, file).toBe(200);
  return new Uint8Array(await response.arrayBuffer());
}

async function gzipSize(data: Uint8Array): Promise<number> {
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

describe("the size budget", () => {
  it("keeps the font file within 32 KB", async () => {
    expect((await bytes(FONT)).byteLength).toBeLessThanOrEqual(BUDGET.font);
  });

  it("keeps the contour pattern within 12 KB", async () => {
    expect((await bytes("cairn/contours.svg")).byteLength).toBeLessThanOrEqual(
      BUDGET.contours,
    );
  });

  it("keeps every stylesheet together within 24 KB gzipped, and a page within 64 KB", async () => {
    const files = STYLESHEET_PATHS.map((path) =>
      path.replace(/^public\/assets\//, ""),
    );
    expect(files).toContain(STYLESHEET);
    let css = 0;
    for (const file of files) css += await gzipSize(await bytes(file));
    expect(css).toBeLessThanOrEqual(BUDGET.stylesheetsGzip);
    const font = (await bytes(FONT)).byteLength;
    const contours = await gzipSize(await bytes("cairn/contours.svg"));
    expect(css + font + contours).toBeLessThanOrEqual(BUDGET.total);
  });

  it("names the font file after the package version it was copied from", async () => {
    const { devDependencies } = (await import("../../package.json")) as {
      devDependencies: Record<string, string>;
    };
    const version = devDependencies["@fontsource-variable/public-sans"] ?? "";
    expect(FONT).toBe(`fonts/public-sans-${version}-latin-wght-normal.woff2`);
  });
});
