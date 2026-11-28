/**
 * The end-to-end suite's global setup: unpacks the screenshots' Chromium
 * once, before any test file starts, so the browser tests that run in
 * parallel processes (`map-browser.test.ts`, `press-browser.test.ts`) never
 * start it while another is still writing it (`unpackChromium` in
 * test/screenshots/browser.ts).
 */
import { unpackChromium } from "../../screenshots/browser";

export default async function setup(): Promise<void> {
  await unpackChromium();
}
