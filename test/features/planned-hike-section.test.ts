import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuildConfig } from "../../src/guild/config";
import type { WebView } from "../../src/guild/web-view";
import { HIKE_DURATION_HOURS } from "../../src/polls/dates";
import { PollStore } from "../../src/polls/store";
import { discordFetch } from "../guild/web-view-helpers";
import { completeRound } from "../polls/helpers";

const OWNER = "400000000000000001";
const ANA = "400000000000000002";
const THREAD = "600000000000000001";
const EVENT = "600000000000000002";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

let counter = 0;

/** A fresh guild whose store `seed` fills, and the view Ana gets of it. */
async function viewAfter(
  seed: (store: PollStore, config: GuildConfig) => void,
): Promise<{ guildId: string; view: WebView }> {
  counter++;
  const guildId = `20000000000000${String(3000 + counter)}`;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    discordFetch({
      id: guildId,
      ownerId: OWNER,
      members: { [OWNER]: [], [ANA]: [] },
    }),
  );
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
  await runInDurableObject(stub, (_instance, state) => {
    seed(new PollStore(state.storage), new GuildConfig(state.storage));
  });
  const result = await stub.webView({ guildId, userId: ANA });
  if (result.kind !== "view") throw new Error(`no view: ${result.kind}`);
  return { guildId, view: result.view };
}

describe("the web view's planned hike", () => {
  it("shows the hike with its start in the guild's zone, and links to its thread and event", async () => {
    const { guildId, view } = await viewAfter((store, config) => {
      config.setTimezone("America/Denver");
      const round = completeRound(
        store,
        "Ridge",
        "2030-06-15 09:30",
        "North trailhead",
      );
      store.setRoundThread(round, THREAD);
      store.setRoundEvent(round, EVENT);
    });
    expect(view.plannedHike).toEqual({
      roundId: expect.any(Number) as number,
      location: {
        label: "Ridge",
        details: "North trailhead",
        proposedBy: "u-proposer",
      },
      start: {
        // 09:30 MDT is 15:30 UTC.
        at: Date.UTC(2030, 5, 15, 15, 30),
        date: "2030-06-15",
        time: "09:30",
        label: "Sat, 15 Jun 2030 · 09:30",
        timeZone: "America/Denver",
      },
      threadId: THREAD,
      threadUrl: `https://discord.com/channels/${guildId}/${THREAD}`,
      eventId: EVENT,
      eventUrl: `https://discord.com/events/${guildId}/${EVENT}`,
    });
  });

  it("has no links while the hike has no thread or event", async () => {
    const { view } = await viewAfter((store) => {
      completeRound(store, "Ridge", "2030-06-15");
    });
    expect(view.plannedHike).toMatchObject({
      start: { time: "11:00", timeZone: "America/Los_Angeles" },
      threadId: null,
      threadUrl: null,
      eventId: null,
      eventUrl: null,
    });
  });

  it("is the newest hike, beside a new round's vote", async () => {
    const { view } = await viewAfter((store) => {
      completeRound(store, "Lake", "2030-06-08");
      completeRound(store, "Ridge", "2030-06-15");
      store.startRound(OWNER, [{ label: "Canyon", proposedBy: OWNER }]);
    });
    expect(view.plannedHike?.location.label).toBe("Ridge");
    expect(view.round?.step).toBe("location_vote_open");
  });

  it("is gone once the hike has ended, while the log keeps it", async () => {
    // 11:00 on 15 June 2030 in Los Angeles is 18:00 UTC.
    const start = Date.UTC(2030, 5, 15, 18);
    const end = start + HIKE_DURATION_HOURS * 3_600_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(end - 1);
    const during = await viewAfter((store) => {
      completeRound(store, "Ridge", "2030-06-15");
    });
    expect(during.view.plannedHike?.start.at).toBe(start);

    vi.setSystemTime(end);
    const after = await viewAfter((store) => {
      completeRound(store, "Ridge", "2030-06-15");
    });
    expect(after.view.plannedHike).toBeNull();
    expect(after.view.log.entries.map((e) => e.location.label)).toEqual([
      "Ridge",
    ]);
  });
});
