import { describe, expect, it } from "vitest";
import { MAX_CONDITIONS, conditions } from "../../src/weather/wmo";

describe("conditions", () => {
  it.each([
    [0, "Clear"],
    [3, "Overcast"],
    [45, "Fog"],
    [55, "Dense drizzle"],
    [65, "Heavy rain"],
    [73, "Snow"],
    [81, "Showers"],
    [86, "Heavy snow showers"],
    [95, "Thunderstorm"],
    [99, "T-storm, big hail"],
  ])("names WMO code %i %s", (code, words) => {
    expect(conditions(code)).toBe(words);
  });

  it("writes ? for no code or one the table does not have", () => {
    expect(conditions(null)).toBe("?");
    expect(conditions(4)).toBe("?");
  });

  it("keeps every name short enough to end a row on a phone", () => {
    expect(MAX_CONDITIONS).toBeLessThanOrEqual(18);
  });
});
