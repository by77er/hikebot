import { beforeAll, describe, expect, it } from "vitest";
import {
  checkPairings,
  colourTokens,
  contrastRatio,
  PAIRINGS,
  parseTokens,
} from "../../src/web/tokens";
import { publicText, TOKENS_FILE } from "./design-files";

describe("contrastRatio", () => {
  it("gives WCAG's ratios for known colours", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("rejects a value that is not #rrggbb", () => {
    expect(() => contrastRatio("red", "#ffffff")).toThrow(/#rrggbb/);
  });
});

describe("the tokens in tokens.css", () => {
  let css = "";
  let tokens: ReturnType<typeof parseTokens>;
  beforeAll(async () => {
    css = await publicText(TOKENS_FILE);
    tokens = parseTokens(css);
  });

  it("define every colour role in both schemes, as #rrggbb", () => {
    const light = colourTokens(tokens.light);
    expect(light.length).toBeGreaterThan(20);
    const dark = parseTokens(css.replace(/:root\s*\{[^}]*\}/, ":root {}")).dark;
    for (const [name, value] of light) {
      expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark[name], `${name} has no dark value`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(["light", "dark"] as const)(
    "meet the minimum contrast of every allowed pairing in the %s scheme",
    (scheme) => {
      const failures = checkPairings(tokens)
        .filter((result) => result.scheme === scheme && !result.passes)
        .map(
          ({ foreground, background, ratio, minimum, use }) =>
            `${use}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, below ${String(minimum)}:1`,
        );
      expect(failures).toEqual([]);
    },
  );

  it("check text at 4.5:1 and large text, boundaries, focus and the blaze at 3:1", () => {
    const minimums = new Set(
      checkPairings(tokens).map(
        ({ kind, minimum }) => `${kind} ${String(minimum)}`,
      ),
    );
    expect([...minimums].sort()).toEqual([
      "large-text 3",
      "non-text 3",
      "text 4.5",
    ]);
    const uses = new Set(PAIRINGS.map(({ use }) => use));
    for (const use of ["Body text", "Control boundary", "Focus ring"]) {
      expect(uses).toContain(use);
    }
  });

  it("cover the form controls on the backgrounds forms sit on, in both schemes", () => {
    const results = checkPairings(tokens);
    const expected = [
      ["color-border-strong", "non-text", "control boundary"],
      ["color-danger", "non-text", "field in error"],
      ["color-primary", "non-text", "checked box and radio"],
      ["color-on-primary", "text", "tick on a checked box"],
      ["color-text-muted", "text", "hint and limit"],
      ["color-danger", "text", "error text"],
      ["color-text", "text", "label and typed text"],
    ] as const;
    for (const [foreground, kind, what] of expected) {
      const backgrounds =
        foreground === "color-on-primary"
          ? ["color-primary"]
          : ["color-bg", "color-surface"];
      for (const background of backgrounds) {
        for (const scheme of ["light", "dark"] as const) {
          const result = results.find(
            (r) =>
              r.scheme === scheme &&
              r.foreground === foreground &&
              r.background === background &&
              r.kind === kind,
          );
          expect(
            result,
            `${what}: ${foreground} on ${background}, ${scheme}`,
          ).toBeDefined();
          expect(result?.minimum).toBe(kind === "text" ? 4.5 : 3);
          expect(result?.passes, `${what}, ${scheme}`).toBe(true);
        }
      }
    }
  });

  it("fail the check when a token changes to a value with too little contrast", () => {
    const paler = css.replace(
      /--color-text-muted: #[0-9a-f]{6};/,
      "--color-text-muted: #9aa39e;",
    );
    const failing = checkPairings(parseTokens(paler)).filter(
      (result) => !result.passes,
    );
    expect(
      failing.map(({ scheme, foreground }) => `${scheme} ${foreground}`),
    ).toContain("light color-text-muted");
  });
});

/** `top` drawn at `opacity` over `bottom`, both `#rrggbb`. */
function blend(top: string, bottom: string, opacity: number): string {
  const channels = [0, 1, 2].map((index) => {
    const at = 1 + index * 2;
    const a = parseInt(top.slice(at, at + 2), 16);
    const b = parseInt(bottom.slice(at, at + 2), 16);
    return Math.round(a * opacity + b * (1 - opacity))
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

describe("the empty state on the contour pattern", () => {
  let tokens: ReturnType<typeof parseTokens>;
  beforeAll(async () => {
    tokens = parseTokens(await publicText(TOKENS_FILE));
  });

  it.each(["light", "dark"] as const)(
    "keeps its text, the focus ring and the button boundary within the minimums where a line crosses it, in the %s scheme",
    (scheme) => {
      const values = tokens[scheme];
      const opacity = Number(values["contour-opacity"]);
      expect(opacity).toBeGreaterThan(0);
      const line = blend(
        values["color-contour"] ?? "",
        values["color-bg"] ?? "",
        opacity,
      );
      const checks: [string, number][] = [
        ["color-text", 4.5],
        ["color-text-muted", 4.5],
        ["color-border-strong", 3],
        ["color-focus", 3],
        ["color-primary", 3],
      ];
      const failures = checks
        .map(([token, minimum]) => ({
          token,
          minimum,
          ratio: contrastRatio(values[token] ?? "", line),
        }))
        .filter(({ ratio, minimum }) => ratio < minimum)
        .map(
          ({ token, ratio, minimum }) =>
            `${token} on a contour line is ${ratio.toFixed(2)}:1, below ${String(minimum)}:1`,
        );
      expect(failures).toEqual([]);
    },
  );
});
