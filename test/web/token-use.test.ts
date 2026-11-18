import { describe, expect, it } from "vitest";
import {
  publicText,
  STYLESHEET_PATHS,
  TOKENS_FILE,
  WEB_SOURCES,
} from "./design-files";
import { findRawValues, findRawColoursInMarkup } from "./token-use";

/** Layout, component and page CSS: values only through tokens. */
const TOKEN_ONLY = STYLESHEET_PATHS.filter(
  (path) =>
    path === "public/assets/cairn/layout.css" ||
    path.startsWith("public/assets/cairn/components/") ||
    path.startsWith("public/assets/cairn/pages/"),
);

describe("token-only CSS", () => {
  it("covers the layout and every component and page stylesheet", () => {
    expect(TOKEN_ONLY).toContain("public/assets/cairn/layout.css");
    expect(TOKEN_ONLY).toContain("public/assets/cairn/components/button.css");
  });

  it.each(TOKEN_ONLY)(
    "%s uses tokens for every colour, size, duration and font",
    async (path) => {
      expect(findRawValues(await publicText(path), "all")).toEqual([]);
    },
  );

  it.each(STYLESHEET_PATHS.filter((path) => path !== TOKENS_FILE))(
    "%s has no raw colour; only tokens.css does",
    async (path) => {
      expect(findRawValues(await publicText(path), "colours")).toEqual([]);
    },
  );

  it.each(Object.keys(WEB_SOURCES))(
    "%s puts no raw colour in a style, fill or stroke attribute",
    (path) => {
      expect(findRawColoursInMarkup(WEB_SOURCES[path] ?? "")).toEqual([]);
    },
  );
});

describe("the check itself", () => {
  it("finds raw colours, sizes, durations and fonts", () => {
    const css = [
      ".a { color: #fff; }",
      ".b { background: rgb(0 0 0 / 0.5); }",
      ".c { border-color: rebeccapurple; }",
      ".d { padding: 12px var(--space-2); }",
      ".e { transition-duration: 200ms; }",
      ".f { font-family: Georgia, serif; }",
      ".g { margin: 1.5rem; }",
    ].join("\n");
    expect(findRawValues(css, "all").map(({ line }) => line)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("allows tokens, keywords, unitless numbers, percentages and media queries", () => {
    const css = [
      "@media (min-width: 48rem) {",
      "  .a { color: var(--color-text); border-color: transparent; }",
      "  .b { width: 100%; flex: 1; z-index: 1; stroke: currentColor; }",
      "  .c { margin: 0; line-height: var(--line-height-body); }",
      "}",
    ].join("\n");
    expect(findRawValues(css, "all")).toEqual([]);
  });

  it("finds a raw colour in a style, fill or stroke attribute", () => {
    expect(
      findRawColoursInMarkup(
        [
          '<p style={{ color: "#c00" }}>',
          '<svg fill="#000">',
          '<path stroke="rgb(0, 0, 0)" />',
          '<a href="#main">',
          '<svg fill="none" stroke="currentColor">',
        ].join("\n"),
      ).map(({ line }) => line),
    ).toEqual([1, 2, 3]);
  });
});
