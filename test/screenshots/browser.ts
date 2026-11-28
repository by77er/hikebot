/**
 * Launches headless Chromium from the `@sparticuz/chromium` package, which
 * ships the browser, its shared libraries and its fonts inside the npm
 * tarball, so nothing is downloaded at run time.
 *
 * The package unpacks its bundled libraries (libnss, libnspr) and points
 * `LD_LIBRARY_PATH` at them only when `AWS_LAMBDA_JS_RUNTIME` names a
 * Node.js runtime at the moment it is first imported; without them Chromium
 * exits with `libnspr4.so: cannot open shared object file`. It unpacks into
 * the process's temporary directory, here `CHROMIUM_DIR`, so nothing else in
 * the system's temporary directory is touched, and it skips unpacking when
 * `chromium` is already there, so a copy left by a run without the
 * libraries is deleted first. Fontconfig is given only the fonts the
 * package unpacks (Open Sans), so pages render the same whichever fonts the
 * machine has installed.
 *
 * The package turns WebGL off. The interactive map needs it, so with
 * `webgl` it is turned back on, drawn in software by SwiftShader, which the
 * package ships, so no GPU of the machine's is involved. That also changes
 * how every page is composited, so only pages with a map are taken with it.
 * That browser's fonts also include Noto Sans, the map picture's fallback
 * (`src/maps/fonts/`), as members' devices have a font for the characters
 * Public Sans lacks (such as the marks in `Mount Si / q̓əlbc̓`), which the
 * map's labels fall back to.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "puppeteer-core";

/** Where the package unpacks; delete it to unpack again from npm. */
export const CHROMIUM_DIR = join(tmpdir(), "hikebot-chromium");

const MAP_FONTS = fileURLToPath(
  new URL("../../src/maps/fonts/", import.meta.url),
);

/**
 * Unpacks Chromium and its libraries into `CHROMIUM_DIR`, unless they are
 * there already, and returns the browser's path. The package treats the
 * binary as ready as soon as its file exists, so two processes unpacking at
 * once can start it half-written (`spawn ETXTBSY`): a run that starts
 * browsers in several processes, such as the end-to-end suite's browser
 * tests, calls this once before them (`test/e2e/harness/chromium.ts`).
 */
export async function unpackChromium(): Promise<string> {
  if (
    existsSync(join(CHROMIUM_DIR, "chromium")) &&
    !existsSync(join(CHROMIUM_DIR, "al2023", "lib"))
  ) {
    rmSync(CHROMIUM_DIR, { recursive: true, force: true });
  }
  mkdirSync(CHROMIUM_DIR, { recursive: true });
  process.env.TMPDIR = CHROMIUM_DIR;
  process.env.AWS_LAMBDA_JS_RUNTIME = "nodejs22.x";
  const { default: chromium } = await import("@sparticuz/chromium");
  return chromium.executablePath();
}

export async function launchBrowser(
  options: { webgl?: boolean } = {},
): Promise<Browser> {
  const executablePath = await unpackChromium();
  const fontconfig = join(
    CHROMIUM_DIR,
    options.webgl ? "fontconfig-map" : "fontconfig",
  );
  mkdirSync(fontconfig, { recursive: true });
  const fallback = join(CHROMIUM_DIR, "map-fonts");
  if (options.webgl) {
    mkdirSync(fallback, { recursive: true });
    for (const file of readdirSync(MAP_FONTS)) {
      if (file.startsWith("NotoSans-") && file.endsWith(".ttf")) {
        copyFileSync(join(MAP_FONTS, file), join(fallback, file));
      }
    }
  }
  writeFileSync(
    join(fontconfig, "fonts.conf"),
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${join(CHROMIUM_DIR, "fonts")}</dir>${options.webgl ? `\n  <dir>${fallback}</dir>` : ""}
  <cachedir>${join(CHROMIUM_DIR, options.webgl ? "fonts-cache-map" : "fonts-cache")}</cachedir>
</fontconfig>
`,
  );
  process.env.TMPDIR = CHROMIUM_DIR;
  process.env.FONTCONFIG_PATH = fontconfig;
  process.env.AWS_LAMBDA_JS_RUNTIME = "nodejs22.x";
  const { default: chromium } = await import("@sparticuz/chromium");
  const { default: puppeteer } = await import("puppeteer-core");
  chromium.setGraphicsMode = false;
  return puppeteer.launch({
    // --single-process makes Chromium exit when a second browser context
    // opens a page, and each screenshot gets a context of its own.
    args: [
      ...chromium.args.filter(
        (arg) =>
          arg !== "--single-process" &&
          !(options.webgl && arg === "--disable-webgl"),
      ),
      ...(options.webgl
        ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
        : []),
      "--hide-scrollbars",
      "--lang=en-US",
    ],
    executablePath,
    headless: "shell",
    defaultViewport: null,
  });
}
