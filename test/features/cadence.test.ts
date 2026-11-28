/**
 * The weekly schedule's job, `cadence:tick`, run by the guild object's real
 * alarm with `Date` faked to each cadence instant in turn, and `fetch`
 * stubbed as the Discord API. The times are in 2030, so no alarm set here
 * fires by itself while a test runs.
 */
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAdminPanelState,
  renderAdminPanel,
} from "../../src/features/admin-panel";
import {
  CADENCE_JOB,
  cadenceDateWindow,
  changeCadence,
  readCadenceState,
  scheduleCadence,
} from "../../src/features/cadence-state";
import {
  cancelRound,
  closeVote,
  startDateVote,
  startLocationVote,
  withdrawDateVote,
  type ActionOutcome,
  type RoundContext,
} from "../../src/features/round-actions";
import { GuildConfig, type CadenceSettings } from "../../src/guild/config";
import { schedule, scheduledJobs } from "../../src/guild/schedule";
import { PollStore, type RoundView } from "../../src/polls/store";

const OWNER = "400000000000000001";
const ANA = "400000000000000002";
const BEN = "400000000000000003";
const APP = env.DISCORD_APPLICATION_ID;
const TEXT = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";
const LA = "America/Los_Angeles";

/** An instant written as UTC: `2030-01-02T17:00` is 09:00 in Los Angeles. */
const utc = (iso: string) => Date.parse(`${iso}Z`);

/** The default schedule's Wednesdays at 09:00 in Los Angeles, in UTC. */
const WED = [
  "2030-01-02T17:00",
  "2030-01-09T17:00",
  "2030-01-16T17:00",
  "2030-01-23T17:00",
] as const;
/** Monday 31 December 2029, noon in Los Angeles: before the first Wednesday. */
const MONDAY_BEFORE = "2029-12-31T20:00";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The faked Discord API.

interface Sent {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

/**
 * Stubs `fetch` as the Discord API: every request is recorded and answered
 * with a new id, except those `fail` matches, answered with Missing
 * Permissions.
 */
function fakeDiscord() {
  const sent: Sent[] = [];
  let failing: RegExp | null = null;
  let next = 700000000000000100n;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const path = `${request.method} ${new URL(request.url).pathname.replace(/^.*\/api\/v10/, "")}`;
    const text = await request.text();
    sent.push({
      method: request.method,
      path,
      body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>),
    });
    if (failing?.test(path)) {
      return Response.json(
        { message: "Missing Permissions", code: 50013 },
        { status: 403 },
      );
    }
    next += 1n;
    return Response.json({ id: String(next) });
  });
  return {
    sent,
    fail(match: RegExp | null) {
      failing = match;
    },
    /** The texts of the messages posted in `channelId`, in order. */
    posts(channelId: string): string[] {
      return sent
        .filter((s) => s.path === `POST /channels/${channelId}/messages`)
        .map((s) => text(s.body.components));
    },
    clear() {
      sent.length = 0;
    },
  };
}

interface Node {
  content?: string;
  components?: Node[];
  component?: Node;
  accessory?: Node;
}

function flatten(components: readonly Node[]): Node[] {
  return components.flatMap((c) => [
    c,
    ...flatten(c.components ?? []),
    ...flatten(c.component ? [c.component] : []),
    ...flatten(c.accessory ? [c.accessory] : []),
  ]);
}

function text(components: unknown): string {
  return flatten((components ?? []) as Node[])
    .map((c) => c.content ?? "")
    .filter((c) => c !== "")
    .join("\n");
}

// The guild object.

function stub(name: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(name));
}

function inGuild<T>(
  name: string,
  run: (context: RoundContext, store: PollStore) => T | Promise<T>,
): Promise<T> {
  return runInDurableObject(stub(name), (_i, state) => {
    const store = new PollStore(state.storage);
    return run({ env, storage: state.storage, guildId: name, store }, store);
  });
}

/**
 * Sets the guild's channels and time zone, and turns the schedule on with
 * `change` as an admin does from the panel, at the faked time.
 */
