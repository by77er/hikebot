import { expect, it } from "vitest";
import { systemNow } from "../src/clock";

it("reads the system clock in milliseconds since the epoch", () => {
  const before = Date.now();
  const now = systemNow();
  expect(now).toBeGreaterThanOrEqual(before);
  expect(now).toBeLessThanOrEqual(Date.now());
});
