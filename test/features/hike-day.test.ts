import {
  createExecutionContext,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { googleLink, osmLink } from "../../src/geo/links";
import { env } from "cloudflare:workers";
import {
  InteractionResponseType,
  MessageFlags,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { calendarAddress } from "../../src/calendar/address";
import { ADMIN_PANEL_IDS } from "../../src/features/admin-panel";
import {
  HIKE_DAY_AFTER_CLOSE_MS,
  HIKE_DAY_IDS,
  HIKE_DAY_JOB,
  HIKE_DAY_SECTIONS,
  renderHikeDay,
  type HikeDay,
} from "../../src/features/hike-day";
import {
  HIKE_DAY_CLAIM_MS,
  claimHikeDay,
  hikeDayStatus,
  hikeDayTime,
} from "../../src/features/hike-day-state";
import { POLL_IDS } from "../../src/features/poll-ui";
import { GuildConfig } from "../../src/guild/config";
import { schedule, scheduledJobs } from "../../src/guild/schedule";
import { PollStore, type OptionView } from "../../src/polls/store";
import {
  callWorker,
  componentInteraction,
  createSigner,
  signedRequest,
  type Signer,
} from "../helpers";

const OWNER = "400000000000000001";
const TEXT = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";
const THREAD = "900000000000000001";
const EVENT = "950000000000000001";
const LA = "America/Los_Angeles";
const BERLIN = "Europe/Berlin";

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Sets the clock the Worker, the object and its store read. */
function setNow(at: number): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

interface Node {
  type: number;
  content?: string;
  custom_id?: string;
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

function text(components: readonly unknown[] = []): string {
  return flatten(components as Node[])
    .map((c) => c.content ?? "")
    .filter((c) => c !== "")
    .join("\n");
}

function ids(components: readonly unknown[] = []): string[] {
  return flatten(components as Node[]).flatMap((c) =>
    c.custom_id === undefined ? [] : [c.custom_id],
  );
}

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

function inObject<T>(
  guildId: string,
  run: (storage: DurableObjectStorage) => T | Promise<T>,
): Promise<T> {
  return runInDurableObject(stub(guildId), (_i, state) => run(state.storage));
}

function click(
  customId: string,
  guildId: string,
): APIMessageComponentInteraction {
  const interaction = componentInteraction(customId, guildId);
  Object.assign(interaction, {
    member: { user: { id: OWNER }, roles: [] },
    message: { id: "800000000000000009", components: [] },
  });
  return interaction;
}

interface Sent {
  route: string;
  body: {
    flags?: number;
    components?: APIMessageTopLevelComponent[];
    allowed_mentions?: unknown;
  };
}

/**
 * Stubs Discord: the guild's owner, a thread `THREAD`, an event `EVENT`,
 * and `post()` for the hike-day announcement in `NEWS`; anything else
 * answers a fresh id. Returns what the bot sent, GETs left out.
 */
function discord(
  guildId: string,
  post: () => Response | Promise<Response> = () =>
    Response.json({ id: "960000000000000001" }),
) {
  const sent: Sent[] = [];
  let next = 1;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname.replace("/api/v10", "");
    const body = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    ) as Sent["body"];
    if (request.method !== "GET") {
      sent.push({ route: `${request.method} ${path}`, body });
    }
    if (path === `/guilds/${guildId}`) {
      return Promise.resolve(Response.json({ id: guildId, owner_id: OWNER }));
    }
    if (path.endsWith("/threads")) {
      return Promise.resolve(
        Response.json({ id: THREAD, parent_id: FORUM }, { status: 201 }),
      );
    }
    if (path.endsWith("/scheduled-events")) {
      return Promise.resolve(Response.json({ id: EVENT, guild_id: guildId }));
    }
    if (
      path === `/channels/${NEWS}/messages` &&
      text(body.components).includes("Hike today")
    ) {
      return Promise.resolve(post());
    }
    next += 1;
    return Promise.resolve(Response.json({ id: String(next) }));
  });
  return sent;
}

/** The hike-day announcements among what the bot sent. */
function hikeDays(sent: Sent[]): Sent[] {
  return sent.filter(
    (r) =>
      r.route === `POST /channels/${NEWS}/messages` &&
      text(r.body.components).includes("## Hike today"),
  );
}

