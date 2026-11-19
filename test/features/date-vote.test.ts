import {
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  ComponentType,
  InteractionResponseType,
  MessageFlags,
  TextInputStyle,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
  type APIModalSubmitInteraction,
} from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DATE_IDS,
  DATE_POLL,
  parseCandidateDates,
  startModal,
} from "../../src/features/date-vote";
import {
  MAX_MESSAGE_COMPONENTS,
  MAX_MESSAGE_TEXT,
  POLL_IDS,
  VOTE_CLOSED_MESSAGE,
  closePoll,
  renderAnnouncement,
  renderPollMessage,
  renderVoteSelect,
  type PollWording,
} from "../../src/features/poll-ui";
import { CADENCE_JOB } from "../../src/features/cadence-state";
import { GuildConfig } from "../../src/guild/config";
import { scheduledJobs } from "../../src/guild/schedule";
import { defaultDateCandidates, todayIn } from "../../src/polls/dates";
import { PollStore, type PollView } from "../../src/polls/store";
import {
  callWorker,
  componentInteraction,
  createSigner,
  modalInteraction,
  signedRequest,
  type Signer,
} from "../helpers";
import { sequence } from "../polls/helpers";

const OWNER = "400000000000000001";
const MEMBER = "400000000000000002";
const TEXT = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";
const POLL_MESSAGE = "700000000000000001";
const GUILD = "200000000000000001";

/** 2026-11-18 12:00 UTC, 04:00 on Wednesday 18 November in Los Angeles. */
const NOW = Date.UTC(2026, 10, 18, 12);
const LA = "America/Los_Angeles";

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
  label?: string;
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

function nodes(components: readonly unknown[]): Node[] {
  return components as Node[];
}

function text(components: readonly unknown[] = []): string {
  return flatten(nodes(components))
    .map((c) => c.content ?? "")
    .filter((c) => c !== "")
    .join("\n");
}

function ids(components: readonly unknown[] = []): string[] {
  return flatten(nodes(components)).flatMap((c) =>
    c.custom_id === undefined ? [] : [c.custom_id],
  );
}

describe("parseCandidateDates", () => {
  const refused = (input: string) => {
    const result = parseCandidateDates(input, NOW, LA);
    if (result.ok) throw new Error(`accepted ${input}`);
    return result.error;
  };

  it.each([
    [
      "both formats, blank lines and spaces",
      " 2026-12-05 \n\n2026-12-05 09:00\r\n2026-12-12  18:30\n",
      ["2026-12-05 11:00", "2026-12-05 09:00", "2026-12-12 18:30"],
    ],
    [
      "repeated dates collapsed",
      "2026-12-05\n2026-12-06\n 2026-12-05\n2026-12-06 11:00",
      ["2026-12-05 11:00", "2026-12-06 11:00"],
    ],
    [
      "today in the guild's zone, at any time",
      "2026-11-18\n2026-11-18 00:00",
      ["2026-11-18 11:00", "2026-11-18 00:00"],
    ],
    [
      "25 dates",
      Array.from(
        { length: 25 },
        (_, i) => `2027-01-${String(i + 1).padStart(2, "0")}`,
      ).join("\n"),
      Array.from(
        { length: 25 },
        (_, i) => `2027-01-${String(i + 1).padStart(2, "0")} 11:00`,
      ),
    ],
  ])("accepts %s", (_name, input, dates) => {
    expect(parseCandidateDates(input, NOW, LA)).toEqual({ ok: true, dates });
  });

  it("lists every line that is not a date, with the accepted formats", () => {
    const error = refused(
      "2026-12-05\n2026/12/06\n\n2026-12-07T09:00\n2026-02-30\n2026-12-08 25:00\nsoon",
    );
    expect(error.split("\n")).toEqual([
      "**The date vote was not started.**",
      "Line 2: `2026/12/06` is not a date.",
      "Line 4: `2026-12-07T09:00` is not a date.",
      "Line 5: `2026-02-30` is not a date.",
      "Line 6: `2026-12-08 25:00` is not a date.",
      "Line 7: `soon` is not a date.",
      "Write one date per line as `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` (24-hour), for example `2026-12-05` or `2026-12-05 09:00`; a date without a time starts at 11:00.",
    ]);
  });

  it("refuses dates before today in the guild's zone, naming each line", () => {
    const error = refused("2026-11-17 23:59\n2026-12-05\n2025-12-05");
    expect(error).toContain(
      "Line 1: `2026-11-17 23:59` (Tue, 17 Nov 2026 · 23:59) is in the past: today is 2026-11-18 in America/Los_Angeles.",
    );
    expect(error).toContain(
      "Line 3: `2025-12-05` (Fri, 5 Dec 2025 · 11:00) is in the past: today is 2026-11-18 in America/Los_Angeles.",
    );
    expect(error).not.toContain("Line 2");
    expect(error).toContain("a date without a time starts at 11:00");
  });

  it("moves today on at midnight in the guild's zone, not in UTC", () => {
    const dates = "2026-11-18\n2026-12-05";
    // 23:59:59 on 18 November in Los Angeles, already the 19th in UTC.
    const beforeMidnight = Date.UTC(2026, 10, 19, 7, 59, 59);
    const afterMidnight = beforeMidnight + 1000;
    expect(parseCandidateDates(dates, beforeMidnight, LA).ok).toBe(true);
    expect(parseCandidateDates(dates, afterMidnight, LA).ok).toBe(false);
    // In Kolkata the 18th ended at 18:30 UTC on the 18th.
    const kolkata = "Asia/Kolkata";
    expect(
      parseCandidateDates(dates, Date.UTC(2026, 10, 18, 18, 29, 59), kolkata)
        .ok,
    ).toBe(true);
    expect(
      parseCandidateDates(dates, Date.UTC(2026, 10, 18, 18, 30), kolkata).ok,
    ).toBe(false);
  });

  it.each([
    ["no date", "  \n ", "You listed no dates;"],
    ["one date", "2026-12-05", "You listed 1 date;"],
    ["one date twice", "2026-12-05\n2026-12-05", "You listed 1 date;"],
  ])("refuses %s: a vote needs 2 to 25", (_name, input, start) => {
    const error = refused(input);
    expect(error).toContain(
      `${start} a date vote needs 2 to 25 different dates.`,
    );
    expect(error).toContain("`YYYY-MM-DD` or `YYYY-MM-DD HH:MM`");
  });

  it("refuses more than 25 different dates", () => {
    const lines = Array.from(
      { length: 26 },
      (_, i) => `2027-02-${String(i + 1).padStart(2, "0")}`,
    );
    expect(refused(lines.join("\n"))).toContain(
      "You listed 26 different dates; a date vote holds at most 25. Remove some.",
    );
  });

  it("quotes long lines shortened and without backticks, and counts lines past 25", () => {
    const error = refused(
      [`\`${"x".repeat(60)}`, ...Array.from({ length: 30 }, () => "nope")].join(
        "\n",
      ),
    );
    expect(error).toContain(`Line 1: \`'${"x".repeat(38)}…\` is not a date.`);
    expect(error).toContain("Line 25: `nope` is not a date.");
    expect(error).not.toContain("Line 26");
    expect(error).toContain("…and 6 more lines like these.");
  });
});

