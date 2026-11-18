import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  calendarAddress,
  calendarGuild,
  calendarPath,
} from "../../src/calendar/address";
import { sign } from "../../src/signing";

const GUILD = "220000000000000101";
const OTHER = "220000000000000102";

describe("calendarAddress", () => {
  it("is the signed path on PUBLIC_URL", async () => {
    const signature = await sign(env.SIGNING_SECRET, "calendar", GUILD);
    expect(await calendarAddress(env, GUILD)).toBe(
      `https://hikebot.example/calendar/${GUILD}/${signature}.ics`,
    );
    expect(await calendarPath(env, GUILD)).toBe(
      `/calendar/${GUILD}/${signature}.ics`,
    );
  });

  it("differs per guild and is the same every time", async () => {
    expect(await calendarAddress(env, GUILD)).toBe(
      await calendarAddress(env, GUILD),
    );
    expect(await calendarAddress(env, GUILD)).not.toBe(
      await calendarAddress(env, OTHER),
    );
  });
});

describe("calendarGuild", () => {
  it("reads the guild back from its own address", async () => {
    expect(await calendarGuild(env, await calendarPath(env, GUILD))).toBe(
      GUILD,
    );
  });

  it("refuses a wrong, changed, truncated, missing or other guild's signature", async () => {
    const signature = await sign(env.SIGNING_SECRET, "calendar", GUILD);
    const other = await sign(env.SIGNING_SECRET, "calendar", OTHER);
    const session = await sign(env.SIGNING_SECRET, "session", GUILD);
    const changed = `${signature.slice(0, 5)}${signature[5] === "A" ? "B" : "A"}${signature.slice(6)}`;
    for (const path of [
      `/calendar/${GUILD}/${changed}.ics`,
      `/calendar/${GUILD}/${signature.slice(0, -1)}.ics`,
      `/calendar/${GUILD}/.ics`,
      `/calendar/${GUILD}.ics`,
      `/calendar/${GUILD}/${other}.ics`,
      `/calendar/${GUILD}/${session}.ics`,
      `/calendar/${GUILD}/${signature}`,
      `/calendar/${GUILD}/${signature}.ics/extra`,
      `/calendar/${GUILD}/x/${signature}.ics`,
    ]) {
      expect(await calendarGuild(env, path), path).toBeNull();
    }
  });

  it("refuses an id that is not a snowflake, even when it is signed", async () => {
    for (const id of ["log", "0220000000000000101", "1234", "1".repeat(21)]) {
      const signature = await sign(env.SIGNING_SECRET, "calendar", id);
      expect(
        await calendarGuild(env, `/calendar/${id}/${signature}.ics`),
        id,
      ).toBeNull();
    }
  });
});
