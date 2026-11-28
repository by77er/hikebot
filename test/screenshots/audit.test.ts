import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyAllowances,
  AUDIT_CONFIGS,
  auditPage,
  formatReport,
  readAllowances,
  SHIFT_OBSERVER,
  smallestTypeToken,
  stopShiftCount,
  type AuditOptions,
  type Finding,
  type PageFinding,
} from "./audit";
import { launchBrowser } from "./browser";

/**
 * Fixture pages, each built to break one check or to pass it, served by
 * path. Each is a whole document at the default 16 px root size.
 */
const FIXTURES: Record<string, string> = {
  "/plain": `<h1>A page</h1><p>Words that fit, at the body size.</p>`,
  "/overflow": `<p>Fits.</p><div style="width: 600px">Too wide for the phone</div>`,
  "/target-small": `<p>Read on.</p><div><button style="width: 30px; height: 30px; padding: 0">Go</button></div>`,
  "/target-fine": `<div><button style="width: 44px; height: 44px; padding: 0">Go</button></div>
<p>Read <a href="/plain">the rules</a> before you vote.</p>
<div data-audit-exempt="a legal notice a member never needs to tap"><a href="/plain">Fine print</a></div>
<div style="display: grid; grid-template-columns: 24px 1fr">
  <input type="checkbox" id="pick" style="width: 24px; height: 24px; margin: 0; grid-column: 1; grid-row: 1">
  <label for="pick" style="grid-column: 1 / -1; grid-row: 1; min-height: 44px; padding-left: 32px">Snow Lake</label>
</div>`,
  "/target-exempt-no-reason": `<div data-audit-exempt=""><a href="/plain">Fine print</a></div>`,
  "/main-path-inline": `<p>To vote, <a class="button--primary" href="/plain">open the vote</a> before Friday.</p>`,
  "/main-path-marked-inline": `<p>Then <a data-main-path href="/plain">sign in</a> to vote.</p>`,
  "/main-path-alone": `<p>The vote is open.</p><div><a class="button--primary" href="/plain" style="display: inline-block; min-height: 44px">Open the vote</a></div>`,
  "/cut-hidden": `<div style="width: 100px; overflow: hidden; white-space: nowrap">A long line of words clipped</div>`,
  "/cut-ellipsis": `<div style="width: 100px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis">A long line of words cut short</div>`,
  "/cut-edge": `<p style="position: absolute; left: 340px; white-space: nowrap">Past the edge</p>`,
  "/cut-fine": `<div style="width: 300px; overflow: hidden">Short words that wrap inside their box</div>
<div style="width: 100px; overflow-x: auto; white-space: nowrap">A long line reached by scrolling the box</div>`,
  "/small": `<p>Body.</p><p style="font-size: 12px">Fine print</p>`,
  "/small-fine": `<p style="font-size: 14px">Small but at the token</p>`,
  "/shift": `<p id="first">Loaded first.</p><p>And this.</p>
<script>
requestAnimationFrame(() => requestAnimationFrame(() => {
  const late = document.createElement("div");
  late.style.height = "300px";
  late.textContent = "Arrived late";
  document.body.prepend(late);
  document.body.dataset.done = "yes";
}));
</script>`,
  "/shift-fine": `<p>Loaded first.</p>
<script>
requestAnimationFrame(() => requestAnimationFrame(() => {
  const late = document.createElement("p");
  late.textContent = "Added below, moving nothing";
  document.body.append(late);
  document.body.dataset.done = "yes";
}));
</script>`,
  "/overlap": `<p>Words under a box</p>
<div style="position: absolute; top: 0; left: 0; width: 300px; height: 60px; background: white"></div>`,
};