// Rendering.

function dateOption(id: number, value: string, label: string, votes: number) {
  return {
    id,
    pollId: 2,
    label,
    details: null,
    dateValue: value,
    proposedBy: OWNER,
    createdAt: 0,
    place: null,
    votes,
  };
}

function datePoll(overrides: Partial<PollView> = {}): PollView {
  return {
    id: 2,
    roundId: 1,
    kind: "date",
    status: "open",
    channelId: TEXT,
    messageId: POLL_MESSAGE,
    winnerOptionId: null,
    tieBroken: false,
    tiedOptionIds: [],
    openedBy: OWNER,
    openedAt: 0,
    closedBy: null,
    closedAt: null,
    options: [
      dateOption(11, "2026-12-12", "Sat, 12 Dec 2026", 1),
      dateOption(12, "2026-12-05 09:00", "Sat, 5 Dec 2026 · 09:00", 3),
      dateOption(13, "2026-12-05", "Sat, 5 Dec 2026", 0),
    ],
    voterCount: 3,
    viewerVotes: [],
    ...overrides,
  };
}

/** A round whose location is decided as Ridge Trail, with its date poll. */
function round(poll: PollView | null) {
  const location: PollView = {
    ...datePoll(),
    id: 1,
    kind: "location",
    status: "closed",
    winnerOptionId: 1,
    options: [
      {
        ...dateOption(1, "", "Ridge Trail", 4),
        dateValue: null,
        details: "https://example.com/ridge",
      },
    ],
  };
  return {
    id: 1,
    status: "date_voting" as const,
    locationOptionId: 1,
    dateOptionId: null,
    threadId: null,
    eventId: null,
    mapPictureKey: null,
    dayOf: null,
    startedBy: OWNER,
    startedAt: 0,
    endedBy: null,
    endedAt: null,
    locationPoll: location,
    datePoll: poll,
  };
}

describe("the date poll message", () => {
  it("names the decided location and lists the dates in date order with their votes, with Vote and Propose a date", () => {
    const poll = datePoll();
    const view = renderPollMessage(poll, DATE_POLL, round(poll));
    const shown = text(view);
    expect(shown).toContain("## When should we hike Ridge Trail?");
    const order = [
      "**Sat, 5 Dec 2026** · 0 votes",
      "**Sat, 5 Dec 2026 · 09:00** · 3 votes",
      "**Sat, 12 Dec 2026** · 1 vote",
    ].map((line) => shown.indexOf(line));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(shown).toContain("3 members have voted.");
    expect(shown).not.toContain("Proposed by");
    expect(ids(view)).toEqual([POLL_IDS.vote(2), "hb:date:propose:2"]);
  });

  it("stays within Discord's limits with 25 dates, open and closed", () => {
    const options = Array.from({ length: 25 }, (_, i) =>
      dateOption(
        i + 1,
        `2027-01-${String(i + 1).padStart(2, "0")} 09:00`,
        `Wed, ${String(i + 1)} Jan 2027 · 09:00`,
        25 - i,
      ),
    );
    const open = datePoll({ options, voterCount: 25 });
    const closed = datePoll({
      options,
      status: "closed",
      winnerOptionId: 1,
    });
    for (const poll of [open, closed]) {
      const view = renderPollMessage(poll, DATE_POLL, round(poll));
      expect(flatten(nodes(view)).length).toBeLessThanOrEqual(
        MAX_MESSAGE_COMPONENTS,
      );
      expect(text(view).length).toBeLessThanOrEqual(MAX_MESSAGE_TEXT);
      expect(text(view).indexOf("1 Jan 2027")).toBeLessThan(
        text(view).indexOf("25 Jan 2027"),
      );
    }
    const select = renderVoteSelect(open, DATE_POLL, undefined, round(open));
    expect(text(select)).toContain("**When should we hike Ridge Trail?**");
  });

  it("marks the winner and a tie once closed, without buttons", () => {
    const poll = datePoll({
      status: "closed",
      options: [
        dateOption(11, "2026-12-12", "Sat, 12 Dec 2026", 2),
        dateOption(12, "2026-12-05", "Sat, 5 Dec 2026", 2),
      ],
      winnerOptionId: 11,
      tieBroken: true,
      tiedOptionIds: [11, 12],
    });
    const view = renderPollMessage(poll, DATE_POLL, round(poll));
    const shown = text(view);
    expect(shown).toContain("## When should we hike Ridge Trail? (closed)");
    expect(shown).toContain("🏆 **Sat, 12 Dec 2026** won with 2 votes.");
    expect(shown).toContain(
      "2 options tied with 2 votes each; the winner was drawn at random.",
    );
    expect(shown.indexOf("**Sat, 5 Dec 2026** · 2 votes")).toBeLessThan(
      shown.indexOf("🏆 **Sat, 12 Dec 2026** · 2 votes"),
    );
    expect(ids(view)).toEqual([]);
  });
});

