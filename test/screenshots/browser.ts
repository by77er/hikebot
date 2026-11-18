/**
 * Launches headless Chromium from the `@sparticuz/chromium` package, which
 * ships the browser, its shared libraries and its fonts inside the npm
 * tarball, so nothing is downloaded at run time.
 *
 * The package unpacks its bundled libraries (libnss, libnspr) and points
 * `LD_LIBRARY_PATH` at them only when `AWS_LAMBDA_JS_RUNTIME` names a
 * Node.js runtime at the moment it is first imported; without them Chromium
 * exits with `libnspr4.so: cannot open shared object file`. It unpacks into
 * the temporary directory and skips unpacking when `chromium` is already
 * there, so a copy left by a run without the libraries is deleted first.
 * `FONTCONFIG_PATH` points at the fonts it unpacks (Open Sans only), so
 * pages render the same whichever fonts the machine has installed.
 */
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "puppeteer-core";

const TMP = tmpdir();
/** Everything `@sparticuz/chromium` unpacks into the temporary directory. */
const UNPACKED = [
  "chromium",
  "al2023",
  "fonts",
  "fonts-cache",
  "swiftshader",
  "libEGL.so",
  "libGLESv2.so",
  "libvk_swiftshader.so",
  "libvulkan.so.1",
  "vk_swiftshader_icd.json",
  "locales",
];

export async function launchBrowser(): Promise<Browser> {
  if (
    existsSync(join(TMP, "chromium")) &&
    !existsSync(join(TMP, "al2023", "lib"))
  ) {
    for (const name of UNPACKED) {
      rmSync(join(TMP, name), { recursive: true, force: true });
    }
  }
  process.env.AWS_LAMBDA_JS_RUNTIME = "nodejs22.x";
  process.env.FONTCONFIG_PATH = join(TMP, "fonts");
  const { default: chromium } = await import("@sparticuz/chromium");
  const { default: puppeteer } = await import("puppeteer-core");
  chromium.setGraphicsMode = false;
  return puppeteer.launch({
    args: [
      ...chromium.args.filter((arg) => arg !== "--single-process"),
      "--hide-scrollbars",
      "--lang=en-US",
    ],
    executablePath: await chromium.executablePath(),
    headless: "shell",
    defaultViewport: null,
  });
}