let browser: Browser;
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const body = FIXTURES[request.url ?? ""];
    response.writeHead(body === undefined ? 404 : 200, {
      "content-type": "text/html; charset=utf-8",
    });
    response.end(
      `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Fixture</title><style>button { font: inherit; }</style></head><body style="margin: 8px; font: 16px/1.5 sans-serif">${body ?? "Not found"}</body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  browser = await launchBrowser();
}, 60_000);

afterAll(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

/**
 * Audits the fixture at `path` at 390 px with a coarse pointer, after
 * `ready` holds when it is given.
 */
async function audit(
  path: string,
  options: Partial<AuditOptions> & { ready?: string } = {},
): Promise<Finding[]> {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setViewport({
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    await page.evaluateOnNewDocument(SHIFT_OBSERVER);
    await page.goto(`${base}${path}`, { waitUntil: "load" });
    if (options.ready) await page.waitForFunction(options.ready);
    return await auditPage(page, {
      targets: options.targets ?? true,
      coarse: options.coarse ?? true,
      smallestText: options.smallestText ?? 14,
    });
  } finally {
    await context.close();
  }
}

const checks = (findings: Finding[]) =>
  findings.map((finding) => finding.check);

describe("auditPage", () => {
  it("finds nothing on a plain page", async () => {
    expect(await audit("/plain")).toEqual([]);
  });

  it("overflow: reports a page that scrolls sideways, naming what sticks out", async () => {
    const found = await audit("/overflow");
    expect(checks(found)).toContain("overflow");
    expect(found.find((finding) => finding.check === "overflow")).toEqual({
      check: "overflow",
      selector: "div",
      text: "Too wide for the phone",
      value: "the page scrolls sideways by 218 px at 390 px wide",
    });
  });

  it("target: reports a button under 44 × 44 px", async () => {
    expect(await audit("/target-small")).toEqual([
      {
        check: "target",
        selector: "button",
        text: "Go",
        value: "30 px × 30 px, under 44 × 44 px",
      },
    ]);
  });

  it("target: passes 44 px controls, links in a sentence, exempt links and a choice with its label", async () => {
    expect(await audit("/target-fine")).toEqual([]);
  });

  it("target: reports data-audit-exempt without a reason", async () => {
    expect(await audit("/target-exempt-no-reason")).toEqual([
      expect.objectContaining({
        check: "target",
        selector: "div",
        value: expect.stringMatching(/gives no reason/) as unknown,
      }),
    ]);
  });

  it("target: measures nothing when the configuration does not ask", async () => {
    expect(
      await audit("/target-small", { targets: false, coarse: false }),
    ).toEqual([]);
  });

  it("inline-main-path: reports a primary action inside a sentence", async () => {
    expect(checks(await audit("/main-path-inline"))).toContain(
      "inline-main-path",
    );
    expect(checks(await audit("/main-path-marked-inline"))).toContain(
      "inline-main-path",
    );
  });

  it("inline-main-path: passes a primary action that stands alone", async () => {
    expect(await audit("/main-path-alone")).toEqual([]);
  });

  it("cut: reports words clipped by a box, cut with an ellipsis or past the window", async () => {
    expect(checks(await audit("/cut-hidden"))).toEqual(["cut"]);
    expect(await audit("/cut-ellipsis")).toContainEqual(
      expect.objectContaining({
        check: "cut",
        value: expect.stringMatching(/^cut with an ellipsis/) as unknown,
      }),
    );
    expect(checks(await audit("/cut-edge"))).toContain("cut");
  });

  it("cut: passes words that wrap inside their box and words a box scrolls to", async () => {
    expect(await audit("/cut-fine")).toEqual([]);
  });

  it("small-text: reports text under the smallest type token", async () => {
    expect(await audit("/small")).toEqual([
      {
        check: "small-text",
        selector: "p:nth-of-type(2)",
        text: "Fine print",
        value: "12 px, under the smallest type token's 14 px",
      },
    ]);
  });

  it("small-text: passes text at the smallest type token", async () => {
    expect(await audit("/small-fine")).toEqual([]);
  });

  it("shift: reports content pushed down while the page loads", async () => {
    const found = await audit("/shift", {
      ready:
        "document.body.dataset.done === 'yes' && window.__hikebotShift.total > 0",
    });
    expect(found).toContainEqual(
      expect.objectContaining({
        check: "shift",
        value: expect.stringMatching(
          /^cumulative layout shift 0\.\d{3} while loading/,
        ) as unknown,
      }),
    );
  });

  it("shift: passes content added below what is shown", async () => {
    expect(
      await audit("/shift-fine", {
        ready: "document.body.dataset.done === 'yes'",
      }),
    ).toEqual([]);
  });

  it("shift: counts nothing that moves after stopShiftCount", async () => {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      await page.setViewport({ width: 390, height: 844 });
      await page.evaluateOnNewDocument(SHIFT_OBSERVER);
      await page.goto(`${base}/plain`, { waitUntil: "load" });
      await stopShiftCount(page);
      // Push the page down once it has been drawn, and wait until the
      // browser has reported the shift.
      await page.evaluate(`new Promise((resolve) => {
        new PerformanceObserver(resolve).observe({ type: "layout-shift" });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const late = document.createElement("div");
          late.style.height = "300px";
          document.body.prepend(late);
        }));
      })`);
      expect(
        await auditPage(page, {
          targets: false,
          coarse: false,
          smallestText: 14,
        }),
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("overlap: reports words another element is drawn over", async () => {
    expect(await audit("/overlap")).toContainEqual(
      expect.objectContaining({
        check: "overlap",
        selector: "p",
        value: expect.stringMatching(/lies under or over div/) as unknown,
      }),
    );
  });

  it("throws when a coarse configuration's pointer is fine", async () => {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      await page.setViewport({ width: 390, height: 844 });
      await page.evaluateOnNewDocument(SHIFT_OBSERVER);
      await page.goto(`${base}/plain`, { waitUntil: "load" });
      await expect(
        auditPage(page, { targets: true, coarse: true, smallestText: 14 }),
      ).rejects.toThrow(/pointer: coarse/);
    } finally {
      await context.close();
    }
  });
});

describe("AUDIT_CONFIGS", () => {
  it("adds 320 px, 390 px coarse and desktop at 200% to the shots, measured only", () => {
    expect(AUDIT_CONFIGS.map((config) => [config.name, config.shot])).toEqual([
      ["phone light", "phone"],
      ["phone dark", "phone"],
      ["desktop light", "desktop"],
      ["desktop dark", "desktop"],
      ["320", null],
      ["390 coarse", null],
      ["desktop 200%", null],
    ]);
    const zoomed = AUDIT_CONFIGS.find(
      (config) => config.name === "desktop 200%",
    );
    expect(zoomed?.viewport).toMatchObject({
      width: 640,
      deviceScaleFactor: 2,
    });
    const coarse = AUDIT_CONFIGS.find((config) => config.name === "390 coarse");
    expect(coarse?.viewport).toMatchObject({
      width: 390,
      hasTouch: true,
      isMobile: true,
    });
    expect(coarse).toMatchObject({ coarse: true, targets: true });
  });
});

describe("smallestTypeToken", () => {
  it("reads the smallest plain --font-size-* token in px", () => {
    expect(
      smallestTypeToken(
        ":root { --font-size-small: 0.875rem; --font-size-body: 1rem; --font-size-h1: clamp(1.75rem, 1.5rem + 1.25vw, 2.25rem); }",
      ),
    ).toBe(14);
  });

  it("reads Cairn's tokens", () => {
    expect(smallestTypeToken()).toBe(14);
  });
});

describe("allowances", () => {
  const finding = (page: string, selector: string): PageFinding => ({
    page,
    config: "phone light",
    check: "target",
    selector,
    text: "Map",
    value: "28 px × 16 px, under 44 × 44 px",
  });

  it("reads entries with a page, a check, a selector and a reason", () => {
    const json = JSON.stringify({
      allow: [
        { page: "home", check: "cut", selector: "span.name", reason: "why" },
      ],
    });
    expect(readAllowances(json, ["home"])).toEqual([
      { page: "home", check: "cut", selector: "span.name", reason: "why" },
    ]);
  });

  it("refuses an entry without a reason, or naming no page or check", () => {
    const entry = { page: "home", check: "cut", selector: "span", reason: "" };
    expect(() =>
      readAllowances(JSON.stringify({ allow: [entry] }), ["home"]),
    ).toThrow(/gives no reason/);
    expect(() =>
      readAllowances(
        JSON.stringify({ allow: [{ ...entry, reason: "why", page: "gone" }] }),
        ["home"],
      ),
    ).toThrow(/names no page/);
    expect(() =>
      readAllowances(
        JSON.stringify({ allow: [{ ...entry, reason: "why", check: "tiny" }] }),
        ["home"],
      ),
    ).toThrow(/names no check/);
  });

  it("passes the findings an entry names, and fails an entry that names none", () => {
    const allowed = {
      page: "home",
      check: "target" as const,
      selector: "a.map",
      reason: "why",
    };
    const stale = { ...allowed, selector: "a.gone" };
    const result = applyAllowances(
      [finding("home", "a.map"), finding("home", "a.other")],
      [allowed, stale],
    );
    expect(result.failing).toEqual([finding("home", "a.other")]);
    expect(result.stale).toEqual([stale]);
  });

  it("reports each finding page by page, then the stale entries", () => {
    expect(
      formatReport(
        [finding("home", "a.map"), finding("servers", "a.tile")],
        [{ page: "home", check: "cut", selector: "span", reason: "why" }],
      ),
    ).toBe(
      [
        'The audit found 2 problem(s) on 2 page(s) ("Audit the pages" in src/web/AGENTS.md):',
        "home",
        '  phone light  target  a.map "Map": 28 px × 16 px, under 44 × 44 px',
        "servers",
        '  phone light  target  a.tile "Map": 28 px × 16 px, under 44 × 44 px',
        "These entries of test/screenshots/audit-allow.json match no finding any more; delete them:",
        "  home  cut  span",
      ].join("\n"),
    );
    expect(formatReport([], [])).toBe("");
  });
});