async function turnOn(
  name: string,
  change: Partial<Omit<CadenceSettings, "onSince">> = {},
  zone = LA,
): Promise<void> {
  await inGuild(name, async ({ storage }, store) => {
    const config = new GuildConfig(storage);
    config.set("voteChannelId", TEXT);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
    config.setTimezone(zone);
    await changeSchedule(storage, store, name, { enabled: true, ...change });
  });
}

async function changeSchedule(
  storage: DurableObjectStorage,
  store: PollStore,
  name: string,
  change: Partial<Omit<CadenceSettings, "onSince">>,
): Promise<void> {
  await changeCadence(storage, store, change, name);
}

/** Moves the clock to `iso` (UTC) and runs the object's alarm. */
async function runAt(name: string, iso: string): Promise<void> {
  vi.setSystemTime(utc(iso));
  expect(await runDurableObjectAlarm(stub(name))).toBe(true);
}

/** When the schedule's job runs next, or undefined if it is not scheduled. */
async function nextRun(name: string): Promise<string | undefined> {
  const at = await inGuild(name, async ({ storage }) =>
    (await scheduledJobs(storage)).get(CADENCE_JOB),
  );
  return at === undefined ? undefined : new Date(at).toISOString();
}

/** `iso` (UTC) as `nextRun` returns it. */
const at = (iso: string) => new Date(utc(iso)).toISOString();

function lastRound(name: string): Promise<RoundView | null> {
  return inGuild(name, (_c, store) => store.getLastRound());
}

/**
 * Adds `labels` to the open location vote, the first proposed by Ana and
 * the next by Ben (each member proposes one), and has members vote.
 */
function proposeAndVote(
  name: string,
  labels: string[],
  votes: Record<string, string>,
): Promise<void> {
  return inGuild(name, (_c, store) => {
    const poll = store.getActiveRound()?.locationPoll;
    if (!poll) throw new Error("no location vote");
    for (const [i, label] of labels.entries()) {
      store.addOption(poll.id, { label, proposedBy: [ANA, BEN][i] ?? ANA });
    }
    voteFor(store, poll.id, votes);
  });
}

/**
 * Has each member in `votes` vote for the option with the label given, or
 * the date (`YYYY-MM-DD`) given.
 */
function voteFor(
  store: PollStore,
  pollId: number,
  votes: Record<string, string>,
): void {
  const poll = store.getPoll(pollId);
  for (const [member, label] of Object.entries(votes)) {
    const option = poll?.options.find(
      (o) => o.label === label || o.dateValue?.startsWith(label),
    );
    if (!option) throw new Error(`no option ${label}`);
    store.setVotes(pollId, member, [option.id]);
  }
}

/** Has members vote on the open date vote. */
function voteDate(name: string, votes: Record<string, string>): Promise<void> {
  return inGuild(name, (_c, store) => {
    const poll = store.getActiveRound()?.datePoll;
    if (!poll) throw new Error("no date vote");
    voteFor(store, poll.id, votes);
  });
}

/** Runs an admin's action and its Discord work, as the panel does. */
async function byHand(
  outcome:
    ActionOutcome<string, object> | Promise<ActionOutcome<string, object>>,
): Promise<void> {
  const done = await outcome;
  if (!done.ok) throw new Error(`refused: ${done.message}`);
  await done.work();
}

function dateValues(round: RoundView | null): (string | null)[] {
  return round?.datePoll?.options.map((o) => o.dateValue) ?? [];
}

/** A location vote opened by the job at `WED[0]`, after turning it on. */
async function locationVoteOpen(
  name: string,
  change: Partial<Omit<CadenceSettings, "onSince">> = {},
): Promise<void> {
  vi.setSystemTime(utc(MONDAY_BEFORE));
  await turnOn(name, change);
  await runAt(name, WED[0]);
}

/** A date vote opened by the job at `WED[1]` after a location was voted. */
async function dateVoteOpen(
  name: string,
  change: Partial<Omit<CadenceSettings, "onSince">> = {},
): Promise<void> {
  await locationVoteOpen(name, change);
  await proposeAndVote(name, ["Ridge Trail"], { [ANA]: "Ridge Trail" });
  await runAt(name, WED[1]);
}

