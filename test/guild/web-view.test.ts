import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuildConfig } from "../../src/guild/config";
import { OWNER_CACHE_MS } from "../../src/guild/permissions";
import {
  MEMBER_CACHE_MS,
  readWebView,
  WebViewCache,
  type WebViewRequest,
  type WebViewResult,
} from "../../src/guild/web-view";
import { PollStore } from "../../src/polls/store";
import { completeRound } from "../polls/helpers";
import {
  discordFetch,
  discordFor,
  paths,
  type DiscordGuild,
} from "./web-view-helpers";

const OWNER = "700000000000000001";
const MEMBER = "700000000000000002";
const ROLE_MEMBER = "700000000000000003";
const STRANGER = "700000000000000004";
const ADMIN_ROLE = "800000000000000001";
const OTHER_ROLE = "800000000000000002";
const VOTE = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";
const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);

afterEach(() => {
  vi.restoreAllMocks();
});

let counter = 0;

/** A fresh guild's object, and a Discord that knows the guild. */
function freshGuild(overrides: Partial<DiscordGuild> = {}) {
  counter++;
  const id = `20000000000000${String(1000 + counter)}`;
  const guild: DiscordGuild = {
    id,
    name: "Trail Friends",
    icon: "abc123",
    ownerId: OWNER,
    members: {
      [OWNER]: [],
      [MEMBER]: [OTHER_ROLE],
      [ROLE_MEMBER]: [ADMIN_ROLE],
    },
    channels: { [VOTE]: "votes", [NEWS]: "news", [FORUM]: "hikes" },
    ...overrides,
  };
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(id));
  return { id, guild, stub };
}

/**
 * Runs `body` inside the guild's object with a cache and a Discord client
 * of its own, and a `read(userId, now)` over them.
 */
function inObject<T>(
  stub: DurableObjectStub,
  guild: DiscordGuild,
  body: (tools: {
    read: (
      userId: string,
      now: number,
      request?: Partial<WebViewRequest>,
    ) => Promise<WebViewResult>;
    storage: DurableObjectStorage;
    fetch: ReturnType<typeof discordFor>["fetch"];
    cache: WebViewCache;
  }) => Promise<T>,
): Promise<T> {
  return runInDurableObject(stub, (_instance, state) => {
    const { api, fetch } = discordFor(guild);
    const cache = new WebViewCache();
    const read = (
      userId: string,
      now: number,
      request: Partial<WebViewRequest> = {},
    ) =>
      readWebView(
        { env, storage: state.storage },
        cache,
        { guildId: guild.id, userId, ...request },
        { api, now },
      );
    return body({ read, storage: state.storage, fetch, cache });
  });
}

function viewOf(result: WebViewResult) {
  if (result.kind !== "view") throw new Error(`no view: ${result.kind}`);
  return result.view;
}

