import {
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  InteractionResponseType,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DATE_POLL } from "../../src/features/date-vote";
import {
  HIKE_EVENT_IDS,
  MAX_EVENT_DESCRIPTION,
  MAX_EVENT_LOCATION,
  MAX_EVENT_NAME,
  START_PASSED_MESSAGE,
  createHikeEventStep,
  eventDescription,
  hikeEventDescription,
  hikeEventRequest,
} from "../../src/features/hike-event";
import {
  EVENT_CLAIM_MS,
  claimHikeEvent,
  hikeEventStatus,
  recordHikeEventFailure,
} from "../../src/features/hike-event-state";
import { HIKE_THREAD_IDS } from "../../src/features/hike-thread";
import { POLL_IDS, closePoll } from "../../src/features/poll-ui";
import { GuildConfig } from "../../src/guild/config";
import { HIKE_DURATION_HOURS } from "../../src/polls/dates";
import {
  MAX_DETAILS_LENGTH,
  MAX_LABEL_LENGTH,
  PollStore,
  type OptionView,
  type PollView,
  type RoundView,
} from "../../src/polls/store";
import {
  callWorker,
  componentInteraction,
  createSigner,
  signedRequest,
  type Signer,
} from "../helpers";
import { sequence } from "../polls/helpers";

const OWNER = "400000000000000001";
const PROPOSER = "400000000000000009";
const STRANGER = "400000000000000003";
const TEXT = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";
const THREAD = "900000000000000001";
const EVENT = "950000000000000001";
const LOCATION_MESSAGE = "700000000000000001";
const DATE_MESSAGE = "700000000000000002";
const GUILD = "200000000000000001";
const LA = "America/Los_Angeles";
const HOUR = 60 * 60 * 1000;

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});
afterEach(() => {
  vi.restoreAllMocks();
});

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

function text(components: readonly unknown[]): string {
  return flatten(components as Node[])
    .map((c) => c.content ?? "")
    .filter((c) => c !== "")
    .join("\n");
}

function ids(components: readonly unknown[]): string[] {
  return flatten(components as Node[]).flatMap((c) =>
    c.custom_id === undefined ? [] : [c.custom_id],
  );
}

// The request.

function option(
  id: number,
  pollId: number,
  label: string,
  extra: Partial<OptionView> = {},
): OptionView {
  return {
    id,
    pollId,
    label,
    details: null,
    dateValue: null,
    proposedBy: OWNER,
    createdAt: 0,
    place: null,
    votes: 1,
    ...extra,
  };
}

function poll(
  id: number,
  kind: "location" | "date",
  options: OptionView[],
): PollView {
  return {
    id,
    roundId: 1,
    kind,
    status: "closed",
    channelId: TEXT,
    messageId: kind === "location" ? LOCATION_MESSAGE : DATE_MESSAGE,
    winnerOptionId: options[0]?.id ?? null,
    tieBroken: false,
    tiedOptionIds: [],
    openedBy: OWNER,
    openedAt: 0,
    closedBy: OWNER,
    closedAt: 0,
    options,
    voterCount: 1,
    viewerVotes: [],
  };
}

/** A completed round at `label` (with `details`) on the date `value`. */
function hike(
  label: string,
  value: string,
  details: string | null = null,
  threadId: string | null = null,
): RoundView {
  const location = poll(1, "location", [option(1, 1, label, { details })]);
  const date = poll(2, "date", [option(11, 2, value, { dateValue: value })]);
  return {
    id: 1,
    status: "complete",
    locationOptionId: 1,
    dateOptionId: 11,
    threadId,
    eventId: null,
    dayOf: null,
    startedBy: OWNER,
    startedAt: 0,
    endedBy: OWNER,
    endedAt: 0,
    locationPoll: location,
    datePoll: date,
  };
}

/** 2026-11-18 12:00 UTC. */
const NOW = Date.UTC(2026, 10, 18, 12);

function request(round: RoundView, timeZone = LA, now = NOW) {
  const made = hikeEventRequest(round, GUILD, timeZone, now);
  if (!made.ok) throw new Error(`no request: ${made.why}`);
  return made.body;
}