describe("the date announcement", () => {
  it("names the hike's location and date, the votes, the tie and links the vote, then the close steps' lines", () => {
    const poll = datePoll({
      status: "closed",
      winnerOptionId: 12,
      tieBroken: true,
      tiedOptionIds: [12, 13],
    });
    const view = renderAnnouncement(
      { poll, round: round(poll), guildId: GUILD, timeZone: LA },
      DATE_POLL,
      ["[Hike thread](https://discord.com/channels/1/2)"],
    );
    expect(text(view).split("\n")).toEqual([
      "## Hike planned",
      "**Where:** Ridge Trail",
      "https://example.com/ridge",
      // 09:00 in Los Angeles on 5 December 2026 is 17:00 UTC.
      "**When:** Sat, 5 Dec 2026 · 09:00 (<t:1796490000:R>)",
      "**Sat, 5 Dec 2026 · 09:00** won the date vote with 3 votes.",
      "2 options tied with 3 votes each; the winner was drawn at random.",
      `[See the vote](https://discord.com/channels/${GUILD}/${TEXT}/${POLL_MESSAGE})`,
      "[Hike thread](https://discord.com/channels/1/2)",
    ]);
  });

  it("shows the decided location's place after its details when it has a point, with the attribution last", () => {
    const poll = datePoll({ status: "closed", winnerOptionId: 12 });
    const located = round(poll);
    const location = located.locationPoll;
    const [ridge] = location.options;
    if (ridge === undefined) throw new Error("no location option");
    const view = renderAnnouncement(
      {
        poll,
        round: {
          ...located,
          locationPoll: {
            ...location,
            options: [
              {
                ...ridge,
                place: {
                  status: "found",
                  point: { lat: 47.4875, lon: -121.7234 },
                  name: "Ridge Trail, King County",
                  attempts: 1,
                },
              },
            ],
          },
        },
        guildId: GUILD,
        timeZone: LA,
      },
      DATE_POLL,
      [],
    );
    const lines = text(view).split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "## Hike planned",
      "**Where:** Ridge Trail",
      "https://example.com/ridge",
      "📍 Ridge Trail, King County · [OpenStreetMap](https://www.openstreetmap.org/?mlat=47.4875&mlon=-121.7234#map=13/47.4875/-121.7234) · [Google Maps](https://www.google.com/maps/search/?api=1&query=47.4875,-121.7234)",
      "**When:** Sat, 5 Dec 2026 · 09:00 (<t:1796490000:R>)",
    ]);
    expect(lines.at(-1)).toBe("-# © OpenStreetMap contributors");
  });

  it("shows no place line while the decided location has no point", () => {
    const poll = datePoll({ status: "closed", winnerOptionId: 12 });
    const shown = text(
      renderAnnouncement(
        { poll, round: round(poll), guildId: GUILD, timeZone: LA },
        DATE_POLL,
        [],
      ),
    );
    expect(shown).not.toContain("📍");
    expect(shown).not.toContain("OpenStreetMap");
  });
});

describe("the When line", () => {
  it.each([
    [12, LA, "**When:** Sat, 5 Dec 2026 · 09:00 (<t:1796490000:R>)"],
    [
      12,
      "Europe/Berlin",
      "**When:** Sat, 5 Dec 2026 · 09:00 (<t:1796457600:R>)",
    ],
    // A date stored without a time, from before every date had one, is read as 11:00.
    [13, LA, "**When:** Sat, 5 Dec 2026 (<t:1796497200:R>)"],
  ])("of option %i in %s is %s", (winnerOptionId, timeZone, line) => {
    const poll = datePoll({ status: "closed", winnerOptionId });
    const view = renderAnnouncement(
      { poll, round: round(poll), guildId: GUILD, timeZone },
      DATE_POLL,
    );
    expect(text(view).split("\n")[3]).toBe(line);
  });
});

// Through the guild object.

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

function configure(guildId: string) {
  return runInDurableObject(stub(guildId), (_i, state) => {
    const config = new GuildConfig(state.storage);
    config.set("voteChannelId", TEXT);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
  });
}

/** A guild whose location vote is closed with Ridge Trail as the winner. */
async function decided(guildId: string): Promise<number> {
  await configure(guildId);
  return runInDurableObject(stub(guildId), (_i, state) => {
    const store = new PollStore(state.storage);
    const round = store.startRound(OWNER, [
      { label: "Ridge Trail", proposedBy: OWNER },
    ]);
    store.closePoll(round.locationPoll?.id ?? 0, OWNER);
    return round.id;
  });
}

/** Stubs Discord: the guild owner, webhooks, then `channel` for messages. */
function discord(guildId: string, channel: () => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith(`/guilds/${guildId}`)) {
      return Promise.resolve(Response.json({ id: guildId, owner_id: OWNER }));
    }
    if (request.url.includes("/webhooks/")) {
      return Promise.resolve(Response.json({ id: "1" }));
    }
    return Promise.resolve(channel());
  });
}

interface Sent {
  method: string;
  url: string;
  body: string;
}

function requests(spy: { mock: { calls: Parameters<typeof fetch>[] } }) {
  return spy.mock.calls.map(([input, init]): Sent => {
    const request = new Request(input, init);
    return {
      method: request.method,
      url: request.url,
      body: typeof init?.body === "string" ? init.body : "",
    };
  });
}

function bodyOf(sent: Sent | undefined) {
  return JSON.parse(sent?.body ?? "{}") as {
    // A forum thread's body has its message's components under `message`.
    components?: APIMessageTopLevelComponent[];
    allowed_mentions?: unknown;
    flags?: number;
    message?: {
      allowed_mentions?: unknown;
      components?: APIMessageTopLevelComponent[];
    };
  };
}

function startSubmit(
  guildId: string,
  dates: string,
  userId = OWNER,
): APIModalSubmitInteraction {
  const interaction = modalInteraction(DATE_IDS.start, guildId);
  Object.assign(interaction, {
    member: { user: { id: userId }, roles: [] },
    message: { id: "800000000000000001", components: [] },
  });
  Object.assign(interaction.data, {
    components: [
      {
        type: ComponentType.Label,
        component: {
          type: ComponentType.TextInput,
          custom_id: DATE_IDS.dates,
          value: dates,
        },
      },
    ],
  });
  return interaction;
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
    data: {
      flags?: number;
      components: APIMessageTopLevelComponent[];
      custom_id?: string;
      title?: string;
    };
  }>();
}

