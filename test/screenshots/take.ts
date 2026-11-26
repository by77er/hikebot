/**
 * `npm run screenshots`: starts the Worker in local workerd next to the fake
 * Discord API, seeds it, opens every page in `pages.json` in headless
 * Chromium at each viewport and colour scheme, signed in as its `user`
 * when it has one, and writes a full-page PNG
 * per combination to `docs/screenshots/<page>--<viewport>--<scheme>.png`,
 * deleting PNGs there that no page produces any more. It exits non-zero
 * when a page answers with another status than its entry gives, or when the
 * page or a file it loads fails.
 *
 * Every run on the same commit writes the same bytes: each page gets a fresh
 * Worker with fixed seed data, Discord's CDN is answered with fixed pictures
 * (`discord-cdn.ts`), the browser's clock is frozen, its time zone
 * and language are fixed, animations and transitions are off, the device
 * scale factor is 1, fonts come from the browser package, never from the
 * machine, and the shot waits for the page's fonts and CSS images (such as
 * the header's contour-line mask) to be ready, and for every interactive
 * map to have drawn everything it shows (MapLibre's `idle`); pages marked
 * `"map": true` are taken in a second browser with WebGL. A page entry
 * with `"javascript": false` is shown as a browser with JavaScript off
 * shows it: every script it loads is answered empty, so none of the page's
 * code runs (turning JavaScript off in the browser would also stop the
 * script's own waits).
 *
 * With `--check` it then prints the SHA-256 of each PNG, to compare with
 * another machine's without copying the files, and fails if any file in
 * `docs/screenshots/` differs from what is committed, listing them: the
 * screenshots are stale.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, CDPSession } from "puppeteer-core";
import { PageClient } from "../e2e/harness/web";
import { launchBrowser } from "./browser";
import { cdnReply, isMissingPicture } from "./discord-cdn";
import {
  SCHEMES,
  screenshotFile,
  screenshotFiles,
  VIEWPORTS,
  type PageList,
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
  const list = JSON.parse(
    readFileSync(new URL("./pages.json", import.meta.url), "utf8"),
  ) as PageList;
  for (const page of list.pages) {
    if (!(page.seed in SEEDS)) {
      throw new Error(
        `pages.json gives page ${page.name} the seed "${page.seed}", which is not in SEEDS in test/screenshots/seeds.ts`,
      );
    }
    if (page.cancel && page.user === null) {
      throw new Error(
        `pages.json cancels sign-in for page ${page.name}, which has no user to sign in`,
      );
    }
    if (page.submit && page.user === null) {
      throw new Error(
        `pages.json submits a form for page ${page.name}, which has no user to sign in`,
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
  let mapBrowser: Browser | undefined;
  try {
    for (const page of list.pages) {
      // A fresh Worker per page, so one page's seed cannot show on another.
      const run = new E2ERun();
      try {
        const e2e = await run.start();
        const seed = SEEDS[page.seed];
        if (seed) await seed(e2e);
        const submitted = page.submit ? await submit(e2e.url, page) : null;
        for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
          for (const scheme of SCHEMES) {
            const file = screenshotFile(page.name, viewport, scheme);
            if (page.map) mapBrowser ??= await launchBrowser({ webgl: true });
            const png = await capture(
              page.map && mapBrowser ? mapBrowser : browser,
              e2e.url,
              page,
              viewport,
              scheme,
              submitted,
            );
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
    await mapBrowser?.close();
  }

  if (check) {
    for (const file of [...expected].sort()) {
      const hash = createHash("sha256")
        .update(readFileSync(join(outDir, file)))
        .digest("hex");
      console.log(`${hash}  ${OUT_DIR}/${file}`);
    }
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
  submitted: Submitted | null,
): Promise<Uint8Array> {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    const failures: string[] = [];
    const { path, cookie, answer } = submitted ?? (await signedIn(base, entry));
    const url = new URL(path, base);
    // The session (or, for a cancelled sign-in, the state) cookie, sent the
    // way the browser would send the one the Worker set.
    if (cookie !== "") await page.setExtraHTTPHeaders({ Cookie: cookie });
    // Avatars and server icons come from the stand-in for Discord's CDN.
    await page.setRequestInterception(true);
    // A form's answer that is not a redirect is the page, as it came.
    page.on("request", (request) => {
      const reply =
        answer && request.isNavigationRequest() && request.url() === url.href
          ? answer
          : entry.javascript === false && request.resourceType() === "script"
          ? NO_SCRIPT
          : cdnReply(request.url());
      void (reply ? request.respond(reply) : request.continue());
    });
    page.on("requestfailed", (request) => {
      failures.push(
        `${request.url()} failed: ${request.failure()?.errorText ?? "unknown error"}`,
      );
    });
    page.on("response", (response) => {
      if (response.url() === url.href || isMissingPicture(response.url())) {
        return;
      }
      if (response.status() >= 400) {
        failures.push(
          `${response.url()} answered ${String(response.status())}`,
        );
      }
    });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const from = message.location().url ?? "";
      if (from === url.href || isMissingPicture(from)) return;
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
    await page.evaluate(CSS_IMAGES_READY);
    if (entry.javascript !== false) {
      await page.waitForFunction(MAPS_SETTLED, { timeout: 60_000 });
      // Two frames more, so the maps' last drawing has reached the screen.
      await page.evaluate(TWO_FRAMES);
      const failed = Number(await page.evaluate(MAPS_FAILED));
      if (failed > 0) failures.push(`${String(failed)} map(s) failed to draw`);
    }
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
 * Signs the page's `user` in through the fake Discord API, as a browser
 * would, and returns the path to open and the cookies to send. A signed-out
 * page opens its own path with no cookie; a cancelled sign-in opens the
 * callback address Discord sent back, with the state cookie.
 */