describe("hikeEventRequest", () => {
  it("is an EXTERNAL guild-only event at the location, from the start to HIKE_DURATION_HOURS later", () => {
    const body = request(
      hike("Lake Loop", "2030-06-15 09:00", "Meet at the north lot.", THREAD),
    );
    expect(body).toEqual({
      name: "Lake Loop",
      privacy_level: GuildScheduledEventPrivacyLevel.GuildOnly,
      // 09:00 in Los Angeles on 15 June 2030 is 16:00 UTC.
      scheduled_start_time: "2030-06-15T16:00:00.000Z",
      scheduled_end_time: "2030-06-15T20:00:00.000Z",
      entity_type: GuildScheduledEventEntityType.External,
      entity_metadata: { location: "Lake Loop" },
      description: `Meet at the north lot.\n\nHike thread: https://discord.com/channels/${GUILD}/${THREAD}`,
    });
    expect(body).not.toHaveProperty("channel_id");
    expect(HIKE_DURATION_HOURS).toBe(4);
  });

  it.each([
    // 11:00 in Berlin on 15 June 2030 is 09:00 UTC.
    ["Europe/Berlin", "2030-06-15 11:00", "2030-06-15T09:00:00.000Z"],
    // 11:00 in Kolkata is 05:30 UTC.
    ["Asia/Kolkata", "2030-06-15 11:00", "2030-06-15T05:30:00.000Z"],
    // The day before the clocks go forward in Los Angeles: PST, UTC-8.
    [LA, "2030-03-09 11:00", "2030-03-09T19:00:00.000Z"],
    // The day they go forward: PDT, UTC-7.
    [LA, "2030-03-10 11:00", "2030-03-10T18:00:00.000Z"],
    // 02:30 that night does not exist; it is read as 03:30 PDT.
    [LA, "2030-03-10 02:30", "2030-03-10T10:30:00.000Z"],
    // 01:30 when they go back happens twice; the first is PDT.
    [LA, "2030-11-03 01:30", "2030-11-03T08:30:00.000Z"],
  ])("starts at the winning date in %s (%s)", (timeZone, value, start) => {
    const body = request(hike("Ridge", value), timeZone);
    expect(body.scheduled_start_time).toBe(start);
    expect(Date.parse(body.scheduled_end_time ?? "")).toBe(
      Date.parse(start) + HIKE_DURATION_HOURS * HOUR,
    );
  });

  it("has no description without details or a thread", () => {
    expect(request(hike("Ridge", "2030-06-15 09:00"))).not.toHaveProperty(
      "description",
    );
  });

  it("stays within Discord's limits with the longest label and details", () => {
    const body = request(
      hike(
        "L".repeat(MAX_LABEL_LENGTH),
        "2030-06-15 09:00",
        "D".repeat(MAX_DETAILS_LENGTH),
        "9".repeat(20),
      ),
    );
    expect(body.name).toBe("L".repeat(MAX_LABEL_LENGTH));
    expect(body.entity_metadata?.location).toBe("L".repeat(MAX_LABEL_LENGTH));
    expect(body.description?.length).toBeLessThanOrEqual(MAX_EVENT_DESCRIPTION);
    expect(body.description).toContain("D".repeat(MAX_DETAILS_LENGTH));
  });

  it("shortens a label and details past Discord's limits, keeping the thread link whole", () => {
    const link = `https://discord.com/channels/${GUILD}/${THREAD}`;
    const body = request(
      hike("L".repeat(150), "2030-06-15 09:00", "D".repeat(2000), THREAD),
    );
    expect(body.name).toHaveLength(MAX_EVENT_NAME);
    expect(body.name.endsWith("…")).toBe(true);
    expect(body.entity_metadata?.location).toHaveLength(MAX_EVENT_LOCATION);
    expect(body.description).toHaveLength(MAX_EVENT_DESCRIPTION);
    expect(body.description?.endsWith(`…\n\nHike thread: ${link}`)).toBe(true);
  });

  it("asks for no event when the start is not after now", () => {
    const round = hike("Ridge", "2030-06-15 09:00");
    const start = Date.UTC(2030, 5, 15, 16);
    expect(hikeEventRequest(round, GUILD, LA, start - 1).ok).toBe(true);
    expect(hikeEventRequest(round, GUILD, LA, start)).toEqual({
      ok: false,
      why: "past",
    });
    expect(hikeEventRequest(round, GUILD, LA, start + HOUR)).toEqual({
      ok: false,
      why: "past",
    });
  });

  it("asks for no event for a round without a decided date", () => {
    const round = { ...hike("Ridge", "2030-06-15 09:00"), dateOptionId: null };
    expect(hikeEventRequest(round, GUILD, LA, NOW)).toEqual({
      ok: false,
      why: "undecided",
    });
  });
});