function activeRound(guildId: string) {
  return runInDurableObject(stub(guildId), (_i, state) =>
    new PollStore(state.storage).getActiveRound(),
  );
}

describe("starting the date vote", () => {
  it("opens a modal with one required paragraph whose placeholder shows both formats", async () => {
    const guild = "200000000000000201";
    await decided(guild);
    discord(guild, () => Response.json({}));
    const click = componentInteraction(DATE_IDS.start, guild);
    Object.assign(click, { member: { user: { id: OWNER }, roles: [] } });
    const reply = await send(click);
    expect(reply.type).toBe(InteractionResponseType.Modal);
    expect(reply.data.custom_id).toBe(DATE_IDS.start);
    expect(reply.data.title).toBe("Start date vote");
    expect(reply.data.components).toEqual([
      expect.objectContaining({
        type: ComponentType.Label,
        label: "Candidate dates (one per line)",
        component: expect.objectContaining({
          custom_id: DATE_IDS.dates,
          style: TextInputStyle.Paragraph,
          required: true,
          placeholder: "2026-12-05 (starts at 11:00) or 2026-12-05 09:00",
        }) as unknown,
        description:
          "2 to 25 dates, as YYYY-MM-DD or YYYY-MM-DD HH:MM (24-hour); the time defaults to 11:00.",
      }),
    ]);
  });

  it("refuses to open the modal before the location is decided", async () => {
    const guild = "200000000000000202";
    await configure(guild);
    discord(guild, () => Response.json({}));
    const click = componentInteraction(DATE_IDS.start, guild);
    Object.assign(click, { member: { user: { id: OWNER }, roles: [] } });
    const reply = await send(click);
    expect(reply.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(reply.data.components)).toContain(
      "The date vote starts once the location is decided.",
    );
  });

  it("opens the date poll, posts it in the voting channel and stores its message id", async () => {
    const guild = "200000000000000203";
    await decided(guild);
    const fetchSpy = discord(guild, () =>
      Response.json({ id: "900000000000000001", channel_id: TEXT }),
    );
    const ctx = createExecutionContext();
    const reply = await send(
      startSubmit(guild, "2030-06-15\n2030-06-08 09:00\n2030-06-08"),
      ctx,
    );
    expect(reply).toEqual({
      type: InteractionResponseType.DeferredMessageUpdate,
    });
    await waitOnExecutionContext(ctx);
    const sent = requests(fetchSpy);
    const post = sent.find((r) => r.method === "POST");
    expect(post?.url).toMatch(new RegExp(`/channels/${TEXT}/messages$`));
    const message = bodyOf(post);
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(text(message.components)).toContain(
      "## When should we hike Ridge Trail?",
    );
    expect(ids(message.components)).toEqual([
      expect.stringMatching(/^hb:poll:vote:\d+$/),
      expect.stringMatching(/^hb:date:propose:\d+$/),
    ]);
    const round = await activeRound(guild);
    expect(round?.status).toBe("date_voting");
    expect(round?.datePoll).toMatchObject({
      channelId: TEXT,
      messageId: "900000000000000001",
    });
    expect(round?.datePoll?.options.map((o) => o.label)).toEqual([
      "Sat, 8 Jun 2030 · 09:00",
      "Sat, 8 Jun 2030 · 11:00",
      "Sat, 15 Jun 2030 · 11:00",
    ]);
    expect(text(message.components)).toContain("**Sat, 8 Jun 2030 · 11:00**");
    const panel = text(bodyOf(sent.at(-1)).components);
    expect(panel).toContain(`The date vote is open in <#${TEXT}>.`);
    expect(panel).toContain("**Location decided:** Ridge Trail");
  });

  it("takes the date poll back when Discord refuses it, leaving the location decided, and shows why", async () => {
    const guild = "200000000000000204";
    await decided(guild);
    const fetchSpy = discord(guild, () =>
      Response.json(
        { message: "Missing Access", code: 50001 },
        { status: 403 },
      ),
    );
    const ctx = createExecutionContext();
    await send(startSubmit(guild, "2030-06-15\n2030-06-08"), ctx);
    await waitOnExecutionContext(ctx);
    const round = await activeRound(guild);
    expect(round?.status).toBe("location_decided");
    expect(round?.datePoll).toBeNull();
    const panel = text(bodyOf(requests(fetchSpy).at(-1)).components);
    expect(panel).toContain(
      `Could not post the date vote in <#${TEXT}>: Discord answered: Missing Access (HTTP 403, code 50001). The date vote was not started;`,
    );
    expect(ids(bodyOf(requests(fetchSpy).at(-1)).components)).toContain(
      DATE_IDS.start,
    );
  });

  it("refuses invalid dates with an ephemeral list and starts nothing", async () => {
    const guild = "200000000000000205";
    await decided(guild);
    const fetchSpy = discord(guild, () => Response.json({}));
    const reply = await send(startSubmit(guild, "2030-06-15\nnext week"));
    expect(reply.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(reply.data.flags).toBe(
      MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    );
    expect(text(reply.data.components)).toContain(
      "Line 2: `next week` is not a date.",
    );
    expect((await activeRound(guild))?.status).toBe("location_decided");
    expect(requests(fetchSpy).filter((r) => r.method === "POST")).toEqual([]);
  });

  it("refuses a non-admin replaying the start button and modal", async () => {
    const guild = "200000000000000206";
    await decided(guild);
    discord(guild, () => Response.json({}));
    const click = componentInteraction(DATE_IDS.start, guild);
    Object.assign(click, { member: { user: { id: MEMBER }, roles: [] } });
    for (const interaction of [
      click,
      startSubmit(guild, "2030-06-15\n2030-06-08", MEMBER),
    ]) {
      const reply = await send(interaction);
      expect(text(reply.data.components)).toContain(
        "The hikebot admin panel is limited to the server owner",
      );
    }
    expect((await activeRound(guild))?.status).toBe("location_decided");
  });
});

describe("closing the date vote", () => {
  /** A guild with an open date poll on a posted message, two dates tied. */
  async function tiedDatePoll(guildId: string): Promise<PollView> {
    const roundId = await decided(guildId);
    return runInDurableObject(stub(guildId), (_i, state) => {
      const store = new PollStore(state.storage);
      const poll = store.startDatePoll(roundId, OWNER, [
        "2030-06-15",
        "2030-06-08",
        "2030-06-22",
      ]);
      store.setPollMessage(poll.id, TEXT, POLL_MESSAGE);
      store.setVotes(poll.id, "u1", [poll.options[0]?.id ?? 0]);
      store.setVotes(poll.id, "u2", [poll.options[1]?.id ?? 0]);
      return store.getPoll(poll.id) as PollView;
    });
  }

  function closeClick(view: PollView): APIMessageComponentInteraction {
    const interaction = componentInteraction(
      POLL_IDS.closeConfirm(view.id),
      "unused",
    );
    Object.assign(interaction, {
      guild_id: GUILD,
      member: { user: { id: OWNER }, roles: [] },
      message: { id: "800000000000000009", components: [] },
    });
    return interaction;
  }

  it("draws the date of a tie from the injected source, completes the round, then edits, announces and sums up", async () => {
    const guild = "date-vote-close-tie";
    const view = await tiedDatePoll(guild);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(Response.json({ id: "1" })));
    await runInDurableObject(stub(guild), async (_i, state) => {
      const store = new PollStore(state.storage, { random: sequence(1) });
      const result = await closePoll(
        closeClick(view),
        { env, storage: state.storage },
        { date: DATE_POLL },
        store,
      );
      expect(result.response).toEqual({
        type: InteractionResponseType.DeferredMessageUpdate,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(store.getActiveRound()).toBeNull();
      expect(store.getLastRound()).toMatchObject({
        status: "complete",
        dateOptionId: view.options[1]?.id,
      });
      await result.followUp?.();
    });
    const sent = requests(fetchSpy);
    // Every stubbed answer has id 1: the thread, its first message and the
    // event.
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `PATCH /api/v10/channels/${TEXT}/messages/${POLL_MESSAGE}`,
      `POST /api/v10/channels/${FORUM}/threads`,
      `POST /api/v10/guilds/${GUILD}/scheduled-events`,
      "PATCH /api/v10/channels/1/messages/1",
      `POST /api/v10/channels/${NEWS}/messages`,
      "PATCH /api/v10/webhooks/100/interaction-token/messages/@original",
    ]);
    const [edit, , , , announcement, panel] = sent.map((r) =>
      text(bodyOf(r).components),
    );
    expect(announcement?.split("\n").slice(-2)).toEqual([
      "**Hike thread:** <#1>",
      `**Hike event:** https://discord.com/events/${GUILD}/1`,
    ]);
    expect(edit).toContain("🏆 **Sat, 15 Jun 2030 · 11:00** won with 1 vote.");
    expect(announcement).toContain("**Where:** Ridge Trail");
    // 11:00 in Los Angeles on 15 June 2030 is 18:00 UTC.
    expect(announcement).toContain(
      "**When:** Sat, 15 Jun 2030 · 11:00 (<t:1907776800:R>)",
    );
    expect(announcement).toContain(
      "2 options tied with 1 vote each; the winner was drawn at random.",
    );
    expect(panel).toContain(
      "The date vote is closed: **Sat, 15 Jun 2030 · 11:00** won with 1 vote, drawn at random from a tie.",
    );
    expect(panel).toContain(
      "**Last hike:** **Ridge Trail** on **Sat, 15 Jun 2030 · 11:00**.",
    );
    expect(panel).toContain("**Hike thread:** <#1>");
    expect(ids(bodyOf(sent[5]).components)).toContain("hb:location:start");
    for (const r of sent.filter((r) => !r.url.endsWith("/scheduled-events"))) {
      // A forum thread's message is nested in its body.
      expect(
        bodyOf(r).allowed_mentions ?? bodyOf(r).message?.allowed_mentions,
      ).toEqual({ parse: [] });
    }
  });

  it("times the When line in the zone set before the vote closed", async () => {
    const guild = "date-vote-close-zone";
    const view = await tiedDatePoll(guild);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(Response.json({ id: "1" })));
    await runInDurableObject(stub(guild), async (_i, state) => {
      new GuildConfig(state.storage).setTimezone("Europe/Berlin");
      await (
        await closePoll(
          closeClick(view),
          { env, storage: state.storage },
          { date: DATE_POLL },
          new PollStore(state.storage, { random: sequence(1) }),
        )
      ).followUp?.();
    });
    const sent = requests(fetchSpy);
    const [, thread, event, , announcement] = sent.map((r) =>
      text(bodyOf(r).components ?? bodyOf(r).message?.components ?? []),
    );
    expect(event).toBe("");
    // 11:00 in Berlin on 15 June 2030 is 09:00 UTC.
    const when = "**When:** Sat, 15 Jun 2030 · 11:00 (<t:1907744400:R>)";
    expect(announcement).toContain(when);
    expect(thread).toContain(when);
    expect(JSON.parse(String(sent[2]?.body))).toMatchObject({
      scheduled_start_time: "2030-06-15T09:00:00.000Z",
      scheduled_end_time: "2030-06-15T13:00:00.000Z",
    });
  });

  it("keeps the result and names each step Discord refused", async () => {
    const guild = "date-vote-close-fails";
    const view = await tiedDatePoll(guild);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const request = new Request(input, init);
        return request.url.includes("/webhooks/")
          ? Promise.resolve(Response.json({ id: "1" }))
          : Promise.reject(new TypeError("Network connection lost"));
      });
    await runInDurableObject(stub(guild), async (_i, state) => {
      const result = await closePoll(
        closeClick(view),
        { env, storage: state.storage },
        { date: DATE_POLL },
        new PollStore(state.storage, { random: sequence(0) }),
      );
      await result.followUp?.();
      expect(new PollStore(state.storage).getLastRound()?.status).toBe(
        "complete",
      );
    });
    const panel = text(bodyOf(requests(fetchSpy).at(-1)).components);
    expect(panel).toContain(
      `Could not update the poll message in <#${TEXT}>: Discord could not be reached.`,
    );
    expect(panel).toContain(
      `Could not post the announcement in <#${NEWS}>: Discord could not be reached.`,
    );
    expect(panel).toContain(
      "**Last hike:** **Ridge Trail** on **Sat, 8 Jun 2030 · 11:00**.",
    );
    expect(panel).toContain(
      `**Hike thread:** not created. Could not create the hike thread in <#${FORUM}>: Discord could not be reached.`,
    );
    expect(ids(bodyOf(requests(fetchSpy).at(-1)).components)).toContain(
      "hb:thread:create:1",
    );
  });

  it("runs the kind's close steps after the final edit and before the announcement, which gets their lines", async () => {
    const guild = "date-vote-close-steps";
    const view = await tiedDatePoll(guild);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(Response.json({ id: "1" })));
    const order: string[] = [];
    const wording: PollWording = {
      ...DATE_POLL,
      closeSteps: [
        {
          name: "create the hike thread",
          run: (closed) => {
            order.push(
              `thread after ${String(fetchSpy.mock.calls.length)} calls`,
            );
            expect(closed.round?.status).toBe("complete");
            expect(closed.guildId).toBe(GUILD);
            return Promise.resolve({
              announce: ["[Hike thread](https://discord.com/channels/1/2)"],
              note: "The hike thread is open.",
            });
          },
        },
        {
          name: "do the second step",
          run: () => Promise.reject(new Error("broken")),
        },
      ],
    };
    await runInDurableObject(stub(guild), async (_i, state) => {
      await (
        await closePoll(
          closeClick(view),
          { env, storage: state.storage },
          { date: wording },
          new PollStore(state.storage, { random: sequence(0) }),
        )
      ).followUp?.();
    });
    expect(order).toEqual(["thread after 1 calls"]);
    const [, announcement, panel] = requests(fetchSpy).map((r) =>
      text(bodyOf(r).components),
    );
    expect(announcement?.split("\n").at(-1)).toBe(
      "[Hike thread](https://discord.com/channels/1/2)",
    );
    expect(panel).toContain("The hike thread is open.");
    expect(panel).toContain(
      "Could not do the second step: Discord could not be reached.",
    );
  });
});