/**
 * Sends the interaction through the Worker and waits for its follow-up,
 * unless the caller passes the context to wait on itself.
 */
async function send(interaction: unknown, own?: ExecutionContext) {
  const ctx = own ?? createExecutionContext();
  const response = await callWorker(
    signer,
    await signedRequest(signer, interaction),
    ctx,
  );
  expect(response.status).toBe(200);
  const body = await response.json<{
    type: InteractionResponseType;
    data?: { components: APIMessageTopLevelComponent[] };
  }>();
  if (own === undefined) await waitOnExecutionContext(ctx);
  return body;
}

/** The panel's status view, redrawn through Refresh. */
async function panel(guildId: string) {
  const reply = await send(click(ADMIN_PANEL_IDS.refresh, guildId));
  return {
    shown: text(reply.data?.components),
    buttons: ids(reply.data?.components),
  };
}

interface Plan {
  guild: string;
  timeZone: string;
  location?: string;
  details?: string | null;
  /** The winning date, `YYYY-MM-DD HH:MM`; a later losing date is added. */
  date: string;
}

/**
 * Plays a round in `guild` up to an open date vote that `date` wins, with
 * the channels and the time zone set, then closes it through the Worker,
 * follow-up and all, at the clock as it is. Returns the round's id.
 */
async function planHike({
  guild,
  timeZone,
  location = "Lake Loop",
  details = "Meet at the north trailhead.",
  date,
}: Plan): Promise<number> {
  const { roundId, pollId } = await inObject(guild, (storage) => {
    const config = new GuildConfig(storage);
    config.set("voteChannelId", TEXT);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
    config.setTimezone(timeZone);
    const store = new PollStore(storage);
    const started = store.startRound(OWNER, [
      { label: location, details, proposedBy: OWNER },
    ]);
    const where = started.locationPoll?.id ?? 0;
    store.setVotes(where, "u1", [started.locationPoll?.options[0]?.id ?? 0]);
    store.closePoll(where, OWNER);
    const poll = store.startDatePoll(started.id, OWNER, [
      date,
      "2030-01-05 11:00",
    ]);
    store.setPollMessage(poll.id, TEXT, "700000000000000002");
    const winner = poll.options.find((o) => o.dateValue === date);
    store.setVotes(poll.id, "u1", [winner?.id ?? 0]);
    return { roundId: started.id, pollId: poll.id };
  });
  const reply = await send(click(POLL_IDS.closeConfirm(pollId), guild));
  expect(reply.type).toBe(InteractionResponseType.DeferredMessageUpdate);
  return roundId;
}

/** Runs the object's alarm until no job is due by the clock. */
async function runDueAlarms(guild: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const due = await inObject(guild, async (storage) =>
      [...(await scheduledJobs(storage)).values()].some(
        (at) => at <= Date.now(),
      ),
    );
    if (!due) return;
    await runDurableObjectAlarm(stub(guild));
  }
}

const jobs = (guild: string) =>
  inObject(guild, (storage) => scheduledJobs(storage));

