import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PollStore } from "../../src/polls/store";
import { completeRound } from "../polls/helpers";
import { discordFetch } from "./web-view-helpers";

const OWNER = "400000000000000001";
const ADMIN = "400000000000000002";
const MEMBER = "400000000000000003";
const STRANGER = "400000000000000004";
const ADMIN_ROLE = "500000000000000001";

afterEach(() => {
  vi.restoreAllMocks();
});

let counter = 0;

/** A guild with a planned hike without a pin, and Discord answering for it. */
async function setUp() {
  counter++;
  const guildId = `20000000000000${String(6000 + counter)}`;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    discordFetch({
      id: guildId,
      ownerId: OWNER,
      members: { [OWNER]: [], [ADMIN]: [ADMIN_ROLE], [MEMBER]: [] },
    }),
  );
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
  const roundId = await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE guild_settings SET admin_role_id = ?",
      ADMIN_ROLE,
    );
    return completeRound(new PollStore(state.storage), "Ridge", "2030-06-15");
  });
  const pin = () =>
    runInDurableObject(stub, (_instance, state) => {
      const store = new PollStore(state.storage);
      const optionId = store.getRound(roundId)?.locationOptionId ?? 0;
      return store.getOption(optionId)?.place ?? null;
    });
  return { guildId, stub, roundId, pin };
}

describe("Set map pin from the web, in the guild object", () => {
  it("sets the pin for the owner and for a member with the admin role, as the panel does", async () => {
    const g = await setUp();
    expect(
      await g.stub.webSetMapPin({
        guildId: g.guildId,
        userId: OWNER,
        roundId: g.roundId,
        input: "https://www.openstreetmap.org/#map=15/47.4875/-121.7234",
      }),
    ).toEqual({
      kind: "set",
      location: "Ridge",
      point: "47.4875, -121.7234",
      notes: [],
    });
    expect(await g.pin()).toMatchObject({
      status: "given",
      point: { lat: 47.4875, lon: -121.7234 },
    });
    expect(
      await g.stub.webSetMapPin({
        guildId: g.guildId,
        userId: ADMIN,
        roundId: g.roundId,
        input: "  ",
      }),
    ).toMatchObject({ kind: "set", point: null });
    expect(await g.pin()).toMatchObject({ status: "cleared", point: null });
    // The forecast's job the pin scheduled runs while Discord is faked.
    expect(await runDurableObjectAlarm(g.stub)).toBe(true);
  });

  it("refuses a member who is not an admin, and someone who is not a member, changing nothing", async () => {
    const g = await setUp();
    for (const [userId, kind] of [
      [MEMBER, "not_admin"],
      [STRANGER, "not_member"],
    ] as const) {
      expect(
        await g.stub.webSetMapPin({
          guildId: g.guildId,
          userId,
          roundId: g.roundId,
          input: "47.4875, -121.7234",
        }),
      ).toEqual({ kind });
    }
    expect((await g.pin())?.point ?? null).toBeNull();
  });

  it("refuses input with no coordinates in it, and a round that is not the one to pin", async () => {
    const g = await setUp();
    const set = (roundId: number, input: string) =>
      g.stub.webSetMapPin({
        guildId: g.guildId,
        userId: OWNER,
        roundId,
        input,
      });
    expect(await set(g.roundId, "Mailbox Peak")).toEqual({
      kind: "unreadable",
    });
    expect(await set(g.roundId, "1".repeat(1001))).toEqual({
      kind: "unreadable",
    });
    expect(await set(g.roundId + 1, "47.4875, -121.7234")).toEqual({
      kind: "not_pinnable",
    });
    expect((await g.pin())?.point ?? null).toBeNull();
  });
});
