import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCalendarFeed } from "../../src/features/calendar-feed";
import { GuildConfig } from "../../src/guild/config";
import { completeRound, withStore } from "../polls/helpers";

const GUILD = "220000000000000201";
const HOUR = 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

describe("loadCalendarFeed", () => {
  it("has one event per completed round, none for cancelled or unfinished ones", async () => {
    const feed = await withStore((store, storage) => {
      completeRound(store, "Ridge", "2030-06-15 09:00");
      const cancelled = store.startRound("u-admin", [
        { label: "Bay", proposedBy: "u1" },
      ]);
      store.cancelRound(cancelled.id, "u-admin");
      completeRound(store, "Lake", "2029-03-02");
      store.startRound("u-admin", [{ label: "Cove", proposedBy: "u1" }]);
      return loadCalendarFeed(storage, GUILD);
    });
    expect(feed.name).toBe("Hikes");
    expect(feed.events.map((event) => event.summary)).toEqual([
      "Hike: Ridge",
      "Hike: Lake",
    ]);
  });

  it("is empty for a guild without hikes", async () => {
    const feed = await withStore((_store, storage) =>
      loadCalendarFeed(storage, GUILD),
    );
    expect(feed.events).toEqual([]);
  });

  it("stamps the feed with the time it was read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2029, 10, 1, 12));
    const feed = await withStore(
      (_store, storage) => loadCalendarFeed(storage, GUILD),
      { now: () => 0 },
    );
    expect(feed.stamp).toBe(Date.UTC(2029, 10, 1, 12));
  });

  it("starts each hike at its date in the guild's zone, in winter and summer, and ends it four hours later", async () => {
    const [pacific, berlin, sydney] = await Promise.all(
      ["America/Los_Angeles", "Europe/Berlin", "Australia/Sydney"].map((zone) =>
        withStore((store, storage) => {
          new GuildConfig(storage).setTimezone(zone);
          completeRound(store, "Summer", "2030-07-20 08:30");
          completeRound(store, "Winter", "2030-01-05");
          return loadCalendarFeed(storage, GUILD);
        }),
      ),
    );
    const times = (feed: typeof pacific) =>
      feed?.events.map((event) => [event.start, event.end - event.start]);
    // Pacific: PDT is UTC-7 in July, PST UTC-8 in January.
    expect(times(pacific)).toEqual([
      [Date.UTC(2030, 6, 20, 15, 30), 4 * HOUR],
      [Date.UTC(2030, 0, 5, 19, 0), 4 * HOUR],
    ]);
    // Berlin: CEST is UTC+2 in July, CET UTC+1 in January.
    expect(times(berlin)).toEqual([
      [Date.UTC(2030, 6, 20, 6, 30), 4 * HOUR],
      [Date.UTC(2030, 0, 5, 10, 0), 4 * HOUR],
    ]);
    // Sydney: AEST is UTC+10 in July, AEDT UTC+11 in January.
    expect(times(sydney)).toEqual([
      [Date.UTC(2030, 6, 19, 22, 30), 4 * HOUR],
      [Date.UTC(2030, 0, 5, 0, 0), 4 * HOUR],
    ]);
  });

  it("describes a hike with its place, details and links, under a UID per round", async () => {
    const feed = await withStore((store, storage) => {
      const ridge = completeRound(
        store,
        "Ridge, North",
        "2030-06-15",
        "Steep;\nbring water",
      );
      store.setRoundThread(ridge, "600000000000000001");
      store.setRoundEvent(ridge, "700000000000000001");
      const lake = completeRound(store, "Lake", "2030-06-01");
      store.setRoundThread(lake, "600000000000000002");
      completeRound(store, "Bay", "2030-05-01");
      return { ridge, lake, feed: loadCalendarFeed(storage, GUILD) };
    });
    const [ridge, lake, bay] = feed.feed.events;
    expect(ridge).toMatchObject({
      uid: `hike-${String(feed.ridge)}-${GUILD}@hikebot`,
      summary: "Hike: Ridge, North",
      location: "Ridge, North",
      description: [
        "Steep;",
        "bring water",
        "",
        `Hike thread: https://discord.com/channels/${GUILD}/600000000000000001`,
        `Discord event: https://discord.com/events/${GUILD}/700000000000000001`,
      ].join("\n"),
      url: `https://discord.com/channels/${GUILD}/600000000000000001`,
    });
    expect(lake).toMatchObject({
      uid: `hike-${String(feed.lake)}-${GUILD}@hikebot`,
      description: `Hike thread: https://discord.com/channels/${GUILD}/600000000000000002`,
      url: `https://discord.com/channels/${GUILD}/600000000000000002`,
    });
    expect(bay).toMatchObject({ description: "", url: null });
    expect(new Set(feed.feed.events.map((e) => e.uid)).size).toBe(3);
  });
});