describe("eventDescription", () => {
  it("is the details, the link, both, or nothing", () => {
    expect(eventDescription("Steep", null)).toBe("Steep");
    expect(eventDescription(null, "https://x")).toBe("Hike thread: https://x");
    expect(eventDescription("Steep", "https://x")).toBe(
      "Steep\n\nHike thread: https://x",
    );
    expect(eventDescription(null, null)).toBe("");
  });

  const SI = { lat: 47.4875, lon: -121.7234 };
  const OSM =
    "https://www.openstreetmap.org/?mlat=47.4875&mlon=-121.7234#map=13/47.4875/-121.7234";
  const GOOGLE =
    "https://www.google.com/maps/search/?api=1&query=47.4875,-121.7234";

  it("shows the place's name, both map links and the attribution between the details and the thread link", () => {
    expect(
      eventDescription("Steep", "https://x", {
        point: SI,
        name: "Mount Si, King County, Washington",
      }),
    ).toBe(
      [
        "Steep",
        "",
        "📍 Mount Si, King County, Washington",
        `OpenStreetMap: ${OSM}`,
        `Google Maps: ${GOOGLE}`,
        "© OpenStreetMap contributors",
        "",
        "Hike thread: https://x",
      ].join("\n"),
    );
    expect(eventDescription(null, null, { point: SI, name: null })).toBe(
      [
        `OpenStreetMap: ${OSM}`,
        `Google Maps: ${GOOGLE}`,
        "© OpenStreetMap contributors",
      ].join("\n"),
    );
  });

  it("stays within 1000 characters with 1000 characters of details, keeping both map links and the thread link whole", () => {
    const link = `https://discord.com/channels/${GUILD}/${THREAD}`;
    const description = eventDescription("D".repeat(1000), link, {
      point: SI,
      name: "N".repeat(80),
    });
    expect(description.length).toBeLessThanOrEqual(MAX_EVENT_DESCRIPTION);
    expect(description).toContain(`OpenStreetMap: ${OSM}`);
    expect(description).toContain(`Google Maps: ${GOOGLE}`);
    expect(description).toContain("© OpenStreetMap contributors");
    expect(description).toContain(`📍 ${"N".repeat(80)}`);
    expect(description.endsWith(`\n\nHike thread: ${link}`)).toBe(true);
    expect(description.startsWith("DDD")).toBe(true);
    expect(description).toContain("…");
  });
});

describe("hikeEventDescription", () => {
  const SI = { lat: 47.4875, lon: -121.7234 };

  function located(place: OptionView["place"]): RoundView {
    const round = hike("Mount Si", "2030-06-15 09:00", "Steep", THREAD);
    const location = round.locationPoll;
    if (location === null) throw new Error("no location poll");
    return {
      ...round,
      locationPoll: {
        ...location,
        options: location.options.map((o) => ({ ...o, place })),
      },
    };
  }

  it("shows the decided location's place when it has a point", () => {
    const description = hikeEventDescription(
      located({ status: "found", point: SI, name: "Mount Si", attempts: 1 }),
      GUILD,
    );
    expect(description).toContain("📍 Mount Si");
    expect(description).toContain(
      "OpenStreetMap: https://www.openstreetmap.org/?mlat=47.4875&mlon=-121.7234",
    );
    expect(description).toContain(
      "Google Maps: https://www.google.com/maps/search/?api=1&query=47.4875,-121.7234",
    );
    expect(description).toContain("© OpenStreetMap contributors");
    expect(description).toContain(
      `Hike thread: https://discord.com/channels/${GUILD}/${THREAD}`,
    );
  });

  it.each([
    ["no place", null],
    [
      "a place not found",
      { status: "not_found", point: null, name: null, attempts: 1 },
    ],
  ] as const)("shows no map links for %s", (_name, place) => {
    expect(hikeEventDescription(located(place), GUILD)).toBe(
      `Steep\n\nHike thread: https://discord.com/channels/${GUILD}/${THREAD}`,
    );
  });
});