describe("who may see a server", () => {
  it("shows a member the server's name, icon and settings, and not as an admin", async () => {
    const { guild, stub } = freshGuild();
    await inObject(stub, guild, async ({ read, storage }) => {
      const config = new GuildConfig(storage);
      config.set("voteChannelId", VOTE);
      config.set("announceChannelId", NEWS);
      config.set("adminRoleId", ADMIN_ROLE);
      const view = viewOf(await read(MEMBER, T0));
      expect(view.server).toEqual({
        id: guild.id,
        name: "Trail Friends",
        iconUrl: `https://cdn.discordapp.com/icons/${guild.id}/abc123.png`,
      });
      expect(view.viewer).toEqual({ userId: MEMBER, isAdmin: false });
      expect(view.settings).toEqual({
        timeZone: "America/Los_Angeles",
        voteChannel: { id: VOTE, name: "votes" },
        announceChannel: { id: NEWS, name: "news" },
        forumChannel: null,
      });
    });
  });

  it("names a channel the server no longer has with a null name", async () => {
    const { guild, stub } = freshGuild({ icon: null });
    await inObject(stub, guild, async ({ read, storage }) => {
      new GuildConfig(storage).set("forumChannelId", "300000000000000099");
      const view = viewOf(await read(MEMBER, T0));
      expect(view.server.iconUrl).toBeNull();
      expect(view.settings.forumChannel).toEqual({
        id: "300000000000000099",
        name: null,
      });
    });
  });

  it("decides admin as Discord interactions do: owner, admin role, neither", async () => {
    const { guild, stub } = freshGuild();
    await inObject(stub, guild, async ({ read, storage }) => {
      new GuildConfig(storage).set("adminRoleId", ADMIN_ROLE);
      expect(viewOf(await read(OWNER, T0)).viewer.isAdmin).toBe(true);
      expect(viewOf(await read(ROLE_MEMBER, T0)).viewer.isAdmin).toBe(true);
      expect(viewOf(await read(MEMBER, T0)).viewer.isAdmin).toBe(false);
    });
  });

  it("gives a non-member nothing but the kind of the answer", async () => {
    const { guild, stub } = freshGuild();
    await inObject(stub, guild, async ({ read, storage, fetch }) => {
      new PollStore(storage).startRound(OWNER, [
        { label: "Ridge", proposedBy: OWNER },
      ]);
      expect(await read(STRANGER, T0)).toStrictEqual({ kind: "not_member" });
      expect(paths(fetch)).toEqual([`/guilds/${guild.id}/members/${STRANGER}`]);
    });
  });

  it("answers unavailable, with nothing else, when Discord fails other than 404", async () => {
    const { guild, stub } = freshGuild({ memberStatus: 500 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await inObject(stub, guild, async ({ read }) => {
      expect(await read(OWNER, T0)).toStrictEqual({ kind: "unavailable" });
      expect(await read(STRANGER, T0)).toStrictEqual({ kind: "unavailable" });
    });
  });

  it("answers unavailable when the guild cannot be read", async () => {
    const { guild, stub } = freshGuild({ guildStatus: 403 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await inObject(stub, guild, async ({ read }) => {
      expect(await read(MEMBER, T0)).toStrictEqual({ kind: "unavailable" });
    });
  });
});

describe("the membership cache", () => {
  it("trusts a member's roles for 60 seconds, then asks Discord again", async () => {
    const { guild, stub } = freshGuild();
    await inObject(stub, guild, async ({ read, storage, fetch }) => {
      new GuildConfig(storage).set("adminRoleId", ADMIN_ROLE);
      const memberPath = `/guilds/${guild.id}/members/${MEMBER}`;
      const asked = () => paths(fetch).filter((p) => p === memberPath).length;

      expect(viewOf(await read(MEMBER, T0)).viewer.isAdmin).toBe(false);
      guild.members[MEMBER] = [ADMIN_ROLE];
      const cached = await read(MEMBER, T0 + MEMBER_CACHE_MS - 1);
      expect(viewOf(cached).viewer.isAdmin).toBe(false);
      expect(asked()).toBe(1);

      const fresh = await read(MEMBER, T0 + MEMBER_CACHE_MS);
      expect(viewOf(fresh).viewer.isAdmin).toBe(true);
      expect(asked()).toBe(2);
    });
  });

  it("remembers a 404 for 60 seconds too", async () => {
    const { guild, stub } = freshGuild();
    await inObject(stub, guild, async ({ read }) => {
      expect((await read(STRANGER, T0)).kind).toBe("not_member");
      guild.members[STRANGER] = [];
      expect((await read(STRANGER, T0 + MEMBER_CACHE_MS - 1)).kind).toBe(
        "not_member",
      );
      expect((await read(STRANGER, T0 + MEMBER_CACHE_MS)).kind).toBe("view");
    });
  });

  it("forgets a member who left once the 60 seconds are up", async () => {
    const { guild, stub } = freshGuild();
    await inObject(stub, guild, async ({ read }) => {
      expect((await read(MEMBER, T0)).kind).toBe("view");
      delete guild.members[MEMBER];
      expect((await read(MEMBER, T0 + 1_000)).kind).toBe("view");
      expect((await read(MEMBER, T0 + MEMBER_CACHE_MS)).kind).toBe(
        "not_member",
      );
    });
  });

  it("does not cache a Discord error", async () => {
    const { guild, stub } = freshGuild({ memberStatus: 500 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await inObject(stub, guild, async ({ read }) => {
      expect((await read(MEMBER, T0)).kind).toBe("unavailable");
      delete guild.memberStatus;
      expect((await read(MEMBER, T0 + 1)).kind).toBe("view");
    });
  });

  it("keeps the server's name and channels for an hour, refreshing the owner with them", async () => {
    const { guild, stub } = freshGuild();
    await inObject(stub, guild, async ({ read, storage, fetch }) => {
      const guildPath = `/guilds/${guild.id}`;
      const asked = () => paths(fetch).filter((p) => p === guildPath).length;
      expect(viewOf(await read(OWNER, T0)).server.name).toBe("Trail Friends");
      expect(new GuildConfig(storage).get()).toMatchObject({
        ownerId: OWNER,
        ownerFetchedAt: T0,
      });
      guild.name = "Summit Club";
      guild.ownerId = MEMBER;
      const later = T0 + OWNER_CACHE_MS - 1;
      expect(viewOf(await read(OWNER, later)).server.name).toBe(
        "Trail Friends",
      );
      expect(asked()).toBe(1);
      const view = viewOf(await read(MEMBER, T0 + OWNER_CACHE_MS));
      expect(view.server.name).toBe("Summit Club");
      expect(view.viewer.isAdmin).toBe(true);
      expect(asked()).toBe(2);
    });
  });

  it("is forgotten when the object restarts", async () => {
    const { guild, stub } = freshGuild();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(discordFetch(guild));
    const memberPath = `/guilds/${guild.id}/members/${MEMBER}`;
    const asked = () => paths(fetch).filter((p) => p === memberPath).length;
    const request = { guildId: guild.id, userId: MEMBER };
    expect((await stub.webView(request)).kind).toBe("view");
    expect((await stub.webView(request)).kind).toBe("view");
    expect(asked()).toBe(1);
    await evictDurableObject(stub);
    expect((await stub.webView(request)).kind).toBe("view");
    expect(asked()).toBe(2);
  });
});

/**
 * Every row of every table, by table name, and the synchronous key-value
 * entries as `kv` (its own table cannot be read with SQL).
 */
function snapshot(storage: DurableObjectStorage): Record<string, unknown[]> {
  const tables = storage.sql
    .exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' ORDER BY name",
    )
    .toArray()
    .map((row) => row.name);
  return {
    ...Object.fromEntries(
      tables.map((name) => [
        name,
        storage.sql.exec(`SELECT * FROM "${name}"`).toArray(),
      ]),
    ),
    kv: [...storage.kv.list()],
  };
}

describe("the read", () => {
  it("writes nothing but the owner cache", async () => {
    const { guild, stub } = freshGuild();
    await inObject(stub, guild, async ({ read, storage }) => {
      const store = new PollStore(storage);
      completeRound(store, "Ridge", "2030-06-15");
      const round = store.startRound(OWNER, [
        { label: "Lake", proposedBy: OWNER },
      ]);
      store.setVotes(round.locationPoll?.id ?? 0, MEMBER, [
        round.locationPoll?.options[0]?.id ?? 0,
      ]);
      storage.kv.put("hike-thread:1", { error: "Missing Access" });
      const before = snapshot(storage);

      viewOf(await read(MEMBER, T0, { page: 2, pageSize: 5 }));
      viewOf(await read(OWNER, T0 + OWNER_CACHE_MS + 1));
      const after = snapshot(storage);

      const ownerCache = (rows: unknown[]) =>
        rows.map((row) => ({
          ...(row as object),
          owner_id: null,
          owner_fetched_at: null,
        }));
      expect({
        ...after,
        guild_settings: ownerCache(after.guild_settings ?? []),
      }).toEqual({
        ...before,
        guild_settings: ownerCache(before.guild_settings ?? []),
      });
      expect(after.guild_settings).toEqual([
        expect.objectContaining({
          owner_id: OWNER,
          owner_fetched_at: T0 + OWNER_CACHE_MS + 1,
        }),
      ]);
    });
  });

  it("returns plain data that survives structured cloning", async () => {
    const { guild, stub } = freshGuild();
    await inObject(stub, guild, async ({ read, storage }) => {
      const store = new PollStore(storage);
      completeRound(store, "Ridge", "2030-06-15");
      store.startRound(OWNER, [{ label: "Lake", proposedBy: OWNER }]);
      const result = await read(MEMBER, T0);
      expect(structuredClone(result)).toEqual(result);
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    });
  });

  it("falls back to ten hikes a page for a page size it does not take", async () => {
    const { guild, stub } = freshGuild();
    await inObject(stub, guild, async ({ read }) => {
      for (const pageSize of [0, 51, 2.5]) {
        expect(viewOf(await read(MEMBER, T0, { pageSize })).log.pageSize).toBe(
          10,
        );
      }
      expect(
        viewOf(await read(MEMBER, T0, { pageSize: 50 })).log.pageSize,
      ).toBe(50);
    });
  });
});
