import { describe, expect, it } from "vitest";
import { ageText } from "../../src/web/age";

const AT = Date.UTC(2026, 11, 3, 15, 0);
const ZONE = "America/Los_Angeles";

describe("ageText", () => {
  it.each([
    [0, "just now"],
    [4_999, "just now"],
    [5_000, "5 s ago"],
    [12_000, "12 s ago"],
    [59_999, "59 s ago"],
    [60_000, "1 min ago"],
    [14 * 60_000 + 30_000, "14 min ago"],
    [3_600_000, "1 h ago"],
    [3 * 3_600_000 + 59 * 60_000, "3 h ago"],
    [24 * 3_600_000 - 1, "23 h ago"],
    // From a day on, the date and time as the bot writes them, in the zone.
    [24 * 3_600_000, "Thu, 3 Dec 2026 · 07:00"],
    [2 * 24 * 3_600_000, "Thu, 3 Dec 2026 · 07:00"],
  ])("writes an age of %i ms as %s", (age, words) => {
    expect(ageText(AT, AT + age, ZONE)).toBe(words);
  });

  it("never writes 0 s or m for minutes, and calls an instant ahead of the clock just now", () => {
    expect(ageText(AT, AT - 60_000, ZONE)).toBe("just now");
    for (let age = 0; age < 3_600_000; age += 997) {
      expect(ageText(AT, AT + age, ZONE)).not.toMatch(/^0 s|\d m\b/);
    }
  });
});
