/**
 * The test run's global setup (`vitest.config.ts`): unpacks the
 * screenshots' Chromium once, before any test file starts, so the browser
 * tests that run in parallel processes (`test/e2e/map-browser.test.ts`,
 * `test/e2e/press-browser.test.ts`, `audit.test.ts` here) never start it
 * while another is still writing it (`unpackChromium` in `browser.ts`).
 *
 * Unpacking points `TMPDIR` (and the package's library path) at the
 * browser's directory. The test processes inherit this process's
 * environment, and a `TMPDIR` left there would put their `CHROMIUM_DIR`
 * inside it, where each would unpack its own copy at once: the environment
 * is put back as it was.
 */
import { unpackChromium } from "./browser";

export default async function setup(): Promise<void> {
  const saved = { ...process.env };
  try {
    await unpackChromium();
  } finally {
    for (const name of Object.keys(process.env)) {
      if (!(name in saved)) Reflect.deleteProperty(process.env, name);
    }
    Object.assign(process.env, saved);
  }
}
