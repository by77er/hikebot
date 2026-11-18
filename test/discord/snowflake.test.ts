import { describe, expect, it } from "vitest";
import {
  DISCORD_EPOCH_MS,
  snowflakeAt,
  snowflakeTime,
} from "../../src/discord/snowflake";

describe("snowflakeTime", () => {
  it("reads the creation time of Discord's documented example id", () => {
    // https://docs.discord.com/developers/reference#snowflakes
    expect(snowflakeTime("175928847299117063")).toBe(1_462_015_105_796);
  });

  it("is Discord's epoch for the id 0", () => {
    expect(snowflakeTime("0")).toBe(DISCORD_EPOCH_MS);
    expect(new Date(DISCORD_EPOCH_MS).toISOString()).toBe(
      "2015-01-01T00:00:00.000Z",
    );
  });
});

describe("snowflakeAt", () => {
  it("makes an id whose time reads back unchanged", () => {
    const time = Date.UTC(2026, 10, 18, 12, 0, 0, 123);
    expect(snowflakeTime(snowflakeAt(time))).toBe(time);
  });

  it("makes the smallest id of that millisecond", () => {
    const time = 1_462_015_105_796;
    expect(BigInt(snowflakeAt(time))).toBeLessThanOrEqual(175928847299117063n);
    expect(snowflakeTime(String(BigInt(snowflakeAt(time)) - 1n))).toBe(
      time - 1,
    );
  });
});
