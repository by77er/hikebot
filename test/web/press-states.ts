/**
 * The checks of `press-states.test.ts`, on a stylesheet's text: each
 * returns the lines that break its rule, with the selector or declaration.
 */

export interface Finding {
  line: number;
  text: string;
}

/** The text with comments blanked out, keeping every line break. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
}

function lineAt(css: string, index: number): number {
  return css.slice(0, index).split("\n").length;
}

/** Properties a transition may name: they move or fade, never recolour. */
const MOVES = new Set(["opacity", "transform"]);

/**
 * Transitions that ease a colour: a `transition` or `transition-property`
 * naming anything but `opacity` or `transform` (a colour, a background, a
 * border, `all`), and a `transition-duration` in a rule with no property
 * list, which eases `all`.
 */
export function findEasedColours(css: string): Finding[] {
  const text = withoutComments(css);
  const found: Finding[] = [];
  for (const rule of text.matchAll(/\{([^{}]*)\}/g)) {
    const body = rule[1] ?? "";
    const start = rule.index + 1;
    const hasList = /(^|[;\s])transition(-property)?\s*:/.test(body);
    for (const declaration of body.matchAll(
      /(^|[;\s])(transition(?:-property|-duration)?)\s*:\s*([^;]*)/g,
    )) {
      const [, , property = "", value = ""] = declaration;
      const at = lineAt(text, start + declaration.index);
      const shown = `${property}: ${value.trim()}`;
      if (property === "transition-duration") {
        if (!hasList) found.push({ line: at, text: shown });
        continue;
      }
      const names = value
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0] ?? "")
        .filter((name) => name !== "");
      if (names.some((name) => !MOVES.has(name))) {
        found.push({ line: at, text: shown });
      }
    }
  }
  return found;
}

/**
 * Selectors that use `:active` with no `[data-pressed]` beside it: each
 * comma-separated selector of a rule that says `:active` must say
 * `[data-pressed]` too, as `:where(:active, [data-pressed])` does.
 */
export function findPressWithoutTwin(css: string): Finding[] {
  const text = withoutComments(css);
  const found: Finding[] = [];
  for (const rule of text.matchAll(/([^{}]+)\{/g)) {
    const prelude = rule[1] ?? "";
    if (!prelude.includes(":active")) continue;
    let depth = 0;
    let from = 0;
    const parts: { text: string; at: number }[] = [];
    for (let i = 0; i <= prelude.length; i += 1) {
      const char = prelude[i];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (i === prelude.length || (char === "," && depth === 0)) {
        parts.push({ text: prelude.slice(from, i), at: from });
        from = i + 1;
      }
    }
    for (const part of parts) {
      if (
        part.text.includes(":active") &&
        !part.text.includes("[data-pressed]")
      ) {
        const lead = part.text.length - part.text.trimStart().length;
        found.push({
          line: lineAt(text, rule.index + part.at + lead),
          text: part.text.trim().replace(/\s+/g, " "),
        });
      }
    }
  }
  return found;
}