describe("the start modal's default dates", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the next two weekends after a day, one per line", () => {
    const form = startModal(defaultDateCandidates("2026-11-18")) as {
      data: { components: Node[] };
    };
    expect(flatten(form.data.components)).toContainEqual(
      expect.objectContaining({
        custom_id: DATE_IDS.dates,
        value:
          "2026-11-21 11:00\n2026-11-22 11:00\n2026-11-28 11:00\n2026-11-29 11:00",
      }),
    );
  });

  it("are computed for today in the guild's zone, not in UTC", async () => {
    const guild = "date-start-defaults-zone";
    await decided(guild);
    discord(guild, () => Response.json({}));
    // 03:00 UTC on Saturday 21 November is Friday evening in Los Angeles.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 21, 3));
    const click = componentInteraction(DATE_IDS.start, guild);
    Object.assign(click, { member: { user: { id: OWNER }, roles: [] } });
    const reply = await send(click);
    expect(flatten(nodes(reply.data.components))).toContainEqual(
      expect.objectContaining({
        custom_id: DATE_IDS.dates,
        value:
          "2026-11-21 11:00\n2026-11-22 11:00\n2026-11-28 11:00\n2026-11-29 11:00",
      }),
    );
  });

  it("start a date vote with four dates when submitted unchanged", async () => {
    const guild = "date-start-defaults-submit";
    await decided(guild);
    discord(guild, () =>
      Response.json({ id: "900000000000000002", channel_id: TEXT }),
    );
    const defaults = defaultDateCandidates(todayIn(LA, Date.now()));
    const ctx = createExecutionContext();
    await send(startSubmit(guild, defaults.join("\n")), ctx);
    await waitOnExecutionContext(ctx);
    const round = await activeRound(guild);
    expect(round?.status).toBe("date_voting");
    expect(round?.datePoll?.options.map((o) => o.dateValue)).toEqual(defaults);
  });

  it("follow the planned close when the weekly schedule is on", async () => {
    const guild = "date-start-defaults-cadence";
    await decided(guild);
    await runInDurableObject(stub(guild), (_i, state) => {
      new GuildConfig(state.storage).setCadence({ enabled: true });
    });
    discord(guild, () => Response.json({}));
    // Thursday 19 November, 10:00 in Los Angeles: a date vote opened now
    // closes Saturday at 09:00, so its dates are the 14 days after that.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 19, 18));
    const click = componentInteraction(DATE_IDS.start, guild);
    Object.assign(click, { member: { user: { id: OWNER }, roles: [] } });
    const reply = await send(click);
    expect(flatten(nodes(reply.data.components))).toContainEqual(
      expect.objectContaining({
        custom_id: DATE_IDS.dates,
        value:
          "2026-11-22 11:00\n2026-11-28 11:00\n2026-11-29 11:00\n2026-12-05 11:00",
      }),
    );
  });

  it("move the schedule's next run to the date vote's planned close when submitted", async () => {
    const guild = "date-start-cadence-run";
    await decided(guild);
    await runInDurableObject(stub(guild), (_i, state) => {
      // Turned on the day before.
      new GuildConfig(state.storage).setCadence({
        enabled: true,
        onSince: Date.UTC(2030, 0, 2),
      });
    });
    discord(guild, () =>
      Response.json({ id: "900000000000000004", channel_id: TEXT }),
    );
    // Thursday 3 January 2030, 10:00 in Los Angeles: years ahead, so the
    // alarm set here does not fire by itself.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2030, 0, 3, 18));
    const ctx = createExecutionContext();
    await send(startSubmit(guild, "2030-01-12\n2030-01-13"), ctx);
    await waitOnExecutionContext(ctx);
    const jobs = await runInDurableObject(stub(guild), (_i, state) =>
      scheduledJobs(state.storage),
    );
    // Saturday 5 January, 09:00 in Los Angeles.
    expect(jobs.get(CADENCE_JOB)).toBe(Date.UTC(2030, 0, 5, 17));
  });

  it("do not limit the admin's list to a month ahead", async () => {
    const guild = "date-start-far-ahead";
    await decided(guild);
    discord(guild, () =>
      Response.json({ id: "900000000000000003", channel_id: TEXT }),
    );
    const ctx = createExecutionContext();
    await send(startSubmit(guild, "2030-06-08\n2030-06-15"), ctx);
    await waitOnExecutionContext(ctx);
    expect((await activeRound(guild))?.datePoll?.options).toHaveLength(2);
  });
});