describe("a whole round on the default schedule", () => {
  it("opens, closes and opens, closes, waits for the hike, opens again", async () => {
    const discord = fakeDiscord();
    const name = "cadence-cycle";
    vi.setSystemTime(utc(MONDAY_BEFORE));
    await turnOn(name);
    expect(await nextRun(name)).toBe(at(WED[0]));
    expect(discord.sent).toEqual([]);

    // Wednesday, week 0: the location vote opens with no options.
    await runAt(name, WED[0]);
    let round = await lastRound(name);
    expect(round).toMatchObject({ status: "location_voting", startedBy: APP });
    expect(round?.locationPoll).toMatchObject({ openedBy: APP, options: [] });
    expect(discord.posts(TEXT)).toHaveLength(1);
    expect(discord.posts(TEXT)[0]).toContain("Where should we hike?");
    expect(await nextRun(name)).toBe(at(WED[1]));

    await proposeAndVote(name, ["Ridge Trail", "Lake Loop"], {
      [ANA]: "Lake Loop",
      [BEN]: "Lake Loop",
    });

    // Wednesday, week 1: the location vote closes as on a manual close, and
    // the date vote opens on the weekends of the 14 days after Friday.
    discord.clear();
    await runAt(name, WED[1]);
    round = await lastRound(name);
    expect(round?.status).toBe("date_voting");
    expect(round?.locationPoll).toMatchObject({
      status: "closed",
      closedBy: APP,
    });
    expect(
      round?.locationPoll?.options.find((o) => o.id === round?.locationOptionId)
        ?.label,
    ).toBe("Lake Loop");
    expect(round?.datePoll?.openedBy).toBe(APP);
    expect(dateValues(round)).toEqual([
      "2030-01-12 11:00",
      "2030-01-13 11:00",
      "2030-01-19 11:00",
      "2030-01-20 11:00",
    ]);
    const decided = discord.posts(NEWS);
    expect(decided).toHaveLength(1);
    expect(decided[0]).toContain("Hike location decided");
    expect(decided[0]).toContain("Lake Loop");
    expect(discord.posts(TEXT)).toHaveLength(1);
    expect(discord.posts(TEXT)[0]).toContain("When should we hike Lake Loop?");
    // Friday, two days later at 09:00.
    expect(await nextRun(name)).toBe(at("2030-01-11T17:00"));

    await voteDate(name, { [ANA]: "2030-01-19", [BEN]: "2030-01-19" });

    // Friday, week 1: the date vote closes with its thread, event and
    // announcement.
    discord.clear();
    await runAt(name, "2030-01-11T17:00");
    round = await lastRound(name);
    expect(round).toMatchObject({ status: "complete", endedBy: APP });
    expect(round?.datePoll?.closedBy).toBe(APP);
    expect(round?.threadId).not.toBeNull();
    expect(round?.eventId).not.toBeNull();
    expect(discord.sent.map((s) => s.path)).toEqual(
      expect.arrayContaining([
        `POST /channels/${FORUM}/threads`,
        `POST /guilds/${name}/scheduled-events`,
        `POST /channels/${NEWS}/messages`,
      ]),
    );
    expect(discord.posts(NEWS)[0]).toContain("Hike planned");
    expect(await nextRun(name)).toBe(at(WED[2]));

    // The Wednesday before the hike (Saturday 19 January): nothing.
    discord.clear();
    await runAt(name, WED[2]);
    expect(discord.sent).toEqual([]);
    expect((await lastRound(name))?.id).toBe(round?.id);
    expect(await nextRun(name)).toBe(at(WED[3]));

    // The first Wednesday after the hike: the next location vote.
    await runAt(name, WED[3]);
    const next = await lastRound(name);
    expect(next?.id).not.toBe(round?.id);
    expect(next).toMatchObject({ status: "location_voting", startedBy: APP });
    expect(discord.posts(TEXT)).toHaveLength(1);

    // The bot acting by itself is never named as a member.
    expect(JSON.stringify(discord.sent)).not.toContain(`<@${APP}>`);
  });

  it("runs on Saturdays at 18:30 with a 3-day date vote, across the March clock change", async () => {
    const discord = fakeDiscord();
    const name = "cadence-saturday";
    // Thursday 28 February 2030 in Los Angeles; clocks go forward 10 March.
    vi.setSystemTime(utc("2030-02-28T20:00"));
    await turnOn(name, { weekday: 6, time: "18:30", dateVoteDays: 3 });
    // Saturday 2 March, 18:30 PST.
    expect(await nextRun(name)).toBe(at("2030-03-03T02:30"));

    await runAt(name, "2030-03-03T02:30");
    expect((await lastRound(name))?.status).toBe("location_voting");
    // Saturday 9 March, 18:30 PST, the evening before the change.
    expect(await nextRun(name)).toBe(at("2030-03-10T02:30"));

    await proposeAndVote(name, ["Ridge Trail"], { [ANA]: "Ridge Trail" });
    await runAt(name, "2030-03-10T02:30");
    let round = await lastRound(name);
    expect(round?.status).toBe("date_voting");
    // It closes Tuesday 12 March at 18:30 PDT: the window is 13 to 26 March.
    expect(await nextRun(name)).toBe(at("2030-03-13T01:30"));
    expect(dateValues(round)).toEqual([
      "2030-03-16 11:00",
      "2030-03-17 11:00",
      "2030-03-23 11:00",
      "2030-03-24 11:00",
    ]);

    await voteDate(name, { [ANA]: "2030-03-16" });
    await runAt(name, "2030-03-13T01:30");
    round = await lastRound(name);
    expect(round?.status).toBe("complete");
    // The hike ends at 15:00 on Saturday 16 March, before that day's 18:30.
    expect(await nextRun(name)).toBe(at("2030-03-17T01:30"));

    discord.clear();
    await runAt(name, "2030-03-17T01:30");
    expect(await lastRound(name)).toMatchObject({
      status: "location_voting",
      startedBy: APP,
    });
    expect(discord.posts(TEXT)).toHaveLength(1);
  });
});

