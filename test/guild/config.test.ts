import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  GuildConfig,
  setupComplete,
  type GuildSettings,
} from "../../src/guild/config";

function stubFor(name: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(name));
}

const empty: GuildSettings = {
  adminRoleId: null,
  voteChannelId: null,
  announceChannelId: null,
  forumChannelId: null,
  ownerId: null,
  ownerFetchedAt: null,
  timezone: "America/Los_Angeles",
  homeArea: null,
};

describe("GuildConfig", () => {
  it("starts with every setting unset", async () => {
    const settings = await runInDurableObject(
      stubFor("config-empty"),
      (_instance, state) => new GuildConfig(state.storage).get(),
    );
    expect(settings).toEqual(empty);
  });

  it("sets, returns and clears each setting", async () => {
    await runInDurableObject(stubFor("config-set"), (_instance, state) => {
      const config = new GuildConfig(state.storage);
      expect(config.set("adminRoleId", "11")).toEqual({
        ...empty,
        adminRoleId: "11",
      });
      config.set("voteChannelId", "12");
      config.set("announceChannelId", "13");
      expect(config.set("forumChannelId", "14")).toEqual({
        ...empty,
        adminRoleId: "11",
        voteChannelId: "12",
        announceChannelId: "13",
        forumChannelId: "14",
      });
      expect(config.set("adminRoleId", null).adminRoleId).toBeNull();
      expect(config.get().voteChannelId).toBe("12");
    });
  });

  it("defaults the time zone to America/Los_Angeles until one is set", async () => {
    const stub = stubFor("config-timezone");
    await runInDurableObject(stub, (_instance, state) => {
      const config = new GuildConfig(state.storage);
      expect(config.get().timezone).toBe("America/Los_Angeles");
      expect(config.setTimezone("Europe/Berlin")).toEqual({
        ...empty,
        timezone: "Europe/Berlin",
      });
      config.set("voteChannelId", "12");
      expect(config.get()).toMatchObject({
        voteChannelId: "12",
        timezone: "Europe/Berlin",
      });
    });
    await evictDurableObject(stub);
    const settings = await runInDurableObject(stub, (_instance, state) =>
      new GuildConfig(state.storage).get(),
    );
    expect(settings.timezone).toBe("Europe/Berlin");
  });

  it("caches the owner id with its fetch time", async () => {
    await runInDurableObject(stubFor("config-owner"), (_instance, state) => {
      const config = new GuildConfig(state.storage);
      expect(config.setOwner("21", 1_700_000_000_000)).toEqual({
        ...empty,
        ownerId: "21",
        ownerFetchedAt: 1_700_000_000_000,
      });
      config.setOwner("22", 1_700_000_100_000);
      expect(config.get()).toMatchObject({
        ownerId: "22",
        ownerFetchedAt: 1_700_000_100_000,
      });
    });
  });

  it("keeps the settings across a restart", async () => {
    const stub = stubFor("config-restart");
    await runInDurableObject(stub, (_instance, state) => {
      new GuildConfig(state.storage).set("forumChannelId", "31");
    });
    await evictDurableObject(stub);
    const settings = await runInDurableObject(stub, (_instance, state) =>
      new GuildConfig(state.storage).get(),
    );
    expect(settings.forumChannelId).toBe("31");
  });

  it("sets and clears the home area, which survives a restart", async () => {
    const stub = stubFor("config-home-area");
    const seattle = {
      text: "Seattle, Washington",
      name: "Seattle, King County, Washington",
      lat: 47.6038321,
      lon: -122.330062,
    };
    await runInDurableObject(stub, (_instance, state) => {
      const config = new GuildConfig(state.storage);
      expect(config.setHomeArea(seattle)).toEqual({
        ...empty,
        homeArea: seattle,
      });
      config.set("voteChannelId", "12");
      expect(config.get().homeArea).toEqual(seattle);
    });
    await evictDurableObject(stub);
    const kept = await runInDurableObject(stub, (_instance, state) => {
      const config = new GuildConfig(state.storage);
      const before = config.get();
      expect(config.setHomeArea(null)).toEqual({
        ...empty,
        voteChannelId: "12",
      });
      return before;
    });
    expect(kept.homeArea).toEqual(seattle);
    await evictDurableObject(stub);
    const cleared = await runInDurableObject(stub, (_instance, state) =>
      new GuildConfig(state.storage).get(),
    );
    expect(cleared.homeArea).toBeNull();
    expect(cleared.voteChannelId).toBe("12");
  });

  it("keeps each guild's settings apart", async () => {
    await runInDurableObject(stubFor("config-guild-a"), (_instance, state) => {
      new GuildConfig(state.storage).set("adminRoleId", "41");
    });
    const other = await runInDurableObject(
      stubFor("config-guild-b"),
      (_instance, state) => new GuildConfig(state.storage).get(),
    );
    expect(other).toEqual(empty);
  });
});

describe("setupComplete", () => {
  it("needs the voting, announcements and hike threads channels, not the role", () => {
    const channels = {
      ...empty,
      voteChannelId: "1",
      announceChannelId: "2",
      forumChannelId: "3",
    };
    expect(setupComplete(channels)).toBe(true);
    expect(setupComplete(empty)).toBe(false);
    expect(setupComplete({ ...channels, voteChannelId: null })).toBe(false);
    expect(setupComplete({ ...channels, announceChannelId: null })).toBe(false);
    expect(setupComplete({ ...channels, forumChannelId: null })).toBe(false);
  });
});