describe("proposing a date", () => {
  /** 05:00 UTC on Thu 19 Nov 2026: still Wed 18 Nov in Los Angeles. */
  const PROPOSE_NOW = Date.UTC(2026, 10, 19, 5);

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A guild with an open date poll on a posted message; its id. */
  async function openDatePoll(
    guildId: string,
    dates = ["2026-11-28", "2026-12-12"],
  ): Promise<number> {
    const roundId = await decided(guildId);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(PROPOSE_NOW);
    return runInDurableObject(stub(guildId), (_i, state) => {
      const store = new PollStore(state.storage);
      const poll = store.startDatePoll(roundId, OWNER, dates);
      store.setPollMessage(poll.id, TEXT, POLL_MESSAGE);
      return poll.id;
    });
  }

  function proposeClick(guildId: string, pollId: number) {
    const click = componentInteraction(DATE_IDS.propose(pollId), guildId);
    Object.assign(click, { member: { user: { id: MEMBER }, roles: [] } });
    return click;
  }

  function proposeSubmit(
    guildId: string,
    pollId: number,
    date: string,
  ): APIModalSubmitInteraction {
    const interaction = modalInteraction(DATE_IDS.propose(pollId), guildId);
    Object.assign(interaction, {
      member: { user: { id: MEMBER }, roles: [] },
    });
    Object.assign(interaction.data, {
      components: [
        {
          type: ComponentType.Label,
          component: {
            type: ComponentType.TextInput,
            custom_id: DATE_IDS.day,
            value: date,
          },
        },
      ],
    });
    return interaction;
  }

  function options(guildId: string, pollId: number) {
    return runInDurableObject(
      stub(guildId),
      (_i, state) => new PollStore(state.storage).getPoll(pollId)?.options,
    );
  }

  it("opens a modal with one short Date field naming the last day and the default time", async () => {
    const guild = "date-propose-modal";
    const pollId = await openDatePoll(guild);
    const reply = await send(proposeClick(guild, pollId));
    expect(reply.type).toBe(InteractionResponseType.Modal);
    expect(reply.data.custom_id).toBe(`hb:date:propose:${String(pollId)}`);
    expect(reply.data.title).toBe("Propose a date");
    expect(reply.data.components).toEqual([
      {
        type: ComponentType.Label,
        label: "Date",
        description:
          "2026-11-18 to 2026-12-19, as YYYY-MM-DD or YYYY-MM-DD HH:MM; the time defaults to 11:00.",
        component: {
          type: ComponentType.TextInput,
          style: TextInputStyle.Short,
          custom_id: DATE_IDS.day,
          required: true,
          max_length: 16,
          placeholder: "2026-11-18 or 2026-11-18 09:00",
        },
      },
    ]);
  });

  it("adds the date with the member as proposer, answers ephemerally and schedules a refresh", async () => {
    const guild = "date-propose-ok";
    const pollId = await openDatePoll(guild);
    const reply = await send(proposeSubmit(guild, pollId, " 2026-12-05 "));
    expect(reply.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(reply.data.flags).toBe(
      MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    );
    expect(text(reply.data.components)).toBe(
      "Added **Sat, 5 Dec 2026 · 11:00** to the date vote. Use **Vote** to vote for it.",
    );
    expect((await options(guild, pollId))?.map((o) => o.label)).toEqual([
      "Sat, 28 Nov 2026 · 11:00",
      "Sat, 5 Dec 2026 · 11:00",
      "Sat, 12 Dec 2026 · 11:00",
    ]);
    expect((await options(guild, pollId))?.[1]?.proposedBy).toBe(MEMBER);
    await runInDurableObject(stub(guild), async (_i, state) => {
      expect(
        await state.storage.get(`poll-refresh:${String(pollId)}`),
      ).toBeDefined();
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it("accepts today, 31 days ahead and the same day at another time", async () => {
    const guild = "date-propose-edges";
    const pollId = await openDatePoll(guild);
    for (const date of ["2026-11-18", "2026-12-19", "2026-11-28 08:00"]) {
      const reply = await send(proposeSubmit(guild, pollId, date));
      expect(text(reply.data.components)).toMatch(/^Added \*\*/);
    }
    expect(await options(guild, pollId)).toHaveLength(5);
  });

  it.each([
    [
      "not a date",
      "next Saturday",
      "`next Saturday` is not a date. Write it as `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` (24-hour), for example `2026-12-05` or `2026-12-05 09:00`.",
    ],
    [
      "yesterday",
      "2026-11-17",
      "Tue, 17 Nov 2026 · 11:00 is in the past: today is 2026-11-18 in America/Los_Angeles. Propose a day from 2026-11-18 to 2026-12-19.",
    ],
    [
      "32 days ahead",
      "2026-12-20",
      "Sun, 20 Dec 2026 · 11:00 is more than 31 days away. Propose a day from 2026-11-18 to 2026-12-19, or ask an admin to plan further ahead.",
    ],
    [
      "the same date and time",
      "2026-11-28 11:00",
      "**Sat, 28 Nov 2026 · 11:00** is already on the vote. Vote for it instead, or propose another time that day.",
    ],
  ])("refuses %s with its own answer", async (_name, date, answer) => {
    const guild = `date-propose-refused-${date.replaceAll(" ", "-")}`;
    const pollId = await openDatePoll(guild);
    const reply = await send(proposeSubmit(guild, pollId, date));
    expect(reply.data.flags).toBe(
      MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    );
    expect(text(reply.data.components)).toBe(answer);
    expect(await options(guild, pollId)).toHaveLength(2);
  });

  it("takes only the 14 days after the planned close in a round on the weekly schedule", async () => {
    const guild = "date-propose-cadence";
    // Opened on Wednesday 18 November in Los Angeles: it closes Friday the
    // 20th, so members may propose from Saturday 21 November to 4 December.
    const pollId = await openDatePoll(guild);
    await runInDurableObject(stub(guild), (_i, state) => {
      // Turned on before the vote opened.
      new GuildConfig(state.storage).setCadence({
        enabled: true,
        onSince: PROPOSE_NOW - 86_400_000,
      });
    });
    const modal = await send(proposeClick(guild, pollId));
    expect(modal.data.components).toMatchObject([
      {
        description:
          "2026-11-21 to 2026-12-04, as YYYY-MM-DD or YYYY-MM-DD HH:MM; the time defaults to 11:00.",
        component: { placeholder: "2026-11-21 or 2026-11-21 09:00" },
      },
    ]);
    for (const [date, label] of [
      ["2026-11-20", "Fri, 20 Nov 2026 · 11:00"],
      ["2026-12-05", "Sat, 5 Dec 2026 · 11:00"],
    ] as const) {
      const reply = await send(proposeSubmit(guild, pollId, date));
      expect(text(reply.data.components)).toBe(
        `${label} is outside this round's dates. Propose a day from 2026-11-21 to 2026-12-04: the 14 days after the date vote closes.`,
      );
    }
    for (const date of ["2026-11-21 08:00", "2026-12-02", "2026-12-04"]) {
      const reply = await send(proposeSubmit(guild, pollId, date));
      expect(text(reply.data.components)).toMatch(/^Added \*\*/);
    }
    expect(await options(guild, pollId)).toHaveLength(5);
  });

  it("names the window from today once a held vote's window has begun", async () => {
    const guild = "date-propose-cadence-held";
    const pollId = await openDatePoll(guild);
    // Opened a week earlier, on Wednesday 11 November: it was to close on
    // the 13th, so its window is 14 to 27 November, and today is the 18th.
    await runInDurableObject(stub(guild), (_i, state) => {
      new GuildConfig(state.storage).setCadence({
        enabled: true,
        onSince: PROPOSE_NOW - 8 * 86_400_000,
      });
      state.storage.sql.exec(
        "UPDATE polls SET opened_at = opened_at - ? WHERE id = ?",
        7 * 86_400_000,
        pollId,
      );
    });
    const modal = await send(proposeClick(guild, pollId));
    expect(modal.data.components).toMatchObject([
      {
        description:
          "2026-11-18 to 2026-11-27, as YYYY-MM-DD or YYYY-MM-DD HH:MM; the time defaults to 11:00.",
      },
    ]);
    const reply = await send(proposeSubmit(guild, pollId, "2026-11-16"));
    expect(text(reply.data.components)).toBe(
      "Mon, 16 Nov 2026 · 11:00 is in the past: today is 2026-11-18 in America/Los_Angeles. Propose a day from 2026-11-18 to 2026-11-27: the 14 days after the date vote closes.",
    );
    expect(await options(guild, pollId)).toHaveLength(2);
  });

  it("keeps the usual month for a vote opened before the weekly schedule was turned on", async () => {
    const guild = "date-propose-cadence-before";
    const pollId = await openDatePoll(guild);
    await runInDurableObject(stub(guild), (_i, state) => {
      new GuildConfig(state.storage).setCadence({
        enabled: true,
        onSince: PROPOSE_NOW + 60_000,
      });
    });
    const modal = await send(proposeClick(guild, pollId));
    expect(modal.data.components).toMatchObject([
      {
        description:
          "2026-11-18 to 2026-12-19, as YYYY-MM-DD or YYYY-MM-DD HH:MM; the time defaults to 11:00.",
      },
    ]);
    const reply = await send(proposeSubmit(guild, pollId, "2026-11-19"));
    expect(text(reply.data.components)).toMatch(/^Added \*\*/);
  });

  it("judges today in the guild's zone", async () => {
    const guild = "date-propose-zone";
    const pollId = await openDatePoll(guild);
    // In Auckland it is already Thursday 19 November.
    await runInDurableObject(stub(guild), (_i, state) => {
      new GuildConfig(state.storage).setTimezone("Pacific/Auckland");
    });
    let reply = await send(proposeSubmit(guild, pollId, "2026-11-18"));
    expect(text(reply.data.components)).toContain(
      "is in the past: today is 2026-11-19 in Pacific/Auckland.",
    );
    reply = await send(proposeSubmit(guild, pollId, "2026-12-20"));
    expect(text(reply.data.components)).toMatch(/^Added /);
  });

  it("refuses a full poll and a closed poll, at the button and at the modal", async () => {
    const guild = "date-propose-full";
    const pollId = await openDatePoll(
      guild,
      Array.from(
        { length: 25 },
        (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`,
      ),
    );
    const full =
      "This vote already has 25 dates, the most it can hold. Vote for one of them instead.";
    let reply = await send(proposeClick(guild, pollId));
    expect(text(reply.data.components)).toBe(full);
    reply = await send(proposeSubmit(guild, pollId, "2026-11-30"));
    expect(text(reply.data.components)).toBe(full);
    await runInDurableObject(stub(guild), (_i, state) => {
      new PollStore(state.storage).closePoll(pollId, OWNER);
    });
    for (const interaction of [
      proposeClick(guild, pollId),
      proposeSubmit(guild, pollId, "2026-11-30"),
    ]) {
      reply = await send(interaction);
      expect(reply.data.flags).toBe(
        MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      );
      expect(text(reply.data.components)).toBe(VOTE_CLOSED_MESSAGE);
    }
    expect(await options(guild, pollId)).toHaveLength(25);
  });

  it("lists a date proposed out of order in date order in the vote select", async () => {
    const guild = "date-propose-select";
    const pollId = await openDatePoll(guild);
    await send(proposeSubmit(guild, pollId, "2026-11-20"));
    const poll = await runInDurableObject(stub(guild), (_i, state) =>
      new PollStore(state.storage).getPoll(pollId),
    );
    if (!poll) throw new Error("no poll");
    // The options as stored in the order they were added.
    const added = {
      ...poll,
      options: [...poll.options].sort((a, b) => a.id - b.id),
    };
    const select = flatten(nodes(renderVoteSelect(added, DATE_POLL))).find(
      (c) => c.custom_id === POLL_IDS.choose(pollId),
    ) as { options?: { label: string }[] } | undefined;
    expect(select?.options?.map((o) => o.label)).toEqual([
      "Fri, 20 Nov 2026 · 11:00",
      "Sat, 28 Nov 2026 · 11:00",
      "Sat, 12 Dec 2026 · 11:00",
    ]);
  });
});