describe("hikeDayTime", () => {
  it.each([
    // An 11:00 hike: 07:00 on the day.
    ["2027-06-12 11:00", LA, Date.UTC(2027, 5, 12, 14)],
    ["2027-06-12 11:00", BERLIN, Date.UTC(2027, 5, 12, 5)],
    // An 08:00 hike: two hours before, 06:00.
    ["2027-06-12 08:00", LA, Date.UTC(2027, 5, 12, 13)],
    ["2027-06-12 08:00", BERLIN, Date.UTC(2027, 5, 12, 4)],
    // Exactly two hours ahead of a 09:00 start is 07:00 too.
    ["2027-06-12 09:00", LA, Date.UTC(2027, 5, 12, 14)],
    // Los Angeles goes to daylight time on Sun 14 Mar 2027.
    ["2027-03-13 11:00", LA, Date.UTC(2027, 2, 13, 15)],
    ["2027-03-14 11:00", LA, Date.UTC(2027, 2, 14, 14)],
    ["2027-03-14 08:00", LA, Date.UTC(2027, 2, 14, 13)],
    ["2027-03-15 11:00", LA, Date.UTC(2027, 2, 15, 14)],
    // ...and back to standard time on Sun 7 Nov 2027.
    ["2027-11-06 11:00", LA, Date.UTC(2027, 10, 6, 14)],
    ["2027-11-07 11:00", LA, Date.UTC(2027, 10, 7, 15)],
    ["2027-11-07 08:00", LA, Date.UTC(2027, 10, 7, 14)],
    ["2027-11-08 11:00", LA, Date.UTC(2027, 10, 8, 15)],
    // Berlin changes on Sun 28 Mar and Sun 31 Oct 2027.
    ["2027-03-27 11:00", BERLIN, Date.UTC(2027, 2, 27, 6)],
    ["2027-03-28 11:00", BERLIN, Date.UTC(2027, 2, 28, 5)],
    ["2027-10-30 11:00", BERLIN, Date.UTC(2027, 9, 30, 5)],
    ["2027-10-31 11:00", BERLIN, Date.UTC(2027, 9, 31, 6)],
  ])("announces a hike at %s in %s at the right instant", (date, zone, at) => {
    expect(hikeDayTime(date, zone)).toBe(at);
  });

  it("is NaN for a value that is not a date", () => {
    expect(hikeDayTime("someday", LA)).toBeNaN();
  });
});

const option = (over: Partial<OptionView>): OptionView => ({
  id: 1,
  pollId: 1,
  label: "Lake Loop",
  details: null,
  dateValue: null,
  proposedBy: OWNER,
  createdAt: 0,
  votes: 0,
  place: null,
  ...over,
});

const DAY: HikeDay = {
  guildId: "200000000000000001",
  timeZone: LA,
  location: option({ details: "Meet at the north trailhead." }),
  date: option({ label: "Sat, 12 Jun 2027 · 11:00" }),
  start: Date.UTC(2027, 5, 12, 18),
  threadId: THREAD,
  eventId: EVENT,
  calendar: "https://hikebot.example/calendar/200000000000000001/sig.ics",
};

describe("the announcement", () => {
  const start = String(Date.UTC(2027, 5, 12, 18) / 1000);

  it("names the location, the start in both forms, the details, the thread, the event, the calendar and asks who is coming", () => {
    const day = {
      ...DAY,
      date: { ...DAY.date, dateValue: "2027-06-12 11:00" },
    };
    expect(text(renderHikeDay(day)).split("\n")).toEqual([
      "## Hike today: Lake Loop",
      `**Starts:** 11:00 (America/Los_Angeles), <t:${start}:t> in your time zone, <t:${start}:R>`,
      "Meet at the north trailhead.",
      `**Hike thread:** <#${THREAD}>`,
      `**Discord event:** https://discord.com/events/200000000000000001/${EVENT}`,
      "**Calendar:** https://hikebot.example/calendar/200000000000000001/sig.ics",
      `Coming? Say so in <#${THREAD}>, so the group knows who to expect.`,
    ]);
  });

  it("leaves out a missing thread, event and details without an error", () => {
    const day: HikeDay = {
      ...DAY,
      location: option({ details: null }),
      date: { ...DAY.date, dateValue: "2027-06-12 11:00" },
      threadId: null,
      eventId: null,
    };
    expect(text(renderHikeDay(day)).split("\n")).toEqual([
      "## Hike today: Lake Loop",
      `**Starts:** 11:00 (America/Los_Angeles), <t:${start}:t> in your time zone, <t:${start}:R>`,
      "**Calendar:** https://hikebot.example/calendar/200000000000000001/sig.ics",
    ]);
  });

  it("shows where the location is with both map links and the attribution when it has a pin", () => {
    const point = { lat: 47.4875, lon: -121.7234 };
    const lines = text(
      renderHikeDay({
        ...DAY,
        location: {
          ...DAY.location,
          place: {
            status: "found",
            point,
            name: "Lake Loop, King County",
            attempts: 1,
          },
        },
      }),
    ).split("\n");
    expect(lines).toContain(
      `📍 Lake Loop, King County · [OpenStreetMap](${osmLink(point)}) · [Google Maps](${googleLink(point)})`,
    );
    expect(lines.indexOf("Meet at the north trailhead.")).toBe(
      lines.findIndex((line) => line.startsWith("📍")) - 1,
    );
    expect(lines[lines.length - 1]).toBe("-# © OpenStreetMap contributors");
    expect(text(renderHikeDay(DAY))).not.toContain("OpenStreetMap");
  });

  it("takes a new section by adding it to the list", () => {
    const forecast = () => ["**Forecast:** sunny, 18°C"];
    const lines = text(
      renderHikeDay(DAY, [...HIKE_DAY_SECTIONS, forecast]),
    ).split("\n");
    expect(lines.at(-1)).toBe("**Forecast:** sunny, 18°C");
    expect(lines.slice(0, -1)).toEqual(text(renderHikeDay(DAY)).split("\n"));
  });
});

