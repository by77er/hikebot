/**
 * The page audit: what the screenshot run measures on every page instead of
 * leaving it to be judged from an image. `take.ts` opens each page of
 * `pages.json` in every configuration of `AUDIT_CONFIGS`, the four it takes
 * shots in and three it only measures, and runs `auditPage` on it once the
 * page is ready to be shot. The measurements themselves run in the page,
 * from `audit-page.js`; each finding names its check:
 *
 * - `overflow`: the document scrolls sideways.
 * - `target`: a link, button, form control, summary, `[role=button]` or
 *   label wrapping a control under 44 × 44 CSS px, in the configurations
 *   390 px wide; a checkbox or radio counts with its label. A link inside
 *   running text is not a target, and nor is anything inside
 *   `[data-audit-exempt]`, whose value says why.
 * - `inline-main-path`: the primary action (`.button--primary` or
 *   `[data-main-path]`) is a link inside a sentence.
 * - `cut`: a word clipped by a box that hides overflow, a box cut with an
 *   ellipsis, or a word past the window's edge. Text in a box that scrolls
 *   is reached by scrolling and not cut.
 * - `small-text`: text under the smallest `--font-size-*` token.
 * - `shift`: a cumulative layout shift of `SHIFT_LIMIT` or more from the
 *   document's start until it is ready, with no input given.
 * - `overlap`: a word whose centre, hit-tested, belongs to another element.
 *
 * Findings an entry of `audit-allow.json` names (page, check, selector,
 * with its reason) pass; every other finding fails the run, and so does an
 * entry that matches no finding.
 */
import { readFileSync } from "node:fs";
import type { Page } from "puppeteer-core";
import { SCHEMES, VIEWPORTS, type Scheme, type ViewportName } from "./pages";

export const CHECKS = [
  "overflow",
  "target",
  "inline-main-path",
  "cut",
  "small-text",
  "shift",
  "overlap",
] as const;

export type CheckName = (typeof CHECKS)[number];

/** A layout shift this large or larger while the page loads fails. */
export const SHIFT_LIMIT = 0.05;

/** What marks the page's primary action. */
export const MAIN_PATH = ".button--primary, [data-main-path]";

/** One thing the audit measured that is wrong on a page. */
export interface Finding {
  check: CheckName;
  /** A CSS selector that matches only the element in its page. */
  selector: string;
  /** The first words the element says. */
  text: string;
  /** What was measured. */
  value: string;
}

/** A finding with the page and configuration it was made in. */
export interface PageFinding extends Finding {
  page: string;
  config: string;
}

/** A browser configuration a page is audited in. */
export interface AuditConfig {
  /** As the report names it, such as `phone light` or `desktop 200%`. */
  name: string;
  viewport: {
    width: number;
    height: number;
    isMobile: boolean;
    hasTouch: boolean;
    deviceScaleFactor: number;
  };
  scheme: Scheme;
  /** The shot taken in this configuration, or null when it only measures. */
  shot: ViewportName | null;
  /** Measure touch targets here. */
  targets: boolean;
  /** The pointer must match `(pointer: coarse)` here. */
  coarse: boolean;
}

/**
 * The configurations every page is audited in: the shots' viewports in
 * both schemes, then 320 CSS px wide, 390 px with a coarse pointer and
 * touch, and the desktop window at 200% zoom (half its width in CSS px at
 * twice the scale), which are only measured.
 */
export const AUDIT_CONFIGS: AuditConfig[] = [
  ...(Object.keys(VIEWPORTS) as ViewportName[]).flatMap((shot) =>
    SCHEMES.map((scheme): AuditConfig => ({
      name: `${shot} ${scheme}`,
      viewport: { ...VIEWPORTS[shot], deviceScaleFactor: 1 },
      scheme,
      shot,
      targets: VIEWPORTS[shot].width === 390,
      coarse: false,
    })),
  ),
  {
    name: "320",
    viewport: {
      width: 320,
      height: 640,
      isMobile: false,
      hasTouch: false,
      deviceScaleFactor: 1,
    },
    scheme: "light",
    shot: null,
    targets: false,
    coarse: false,
  },
  {
    name: "390 coarse",
    viewport: { ...VIEWPORTS.phone, deviceScaleFactor: 1 },
    scheme: "light",
    shot: null,
    targets: true,
    coarse: true,
  },
  {
    name: "desktop 200%",
    viewport: {
      width: VIEWPORTS.desktop.width / 2,
      height: VIEWPORTS.desktop.height / 2,
      isMobile: false,
      hasTouch: false,
      deviceScaleFactor: 2,
    },
    scheme: "light",
    shot: null,
    targets: false,
    coarse: false,
  },
];

/**
 * Runs in the page before its own scripts and sums every layout shift
 * from the document's start, keeping a node the largest one moved. No
 * input is given while the page loads, so every entry counts. A string,
 * as the scripts in `take.ts` are.
 */
export const SHIFT_OBSERVER = `(() => {
  const shift = { total: 0, largest: null, largestValue: 0 };
  window.__hikebotShift = shift;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      shift.total += entry.value;
      if (entry.value > shift.largestValue) {
        shift.largestValue = entry.value;
        shift.largest = entry.sources?.[0]?.node ?? null;
      }
    }
  }).observe({ type: "layout-shift", buffered: true });
})();`;

const PAGE_SCRIPT = readFileSync(
  new URL("./audit-page.js", import.meta.url),
  "utf8",
);

