/**
 * The web pages' admin action, `runWebAction`, inside a real guild object
 * with a Discord client that answers from a `DiscordGuild`: it asks
 * Discord afresh, at the moment of the action, whether the user is a
 * member and an admin (owner or admin role), refuses everyone else without
 * changing anything, and runs the control as the user. Also checks that
 * only an admin's view carries the `admin` section.
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuildConfig } from "../../src/guild/config";
import {
  runWebAction,
  type WebActionRequest,
  type WebActionResult,
} from "../../src/guild/web-action";
import {
  readWebView,
  WebViewCache,
  type WebViewResult,
} from "../../src/guild/web-view";
import { PollStore } from "../../src/polls/store";
import { discordFor, paths, type DiscordGuild } from "./web-view-helpers";

const OWNER = "700000000000009601";
const MEMBER = "700000000000009602";
const ROLE_MEMBER = "700000000000009603";
const STRANGER = "700000000000009604";
const ADMIN_ROLE = "800000000000009601";
const OTHER_ROLE = "800000000000009602";
const VOTE = "300000000000009601";
const NEWS = "300000000000009602";
const FORUM = "300000000000009603";
const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);

afterEach(() => {
  vi.restoreAllMocks();
});

let counter = 0;

/** A fresh guild's object, and a Discord that knows the guild. */
function freshGuild(overrides: Partial<DiscordGuild> = {}) {
  counter++;
  const id = `2000000000000096${String(10 + counter)}`;
  const guild: DiscordGuild = {
    id,
    name: "Trail Friends",
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
 * Stubs the global `fetch` the round actions' Discord work goes through,
 * answering every request with a new id.
 */
function stubWork() {
  let next = 700000000000009690n;
  return vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    next += 1n;
    return Promise.resolve(Response.json({ id: String(next) }));
  });
}

/**
 * Runs `body` inside the guild's object, its settings complete and its
 * admin role set, with a cache and a Discord client of its own, an
 * `act(userId, now)` that starts a location vote through `runWebAction`
 * and a `read(userId, now)` through `readWebView`.
 */
function inObject<T>(
  stub: DurableObjectStub,
  guild: DiscordGuild,
  body: (tools: {
    act: (userId: string, now: number) => Promise<WebActionResult>;
    read: (userId: string, now: number) => Promise<WebViewResult>;
    store: PollStore;
    fetch: ReturnType<typeof discordFor>["fetch"];
  }) => Promise<T>,
): Promise<T> {
  return runInDurableObject(stub, (_instance, state) => {
    const config = new GuildConfig(state.storage);
    config.set("voteChannelId", VOTE);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
    config.set("adminRoleId", ADMIN_ROLE);
    const { api, fetch } = discordFor(guild);
    const cache = new WebViewCache();
    const context = { env, storage: state.storage };
    const act = (userId: string, now: number) => {
      const request: WebActionRequest = {
        guildId: guild.id,
        userId,
        action: "start-location-vote",
        target: null,
        text: "Ridge Trail\nLake Loop",
      };
      return runWebAction(context, cache, request, { api, now });
    };
    const read = (userId: string, now: number) =>
      readWebView(context, cache, { guildId: guild.id, userId }, { api, now });
    return body({ act, read, store: new PollStore(state.storage), fetch });
  });
}

describe("runWebAction", () => {
  it("forbids a member who is neither owner nor holds the admin role, and changes nothing", async () => {
    const { guild, stub } = freshGuild();
    const work = stubWork();
    await inObject(stub, guild, async ({ act, store, fetch }) => {
      expect(await act(MEMBER, T0)).toStrictEqual({ kind: "forbidden" });
      expect(store.getActiveRound()).toBeNull();
      expect(store.getLastRound()).toBeNull();
      expect(paths(fetch)).toContain(`/guilds/${guild.id}/members/${MEMBER}`);
      expect(work).not.toHaveBeenCalled();
    });
  });

  it("lets the owner start a location vote, as its starter", async () => {
    const { guild, stub } = freshGuild();
    stubWork();
    await inObject(stub, guild, async ({ act, store }) => {
      const result = await act(OWNER, T0);
      expect(result).toMatchObject({
        kind: "done",
        notes: [`The location vote is open in <#${VOTE}>.`],
        finishing: false,
      });
      const round = store.getActiveRound();
      expect(round?.startedBy).toBe(OWNER);
      expect(round?.locationPoll?.options.map((o) => o.proposedBy)).toEqual([
        OWNER,
        OWNER,
      ]);
    });
  });

  it("lets a member with the admin role start a location vote, as its starter", async () => {
    const { guild, stub } = freshGuild();
    stubWork();
    await inObject(stub, guild, async ({ act, store }) => {
      expect((await act(ROLE_MEMBER, T0)).kind).toBe("done");
      expect(store.getActiveRound()?.startedBy).toBe(ROLE_MEMBER);
    });
  });

  it("asks Discord afresh even when the cache holds a fresh answer", async () => {
    const { guild, stub } = freshGuild();
    const work = stubWork();
    await inObject(stub, guild, async ({ act, read, store, fetch }) => {
      const memberPath = `/guilds/${guild.id}/members/${ROLE_MEMBER}`;
      const result = await read(ROLE_MEMBER, T0);
      expect(result.kind === "view" && result.view.viewer.isAdmin).toBe(true);
      guild.members[ROLE_MEMBER] = [];

      expect(await act(ROLE_MEMBER, T0)).toStrictEqual({ kind: "forbidden" });
      expect(paths(fetch).filter((p) => p === memberPath)).toHaveLength(2);
      expect(store.getActiveRound()).toBeNull();
      expect(work).not.toHaveBeenCalled();
    });
  });

  it("answers not_member for a user who is not a member", async () => {
    const { guild, stub } = freshGuild();
    await inObject(stub, guild, async ({ act, store }) => {
      expect(await act(STRANGER, T0)).toStrictEqual({ kind: "not_member" });
      expect(store.getActiveRound()).toBeNull();
    });
  });

  it("answers unavailable when Discord fails other than 404", async () => {
    const { guild, stub } = freshGuild({ memberStatus: 500 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await inObject(stub, guild, async ({ act, store }) => {
      expect(await act(OWNER, T0)).toStrictEqual({ kind: "unavailable" });
      expect(store.getActiveRound()).toBeNull();
    });
  });
});

describe("the view's admin section", () => {
  it("is null for a plain member and given to the owner", async () => {
    const { guild, stub } = freshGuild();
    await inObject(stub, guild, async ({ read }) => {
      const member = await read(MEMBER, T0);
      if (member.kind !== "view") throw new Error(member.kind);
      expect(member.view.admin).toBeNull();
      const owner = await read(OWNER, T0);
      if (owner.kind !== "view") throw new Error(owner.kind);
      expect(owner.view.admin).not.toBeNull();
      expect(owner.view.admin?.actions.map((a) => a.label)).toEqual([
        "Start location vote",
      ]);
    });
  });
});