async function signedIn(base: URL, entry: ScreenshotPage): Promise<Submitted> {
  if (entry.user === null) return { path: entry.path, cookie: "" };
  const client = new PageClient(base);
  const user = { id: entry.user };
  if (entry.cancel) {
    const path = await client.authorize(user, { cancel: true });
    return { path, cookie: client.cookieHeader() };
  }
  const back = await client.signIn(user);
  if (back.status !== 303) {
    throw new Error(
      `${entry.name}: signing in ${entry.user} answered ${String(back.status)}`,
    );
  }
  return { path: entry.path, cookie: client.cookieHeader() };
}

/** Where a page's shots open after its `submit`, and with what. */
interface Submitted {
  path: string;
  cookie: string;
  /** The form's answer, when it was not a redirect: shown as the page. */
  answer?: { status: number; headers: Record<string, string>; body: string };
}

/**
 * Signs the page's `user` in, opens `submit.from` and submits its form, as
 * a browser would, and returns the path to open and the cookies to send:
 * the session and whatever the submission set; with the answer itself when
 * it was not a redirect.
 */
async function submit(base: URL, entry: ScreenshotPage): Promise<Submitted> {
  const { submit: form, user } = entry;
  if (!form || user === null) throw new Error(`${entry.name} submits nothing`);
  const client = new PageClient(base);
  const back = await client.signIn({ id: user });
  if (back.status !== 303) {
    throw new Error(
      `${entry.name}: signing in ${user} answered ${String(back.status)}`,
    );
  }
  const from = await client.get(form.from);
  const answer = await client.submitForm(from, form.action, form.fields);
  if (answer.status === 303) {
    return { path: entry.path, cookie: client.cookieHeader() };
  }
  return {
    path: entry.path,
    cookie: client.cookieHeader(),
    answer: {
      status: answer.status,
      headers: Object.fromEntries(answer.headers),
      body: answer.body,
    },
  };
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

/**
 * Resolves once every image the page's CSS uses (backgrounds and masks, on
 * elements and their ::before and ::after) is decoded and a frame has been
 * painted with them, so a shot never catches a mask that has not arrived.
 * A string for the same reason as `FREEZE_CLOCK`.
 */
const CSS_IMAGES_READY = `(async () => {
  const urls = new Set();
  for (const element of document.querySelectorAll("*")) {
    for (const pseudo of [null, "::before", "::after"]) {
      const style = getComputedStyle(element, pseudo);
      for (const value of [style.backgroundImage, style.maskImage, style.webkitMaskImage]) {
        for (const match of (value || "").matchAll(/url\\("?([^")]+)"?\\)/g)) urls.add(match[1]);
      }
    }
  }
  await Promise.all([...urls].map((url) => {
    const image = new Image();
    image.src = url;
    return image.decode().catch(() => undefined);
  }));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
})()`;

/** The answer to a script request of a page shown without JavaScript. */
const NO_SCRIPT = { status: 200, contentType: "text/javascript", body: "" };

/**
 * True once every map view on the page has drawn (`data-map-state` set to
 * `idle` by `public/assets/maps/map-view.mjs`), found no map data
 * (`none`) or given up (`failed`).
 */
const MAPS_SETTLED = `[...document.querySelectorAll("figure[data-map]")].every((figure) =>
  ["idle", "none", "failed"].includes(figure.dataset.mapState))`;

const TWO_FRAMES = `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`;

/** How many map views gave up. */
const MAPS_FAILED = `document.querySelectorAll('figure[data-map][data-map-state="failed"]').length`;

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
