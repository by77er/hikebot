/**
 * Set map pin as the web page's admin control, inside a real guild object
 * through its `adminAction` method: the object asks Discord whether the
 * user is an admin at that moment, then sets the pin as the panel's modal
 * does, running the panel's hooks.
 */
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PIN_UNREADABLE } from "../../src/features/map-pin";
import { PollStore } from "../../src/polls/store";
import { discordFetch } from "../guild/web-view-helpers";
import { completeRound } from "../polls/helpers";

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
  const set = (userId: string, text: string, target = roundId) =>
    stub.adminAction({
      guildId,
      userId,
      action: "set-map-pin",
      target,
      text,
    });
  return { stub, roundId, pin, set };
}

describe("Set map pin from the web, in the guild object", () => {
  it("sets the pin for the owner and for a member with the admin role, with the panel's notes", async () => {
    const g = await setUp();
    expect(
      await g.set(
        OWNER,
        "https://www.openstreetmap.org/#map=15/47.4875/-121.7234",
      ),
    ).toMatchObject({
      kind: "done",
      notes: ["The map pin of **Ridge** is set to 47.4875, -121.7234."],
      finishing: false,
    });
    expect(await g.pin()).toMatchObject({
      status: "given",
      point: { lat: 47.4875, lon: -121.7234 },
    });
    expect(await g.set(ADMIN, "  ")).toMatchObject({
      kind: "done",
      notes: ["The map pin of **Ridge** is removed."],
    });
    expect(await g.pin()).toMatchObject({ status: "cleared", point: null });
    // The forecast's job the pin scheduled runs while Discord is faked.
    expect(await runDurableObjectAlarm(g.stub)).toBe(true);
  });

  it("refuses a member who is not an admin, and someone who is not a member, changing nothing", async () => {
    const g = await setUp();
    expect(await g.set(MEMBER, "47.4875, -121.7234")).toEqual({
      kind: "forbidden",
    });
    expect(await g.set(STRANGER, "47.4875, -121.7234")).toEqual({
      kind: "not_member",
    });
    expect((await g.pin())?.point ?? null).toBeNull();
  });

  it("refuses input with no coordinates in it, and a round that is not the one to pin, with the panel's sentences", async () => {
    const g = await setUp();
    expect(await g.set(OWNER, "Mailbox Peak")).toEqual({
      kind: "refused",
      code: "unreadable",
      message: PIN_UNREADABLE,
    });
    expect(await g.set(OWNER, "1".repeat(1001))).toMatchObject({
      code: "unreadable",
    });
    expect(
      await g.set(OWNER, "47.4875, -121.7234", g.roundId + 1),
    ).toMatchObject({ kind: "refused", code: "not_pinnable" });
    expect((await g.pin())?.point ?? null).toBeNull();
  });
});
