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
 * The package turns WebGL off; the interactive map needs it, so it is
 * turned back on, drawn in software by SwiftShader, which the package
 * ships, so no GPU of the machine's is involved.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "puppeteer-core";

/** Where the package unpacks; delete it to unpack again from npm. */
export const CHROMIUM_DIR = join(tmpdir(), "hikebot-chromium");

export async function launchBrowser(): Promise<Browser> {
  if (
    existsSync(join(CHROMIUM_DIR, "chromium")) &&
    !existsSync(join(CHROMIUM_DIR, "al2023", "lib"))
  ) {
    rmSync(CHROMIUM_DIR, { recursive: true, force: true });
  }
  const fontconfig = join(CHROMIUM_DIR, "fontconfig");
  mkdirSync(fontconfig, { recursive: true });
  writeFileSync(
    join(fontconfig, "fonts.conf"),
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${join(CHROMIUM_DIR, "fonts")}</dir>
  <cachedir>${join(CHROMIUM_DIR, "fonts-cache")}</cachedir>
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
        (arg) => arg !== "--single-process" && arg !== "--disable-webgl",
      ),
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--hide-scrollbars",
      "--lang=en-US",
    ],
    executablePath: await chromium.executablePath(),
    headless: "shell",
    defaultViewport: null,
  });
}