describe("quiet weeks", () => {
  it("keeps a location vote without options open, with one notice per Wednesday", async () => {
    const discord = fakeDiscord();
    const name = "cadence-quiet-empty";
    await locationVoteOpen(name);
    const opened = await lastRound(name);

    await runAt(name, WED[1]);
    expect(await lastRound(name)).toMatchObject({
      id: opened?.id,
      status: "location_voting",
    });
    expect(discord.posts(NEWS)).toEqual([
      `**The location vote stays open another week.**\nNobody has proposed a location yet, so hikebot did not close it. Propose a location or vote in <#${TEXT}>; hikebot tries again <t:${String(utc(WED[2]) / 1000)}:F>.`,
    ]);
    expect(await nextRun(name)).toBe(at(WED[2]));

    // A second run in the same week (here, the alarm firing early) does not
    // post the notice again.
    await runAt(name, "2030-01-09T18:00");
    expect(discord.posts(NEWS)).toHaveLength(1);

    await runAt(name, WED[2]);
    expect(discord.posts(NEWS)).toHaveLength(2);
    expect((await lastRound(name))?.status).toBe("location_voting");
  });

  it("keeps a location vote nobody voted on open, saying so", async () => {
    const discord = fakeDiscord();
    const name = "cadence-quiet-novotes";
    await locationVoteOpen(name);
    await proposeAndVote(name, ["Ridge Trail"], {});

    await runAt(name, WED[1]);
    expect((await lastRound(name))?.status).toBe("location_voting");
    expect(discord.posts(NEWS)).toHaveLength(1);
    expect(discord.posts(NEWS)[0]).toContain(
      "Nobody has voted yet, so hikebot did not close it.",
    );
  });

  it("holds a date vote nobody voted on a day at a time with one notice, then cancels the round", async () => {
    const discord = fakeDiscord();
    const name = "cadence-quiet-dates";
    // A one-day date vote: it closes on Thursday, 50 hours before the first
    // candidate (Saturday 12 January at 11:00).
    await dateVoteOpen(name, { dateVoteDays: 1 });
    expect(await nextRun(name)).toBe(at("2030-01-10T17:00"));
    discord.clear();

    await runAt(name, "2030-01-10T17:00");
    expect((await lastRound(name))?.status).toBe("date_voting");
    expect(discord.posts(NEWS)).toEqual([
      `**The date vote stays open.**\nNobody has voted on a date yet, so hikebot did not close it. Vote in <#${TEXT}>: hikebot closes it at 09:00 (America/Los_Angeles) on the first day someone has voted, and cancels the round if nobody has voted once the earliest date is less than a day away.`,
    ]);
    expect(await nextRun(name)).toBe(at("2030-01-11T17:00"));

    // Friday: still no votes, 26 hours ahead: held without a second notice.
    await runAt(name, "2030-01-11T17:00");
    expect((await lastRound(name))?.status).toBe("date_voting");
    expect(discord.posts(NEWS)).toHaveLength(1);
    expect(await nextRun(name)).toBe(at("2030-01-12T17:00"));

    // Saturday: the first candidate is 2 hours away: the round is cancelled.
    await runAt(name, "2030-01-12T17:00");
    const round = await lastRound(name);
    expect(round).toMatchObject({ status: "cancelled", endedBy: APP });
    expect(discord.posts(NEWS)).toHaveLength(2);
    expect(discord.posts(NEWS)[1]).toBe(
      `**This round is cancelled.**\nNobody voted on a date for **Ridge Trail**, so hikebot cancelled the round. A new location vote opens <t:${String(utc(WED[2]) / 1000)}:F>.`,
    );
    // The date vote's message shows it cancelled.
    expect(
      discord.sent.some(
        (s) =>
          s.method === "PATCH" &&
          s.path.startsWith(`PATCH /channels/${TEXT}/messages/`),
      ),
    ).toBe(true);
    expect(await nextRun(name)).toBe(at(WED[2]));

    // The next Wednesday starts a new round.
    await runAt(name, WED[2]);
    const next = await lastRound(name);
    expect(next?.id).not.toBe(round?.id);
    expect(next?.status).toBe("location_voting");
  });

  it("closes a held date vote at the next day's time once someone votes", async () => {
    fakeDiscord();
    const name = "cadence-quiet-late-vote";
    await dateVoteOpen(name, { dateVoteDays: 1 });
    await runAt(name, "2030-01-10T17:00");
    expect((await lastRound(name))?.status).toBe("date_voting");

    await voteDate(name, { [BEN]: "2030-01-13" });
    await runAt(name, "2030-01-11T17:00");
    const round = await lastRound(name);
    expect(round).toMatchObject({ status: "complete", endedBy: APP });
    expect(
      round?.datePoll?.options.find((o) => o.id === round.dateOptionId)
        ?.dateValue,
    ).toBe("2030-01-13 11:00");
  });
});