// The event's state.

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

describe("hikeEventStatus and claimHikeEvent", () => {
  const round = (eventId: string | null = null): RoundView => ({
    ...hike("Ridge", "2030-06-15 09:00"),
    eventId,
  });

  it("lets one claim through, refuses a second while it is fresh, and takes back a lost one as unconfirmed", async () => {
    await runInDurableObject(stub("hike-event-claim"), (_i, state) => {
      const { storage } = state;
      expect(hikeEventStatus(storage, round(), NOW, LA).state).toBe("missing");
      expect(claimHikeEvent(storage, round(), NOW, LA)).toBe(true);
      expect(hikeEventStatus(storage, round(), NOW, LA).state).toBe("creating");
      expect(claimHikeEvent(storage, round(), NOW + 1, LA)).toBe(false);
      expect(
        claimHikeEvent(storage, round(), NOW + EVENT_CLAIM_MS - 1, LA),
      ).toBe(false);
      expect(
        hikeEventStatus(storage, round(), NOW + EVENT_CLAIM_MS, LA).state,
      ).toBe("unconfirmed");
      expect(claimHikeEvent(storage, round(), NOW + EVENT_CLAIM_MS, LA)).toBe(
        true,
      );
    });
  });

  it("keeps a failure's reason until the next claim, and an event wins over any attempt", async () => {
    await runInDurableObject(stub("hike-event-failure"), (_i, state) => {
      const { storage } = state;
      expect(claimHikeEvent(storage, round(), NOW, LA)).toBe(true);
      recordHikeEventFailure(storage, 1, "Missing Permissions");
      expect(hikeEventStatus(storage, round(), NOW + 1, LA)).toEqual({
        state: "failed",
        reason: "Missing Permissions",
      });
      expect(hikeEventStatus(storage, round(EVENT), NOW + 1, LA)).toEqual({
        state: "created",
        eventId: EVENT,
      });
      expect(claimHikeEvent(storage, round(EVENT), NOW + 1, LA)).toBe(false);
      expect(claimHikeEvent(storage, round(), NOW + 2, LA)).toBe(true);
    });
  });

  it("refuses any claim once the start has passed, whatever was tried", async () => {
    await runInDurableObject(stub("hike-event-past"), (_i, state) => {
      const { storage } = state;
      const start = Date.UTC(2030, 5, 15, 16);
      recordHikeEventFailure(storage, 1, "Missing Permissions");
      expect(hikeEventStatus(storage, round(), start - 1, LA).state).toBe(
        "failed",
      );
      expect(hikeEventStatus(storage, round(), start, LA)).toEqual({
        state: "past",
      });
      expect(claimHikeEvent(storage, round(), start, LA)).toBe(false);
    });
  });
});

// Through the guild object.

/**
 * A guild whose date vote is open, with both poll messages posted, that
 * `dates[1]` wins; Lake Loop has details.
 */
