/**
 * The test run's global setup (`vitest.config.ts`): unpacks the
 * screenshots' Chromium once, before any test file starts, so the browser
 * tests that run in parallel processes (`test/e2e/map-browser.test.ts`,
 * `test/e2e/press-browser.test.ts`, `audit.test.ts` here) never start it
 * while another is still writing it (`unpackChromium` in `browser.ts`).
 */
import { unpackChromium } from "./browser";

export default async function setup(): Promise<void> {
  await unpackChromium();
}