describe("manual actions between runs", () => {
  it("opens the date vote on Wednesday after an admin closed the location vote early", async () => {
    fakeDiscord();
    const name = "cadence-manual-close-location";
    await locationVoteOpen(name);
    await proposeAndVote(name, ["Ridge Trail"], { [ANA]: "Ridge Trail" });
    vi.setSystemTime(utc("2030-01-07T20:00"));
    const pollId = (await lastRound(name))?.locationPoll?.id ?? 0;
    await inGuild(name, (context) =>
      byHand(closeVote(context, OWNER, { pollId })),
    );

    await runAt(name, WED[1]);
    const round = await lastRound(name);
    expect(round?.locationPoll).toMatchObject({
      status: "closed",
      closedBy: OWNER,
    });
    expect(round?.status).toBe("date_voting");
    expect(round?.datePoll?.openedBy).toBe(APP);
    expect(await nextRun(name)).toBe(at("2030-01-11T17:00"));
  });

  it("closes a date vote an admin started by hand at the schedule's time, days after it opened", async () => {
    fakeDiscord();
    const name = "cadence-manual-start-dates";
    await locationVoteOpen(name);
    await proposeAndVote(name, ["Ridge Trail"], { [ANA]: "Ridge Trail" });
    // Monday 7 January: the admin closes the vote and starts the date vote
    // on the default dates, as the panel's modal does.
    vi.setSystemTime(utc("2030-01-07T20:00"));
    await inGuild(name, async (context, store) => {
      const pollId = store.getActiveRound()?.locationPoll?.id ?? 0;
      await byHand(closeVote(context, OWNER, { pollId }));
      const started = startDateVote(context, OWNER);
      await scheduleCadence(
        context.storage,
        store,
        new GuildConfig(context.storage).get(),
        store.now(),
      );
      await byHand(started);
    });
    let round = await lastRound(name);
    expect(round?.datePoll?.openedBy).toBe(OWNER);
    // It closes Wednesday, two days after Monday: candidates from Thursday.
    expect(dateValues(round)).toEqual([
      "2030-01-12 11:00",
      "2030-01-13 11:00",
      "2030-01-19 11:00",
      "2030-01-20 11:00",
    ]);
    expect(await nextRun(name)).toBe(at(WED[1]));

    await voteDate(name, { [ANA]: "2030-01-12" });
    await runAt(name, WED[1]);
    round = await lastRound(name);
    expect(round).toMatchObject({ status: "complete", endedBy: APP });
    expect(await nextRun(name)).toBe(at(WED[2]));
  });

  it("opens the date vote again on Wednesday after an admin withdrew it, not before", async () => {
    const discord = fakeDiscord();
    const name = "cadence-manual-withdraw";
    await dateVoteOpen(name);
    const withdrawn = (await lastRound(name))?.datePoll?.id ?? 0;
    vi.setSystemTime(utc("2030-01-10T20:00"));
    await inGuild(name, (context) =>
      byHand(withdrawDateVote(context, OWNER, { pollId: withdrawn })),
    );
    discord.clear();

    // Friday's run, planned for the withdrawn vote's close, does nothing.
    await runAt(name, "2030-01-11T17:00");
    expect(discord.sent).toEqual([]);
    expect((await lastRound(name))?.status).toBe("location_decided");
    expect(await nextRun(name)).toBe(at(WED[2]));

    await runAt(name, WED[2]);
    const round = await lastRound(name);
    expect(round?.status).toBe("date_voting");
    expect(round?.datePoll).toMatchObject({
      openedBy: APP,
      openedAt: utc(WED[2]),
    });
  });

  it("starts a new round on Wednesday after an admin cancelled the round, leaving it cancelled", async () => {
    fakeDiscord();
    const name = "cadence-manual-cancel";
    await locationVoteOpen(name);
    const cancelled = await lastRound(name);
    vi.setSystemTime(utc("2030-01-07T20:00"));
    await inGuild(name, (context) =>
      byHand(cancelRound(context, OWNER, { roundId: cancelled?.id ?? 0 })),
    );

    await runAt(name, WED[1]);
    const round = await lastRound(name);
    expect(round?.id).not.toBe(cancelled?.id);
    expect(round).toMatchObject({ status: "location_voting", startedBy: APP });
    const before = await inGuild(name, (_c, store) =>
      store.getRound(cancelled?.id ?? 0),
    );
    expect(before).toMatchObject({ status: "cancelled", endedBy: OWNER });
  });

  it("does nothing at the planned close of a date vote an admin closed early", async () => {
    const discord = fakeDiscord();
    const name = "cadence-manual-close-dates";
    await dateVoteOpen(name);
    await voteDate(name, { [ANA]: "2030-01-19" });
    vi.setSystemTime(utc("2030-01-10T20:00"));
    const pollId = (await lastRound(name))?.datePoll?.id ?? 0;
    await inGuild(name, (context) =>
      byHand(closeVote(context, OWNER, { pollId })),
    );
    const round = await lastRound(name);
    expect(round).toMatchObject({ status: "complete", endedBy: OWNER });
    discord.clear();

    await runAt(name, "2030-01-11T17:00");
    expect(discord.sent).toEqual([]);
    expect(await lastRound(name)).toMatchObject({
      id: round?.id,
      endedBy: OWNER,
    });
    expect(await nextRun(name)).toBe(at(WED[2]));
  });

  it("leaves a date vote opened before the schedule was turned on to the admins", async () => {
    const discord = fakeDiscord();
    const name = "cadence-manual-before-on";
    // Monday 7 January, the schedule off: the admin decides the location and
    // starts a date vote on 12 and 19 January by hand.
    vi.setSystemTime(utc("2030-01-07T20:00"));
    await inGuild(name, async (context, store) => {
      const config = new GuildConfig(context.storage);
      config.set("voteChannelId", TEXT);
      config.set("announceChannelId", NEWS);
      config.set("forumChannelId", FORUM);
      config.setTimezone(LA);
      await byHand(
        startLocationVote(context, OWNER, { labels: ["Ridge Trail"] }),
      );
      const pollId = store.getActiveRound()?.locationPoll?.id ?? 0;
      voteFor(store, pollId, { [ANA]: "Ridge Trail" });
      await byHand(closeVote(context, OWNER, { pollId }));
      await byHand(
        startDateVote(context, OWNER, {
          dates: ["2030-01-12 11:00", "2030-01-19 11:00"],
        }),
      );
    });
    // Friday 11 January: the schedule is turned on.
    vi.setSystemTime(utc("2030-01-11T20:00"));
    await inGuild(name, ({ storage }, store) =>
      changeSchedule(storage, store, name, { enabled: true }),
    );
    // Not the next morning, as for a vote it opened: the next Wednesday.
    expect(await nextRun(name)).toBe(at(WED[2]));
    expect(
      await inGuild(name, ({ storage }) =>
        text(renderAdminPanel(loadAdminPanelState(storage))),
      ),
    ).toContain(
      "**Next:** nothing until an admin closes the date vote, which was started before the schedule was turned on.",
    );
    const poll = (await lastRound(name))?.datePoll;
    expect(
      await inGuild(name, ({ storage }) =>
        poll ? cadenceDateWindow(poll, new GuildConfig(storage).get()) : "none",
      ),
    ).toBeNull();
    discord.clear();

    await runAt(name, WED[2]);
    // Nothing on Discord; the alarm also ran the location lookup job.
    expect(discord.sent.filter((s) => s.path.includes("/channels/"))).toEqual(
      [],
    );
    expect((await lastRound(name))?.status).toBe("date_voting");
    expect(await nextRun(name)).toBe(at(WED[3]));
  });

  it("waits six days before closing a location vote an admin started by hand", async () => {
    fakeDiscord();
    const name = "cadence-manual-start-location";
    vi.setSystemTime(utc(MONDAY_BEFORE));
    await turnOn(name);
    // Monday 7 January: the admin starts a location vote by hand.
    vi.setSystemTime(utc("2030-01-07T20:00"));
    await inGuild(name, (context) =>
      byHand(startLocationVote(context, OWNER, { labels: ["Ridge Trail"] })),
    );
    await proposeAndVote(name, [], { [ANA]: "Ridge Trail" });

    // Wednesday 2 days later: too soon to close.
    await runAt(name, WED[0]);
    await runAt(name, WED[1]);
    expect((await lastRound(name))?.status).toBe("location_voting");
    await runAt(name, WED[2]);
    expect((await lastRound(name))?.status).toBe("date_voting");
  });
});