describe("the hike:day-of job", () => {
  it.each([
    {
      name: "an 11:00 hike in Los Angeles",
      start: Date.UTC(2027, 5, 12, 18),
      guild: "200000000000000901",
      timeZone: LA,
      closedAt: Date.UTC(2027, 5, 9, 19),
      date: "2027-06-12 11:00",
      at: Date.UTC(2027, 5, 12, 14),
      written: "11:00 (America/Los_Angeles)",
    },
    {
      name: "an 08:00 hike in Berlin",
      start: Date.UTC(2027, 5, 12, 6),
      guild: "200000000000000902",
      timeZone: BERLIN,
      closedAt: Date.UTC(2027, 5, 9, 19),
      date: "2027-06-12 08:00",
      at: Date.UTC(2027, 5, 12, 4),
      written: "08:00 (Europe/Berlin)",
    },
    {
      name: "a Los Angeles hike decided in standard time, held in daylight time",
      start: Date.UTC(2027, 2, 14, 18),
      guild: "200000000000000903",
      timeZone: LA,
      closedAt: Date.UTC(2027, 2, 10, 19),
      date: "2027-03-14 11:00",
      at: Date.UTC(2027, 2, 14, 14),
      written: "11:00 (America/Los_Angeles)",
    },
    {
      name: "a Berlin hike decided in summer time, held in winter time",
      start: Date.UTC(2027, 9, 31, 10),
      guild: "200000000000000904",
      timeZone: BERLIN,
      closedAt: Date.UTC(2027, 9, 27, 19),
      date: "2027-10-31 11:00",
      at: Date.UTC(2027, 9, 31, 6),
      written: "11:00 (Europe/Berlin)",
    },
  ])(
    "posts $name once, at the right instant",
    async ({ guild, timeZone, closedAt, date, at, start, written }) => {
      setNow(closedAt);
      const sent = discord(guild);
      const roundId = await planHike({ guild, timeZone, date });
      expect((await jobs(guild)).get(HIKE_DAY_JOB)).toBe(at);
      expect(hikeDays(sent)).toEqual([]);

      // A second before, the job runs and posts nothing.
      setNow(at - 1000);
      await runDueAlarms(guild);
      expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
      expect(hikeDays(sent)).toEqual([]);
      expect((await jobs(guild)).get(HIKE_DAY_JOB)).toBe(at);

      setNow(at);
      expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
      const [posted, ...more] = hikeDays(sent);
      expect(more).toEqual([]);
      expect(posted?.body.flags).toBe(MessageFlags.IsComponentsV2);
      expect(posted?.body.allowed_mentions).toEqual({ parse: [] });
      const calendar = await calendarAddress(env, guild);
      const startsAt = String(start / 1000);
      expect(text(posted?.body.components).split("\n")).toEqual([
        "## Hike today: Lake Loop",
        `**Starts:** ${written}, <t:${startsAt}:t> in your time zone, <t:${startsAt}:R>`,
        "Meet at the north trailhead.",
        `**Hike thread:** <#${THREAD}>`,
        `**Discord event:** https://discord.com/events/${guild}/${EVENT}`,
        `**Calendar:** ${calendar}`,
        `Coming? Say so in <#${THREAD}>, so the group knows who to expect.`,
      ]);

      // Nothing else is planned, so the job is not scheduled again, and a
      // second run posts nothing.
      expect((await jobs(guild)).has(HIKE_DAY_JOB)).toBe(false);
      await inObject(guild, (storage) =>
        schedule(storage, HIKE_DAY_JOB, Date.now()),
      );
      expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
      expect(hikeDays(sent)).toHaveLength(1);
      await inObject(guild, (storage) => {
        const round = new PollStore(storage).getRound(roundId);
        expect(round?.dayOf).toEqual({
          channelId: NEWS,
          messageId: "960000000000000001",
        });
      });
      expect((await panel(guild)).shown).toContain(
        `**Hike-day announcement:** posted in <#${NEWS}>.`,
      );
    },
  );

  it("schedules itself for the next planned hike after it posts", async () => {
    const guild = "200000000000000905";
    setNow(Date.UTC(2027, 5, 9, 19));
    const sent = discord(guild);
    await planHike({ guild, timeZone: LA, date: "2027-06-12 11:00" });
    await planHike({
      guild,
      timeZone: LA,
      location: "Ridge Trail",
      date: "2027-06-19 08:00",
    });
    // The earlier hike's time is kept.
    expect((await jobs(guild)).get(HIKE_DAY_JOB)).toBe(
      Date.UTC(2027, 5, 12, 14),
    );
    setNow(Date.UTC(2027, 5, 12, 14));
    await runDueAlarms(guild);
    expect(hikeDays(sent).map((r) => text(r.body.components))).toEqual([
      expect.stringContaining("## Hike today: Lake Loop"),
    ]);
    expect((await jobs(guild)).get(HIKE_DAY_JOB)).toBe(
      Date.UTC(2027, 5, 19, 13),
    );
    setNow(Date.UTC(2027, 5, 19, 13));
    await runDueAlarms(guild);
    expect(hikeDays(sent).map((r) => text(r.body.components))).toEqual([
      expect.stringContaining("## Hike today: Lake Loop"),
      expect.stringContaining("## Hike today: Ridge Trail"),
    ]);
    expect((await jobs(guild)).has(HIKE_DAY_JOB)).toBe(false);
  });

  it("announces a hike decided on its own day after 07:00 at once, after the result", async () => {
    const guild = "200000000000000906";
    // 09:00 in Los Angeles on the day of an 11:00 hike.
    const closedAt = Date.UTC(2027, 5, 12, 16);
    setNow(closedAt);
    const sent = discord(guild);
    await planHike({ guild, timeZone: LA, date: "2027-06-12 11:00" });
    expect((await jobs(guild)).get(HIKE_DAY_JOB)).toBe(
      closedAt + HIKE_DAY_AFTER_CLOSE_MS,
    );
    setNow(closedAt + HIKE_DAY_AFTER_CLOSE_MS);
    await runDueAlarms(guild);
    const news = sent
      .filter((r) => r.route === `POST /channels/${NEWS}/messages`)
      .map((r) => text(r.body.components).split("\n")[0]);
    expect(news).toEqual(["## Hike planned", "## Hike today: Lake Loop"]);
  });

  it("does not announce a hike decided after it started", async () => {
    const guild = "200000000000000907";
    // 11:30 in Los Angeles, half an hour into an 11:00 hike.
    setNow(Date.UTC(2027, 5, 12, 18, 30));
    const sent = discord(guild);
    const roundId = await planHike({
      guild,
      timeZone: LA,
      date: "2027-06-12 11:00",
    });
    expect((await jobs(guild)).has(HIKE_DAY_JOB)).toBe(false);
    await runDueAlarms(guild);
    expect(hikeDays(sent)).toEqual([]);
    await inObject(guild, (storage) => {
      const store = new PollStore(storage);
      const round = store.getRound(roundId);
      if (round === null) throw new Error("no round");
      expect(hikeDayStatus(storage, round, store.now())).toEqual({
        state: "none",
      });
    });
    expect((await panel(guild)).shown).not.toContain("Hike-day announcement");
  });

  it("skips a hike that is over by the time the job runs", async () => {
    const guild = "200000000000000908";
    setNow(Date.UTC(2027, 5, 9, 19));
    const sent = discord(guild);
    await planHike({ guild, timeZone: LA, date: "2027-06-12 11:00" });
    // The object was down all day: the hike ended at 15:00 (22:00 UTC).
    setNow(Date.UTC(2027, 5, 12, 22));
    await runDueAlarms(guild);
    expect(hikeDays(sent)).toEqual([]);
    expect((await jobs(guild)).has(HIKE_DAY_JOB)).toBe(false);
    expect((await panel(guild)).shown).not.toContain("Hike-day announcement");
  });

  it("skips a round that was cancelled", async () => {
    const guild = "200000000000000909";
    setNow(Date.UTC(2027, 5, 9, 19));
    const sent = discord(guild);
    const roundId = await planHike({
      guild,
      timeZone: LA,
      date: "2027-06-12 11:00",
    });
    await inObject(guild, (storage) => {
      storage.sql.exec(
        "UPDATE rounds SET status = 'cancelled' WHERE id = ?",
        roundId,
      );
    });
    setNow(Date.UTC(2027, 5, 12, 14));
    await runDueAlarms(guild);
    expect(hikeDays(sent)).toEqual([]);
    expect((await jobs(guild)).has(HIKE_DAY_JOB)).toBe(false);
  });
});