async function dateVoting(
  guildId: string,
  dates: [string, string] = ["2030-06-15 09:00", "2030-06-08"],
): Promise<PollView> {
  return runInDurableObject(stub(guildId), (_i, state) => {
    const config = new GuildConfig(state.storage);
    config.set("voteChannelId", TEXT);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
    const store = new PollStore(state.storage);
    const started = store.startRound(OWNER, [
      {
        label: "Lake Loop",
        details: "Meet at the north lot.",
        proposedBy: PROPOSER,
      },
    ]);
    const location = started.locationPoll?.id ?? 0;
    store.setPollMessage(location, TEXT, LOCATION_MESSAGE);
    store.setVotes(location, "u1", [started.locationPoll?.options[0]?.id ?? 0]);
    store.closePoll(location, OWNER);
    const date = store.startDatePoll(started.id, OWNER, dates);
    store.setPollMessage(date.id, TEXT, DATE_MESSAGE);
    const winner = date.options.find(
      (o) => o.dateValue?.startsWith(dates[0].slice(0, 10)) ?? false,
    );
    store.setVotes(date.id, "u1", [winner?.id ?? 0]);
    return store.getPoll(date.id) as PollView;
  });
}

function click(
  customId: string,
  guildId = GUILD,
  userId = OWNER,
): APIMessageComponentInteraction {
  const interaction = componentInteraction(customId, guildId);
  Object.assign(interaction, {
    member: { user: { id: userId }, roles: [] },
    message: { id: "800000000000000009", components: [] },
  });
  return interaction;
}

interface Sent {
  route: string;
  body: {
    name?: string;
    description?: string;
    channel_id?: unknown;
    entity_type?: number;
    privacy_level?: number;
    scheduled_start_time?: string;
    scheduled_end_time?: string;
    entity_metadata?: { location?: string };
    flags?: number;
    message?: { components: APIMessageTopLevelComponent[] };
    components?: APIMessageTopLevelComponent[];
    allowed_mentions?: unknown;
  };
}

const ok =
  (body: object, status = 200) =>
  () =>
    Promise.resolve(Response.json(body, { status }));
const created = ok({ id: EVENT, guild_id: GUILD });
const refused = (code: number, message: string, status = 403) =>
  ok({ message, code }, status);
const forbidden = refused(50013, "Missing Permissions");

/**
 * Stubs Discord: the guild owner and webhooks answer; a thread is
 * `THREAD`; the event answers `event()`, the edit of the thread's first
 * message `threadEdit()`; any other message gets id 1.
 */
function discord(
  guildId: string,
  event: () => Promise<Response>,
  threadEdit: () => Promise<Response> = ok({ id: THREAD }),
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.endsWith(`/guilds/${guildId}`)) {
      return Promise.resolve(Response.json({ id: guildId, owner_id: OWNER }));
    }
    if (path.endsWith("/threads")) {
      return Promise.resolve(
        Response.json({ id: THREAD, parent_id: FORUM }, { status: 201 }),
      );
    }
    if (path.endsWith("/scheduled-events")) return event();
    if (path.endsWith(`/channels/${THREAD}/messages/${THREAD}`)) {
      return threadEdit();
    }
    return Promise.resolve(Response.json({ id: "1" }));
  });
}

function sent(spy: { mock: { calls: Parameters<typeof fetch>[] } }): Sent[] {
  return spy.mock.calls
    .map(([input, init]) => {
      const request = new Request(input, init);
      return {
        route: `${request.method} ${new URL(request.url).pathname.replace("/api/v10", "")}`,
        body: JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as Sent["body"],
      };
    })
    .filter((r) => !r.route.startsWith("GET "));
}

function eventRequests(spy: { mock: { calls: Parameters<typeof fetch>[] } }) {
  return sent(spy).filter((r) => r.route.endsWith("/scheduled-events"));
}

async function closeDateVote(guildId: string, view: PollView) {
  await runInDurableObject(stub(guildId), async (_i, state) => {
    await (
      await closePoll(
        click(POLL_IDS.closeConfirm(view.id), guildId),
        { env, storage: state.storage },
        { date: DATE_POLL },
        new PollStore(state.storage, { random: sequence(0) }),
      )
    ).followUp?.();
  });
}

async function send(interaction: unknown, ctx = createExecutionContext()) {
  const response = await callWorker(
    signer,
    await signedRequest(signer, interaction),
    ctx,
  );
  expect(response.status).toBe(200);
  return response.json<{
    type: InteractionResponseType;
    data?: { components: APIMessageTopLevelComponent[] };
  }>();
}