describe("settings", () => {
  it("stops when turned off, leaving the open vote as it is", async () => {
    const discord = fakeDiscord();
    const name = "cadence-off";
    await locationVoteOpen(name);
    await proposeAndVote(name, ["Ridge Trail"], { [ANA]: "Ridge Trail" });
    vi.setSystemTime(utc("2030-01-07T20:00"));
    await inGuild(name, ({ storage }, store) =>
      changeSchedule(storage, store, name, { enabled: false }),
    );
    expect(await nextRun(name)).toBeUndefined();
    expect(await inGuild(name, ({ storage }) => storage.getAlarm())).toBeNull();

    // Even a run left over from before does nothing and schedules nothing.
    await inGuild(name, ({ storage }) =>
      schedule(storage, CADENCE_JOB, utc(WED[1])),
    );
    discord.clear();
    await runAt(name, WED[1]);
    expect(discord.sent).toEqual([]);
    expect((await lastRound(name))?.status).toBe("location_voting");
    expect(await nextRun(name)).toBeUndefined();

    // Turned on again, it acts from the next Wednesday.
    await inGuild(name, ({ storage }, store) =>
      changeSchedule(storage, store, name, { enabled: true }),
    );
    expect(await nextRun(name)).toBe(at(WED[2]));
  });

  it("moves the next run when the weekday changes", async () => {
    fakeDiscord();
    const name = "cadence-weekday";
    vi.setSystemTime(utc(MONDAY_BEFORE));
    await turnOn(name);
    expect(await nextRun(name)).toBe(at(WED[0]));
    await inGuild(name, ({ storage }, store) =>
      changeSchedule(storage, store, name, { weekday: 5 }),
    );
    // Friday 4 January, 09:00.
    expect(await nextRun(name)).toBe(at("2030-01-04T17:00"));
    await runAt(name, "2030-01-04T17:00");
    expect((await lastRound(name))?.status).toBe("location_voting");
  });

  it("does not act on a time that has just passed when the time changes", async () => {
    const discord = fakeDiscord();
    const name = "cadence-time";
    // Wednesday 2 January, 08:30 in Los Angeles.
    vi.setSystemTime(utc("2030-01-02T16:30"));
    await turnOn(name);
    expect(await nextRun(name)).toBe(at(WED[0]));
    await inGuild(name, ({ storage }, store) =>
      changeSchedule(storage, store, name, { time: "08:00" }),
    );
    expect(await nextRun(name)).toBe(at("2030-01-09T16:00"));
    // The alarm firing now does nothing for today's 08:00.
    await runAt(name, "2030-01-02T16:30");
    expect(discord.sent).toEqual([]);
    expect(await lastRound(name)).toBeNull();
  });

  it("moves the date vote's close when its length changes", async () => {
    fakeDiscord();
    const name = "cadence-length";
    await dateVoteOpen(name);
    expect(await nextRun(name)).toBe(at("2030-01-11T17:00"));
    await inGuild(name, ({ storage }, store) =>
      changeSchedule(storage, store, name, { dateVoteDays: 3 }),
    );
    expect(await nextRun(name)).toBe(at("2030-01-12T17:00"));
  });

  it("shows the schedule and what it does next on the panel", async () => {
    fakeDiscord();
    const name = "cadence-panel";
    vi.setSystemTime(utc(MONDAY_BEFORE));
    const panel = () =>
      inGuild(name, ({ storage }) =>
        text(renderAdminPanel(loadAdminPanelState(storage))),
      );
    await inGuild(name, ({ storage }) => {
      new GuildConfig(storage).set("voteChannelId", TEXT);
    });
    expect(await panel()).toContain("**Schedule:** off");

    await turnOn(name);
    const t = (iso: string) => String(utc(iso) / 1000);
    expect(await panel()).toContain(
      `**Schedule:** on · Wednesdays at 09:00 (America/Los_Angeles) · date vote 2 days\n**Next:** Opens a location vote <t:${t(WED[0])}:F> (<t:${t(WED[0])}:R>).`,
    );
    await runAt(name, WED[0]);
    expect(await panel()).toContain(
      `**Next:** Closes the location vote and opens the date vote, if anyone has voted <t:${t(WED[1])}:F>`,
    );
    await proposeAndVote(name, ["Ridge Trail"], { [ANA]: "Ridge Trail" });
    expect(await panel()).toContain(
      `**Next:** Closes the location vote and opens the date vote <t:${t(WED[1])}:F>`,
    );
    await runAt(name, WED[1]);
    expect(await panel()).toContain(
      `**Next:** Closes the date vote if anyone has voted <t:${t("2030-01-11T17:00")}:F>`,
    );
    await voteDate(name, { [ANA]: "2030-01-19" });
    await runAt(name, "2030-01-11T17:00");
    // The hike is on Saturday 19 January: the next vote opens the 23rd.
    expect(await panel()).toContain(
      `**Next:** Opens a location vote <t:${t(WED[3])}:F>`,
    );
  });
});

describe("a step that fails", () => {
  it("keeps the next run scheduled", async () => {
    const discord = fakeDiscord();
    const name = "cadence-throws";
    await locationVoteOpen(name);
    // The quiet notice cannot be posted: the step throws.
    discord.fail(new RegExp(`^POST /channels/${NEWS}/messages$`));
    await runAt(name, WED[1]);
    expect(
      discord.sent.filter((s) => s.path === `POST /channels/${NEWS}/messages`),
    ).toHaveLength(1);
    expect(await nextRun(name)).toBe(at(WED[2]));
    expect(
      await inGuild(name, ({ storage }) => readCadenceState(storage)),
    ).toMatchObject({ guildId: name, lastInstant: utc(WED[1]) });

    discord.fail(null);
    await runAt(name, WED[2]);
    expect(discord.posts(NEWS)).toHaveLength(2);
  });
});