describe("a post that was cut off or failed", () => {
  it("is not posted again after a restart between claim and post; the panel shows it unconfirmed and the retry posts it once", async () => {
    const guild = "200000000000000911";
    setNow(Date.UTC(2027, 5, 9, 19));
    const sent = discord(guild);
    const roundId = await planHike({
      guild,
      timeZone: LA,
      date: "2027-06-12 11:00",
    });
    const at = Date.UTC(2027, 5, 12, 14);
    setNow(at);
    // The job claimed the post, then the object restarted before Discord
    // was asked.
    await inObject(guild, (storage) => {
      const round = new PollStore(storage).getRound(roundId);
      if (round === null) throw new Error("no round");
      expect(claimHikeDay(storage, round, guild, at)).toBe(true);
    });
    await evictDurableObject(stub(guild));
    await runDueAlarms(guild);
    expect(hikeDays(sent)).toEqual([]);

    setNow(at + HIKE_DAY_CLAIM_MS);
    const before = await panel(guild);
    expect(before.shown).toContain(
      "**Hike-day announcement:** not confirmed: posting it was cut off, so it may or may not have been posted.",
    );
    expect(before.buttons).toContain(HIKE_DAY_IDS.post(roundId));
    // The job still leaves it to the admin.
    await inObject(guild, (storage) =>
      schedule(storage, HIKE_DAY_JOB, Date.now()),
    );
    await runDueAlarms(guild);
    expect(hikeDays(sent)).toEqual([]);

    const retried = await send(click(HIKE_DAY_IDS.post(roundId), guild));
    expect(retried.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    expect(hikeDays(sent)).toHaveLength(1);
    expect(text(sent.at(-1)?.body.components)).toContain(
      `The hike-day announcement is posted in <#${NEWS}>.`,
    );
    const again = await send(click(HIKE_DAY_IDS.post(roundId), guild));
    expect(text(again.data?.components)).toContain(
      `The hike-day announcement is already posted in <#${NEWS}>.`,
    );
    expect(hikeDays(sent)).toHaveLength(1);
    const after = await panel(guild);
    expect(after.buttons).not.toContain(HIKE_DAY_IDS.post(roundId));
  });

  it("shows a refused post with Discord's error, and the retry posts it once even when clicked twice", async () => {
    const guild = "200000000000000912";
    setNow(Date.UTC(2027, 5, 9, 19));
    let refuse = true;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent = discord(guild, () =>
      refuse
        ? Response.json(
            { message: "Missing Access", code: 50001 },
            { status: 403 },
          )
        : held.then(() => Response.json({ id: "960000000000000002" })),
    );
    const roundId = await planHike({
      guild,
      timeZone: LA,
      date: "2027-06-12 11:00",
    });
    setNow(Date.UTC(2027, 5, 12, 14));
    await runDueAlarms(guild);
    expect(hikeDays(sent)).toHaveLength(1);
    const failed = await panel(guild);
    expect(failed.shown).toContain(
      `**Hike-day announcement:** not posted. Could not post the hike-day announcement in <#${NEWS}>: Discord answered: Missing Access (HTTP 403, code 50001).`,
    );
    expect(failed.buttons).toContain(HIKE_DAY_IDS.post(roundId));

    refuse = false;
    // The first click's post waits until the second click is answered.
    const first = createExecutionContext();
    const one = await send(click(HIKE_DAY_IDS.post(roundId), guild), first);
    const two = await send(click(HIKE_DAY_IDS.post(roundId), guild));
    expect(one.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    expect(text(two.data?.components)).toContain(
      "The hike-day announcement is being posted.",
    );
    expect(text(two.data?.components)).toContain(
      "**Hike-day announcement:** being posted.",
    );
    expect(ids(two.data?.components)).not.toContain(HIKE_DAY_IDS.post(roundId));
    release();
    await waitOnExecutionContext(first);
    expect(hikeDays(sent)).toHaveLength(2);
    expect((await panel(guild)).shown).toContain(
      `**Hike-day announcement:** posted in <#${NEWS}>.`,
    );
  });

  it("posts nothing without an announcements channel; the panel says so before and after, and the retry posts it once a channel is set", async () => {
    const guild = "200000000000000913";
    setNow(Date.UTC(2027, 5, 9, 19));
    const sent = discord(guild);
    const roundId = await planHike({
      guild,
      timeZone: LA,
      date: "2027-06-12 11:00",
    });
    await inObject(guild, (storage) => {
      new GuildConfig(storage).set("announceChannelId", null);
    });
    const at = Date.UTC(2027, 5, 12, 14);
    expect((await panel(guild)).shown).toContain(
      `**Hike-day announcement:** due <t:${String(at / 1000)}:f>, but no announcements channel is set, so it will not be posted. Pick one under Settings.`,
    );

    setNow(at);
    await runDueAlarms(guild);
    expect(hikeDays(sent)).toEqual([]);
    const failed = await panel(guild);
    expect(failed.shown).toContain(
      "**Hike-day announcement:** not posted. No announcements channel is set, so the hike-day announcement was not posted. Pick one under Settings, then click Post hike-day announcement.",
    );
    expect(failed.buttons).toContain(HIKE_DAY_IDS.post(roundId));

    await inObject(guild, (storage) => {
      new GuildConfig(storage).set("announceChannelId", NEWS);
    });
    await send(click(HIKE_DAY_IDS.post(roundId), guild));
    expect(hikeDays(sent)).toHaveLength(1);
  });

  it("refuses the retry once the hike is over, and before it is due", async () => {
    const guild = "200000000000000914";
    setNow(Date.UTC(2027, 5, 9, 19));
    const sent = discord(guild);
    const roundId = await planHike({
      guild,
      timeZone: LA,
      date: "2027-06-12 11:00",
    });
    const early = await send(click(HIKE_DAY_IDS.post(roundId), guild));
    expect(text(early.data?.components)).toContain(
      "The hike-day announcement is not due, so it was not posted.",
    );
    expect(
      text(early.data?.components).match(
        /Hike-day announcement:\*\* [^\n]*/,
      )?.[0],
    ).toBe(
      `Hike-day announcement:** <t:${String(Date.UTC(2027, 5, 12, 14) / 1000)}:f> in <#${NEWS}>.`,
    );
    await inObject(guild, (storage) => {
      const round = new PollStore(storage).getRound(roundId);
      if (round === null) throw new Error("no round");
      claimHikeDay(storage, round, guild, Date.UTC(2027, 5, 12, 14));
    });
    setNow(Date.UTC(2027, 5, 12, 22));
    const late = await send(click(HIKE_DAY_IDS.post(roundId), guild));
    expect(text(late.data?.components)).toContain(
      "The hike is over, so its hike-day announcement is not posted.",
    );
    expect(hikeDays(sent)).toEqual([]);
  });

  it("refuses a non-admin", async () => {
    const guild = "200000000000000915";
    setNow(Date.UTC(2027, 5, 9, 19));
    const sent = discord(guild);
    const roundId = await planHike({
      guild,
      timeZone: LA,
      date: "2027-06-12 11:00",
    });
    const interaction = click(HIKE_DAY_IDS.post(roundId), guild);
    Object.assign(interaction, {
      member: { user: { id: "400000000000000003" }, roles: [] },
    });
    const reply = await send(interaction);
    expect(reply.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(hikeDays(sent)).toEqual([]);
  });
});
