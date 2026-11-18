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
} from "../../src/features/date-vote";
import {
  MAX_MESSAGE_COMPONENTS,
  MAX_MESSAGE_TEXT,
  POLL_IDS,
  closePoll,
  renderAnnouncement,
  renderPollMessage,
  renderVoteSelect,
  type PollWording,
} from "../../src/features/poll-ui";
import { GuildConfig } from "../../src/guild/config";
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
    startedBy: OWNER,
    startedAt: 0,
    endedBy: null,
    endedAt: null,
    locationPoll: location,
    datePoll: poll,
  };
}

describe("the date poll message", () => {
  it("names the decided location and lists the dates in date order with their votes, and only Vote", () => {
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
    expect(ids(view)).toEqual([POLL_IDS.vote(2)]);
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
      const result = closePoll(
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
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `PATCH /api/v10/channels/${TEXT}/messages/${POLL_MESSAGE}`,
      `POST /api/v10/channels/${FORUM}/threads`,
      `POST /api/v10/channels/${NEWS}/messages`,
      "PATCH /api/v10/webhooks/100/interaction-token/messages/@original",
    ]);
    const [edit, , announcement, panel] = sent.map((r) =>
      text(bodyOf(r).components),
    );
    expect(announcement?.split("\n").at(-1)).toBe("**Hike thread:** <#1>");
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
    expect(ids(bodyOf(sent[3]).components)).toContain("hb:location:start");
    for (const r of sent) {
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
      await closePoll(
        closeClick(view),
        { env, storage: state.storage },
        { date: DATE_POLL },
        new PollStore(state.storage, { random: sequence(1) }),
      ).followUp?.();
    });
    const [, thread, announcement] = requests(fetchSpy).map((r) =>
      text(bodyOf(r).components ?? bodyOf(r).message?.components),
    );
    // 11:00 in Berlin on 15 June 2030 is 09:00 UTC.
    const when = "**When:** Sat, 15 Jun 2030 · 11:00 (<t:1907744400:R>)";
    expect(announcement).toContain(when);
    expect(thread).toContain(when);
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
      const result = closePoll(
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
      await closePoll(
        closeClick(view),
        { env, storage: state.storage },
        { date: wording },
        new PollStore(state.storage, { random: sequence(0) }),
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
