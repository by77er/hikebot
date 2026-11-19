import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actOnGuild, readGuild } from "../../src/web/guild";
import { discordFetch, paths } from "../guild/web-view-helpers";

const GUILD = "200000000000005001";
const OWNER = "400000000000000001";
const MEMBER = "400000000000000002";
const STRANGER = "400000000000000003";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readGuild", () => {
  it("reads the guild object's view through the binding", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      discordFetch({
        id: GUILD,
        name: "Trail Friends",
        ownerId: OWNER,
        members: { [OWNER]: [], [MEMBER]: [] },
      }),
    );
    const result = await readGuild(env, GUILD, MEMBER, { pageSize: 5 });
    expect(result).toMatchObject({
      kind: "view",
      view: {
        server: { id: GUILD, name: "Trail Friends" },
        viewer: { userId: MEMBER, isAdmin: false },
        round: null,
        log: { page: 1, pageSize: 5, total: 0 },
      },
    });
    expect(await readGuild(env, GUILD, OWNER)).toMatchObject({
      view: { viewer: { userId: OWNER, isAdmin: true } },
    });
    expect(await readGuild(env, GUILD, STRANGER)).toStrictEqual({
      kind: "not_member",
    });
  });

  it("answers not_member for ids that cannot be Discord's, asking no one", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const [guildId, userId] of [
      ["../admin", MEMBER],
      [GUILD, "me"],
      ["", ""],
      ["1234", MEMBER],
    ] as const) {
      expect(await readGuild(env, guildId, userId)).toStrictEqual({
        kind: "not_member",
      });
    }
    expect(paths(fetch)).toEqual([]);
  });
});

describe("actOnGuild", () => {
  const ACTION_GUILD = "200000000000005002";
  const start = {
    action: "start-location-vote",
    target: null,
    text: "Ridge Trail",
  } as const;

  it("runs an admin's control in the guild object through the binding", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      discordFetch({
        id: ACTION_GUILD,
        name: "Trail Friends",
        ownerId: OWNER,
        members: { [OWNER]: [], [MEMBER]: [] },
      }),
    );
    expect(await actOnGuild(env, ACTION_GUILD, MEMBER, start)).toStrictEqual({
      kind: "forbidden",
    });
    expect(await actOnGuild(env, ACTION_GUILD, STRANGER, start)).toStrictEqual({
      kind: "not_member",
    });
    // The owner gets as far as the round action, which wants setup first.
    expect(await actOnGuild(env, ACTION_GUILD, OWNER, start)).toMatchObject({
      kind: "refused",
      code: "setup_incomplete",
    });
  });

  it("answers not_member for ids that cannot be Discord's, asking no one", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const [guildId, userId] of [
      ["../admin", MEMBER],
      [ACTION_GUILD, "me"],
      ["", ""],
      ["1234", MEMBER],
    ] as const) {
      expect(await actOnGuild(env, guildId, userId, start)).toStrictEqual({
        kind: "not_member",
      });
    }
    expect(paths(fetch)).toEqual([]);
  });
});
