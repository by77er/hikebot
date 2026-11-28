import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNREAD_MAP_NOTE } from "../../src/features/location-vote";
import { GuildConfig } from "../../src/guild/config";
import type { WebProposal } from "../../src/guild/web-action";
import { PollStore, type PollView } from "../../src/polls/store";
import { discordFetch, type DiscordGuild } from "./web-view-helpers";

const OWNER = "400000000000000001";
const ANA = "400000000000000002";
const VOTE = "300000000000000001";
const MESSAGE = "700000000000000001";
/** 1 June 2030, 11:00 in Los Angeles, the guild's time zone. */
const NOW = Date.UTC(2030, 5, 1, 18);

const CLOSED = "This vote has closed.";
const UNAVAILABLE = "This action is no longer available.";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

let counter = 0;

/** A fresh guild whose members are the owner and Ana, at `NOW`. */
function setUp() {
  counter++;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const guildId = `20000000000000${String(3000 + counter)}`;
  const guild: DiscordGuild = {
    id: guildId,
    ownerId: OWNER,
    members: { [OWNER]: [], [ANA]: [] },
    channels: { [VOTE]: "votes" },
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(discordFetch(guild));
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
  const store = <T>(body: (store: PollStore) => T) =>
    runInDurableObject(stub, (_instance, state) =>
      body(new PollStore(state.storage)),
    );
  const vote = (pollId: number, optionIds: number[], userId = ANA) =>
    stub.webVote({ guildId, userId, pollId, optionIds });
  const propose = (pollId: number, proposal: WebProposal, userId = ANA) =>
    stub.webPropose({ guildId, userId, pollId, proposal });
  const refreshMarked = (pollId: number) =>
    runInDurableObject(stub, (_instance, state) =>
      state.storage.get(`poll-refresh:${String(pollId)}`),
    );
  return { guildId, guild, stub, store, vote, propose, refreshMarked };
}

/** Starts a location vote on `labels`, its message posted. */
function locationVote(store: PollStore, labels: string[]): PollView {
  const round = store.startRound(
    OWNER,
    labels.map((label) => ({ label, proposedBy: OWNER })),
  );
  const id = round.locationPoll?.id ?? 0;
  store.setPollMessage(id, VOTE, MESSAGE);
  return store.getPoll(id) as PollView;
}

/** Closes `poll` with `label` the winner. */
function closeWith(store: PollStore, poll: PollView, label: string): void {
  const option = poll.options.find((o) => o.label === label);
  store.setVotes(poll.id, OWNER, [option?.id ?? 0]);
  store.closePoll(poll.id, OWNER);
}

/** Opens the date vote of a round whose location vote decided Lake. */
function dateVote(store: PollStore): PollView {
  const where = locationVote(store, ["Lake"]);
  closeWith(store, where, "Lake");
  const poll = store.startDatePoll(where.roundId, OWNER, [
    "2030-06-08",
    "2030-06-15",
  ]);
  store.setPollMessage(poll.id, VOTE, "700000000000000002");
  return poll;
}

/** Plays a hike at Lake on 8 June 2030, then opens a location vote on Ridge. */
function afterLakeHike(store: PollStore): PollView {
  const where = locationVote(store, ["Lake", "Canyon"]);
  closeWith(store, where, "Lake");
  const when = store.startDatePoll(where.roundId, OWNER, [
    "2030-06-08",
    "2030-06-15",
  ]);
  closeWith(store, when, "Sat, 8 Jun 2030 · 11:00");
  return locationVote(store, ["Ridge"]);
}

const LAKE_RESTS =
  "**Lake** was the hike on Sat, 8 Jun 2030 · 11:00. It can be suggested again after 2 more hikes.";

describe("webVote", () => {
  it("replaces the member's votes with exactly the ticked ones, under their user id, and marks the poll for a refresh", async () => {
    const g = setUp();
    const poll = await g.store((s) => {
      const p = locationVote(s, ["Ridge", "Lake", "Canyon"]);
      s.setVotes(p.id, ANA, [p.options[0]?.id ?? 0]);
      return p;
    });
    const [ridge, lake, canyon] = poll.options.map((o) => o.id);
    expect(await g.vote(poll.id, [lake ?? 0, canyon ?? 0])).toEqual({
      kind: "done",
      banner: "Your votes are saved.",
      note: null,
    });
    const after = await g.store((s) => s.getPoll(poll.id, ANA));
    expect(after?.viewerVotes.sort()).toEqual([lake, canyon].sort());
    expect(after?.viewerVotes).not.toContain(ridge);
    expect(await g.refreshMarked(poll.id)).toBeDefined();
  });

  it("clears the member's votes when none is ticked", async () => {
    const g = setUp();
    const poll = await g.store((s) => {
      const p = locationVote(s, ["Ridge"]);
      s.setVotes(p.id, ANA, [p.options[0]?.id ?? 0]);
      return p;
    });
    expect(await g.vote(poll.id, [])).toMatchObject({
      kind: "done",
      banner: "Your votes are cleared.",
    });
    expect(
      (await g.store((s) => s.getPoll(poll.id, ANA)))?.viewerVotes,
    ).toEqual([]);
  });

  it.each([
    ["poll_closed", CLOSED],
    ["unknown_option", "That option is not in this poll."],
    ["poll_not_found", UNAVAILABLE],
  ])(
    "refuses %s with the bot's sentence and stores nothing",
    async (code, message) => {
      const g = setUp();
      const poll = await g.store((s) => {
        const p = locationVote(s, ["Ridge", "Lake"]);
        s.setVotes(p.id, ANA, [p.options[0]?.id ?? 0]);
        if (code === "poll_closed") s.closePoll(p.id, OWNER);
        return p;
      });
      const pollId = code === "poll_not_found" ? poll.id + 100 : poll.id;
      const optionIds =
        code === "unknown_option" ? [999_999] : [poll.options[1]?.id ?? 0];
      expect(await g.vote(pollId, optionIds)).toEqual({
        kind: "refused",
        code,
        message,
      });
      expect(
        (await g.store((s) => s.getPoll(poll.id, ANA)))?.viewerVotes,
      ).toEqual([poll.options[0]?.id]);
    },
  );

  it("asks Discord at the moment of the action, so a member who left since the page was read is refused", async () => {
    const g = setUp();
    const poll = await g.store((s) => locationVote(s, ["Ridge"]));
    // The page's read caches Ana as a member.
    expect(
      (await g.stub.webView({ guildId: g.guildId, userId: ANA })).kind,
    ).toBe("view");
    g.guild.members = { [OWNER]: [] };
    expect(await g.vote(poll.id, [poll.options[0]?.id ?? 0])).toEqual({
      kind: "not_member",
    });
    expect((await g.store((s) => s.getPoll(poll.id, ANA)))?.voterCount).toBe(0);
    // And the page's next read knows it too.
    expect(
      (await g.stub.webView({ guildId: g.guildId, userId: ANA })).kind,
    ).toBe("not_member");
  });

  it("answers unavailable when Discord cannot be asked, and stores nothing", async () => {
    const g = setUp();
    const poll = await g.store((s) => locationVote(s, ["Ridge"]));
    g.guild.memberStatus = 500;
    expect(await g.vote(poll.id, [poll.options[0]?.id ?? 0])).toEqual({
      kind: "unavailable",
    });
    expect((await g.store((s) => s.getPoll(poll.id, ANA)))?.voterCount).toBe(0);
  });
});

describe("webPropose a location", () => {
  const lake = (
    overrides: Partial<{ name: string; details: string; map: string }> = {},
  ): WebProposal => ({
    kind: "location",
    name: "Lake",
    details: "",
    map: "",
    ...overrides,
  });

  it("adds it with the member as proposer and marks the poll for a refresh", async () => {
    const g = setUp();
    const poll = await g.store((s) => locationVote(s, ["Ridge"]));
    expect(
      await g.propose(
        poll.id,
        lake({ details: "Loop, 8 km", map: "47.4875, -121.7234" }),
      ),
    ).toEqual({ kind: "done", banner: "Added Lake.", note: null });
    const added = (await g.store((s) => s.getPoll(poll.id)))?.options.find(
      (o) => o.label === "Lake",
    );
    expect(added).toMatchObject({
      proposedBy: ANA,
      details: "Loop, 8 km",
      place: { status: "given", point: { lat: 47.4875, lon: -121.7234 } },
    });
    expect(await g.refreshMarked(poll.id)).toBeDefined();
  });

  it("adds the bot's note when the map field holds no coordinates", async () => {
    const g = setUp();
    const poll = await g.store((s) => locationVote(s, ["Ridge"]));
    expect(
      await g.propose(poll.id, lake({ map: "https://maps.app.goo.gl/abc" })),
    ).toEqual({ kind: "done", banner: "Added Lake.", note: UNREAD_MAP_NOTE });
  });

  it.each([
    [
      "invalid_label",
      lake({ name: " " }),
      "A label must be 1 to 80 characters.",
    ],
    [
      "invalid_details",
      lake({ details: "x".repeat(301) }),
      "Details must be at most 300 characters.",
    ],
    [
      "duplicate_option",
      lake({ name: "ridge" }),
      "**ridge** is already on the list. Vote for it instead.",
    ],
  ])("refuses %s with the bot's sentence", async (code, proposal, message) => {
    const g = setUp();
    const poll = await g.store((s) => locationVote(s, ["Ridge"]));
    expect(await g.propose(poll.id, proposal)).toEqual({
      kind: "refused",
      code,
      message,
    });
    expect((await g.store((s) => s.getPoll(poll.id)))?.options).toHaveLength(1);
  });

  it("refuses too_many_options on a full vote", async () => {
    const g = setUp();
    const poll = await g.store((s) =>
      locationVote(
        s,
        Array.from({ length: 25 }, (_, i) => `Place ${String(i + 1)}`),
      ),
    );
    expect(await g.propose(poll.id, lake())).toEqual({
      kind: "refused",
      code: "too_many_options",
      message:
        "This vote already has 25 locations, the most it can hold. Vote for one of them instead.",
    });
  });

  it("refuses poll_closed and a poll that is not there", async () => {
    const g = setUp();
    const poll = await g.store((s) => {
      const p = locationVote(s, ["Ridge"]);
      s.closePoll(p.id, OWNER);
      return p;
    });
    expect(await g.propose(poll.id, lake())).toEqual({
      kind: "refused",
      code: "poll_closed",
      message: CLOSED,
    });
    expect(await g.propose(poll.id + 100, lake())).toEqual({
      kind: "refused",
      code: "unavailable",
      message: UNAVAILABLE,
    });
  });

  it("refuses location_on_cooldown, typed, with the bot's cooldown sentence", async () => {
    const g = setUp();
    const poll = await g.store((s) => afterLakeHike(s));
    expect(await g.propose(poll.id, lake())).toEqual({
      kind: "refused",
      code: "location_on_cooldown",
      message: LAKE_RESTS,
    });
  });

  it("refuses a member who is not in the server, and adds nothing", async () => {
    const g = setUp();
    const poll = await g.store((s) => locationVote(s, ["Ridge"]));
    expect(await g.propose(poll.id, lake(), "400000000000000099")).toEqual({
      kind: "not_member",
    });
    expect((await g.store((s) => s.getPoll(poll.id)))?.options).toHaveLength(1);
  });
});

describe("webPropose a past location again", () => {
  it("adds it with its saved label and the member as proposer", async () => {
    const g = setUp();
    const poll = await g.store((s) => afterLakeHike(s));
    const canyon = await g.store(
      (s) =>
        s.listPastLocations(ANA, poll.id).find((p) => p.label === "Canyon")
          ?.optionId,
    );
    expect(
      await g.propose(poll.id, { kind: "again", optionId: canyon ?? 0 }),
    ).toEqual({
      kind: "done",
      banner: "Added Canyon.",
      note: null,
    });
    expect(
      (await g.store((s) => s.getPoll(poll.id)))?.options.find(
        (o) => o.label === "Canyon",
      )?.proposedBy,
    ).toBe(ANA);
  });

  it("refuses a resting one with the bot's cooldown sentence, and an unknown one", async () => {
    const g = setUp();
    const poll = await g.store((s) => afterLakeHike(s));
    const lakeId = await g.store(
      (s) =>
        s.listPastLocations(ANA, poll.id).find((p) => p.label === "Lake")
          ?.optionId,
    );
    expect(
      await g.propose(poll.id, { kind: "again", optionId: lakeId ?? 0 }),
    ).toEqual({
      kind: "refused",
      code: "location_on_cooldown",
      message: LAKE_RESTS,
    });
    expect(
      await g.propose(poll.id, { kind: "again", optionId: 999_999 }),
    ).toEqual({
      kind: "refused",
      code: "unavailable",
      message: UNAVAILABLE,
    });
  });
});

describe("webPropose one location per member", () => {
  const ALREADY = (label: string) =>
    `You've already proposed **${label}** for this location vote. Each member proposes one location per round.`;
  const newOne = (name: string): WebProposal => ({
    kind: "location",
    name,
    details: "",
    map: "",
  });

  it("refuses a new location after one suggested again, and adds nothing", async () => {
    const g = setUp();
    const poll = await g.store((s) => afterLakeHike(s));
    const canyon = await g.store(
      (s) =>
        s.listPastLocations(ANA, poll.id).find((p) => p.label === "Canyon")
          ?.optionId,
    );
    await g.propose(poll.id, { kind: "again", optionId: canyon ?? 0 });
    expect(await g.propose(poll.id, newOne("Summit"))).toEqual({
      kind: "refused",
      code: "already_proposed",
      message: ALREADY("Canyon"),
    });
    expect(
      (await g.store((s) => s.getPoll(poll.id)))?.options.map((o) => o.label),
    ).toEqual(["Ridge", "Canyon"]);
  });

  it("refuses one suggested again after a new location, and adds nothing", async () => {
    const g = setUp();
    const poll = await g.store((s) => afterLakeHike(s));
    const canyon = await g.store(
      (s) =>
        s.listPastLocations(ANA, poll.id).find((p) => p.label === "Canyon")
          ?.optionId,
    );
    await g.propose(poll.id, newOne("Summit"));
    expect(
      await g.propose(poll.id, { kind: "again", optionId: canyon ?? 0 }),
    ).toEqual({
      kind: "refused",
      code: "already_proposed",
      message: ALREADY("Summit"),
    });
    expect(
      (await g.store((s) => s.getPoll(poll.id)))?.options.map((o) => o.label),
    ).toEqual(["Ridge", "Summit"]);
  });

  it("keeps one of two proposals sent at once", async () => {
    const g = setUp();
    const poll = await g.store((s) => locationVote(s, ["Ridge"]));
    const results = await Promise.all([
      g.propose(poll.id, newOne("Lake")),
      g.propose(poll.id, newOne("Summit")),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["done", "refused"]);
    const options = (await g.store((s) => s.getPoll(poll.id)))?.options ?? [];
    expect(options.filter((o) => o.proposedBy === ANA)).toHaveLength(1);
  });

  it("lets the owner, who started the vote with its locations, propose one", async () => {
    const g = setUp();
    const poll = await g.store((s) =>
      locationVote(s, ["Ridge", "Lake", "Canyon", "Summit", "Falls"]),
    );
    expect(await g.propose(poll.id, newOne("Meadow"), OWNER)).toMatchObject({
      kind: "done",
    });
    expect(await g.propose(poll.id, newOne("Pass"), OWNER)).toEqual({
      kind: "refused",
      code: "already_proposed",
      message: ALREADY("Meadow"),
    });
  });
});

describe("webPropose a date", () => {
  const date = (day: string, time = ""): WebProposal => ({
    kind: "date",
    date: day,
    time,
  });

  it("adds the date and time, or the default time, with the member as proposer", async () => {
    const g = setUp();
    const poll = await g.store((s) => dateVote(s));
    expect(await g.propose(poll.id, date("2030-06-09", "09:00"))).toEqual({
      kind: "done",
      banner: "Added Sun, 9 Jun 2030 · 09:00.",
      note: null,
    });
    expect(await g.propose(poll.id, date("2030-06-22"), OWNER)).toMatchObject({
      banner: "Added Sat, 22 Jun 2030 · 11:00.",
    });
    const options = (await g.store((s) => s.getPoll(poll.id)))?.options ?? [];
    expect(options.filter((o) => o.proposedBy === ANA)).toHaveLength(1);
    // The owner's: the two starting dates and the one proposed.
    expect(options.filter((o) => o.proposedBy === OWNER)).toHaveLength(3);
    expect(await g.refreshMarked(poll.id)).toBeDefined();
  });

  it("refuses a member's second date with the bot's sentence and adds nothing", async () => {
    const g = setUp();
    const poll = await g.store((s) => dateVote(s));
    await g.propose(poll.id, date("2030-06-09", "09:00"));
    expect(await g.propose(poll.id, date("2030-06-22"))).toEqual({
      kind: "refused",
      code: "already_proposed",
      message:
        "You've already proposed **Sun, 9 Jun 2030 · 09:00** for this date vote. Each member proposes one date per round.",
    });
    expect((await g.store((s) => s.getPoll(poll.id)))?.options).toHaveLength(3);
  });

  it.each([
    ["no_date", date(""), "invalid_date", "Pick a date."],
    [
      "invalid_date",
      date("2030-06-09", "25:00"),
      "invalid_date",
      "`2030-06-09 25:00` is not a date. Write it as `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` (24-hour), for example `2026-12-05` or `2026-12-05 09:00`.",
    ],
    [
      "date_in_past",
      date("2030-05-31"),
      "date_in_past",
      "Fri, 31 May 2030 · 11:00 is in the past: today is 2030-06-01 in America/Los_Angeles. Propose a day from 2030-06-01 to 2030-07-02.",
    ],
    [
      "date_too_far",
      date("2030-07-03"),
      "date_too_far",
      "Wed, 3 Jul 2030 · 11:00 is more than 31 days away. Propose a day from 2030-06-01 to 2030-07-02, or ask an admin to plan further ahead.",
    ],
    [
      "duplicate_option",
      date("2030-06-08", "11:00"),
      "duplicate_option",
      "**Sat, 8 Jun 2030 · 11:00** is already on the vote. Vote for it instead, or propose another time that day.",
    ],
  ])(
    "refuses %s with the bot's sentence and adds nothing",
    async (_name, proposal, code, message) => {
      const g = setUp();
      const poll = await g.store((s) => dateVote(s));
      expect(await g.propose(poll.id, proposal)).toEqual({
        kind: "refused",
        code,
        message,
      });
      expect((await g.store((s) => s.getPoll(poll.id)))?.options).toHaveLength(
        2,
      );
    },
  );

  it("refuses date_outside_window in a round on the weekly schedule", async () => {
    const g = setUp();
    const poll = await g.store((s) => dateVote(s));
    await runInDurableObject(g.stub, (_i, state) => {
      new GuildConfig(state.storage).setCadence({
        enabled: true,
        onSince: NOW - 86_400_000,
      });
    });
    expect(await g.propose(poll.id, date("2030-06-02"))).toMatchObject({
      kind: "refused",
      code: "date_outside_window",
      message: expect.stringMatching(
        /^Sun, 2 Jun 2030 · 11:00 is outside this round's dates\. Propose a day from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}: the 14 days after the date vote closes\.$/,
      ) as string,
    });
  });

  it("refuses too_many_options, poll_closed and a location poll", async () => {
    const g = setUp();
    const full = await g.store((s) => {
      const where = locationVote(s, ["Lake"]);
      closeWith(s, where, "Lake");
      return s.startDatePoll(
        where.roundId,
        OWNER,
        Array.from(
          { length: 25 },
          (_, i) => `2030-06-${String(i + 2).padStart(2, "0")}`,
        ),
      );
    });
    expect(await g.propose(full.id, date("2030-06-30"))).toEqual({
      kind: "refused",
      code: "too_many_options",
      message:
        "This vote already has 25 dates, the most it can hold. Vote for one of them instead.",
    });
    await g.store((s) => s.closePoll(full.id, OWNER));
    expect(await g.propose(full.id, date("2030-06-30"))).toEqual({
      kind: "refused",
      code: "poll_closed",
      message: CLOSED,
    });
    const ridge = await g.store((s) => locationVote(s, ["Ridge"]));
    expect(await g.propose(ridge.id, date("2030-06-30"))).toEqual({
      kind: "refused",
      code: "invalid_state",
      message: UNAVAILABLE,
    });
  });
});
