/**
 * Cairn's press and motion rules in its stylesheets ("States" and
 * "Motion" in docs/design-system.md): no transition eases a colour (a
 * transition names only `opacity` or `transform`, always with a property
 * list), and every `:active` rule has its `[data-pressed]` twin in the
 * same selector, so a press shows with a finger as soon as it lands.
 */
import { describe, expect, it } from "vitest";
import { publicText, STYLESHEET_PATHS } from "./design-files";
import { findEasedColours, findPressWithoutTwin } from "./press-states";

describe("Cairn's stylesheets", () => {
  it("cover every component", () => {
    expect(STYLESHEET_PATHS).toContain(
      "public/assets/cairn/components/button.css",
    );
    expect(STYLESHEET_PATHS).toContain("public/assets/cairn/cairn.css");
  });

  it.each(STYLESHEET_PATHS)("%s eases no colour", async (path) => {
    expect(findEasedColours(await publicText(path))).toEqual([]);
  });

  it.each(STYLESHEET_PATHS)(
    "%s gives every :active its [data-pressed] twin",
    async (path) => {
      expect(findPressWithoutTwin(await publicText(path))).toEqual([]);
    },
  );
});

describe("the checks themselves", () => {
  it("find a transition on a colour, a shorthand, all, or no property list", () => {
    const css = [
      ".a { transition: background-color 120ms; }",
      ".b { transition-property: border-color, transform; }",
      ".c { transition: all var(--duration-quick); }",
      ".d { transition-duration: var(--duration-quick); }",
      ".e { transition: color var(--duration-quick), opacity 1s; }",
      ".f { transition: transform var(--duration-quick) var(--easing-standard); }",
      ".g { transition-property: opacity, transform; transition-duration: 1s; }",
      ".h { transition: background 120ms; }",
    ].join("\n");
    expect(findEasedColours(css).map(({ line }) => line)).toEqual([
      1, 2, 3, 4, 5, 8,
    ]);
  });

  it("finds an :active with no [data-pressed] in its selector", () => {
    const css = [
      ".a:active { color: red; }",
      ".b:where(:active, [data-pressed]) { color: red; }",
      ".c:where(:active, [data-preview='active']),",
      ".d:hover { color: red; }",
      "/* :active in a comment */",
      ".e:where(",
      "  :active,",
      "  [data-pressed]",
      ") { color: red; }",
    ].join("\n");
    expect(findPressWithoutTwin(css).map(({ line }) => line)).toEqual([1, 3]);
  });
});