const TOKENS = new URL("../../public/assets/cairn/tokens.css", import.meta.url);

/**
 * The smallest `--font-size-*` token of `css` in CSS px, at the browser's
 * default 16 px root size; a token that is not a plain length (a clamp)
 * is larger than the plain ones.
 */
export function smallestTypeToken(
  css: string = readFileSync(TOKENS, "utf8"),
): number {
  const sizes = [
    ...css.matchAll(/--font-size-[\w-]+:\s*([\d.]+)(rem|px)\s*;/g),
  ].map(([, value, unit]) => Number(value) * (unit === "rem" ? 16 : 1));
  if (sizes.length === 0) {
    throw new Error("no --font-size-* token with a plain length was found");
  }
  return Math.min(...sizes);
}

export interface AuditOptions {
  /** Measure touch targets. */
  targets: boolean;
  /** The pointer must be coarse; the audit throws when it is not. */
  coarse?: boolean;
  /** Text under this many CSS px is small; the smallest type token. */
  smallestText: number;
}

/**
 * Measures `page` as it stands, which must have been opened with
 * `SHIFT_OBSERVER` installed, and returns its findings in document order,
 * check by check. It scrolls the page to hit-test words and scrolls it
 * back.
 */
export async function auditPage(
  page: Page,
  options: AuditOptions,
): Promise<Finding[]> {
  if (options.coarse) {
    const coarse = await page.evaluate(
      `matchMedia("(pointer: coarse)").matches`,
    );
    if (coarse !== true) {
      throw new Error(
        "the configuration asks for a coarse pointer, but the page does not match (pointer: coarse)",
      );
    }
  }
  const settings = {
    targets: options.targets,
    smallestText: options.smallestText,
    mainPath: MAIN_PATH,
    shiftLimit: SHIFT_LIMIT,
  };
  const found = (await page.evaluate(
    `${PAGE_SCRIPT}\nhikebotAudit(${JSON.stringify(settings)});`,
  )) as Finding[];
  return CHECKS.flatMap((check) =>
    found.filter((finding) => finding.check === check),
  );
}

/** An entry of `audit-allow.json`: a finding that passes, and why. */
export interface Allowance {
  page: string;
  check: CheckName;
  selector: string;
  reason: string;
}

/**
 * The entries of `audit-allow.json`, checked: each names a page of the
 * list, one of `CHECKS`, a selector and a reason.
 */
export function readAllowances(json: string, pages: string[]): Allowance[] {
  const parsed = JSON.parse(json) as { allow?: unknown };
  if (!Array.isArray(parsed.allow)) {
    throw new Error('audit-allow.json must hold { "allow": [...] }');
  }
  return parsed.allow.map((entry: unknown, index): Allowance => {
    const where = `audit-allow.json entry ${String(index + 1)}`;
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${where} is not an object`);
    }
    const { page, check, selector, reason } = entry as Record<string, unknown>;
    if (typeof page !== "string" || !pages.includes(page)) {
      throw new Error(`${where} names no page of pages.json: ${String(page)}`);
    }
    if (!CHECKS.includes(check as CheckName)) {
      throw new Error(
        `${where} names no check: ${String(check)}; the checks are ${CHECKS.join(", ")}`,
      );
    }
    if (typeof selector !== "string" || selector.trim() === "") {
      throw new Error(`${where} has no selector`);
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new Error(`${where} gives no reason`);
    }
    return { page, check: check as CheckName, selector, reason };
  });
}

/**
 * The findings no allowance names, and the allowances that name no
 * finding: both fail the run.
 */
export function applyAllowances(
  findings: PageFinding[],
  allowances: Allowance[],
): { failing: PageFinding[]; stale: Allowance[] } {
  const matches = (allowance: Allowance, finding: PageFinding): boolean =>
    allowance.page === finding.page &&
    allowance.check === finding.check &&
    allowance.selector === finding.selector;
  return {
    failing: findings.filter(
      (finding) => !allowances.some((allowance) => matches(allowance, finding)),
    ),
    stale: allowances.filter(
      (allowance) => !findings.some((finding) => matches(allowance, finding)),
    ),
  };
}

/**
 * The report of a failed audit, page by page: one line per finding with
 * its configuration, check, selector, words and value, then the stale
 * allowances. Empty when nothing fails.
 */
export function formatReport(
  failing: PageFinding[],
  stale: Allowance[],
): string {
  const lines: string[] = [];
  if (failing.length > 0) {
    const pages = [...new Set(failing.map((finding) => finding.page))];
    lines.push(
      `The audit found ${String(failing.length)} problem(s) on ${String(pages.length)} page(s) ("Audit the pages" in src/web/AGENTS.md):`,
    );
    for (const page of pages) {
      lines.push(page);
      for (const finding of failing.filter((each) => each.page === page)) {
        const text = finding.text ? ` "${finding.text}"` : "";
        lines.push(
          `  ${finding.config}  ${finding.check}  ${finding.selector}${text}: ${finding.value}`,
        );
      }
    }
  }
  if (stale.length > 0) {
    lines.push(
      `These entries of test/screenshots/audit-allow.json match no finding any more; delete them:`,
    );
    for (const allowance of stale) {
      lines.push(
        `  ${allowance.page}  ${allowance.check}  ${allowance.selector}`,
      );
    }
  }
  return lines.join("\n");
}
