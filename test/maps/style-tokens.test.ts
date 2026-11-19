import { beforeAll, describe, expect, it } from "vitest";
import {
  CAIRN,
  COLOURS,
  RECIPES,
  mixRecipe,
  type CairnToken,
  type ColourRole,
} from "../../src/maps/style";
import { mapToken } from "../../src/web/pages/styleguide/map";
import { contrastRatio, parseTokens } from "../../src/web/tokens";
import { publicText, TOKENS_FILE } from "../web/design-files";

/**
 * Every way the style module and the stylesheet disagree: a Cairn token
 * whose value differs, a role whose map token differs from the colour its
 * recipe makes from the stylesheet's values, a role without a map token, a
 * map token without a role.
 */
function disagreements(css: string): string[] {
  const light = parseTokens(css).light;
  const found: string[] = [];
  for (const [name, value] of Object.entries(CAIRN)) {
    if (light[name] !== value) {
      found.push(
        `--${name} is ${String(light[name])} in tokens.css, ${value} in style.ts`,
      );
    }
  }
  const tokens = Object.fromEntries(
    Object.keys(CAIRN).map((name) => [name, light[name] ?? "#000000"]),
  ) as Record<CairnToken, string>;
  for (const [role, recipe] of Object.entries(RECIPES)) {
    const made = mixRecipe(recipe, tokens);
    const token = light[mapToken(role as ColourRole)];
    if (token !== made || COLOURS[role as ColourRole] !== made) {
      found.push(
        `${role}: --${mapToken(role as ColourRole)} is ${String(token)}, style.ts has ${COLOURS[role as ColourRole]}, the recipe makes ${made}`,
      );
    }
  }
  const roles = new Set(
    Object.keys(RECIPES).map((role) => mapToken(role as ColourRole)),
  );
  for (const name of Object.keys(light)) {
    if (name.startsWith("map-") && !roles.has(name)) {
      found.push(`--${name} is no role of src/maps/style.ts`);
    }
  }
  return found;
}

describe("the map's colours", () => {
  let css = "";
  beforeAll(async () => {
    css = await publicText(TOKENS_FILE);
  });

  it("agree with the tokens in tokens.css", () => {
    expect(disagreements(css)).toEqual([]);
  });

  it("disagree when a Cairn colour changes and the map tokens do not", () => {
    const greener = css.replace(
      /--color-success: #[0-9a-f]{6};/,
      "--color-success: #2c7a35;",
    );
    const found = disagreements(greener);
    expect(found).toContainEqual(expect.stringMatching(/^--color-success is/));
    expect(found).toContainEqual(expect.stringMatching(/^forest:/));
  });

  it("disagree when a map token changes", () => {
    const bluer = css.replace(
      /--map-water: #[0-9a-f]{6};/,
      "--map-water: #a8cadf;",
    );
    expect(disagreements(bluer)).toEqual([
      expect.stringMatching(/^water: --map-water is #a8cadf/),
    ]);
  });

  it("mix as CSS color-mix in sRGB does", () => {
    // color-mix(in srgb, #000000 25%, #ffffff) is rgb(191.25 ...).
    expect(
      mixRecipe(
        { token: "color-text", amount: 0.25, into: "color-surface" },
        { ...CAIRN, "color-text": "#000000" },
      ),
    ).toBe("#bfbfbf");
    expect(mixRecipe({ token: "color-accent" })).toBe(CAIRN["color-accent"]);
  });
});

describe("the map's contrast", () => {
  const FILLS: ColourRole[] = [
    "land",
    "forest",
    "grass",
    "bareRock",
    "ice",
    "settled",
    "park",
  ];

  it.each([
    ["label", "labelHalo", 4.5],
    ["waterLabel", "labelHalo", 4.5],
    ["peak", "labelHalo", 4.5],
    ["furniture", "furnitureBackground", 4.5],
    ["pin", "pinOutline", 3],
  ] as const)(
    "draws %s on %s at %s:1 or more",
    (foreground, background, minimum) => {
      expect(
        contrastRatio(COLOURS[foreground], COLOURS[background]),
      ).toBeGreaterThanOrEqual(minimum);
    },
  );

  it.each(FILLS)("draws trails at 3:1 or more on %s", (fill) => {
    expect(contrastRatio(COLOURS.path, COLOURS[fill])).toBeGreaterThanOrEqual(
      3,
    );
  });

  it.each([...FILLS, "water"] as const)(
    "outlines the pin at 3:1 or more on %s",
    (fill) => {
      expect(
        contrastRatio(COLOURS.pinKeyline, COLOURS[fill]),
      ).toBeGreaterThanOrEqual(3);
    },
  );
});