function lastRound(guildId: string) {
  return runInDurableObject(stub(guildId), (_i, state) =>
    new PollStore(state.storage).getLastRound(),
  );
}

const eventLink = (guildId: string) =>
  `https://discord.com/events/${guildId}/${EVENT}`;

describe("closing the date vote", () => {
  it("creates the event after the thread, links it from the thread and the announcement, and stores it", async () => {
    const guild = "200000000000000401";
    const view = await dateVoting(guild);
    const spy = discord(guild, created);
    await closeDateVote(guild, view);
    const requests = sent(spy);
    expect(requests.map((r) => r.route)).toEqual([
      `PATCH /channels/${TEXT}/messages/${DATE_MESSAGE}`,
      `POST /channels/${FORUM}/threads`,
      `POST /guilds/${guild}/scheduled-events`,
      `PATCH /channels/${THREAD}/messages/${THREAD}`,
      `POST /channels/${NEWS}/messages`,
      "PATCH /webhooks/100/interaction-token/messages/@original",
    ]);
    const [, thread, event, edit, announcement, panel] = requests;
    expect(event?.body).toEqual({
      name: "Lake Loop",
      privacy_level: 2,
      scheduled_start_time: "2030-06-15T16:00:00.000Z",
      scheduled_end_time: "2030-06-15T20:00:00.000Z",
      entity_type: 3,
      entity_metadata: { location: "Lake Loop" },
      description: `Meet at the north lot.\n\nHike thread: https://discord.com/channels/${guild}/${THREAD}`,
    });
    expect(text(thread?.body.message?.components ?? [])).not.toContain(
      "Hike event",
    );
    const edited = text(edit?.body.components ?? []);
    expect(edited).toContain(`**Hike event:** ${eventLink(guild)}`);
    expect(edited).toContain("## Lake Loop");
    expect(edit?.body.allowed_mentions).toEqual({ parse: [] });
    expect(text(announcement?.body.components ?? []).split("\n")).toEqual(
      expect.arrayContaining([
        `**Hike thread:** <#${THREAD}>`,
        `**Hike event:** ${eventLink(guild)}`,
      ]) as unknown,
    );
    expect(text(panel?.body.components ?? [])).toContain(
      "**Hike event:** created.",
    );
    expect(ids(panel?.body.components ?? [])).not.toContain(
      HIKE_EVENT_IDS.create(1),
    );
    expect((await lastRound(guild))?.eventId).toBe(EVENT);
  });

  it("logs a failed edit of the thread's message and carries on", async () => {
    const guild = "200000000000000402";
    const view = await dateVoting(guild);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {
      // Asserted below.
    });
    const spy = discord(guild, created, forbidden);
    await closeDateVote(guild, view);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining(
        "linking the event in the thread of round 1 failed: Discord answered: Missing Permissions",
      ),
    );
    const requests = sent(spy);
    const announcement = requests.find(
      (r) => r.route === `POST /channels/${NEWS}/messages`,
    );
    expect(text(announcement?.body.components ?? [])).toContain(
      `**Hike event:** ${eventLink(guild)}`,
    );
    const panel = text(requests.at(-1)?.body.components ?? []);
    expect(panel).toContain("**Hike event:** created.");
    expect(panel).not.toContain("Could not");
    const last = await lastRound(guild);
    expect(last?.status).toBe("complete");
    expect(last?.eventId).toBe(EVENT);
  });

  it.each([
    [
      "a missing permission",
      "200000000000000411",
      forbidden,
      "Could not create the hike event: Discord answered: Missing Permissions (HTTP 403, code 50013). Give the bot the Create Events permission in the server's settings, then click Create hike event.",
    ],
    [
      "the limit of 100 events",
      "200000000000000412",
      refused(
        30038,
        "Maximum number of uncompleted guild scheduled events reached (100)",
        400,
      ),
      "Could not create the hike event: Discord answered: Maximum number of uncompleted guild scheduled events reached (100) (HTTP 400, code 30038). The server already has 100 scheduled events, the most Discord allows. End or delete one, then click Create hike event.",
    ],
    [
      "anything else",
      "200000000000000413",
      refused(50035, "Invalid Form Body", 400),
      "Could not create the hike event: Discord answered: Invalid Form Body (HTTP 400, code 50035). Click Create hike event to try again.",
    ],
  ])(
    "completes the round and announces once without the event when Discord refuses for %s, and the panel offers the retry with the reason",
    async (_name, guild, refusal, reason) => {
      const view = await dateVoting(guild);
      const spy = discord(guild, refusal);
      await closeDateVote(guild, view);
      const requests = sent(spy);
      expect(requests.map((r) => r.route)).toEqual([
        `PATCH /channels/${TEXT}/messages/${DATE_MESSAGE}`,
        `POST /channels/${FORUM}/threads`,
        `POST /guilds/${guild}/scheduled-events`,
        `POST /channels/${NEWS}/messages`,
        "PATCH /webhooks/100/interaction-token/messages/@original",
      ]);
      const [, , , announcement, panel] = requests;
      expect(text(announcement?.body.components ?? [])).not.toContain(
        "Hike event",
      );
      expect(text(panel?.body.components ?? [])).toContain(
        `**Hike event:** not created. ${reason}`,
      );
      expect(ids(panel?.body.components ?? [])).toContain(
        HIKE_EVENT_IDS.create(1),
      );
      const last = await lastRound(guild);
      expect(last?.status).toBe("complete");
      expect(last?.eventId).toBeNull();
    },
  );

  it("asks Discord for no event when the start has passed, and the panel says so without a retry", async () => {
    const guild = "200000000000000403";
    const view = await dateVoting(guild, ["2020-06-15 09:00", "2020-06-08"]);
    const spy = discord(guild, created);
    await closeDateVote(guild, view);
    expect(eventRequests(spy)).toEqual([]);
    const requests = sent(spy);
    expect(requests.map((r) => r.route)).toContain(
      `POST /channels/${NEWS}/messages`,
    );
    const panel = requests.at(-1)?.body.components ?? [];
    expect(text(panel)).toContain(`**Hike event:** ${START_PASSED_MESSAGE}`);
    expect(ids(panel)).not.toContain(HIKE_EVENT_IDS.create(1));
    const last = await lastRound(guild);
    expect(last?.status).toBe("complete");
    expect(last?.eventId).toBeNull();
  });

  it("creates no event from the step when one exists", async () => {
    const guild = "200000000000000404";
    const view = await dateVoting(guild);
    const spy = discord(guild, created);
    await closeDateVote(guild, view);
    await runInDurableObject(stub(guild), async (_i, state) => {
      const result = await createHikeEventStep.run(
        {
          poll: view,
          round: new PollStore(state.storage).getLastRound(),
          guildId: guild,
          timeZone: LA,
        },
        { env, storage: state.storage },
      );
      expect(result).toEqual({});
    });
    expect(eventRequests(spy)).toHaveLength(1);
  });
});

