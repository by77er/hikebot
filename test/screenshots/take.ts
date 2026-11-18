/**
 * `npm run screenshots`: starts the Worker in local workerd next to the fake
 * Discord API, seeds it, opens every page in `pages.json` in headless
 * Chromium at each viewport and colour scheme, and writes a full-page PNG
 * per combination to `docs/screenshots/<page>--<viewport>--<scheme>.png`,
 * deleting PNGs there that no page produces any more. It exits non-zero
 * when a page answers with another status than its entry gives, or when the
 * page or a file it loads fails.
 *
 * Every run on the same commit writes the same bytes: each page gets a fresh
 * Worker with fixed seed data, the browser's clock is frozen, its time zone
 * and language are fixed, animations and transitions are off, the device
 * scale factor is 1, and fonts come from the browser package, never from
 * the machine.
 *
 * With `--check` it then fails if any file in `docs/screenshots/` differs
 * from what is committed, listing them: the screenshots are stale.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, CDPSession } from "puppeteer-core";
import { launchBrowser } from "./browser";
import {
  readPageList,
  SCHEMES,
  screenshotFile,
  screenshotFiles,
  VIEWPORTS,
  type ScreenshotPage,
  type ViewportName,
} from "./pages";
import { SEEDS } from "./seeds";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT_DIR = "docs/screenshots";
/** The instant the browser's clock is frozen at: 2030-06-01 09:00 UTC. */
const FROZEN_TIME = Date.UTC(2030, 5, 1, 9, 0, 0);
const NO_MOTION_CSS = `*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

// Keep Wrangler off the network and out of the home directory, as the
// end-to-end suite does in vitest.e2e.config.ts.
process.env.WRANGLER_SEND_METRICS = "false";
process.env.WRANGLER_LOG = "none";
process.env.XDG_CONFIG_HOME = join(ROOT, ".wrangler", "e2e-config");

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const list = readPageList();
  for (const page of list.pages) {
    if (!(page.seed in SEEDS)) {
      throw new Error(
        `pages.json gives page ${page.name} the seed "${page.seed}", which is not in SEEDS in test/screenshots/seeds.ts`,
      );
    }
    if (page.user !== null) {
      throw new Error(
        `pages.json signs in "${page.user}" for page ${page.name}, but test/screenshots/take.ts cannot sign a member in yet; teach it in signIn()`,
      );
    }
  }
  const outDir = join(ROOT, OUT_DIR);
  mkdirSync(outDir, { recursive: true });
  const expected = new Set(screenshotFiles(list));
  for (const file of readdirSync(outDir)) {
    if (file.endsWith(".png") && !expected.has(file)) {
      rmSync(join(outDir, file));
      console.log(`deleted ${OUT_DIR}/${file}: no page in pages.json makes it`);
    }
  }

  const { E2ERun } = await import("../e2e/harness/start");
  const browser = await launchBrowser();
  try {
    for (const page of list.pages) {
      // A fresh Worker per page, so one page's seed cannot show on another.
      const run = new E2ERun();
      try {
        const e2e = await run.start();
        const seed = SEEDS[page.seed];
        if (seed) await seed(e2e);
        for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
          for (const scheme of SCHEMES) {
            const file = screenshotFile(page.name, viewport, scheme);
            const png = await capture(browser, e2e.url, page, viewport, scheme);
            writeFileSync(join(outDir, file), png);
            console.log(`wrote ${OUT_DIR}/${file}`);
          }
        }
      } finally {
        await run.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (check) {
    const stale = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all", "--", OUT_DIR],
      { cwd: ROOT, encoding: "utf8" },
    ).trimEnd();
    if (stale) {
      console.error(
        `These screenshots differ from what is committed:\n${stale}\nRun \`npm run screenshots\` and commit ${OUT_DIR}/ ("Take the screenshots" in src/web/AGENTS.md).`,
      );
      process.exitCode = 1;
    } else {
      console.log(`${OUT_DIR}/ matches what is committed.`);
    }
  }
}

async function capture(
  browser: Browser,
  base: URL,
  entry: ScreenshotPage,
  viewport: ViewportName,
  scheme: (typeof SCHEMES)[number],
): Promise<Uint8Array> {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    const failures: string[] = [];
    const url = new URL(entry.path, base);
    page.on("requestfailed", (request) => {
      failures.push(
        `${request.url()} failed: ${request.failure()?.errorText ?? "unknown error"}`,
      );
    });
    page.on("response", (response) => {
      if (response.url() === url.href) return;
      if (response.status() >= 400) {
        failures.push(
          `${response.url()} answered ${String(response.status())}`,
        );
      }
    });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (message.location().url === url.href) return;
      failures.push(`console error: ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      failures.push(`page error: ${String(error)}`);
    });

    const size = VIEWPORTS[viewport];
    await page.setViewport({ ...size, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: scheme },
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    await page.emulateTimezone("UTC");
    await page.evaluateOnNewDocument(FREEZE_CLOCK);
    const session = await page.createCDPSession();
    await session.send("Emulation.setLocaleOverride", { locale: "en-US" });

    const response = await page.goto(url.href, { waitUntil: "load" });
    if (!response)
      throw new Error(`${entry.name}: ${url.href} gave no response`);
    if (response.status() !== entry.status) {
      failures.push(
        `answered ${String(response.status())}, but pages.json expects ${String(entry.status)}`,
      );
    }
    await stopMotion(session);
    await page.evaluate("document.fonts.ready.then(() => undefined)");
    if (failures.length > 0) {
      throw new Error(
        `${entry.name} (${entry.path}) at ${viewport} ${scheme}:\n${failures.join("\n")}`,
      );
    }
    return await page.screenshot({
      type: "png",
      fullPage: true,
      captureBeyondViewport: true,
    });
  } finally {
    await context.close();
  }
}

/**
 * Turns animations and transitions off with an inspector stylesheet, which
 * DevTools adds outside the page's Content-Security-Policy, so the page is
 * otherwise rendered exactly as a browser gets it.
 */
async function stopMotion(session: CDPSession): Promise<void> {
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const { frameTree } = await session.send("Page.getFrameTree");
  const { styleSheetId } = await session.send("CSS.createStyleSheet", {
    frameId: frameTree.frame.id,
  });
  await session.send("CSS.setStyleSheetText", {
    styleSheetId,
    text: NO_MOTION_CSS,
  });
}

/**
 * Runs in the page before its own scripts, so `Date` always reads
 * `FROZEN_TIME`. It is a string because the loader that runs this file
 * rewrites functions in ways a page cannot run.
 */
const FREEZE_CLOCK = `(() => {
  const at = ${String(FROZEN_TIME)};
  const RealDate = Date;
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args) => Reflect.construct(target, args.length === 0 ? [at] : args),
    apply: () => new RealDate(at).toString(),
    get: (target, property, receiver) =>
      property === "now" ? () => at : Reflect.get(target, property, receiver),
  });
})();`;

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