describe("Create hike event", () => {
  async function failedClose(guild: string) {
    const view = await dateVoting(guild);
    discord(guild, forbidden);
    await closeDateVote(guild, view);
    vi.restoreAllMocks();
  }

  it("retries after a failure: stores the event, links it from the thread, posts no announcement, and the button is gone", async () => {
    const guild = "200000000000000501";
    await failedClose(guild);

    const spy = discord(guild, created);
    const ctx = createExecutionContext();
    const reply = await send(click(HIKE_EVENT_IDS.create(1), guild), ctx);
    expect(reply.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    await waitOnExecutionContext(ctx);
    const requests = sent(spy);
    expect(requests.map((r) => r.route)).toEqual([
      `POST /guilds/${guild}/scheduled-events`,
      `PATCH /channels/${THREAD}/messages/${THREAD}`,
      "PATCH /webhooks/100/interaction-token/messages/@original",
    ]);
    expect(text(requests[1]?.body.components ?? [])).toContain(
      `**Hike event:** ${eventLink(guild)}`,
    );
    const panel = requests[2]?.body.components ?? [];
    expect(text(panel)).toContain(
      `The hike event is created: ${eventLink(guild)}`,
    );
    expect(text(panel)).toContain("**Hike event:** created.");
    expect(ids(panel)).not.toContain(HIKE_EVENT_IDS.create(1));
    expect((await lastRound(guild))?.eventId).toBe(EVENT);

    // A click on an old panel creates nothing.
    const again = await send(click(HIKE_EVENT_IDS.create(1), guild));
    expect(again.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(again.data?.components ?? [])).toContain(
      `The hike event already exists: ${eventLink(guild)}`,
    );
    expect(eventRequests(spy)).toHaveLength(1);
  });

  it("creates one event when the button is clicked twice quickly", async () => {
    const guild = "200000000000000502";
    await failedClose(guild);

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = discord(guild, () => held.then(created));
    const first = createExecutionContext();
    const one = await send(click(HIKE_EVENT_IDS.create(1), guild), first);
    const two = await send(click(HIKE_EVENT_IDS.create(1), guild));
    expect(one.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    expect(two.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(two.data?.components ?? [])).toContain(
      "The hike event is being created.",
    );
    expect(text(two.data?.components ?? [])).toContain(
      "**Hike event:** being created.",
    );
    expect(ids(two.data?.components ?? [])).not.toContain(
      HIKE_EVENT_IDS.create(1),
    );
    release();
    await waitOnExecutionContext(first);
    expect(eventRequests(spy)).toHaveLength(1);
    expect((await lastRound(guild))?.eventId).toBe(EVENT);
  });

  it("is refused once the start has passed, and the panel offers it no more", async () => {
    const guild = "200000000000000503";
    await failedClose(guild);
    await runInDurableObject(stub(guild), (_i, state) => {
      // The hike's date has gone by since Discord refused.
      state.storage.sql.exec(
        "UPDATE poll_options SET date_value = '2020-06-15 09:00' WHERE date_value = '2030-06-15 09:00'",
      );
    });
    const spy = discord(guild, created);
    const reply = await send(click(HIKE_EVENT_IDS.create(1), guild));
    expect(reply.type).toBe(InteractionResponseType.UpdateMessage);
    const panel = reply.data?.components ?? [];
    expect(text(panel)).toContain(START_PASSED_MESSAGE);
    expect(text(panel)).toContain(`**Hike event:** ${START_PASSED_MESSAGE}`);
    expect(ids(panel)).not.toContain(HIKE_EVENT_IDS.create(1));
    expect(eventRequests(spy)).toEqual([]);
  });

  it("no longer applies once a new round has started", async () => {
    const guild = "200000000000000504";
    await failedClose(guild);
    await runInDurableObject(stub(guild), (_i, state) => {
      new PollStore(state.storage).startRound(OWNER, []);
    });
    const spy = discord(guild, created);
    const reply = await send(click(HIKE_EVENT_IDS.create(1), guild));
    expect(text(reply.data?.components ?? [])).toContain(
      "That hike is no longer the last one, so its event is not created from here.",
    );
    expect(sent(spy)).toEqual([]);
  });

  it("refuses a member who is not an admin", async () => {
    const guild = "200000000000000505";
    await failedClose(guild);
    const spy = discord(guild, created);
    const reply = await send(click(HIKE_EVENT_IDS.create(1), guild, STRANGER));
    expect(reply.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(sent(spy)).toEqual([]);
    expect((await lastRound(guild))?.eventId).toBeNull();
  });

  it("is offered beside Create hike thread when both failed", async () => {
    const guild = "200000000000000506";
    const view = await dateVoting(guild);
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith(`/guilds/${guild}`)) {
          return Promise.resolve(Response.json({ id: guild, owner_id: OWNER }));
        }
        if (request.url.includes("/webhooks/")) {
          return Promise.resolve(Response.json({ id: "1" }));
        }
        return forbidden();
      });
    await closeDateVote(guild, view);
    const panel = sent(spy).at(-1)?.body.components ?? [];
    expect(ids(panel)).toEqual(
      expect.arrayContaining([
        HIKE_THREAD_IDS.create(1),
        HIKE_EVENT_IDS.create(1),
      ]) as unknown,
    );
  });
});
