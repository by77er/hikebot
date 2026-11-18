import {
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  InteractionResponseType,
  MessageFlags,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DATE_POLL } from "../../src/features/date-vote";
import {
  HIKE_THREAD_IDS,
  MAX_THREAD_NAME,
  createHikeThreadStep,
  renderThreadMessage,
  threadTitle,
} from "../../src/features/hike-thread";
import {
  THREAD_CLAIM_MS,
  claimHikeThread,
  hikeThreadStatus,
  recordHikeThreadFailure,
} from "../../src/features/hike-thread-state";
import {
  MAX_MESSAGE_COMPONENTS,
  MAX_MESSAGE_TEXT,
  POLL_IDS,
  closePoll,
} from "../../src/features/poll-ui";
import { GuildConfig } from "../../src/guild/config";
import {
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
const LOCATION_MESSAGE = "700000000000000001";
const DATE_MESSAGE = "700000000000000002";
const GUILD = "200000000000000001";

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

// Rendering.

describe("threadTitle", () => {
  const date = "Sat, 5 Dec 2026 · 09:00";
  it.each([
    ["a short location", "Eagle Peak", "Eagle Peak — Sat, 5 Dec 2026 · 09:00"],
    [
      "a location that just fits",
      "L".repeat(MAX_THREAD_NAME - 3 - date.length),
      `${"L".repeat(MAX_THREAD_NAME - 3 - date.length)} — ${date}`,
    ],
    [
      "a location one character too long",
      "L".repeat(MAX_THREAD_NAME - 2 - date.length),
      `${"L".repeat(MAX_THREAD_NAME - 4 - date.length)}… — ${date}`,
    ],
    [
      "the longest location (80 characters)",
      "L".repeat(80),
      `${"L".repeat(MAX_THREAD_NAME - 4 - date.length)}… — ${date}`,
    ],
  ])("%s", (_name, location, title) => {
    expect(threadTitle(location, date)).toBe(title);
    expect(threadTitle(location, date).length).toBeLessThanOrEqual(
      MAX_THREAD_NAME,
    );
  });

  it("cuts a long location on a code point boundary and keeps the date whole", () => {
    const title = threadTitle(`${"L".repeat(72)}🏔️ summit ridge`, date);
    expect(title.length).toBeLessThanOrEqual(MAX_THREAD_NAME);
    expect(title.endsWith(` — ${date}`)).toBe(true);
    expect(title).not.toMatch(/[\uD800-\uDBFF]…/);
  });
});

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
    votes: 0,
    ...extra,
  };
}

function poll(
  id: number,
  kind: "location" | "date",
  options: OptionView[],
  extra: Partial<PollView> = {},
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
    voterCount: 4,
    viewerVotes: [],
    ...extra,
  };
}

function round(location: PollView, date: PollView): RoundView {
  return {
    id: 1,
    status: "complete",
    locationOptionId: location.winnerOptionId,
    dateOptionId: date.winnerOptionId,
    threadId: null,
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

describe("renderThreadMessage", () => {
  it("names the location, its details, the proposer, the date and both results with links", () => {
    const view = renderThreadMessage(
      round(
        poll(1, "location", [
          option(1, 1, "Lake Loop", {
            details: "https://example.com/lake · 12 km",
            proposedBy: PROPOSER,
            votes: 3,
          }),
        ]),
        poll(
          2,
          "date",
          [
            option(11, 2, "Sat, 15 Jun 2030 · 09:00", {
              dateValue: "2030-06-15 09:00",
              votes: 1,
            }),
          ],
          {
            tieBroken: true,
            tiedOptionIds: [11, 12],
            voterCount: 1,
          },
        ),
      ),
      GUILD,
      "America/Los_Angeles",
    );
    expect(text(view).split("\n")).toEqual([
      "## Lake Loop",
      "https://example.com/lake · 12 km",
      `Proposed by <@${PROPOSER}>`,
      // 09:00 in Los Angeles on 15 June 2030 is 16:00 UTC.
      "**When:** Sat, 15 Jun 2030 · 09:00 (<t:1907769600:R>)",
      `**Location vote:** **Lake Loop** won with 3 votes; 4 members voted. [See the location vote](https://discord.com/channels/${GUILD}/${TEXT}/${LOCATION_MESSAGE})`,
      `**Date vote:** **Sat, 15 Jun 2030 · 09:00** won with 1 vote; 1 member voted. The winner was drawn at random from 2 tied options. [See the date vote](https://discord.com/channels/${GUILD}/${TEXT}/${DATE_MESSAGE})`,
    ]);
  });

  function located(place: OptionView["place"]) {
    return renderThreadMessage(
      round(
        poll(1, "location", [
          option(1, 1, "Mount Si", {
            details: "Steep, 13 km",
            proposedBy: PROPOSER,
            place,
          }),
        ]),
        poll(2, "date", [
          option(11, 2, "Sat, 15 Jun 2030 · 09:00", {
            dateValue: "2030-06-15 09:00",
          }),
        ]),
      ),
      GUILD,
      "America/Los_Angeles",
    );
  }

  it("shows the decided location's place with both map links after its details, and the attribution last", () => {
    const view = located({
      status: "found",
      point: { lat: 47.4875, lon: -121.7234 },
      name: "Mount Si, King County, Washington",
      attempts: 1,
    });
    const lines = text(view).split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "## Mount Si",
      "Steep, 13 km",
      "📍 Mount Si, King County, Washington · [OpenStreetMap](https://www.openstreetmap.org/?mlat=47.4875&mlon=-121.7234#map=13/47.4875/-121.7234) · [Google Maps](https://www.google.com/maps/search/?api=1&query=47.4875,-121.7234)",
      `Proposed by <@${PROPOSER}>`,
    ]);
    expect(lines.at(-1)).toBe("-# © OpenStreetMap contributors");
    const last = flatten(view).at(-1);
    expect(last?.content).toBe("-# © OpenStreetMap contributors");
  });

  it("shows given coordinates without a place name", () => {
    const view = located({
      status: "given",
      point: { lat: 47.5, lon: -121.8 },
      name: null,
      attempts: 0,
    });
    expect(text(view)).toContain(
      "📍 [OpenStreetMap](https://www.openstreetmap.org/?mlat=47.5&mlon=-121.8#map=13/47.5/-121.8) · [Google Maps](https://www.google.com/maps/search/?api=1&query=47.5,-121.8)",
    );
    expect(text(view)).toContain("© OpenStreetMap contributors");
  });

  it.each([
    ["no place", null],
    [
      "a place still being looked up",
      { status: "pending", point: null, name: null, attempts: 0 },
    ],
    [
      "a place that was not found",
      { status: "not_found", point: null, name: null, attempts: 1 },
    ],
    [
      "a cleared pin",
      { status: "cleared", point: null, name: null, attempts: 1 },
    ],
  ] as const)(
    "shows no map links and no attribution for %s",
    (_name, place) => {
      const shown = text(located(place));
      expect(shown).not.toContain("📍");
      expect(shown).not.toContain("openstreetmap.org");
      expect(shown).not.toContain("google.com/maps");
      expect(shown).not.toContain("OpenStreetMap contributors");
    },
  );

  it.each([
    ["minimum", "L", null, 1],
    ["maximum", "L".repeat(80), "D".repeat(300), 25],
  ])(
    "stays within Discord's limits with %s-length inputs",
    (_name, label, details, tied) => {
      const view = renderThreadMessage(
        round(
          poll(1, "location", [option(1, 1, label, { details, votes: 9999 })], {
            tieBroken: tied > 1,
            tiedOptionIds: Array.from({ length: tied }, (_, i) => i + 1),
            voterCount: 9999,
          }),
          poll(
            2,
            "date",
            [
              option(11, 2, "Wed, 25 Dec 2030 · 23:59", {
                dateValue: "2030-12-25 23:59",
              }),
            ],
            {
              tieBroken: tied > 1,
              tiedOptionIds: Array.from({ length: tied }, (_, i) => i + 11),
            },
          ),
        ),
        "2".repeat(20),
        "America/Los_Angeles",
      );
      expect(flatten(view as unknown as Node[]).length).toBeLessThanOrEqual(
        MAX_MESSAGE_COMPONENTS,
      );
      expect(text(view).length).toBeLessThanOrEqual(MAX_MESSAGE_TEXT);
      expect(text(view)).toContain(`## ${label}`);
    },
  );
});

// The thread's state.

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

describe("hikeThreadStatus and claimHikeThread", () => {
  const complete = (threadId: string | null = null): RoundView => ({
    ...round(poll(1, "location", []), poll(2, "date", [])),
    threadId,
  });

  it("lets one claim through, refuses a second while it is fresh, and takes back a lost one as unconfirmed", async () => {
    await runInDurableObject(stub("hike-thread-claim"), (_i, state) => {
      const { storage } = state;
      expect(hikeThreadStatus(storage, complete(), 1000).state).toBe("missing");
      expect(claimHikeThread(storage, complete(), 1000)).toBe(true);
      expect(hikeThreadStatus(storage, complete(), 1000).state).toBe(
        "creating",
      );
      expect(claimHikeThread(storage, complete(), 1001)).toBe(false);
      expect(
        claimHikeThread(storage, complete(), 1000 + THREAD_CLAIM_MS - 1),
      ).toBe(false);
      expect(
        hikeThreadStatus(storage, complete(), 1000 + THREAD_CLAIM_MS).state,
      ).toBe("unconfirmed");
      expect(claimHikeThread(storage, complete(), 1000 + THREAD_CLAIM_MS)).toBe(
        true,
      );
    });
  });

  it("keeps a failure's reason until the next claim, and a thread wins over any attempt", async () => {
    await runInDurableObject(stub("hike-thread-failure"), (_i, state) => {
      const { storage } = state;
      expect(claimHikeThread(storage, complete(), 1000)).toBe(true);
      recordHikeThreadFailure(storage, 1, "Missing Permissions");
      expect(hikeThreadStatus(storage, complete(), 1001)).toEqual({
        state: "failed",
        reason: "Missing Permissions",
      });
      expect(hikeThreadStatus(storage, complete(THREAD), 1001)).toEqual({
        state: "created",
        threadId: THREAD,
      });
      expect(claimHikeThread(storage, complete(THREAD), 1001)).toBe(false);
      expect(claimHikeThread(storage, complete(), 1002)).toBe(true);
      expect(hikeThreadStatus(storage, complete(), 1002).state).toBe(
        "creating",
      );
    });
  });
});

// Through the guild object.

/** A guild whose date vote is open, with both poll messages posted. */
async function dateVoting(guildId: string): Promise<PollView> {
  return runInDurableObject(stub(guildId), (_i, state) => {
    const config = new GuildConfig(state.storage);
    config.set("voteChannelId", TEXT);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
    const store = new PollStore(state.storage);
    const started = store.startRound(OWNER, [
      { label: "Lake Loop", proposedBy: PROPOSER },
    ]);
    const location = started.locationPoll?.id ?? 0;
    store.setPollMessage(location, TEXT, LOCATION_MESSAGE);
    store.setVotes(location, "u1", [started.locationPoll?.options[0]?.id ?? 0]);
    store.closePoll(location, OWNER);
    const date = store.startDatePoll(started.id, OWNER, [
      "2030-06-15 09:00",
      "2030-06-08",
    ]);
    store.setPollMessage(date.id, TEXT, DATE_MESSAGE);
    store.setVotes(date.id, "u1", [date.options[1]?.id ?? 0]);
    store.setVotes(date.id, "u2", [date.options[1]?.id ?? 0]);
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
    message?: {
      flags?: number;
      content?: unknown;
      embeds?: unknown;
      components: APIMessageTopLevelComponent[];
      allowed_mentions?: unknown;
    };
    flags?: number;
    components: APIMessageTopLevelComponent[];
    allowed_mentions?: unknown;
  };
}

/**
 * Stubs Discord: the guild owner and webhooks answer; a thread answers
 * `thread()`; any other message gets id 1.
 */
function discord(guildId: string, thread: () => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith(`/guilds/${guildId}`)) {
      return Promise.resolve(Response.json({ id: guildId, owner_id: OWNER }));
    }
    if (request.url.endsWith("/threads")) return thread();
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

const created = () =>
  Promise.resolve(
    Response.json({ id: THREAD, parent_id: FORUM }, { status: 201 }),
  );
const forbidden = () =>
  Promise.resolve(
    Response.json(
      { message: "Missing Permissions", code: 50013 },
      { status: 403 },
    ),
  );

async function closeDateVote(guildId: string, view: PollView) {
  await runInDurableObject(stub(guildId), async (_i, state) => {
    await (
      await closePoll(
        click(POLL_IDS.closeConfirm(view.id)),
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

describe("closing the date vote", () => {
  it("creates the thread in the forum channel, then announces with its link, and stores the thread", async () => {
    const guild = "hike-thread-close";
    const view = await dateVoting(guild);
    const spy = discord(guild, created);
    await closeDateVote(guild, view);
    const requests = sent(spy);
    expect(requests.map((r) => r.route)).toEqual([
      `PATCH /channels/${TEXT}/messages/${DATE_MESSAGE}`,
      `POST /channels/${FORUM}/threads`,
      `POST /guilds/${GUILD}/scheduled-events`,
      `PATCH /channels/${THREAD}/messages/${THREAD}`,
      `POST /channels/${NEWS}/messages`,
      "PATCH /webhooks/100/interaction-token/messages/@original",
    ]);
    const [, thread, , , announcement, panel] = requests;
    expect(thread?.body.name).toBe("Lake Loop — Sat, 15 Jun 2030 · 09:00");
    expect(thread?.body.message?.flags).toBe(MessageFlags.IsComponentsV2);
    expect(thread?.body.message?.content).toBeUndefined();
    expect(thread?.body.message?.embeds).toBeUndefined();
    expect(thread?.body.message?.allowed_mentions).toEqual({ parse: [] });
    const body = text(thread?.body.message?.components ?? []);
    expect(body).toContain("## Lake Loop");
    expect(body).toContain(`Proposed by <@${PROPOSER}>`);
    expect(body).toContain("**When:** Sat, 15 Jun 2030 · 09:00");
    expect(body).toContain(
      "**Date vote:** **Sat, 15 Jun 2030 · 09:00** won with 2 votes; 2 members voted.",
    );
    expect(text(announcement?.body.components ?? []).split("\n")).toContain(
      `**Hike thread:** <#${THREAD}>`,
    );
    const shown = text(panel?.body.components ?? []);
    expect(shown).toContain(`**Hike thread:** <#${THREAD}>`);
    expect(ids(panel?.body.components ?? [])).not.toContain(
      HIKE_THREAD_IDS.create(1),
    );
    expect((await lastRound(guild))?.threadId).toBe(THREAD);
  });

  it("still announces without a link when Discord refuses the thread, and the panel offers the retry with the reason", async () => {
    const guild = "hike-thread-close-403";
    const view = await dateVoting(guild);
    const spy = discord(guild, forbidden);
    await closeDateVote(guild, view);
    const requests = sent(spy);
    expect(requests.map((r) => r.route)).toEqual([
      `PATCH /channels/${TEXT}/messages/${DATE_MESSAGE}`,
      `POST /channels/${FORUM}/threads`,
      `POST /guilds/${GUILD}/scheduled-events`,
      `POST /channels/${NEWS}/messages`,
      "PATCH /webhooks/100/interaction-token/messages/@original",
    ]);
    const [, , , announcement, panel] = requests;
    expect(text(announcement?.body.components ?? [])).not.toContain(
      "Hike thread",
    );
    expect(text(panel?.body.components ?? [])).toContain(
      `**Hike thread:** not created. Could not create the hike thread in <#${FORUM}>: Discord answered: Missing Permissions (HTTP 403, code 50013). Check that it is still a forum channel and that the bot can create posts in it, then click Create hike thread.`,
    );
    expect(ids(panel?.body.components ?? [])).toContain(
      HIKE_THREAD_IDS.create(1),
    );
    const last = await lastRound(guild);
    expect(last?.status).toBe("complete");
    expect(last?.threadId).toBeNull();
  });

  it("records a missing forum channel as the reason", async () => {
    const guild = "hike-thread-no-forum";
    const view = await dateVoting(guild);
    await runInDurableObject(stub(guild), (_i, state) => {
      new GuildConfig(state.storage).set("forumChannelId", null);
    });
    const spy = discord(guild, created);
    await closeDateVote(guild, view);
    const requests = sent(spy);
    expect(requests.map((r) => r.route)).not.toContain(
      `POST /channels/${FORUM}/threads`,
    );
    expect(text(requests.at(-1)?.body.components ?? [])).toContain(
      "**Hike thread:** not created. No hike threads channel is set.",
    );
  });

  it("creates no thread from the step when one exists", async () => {
    const guild = "hike-thread-step-exists";
    const view = await dateVoting(guild);
    const spy = discord(guild, created);
    await closeDateVote(guild, view);
    await runInDurableObject(stub(guild), async (_i, state) => {
      const store = new PollStore(state.storage);
      const result = await createHikeThreadStep.run(
        {
          poll: view,
          round: store.getLastRound(),
          guildId: GUILD,
          timeZone: "America/Los_Angeles",
        },
        { env, storage: state.storage },
      );
      expect(result).toEqual({});
    });
    expect(sent(spy).filter((r) => r.route.endsWith("/threads"))).toHaveLength(
      1,
    );
  });
});

describe("the thread's When line", () => {
  it("is timed in the zone the close step is given", async () => {
    const guild = "hike-thread-step-zone";
    const view = await dateVoting(guild);
    discord(guild, forbidden);
    await closeDateVote(guild, view);
    vi.restoreAllMocks();
    const spy = discord(guild, created);
    await runInDurableObject(stub(guild), async (_i, state) => {
      const store = new PollStore(state.storage);
      await createHikeThreadStep.run(
        {
          poll: view,
          round: store.getLastRound(),
          guildId: GUILD,
          timeZone: "Asia/Kolkata",
        },
        { env, storage: state.storage },
      );
    });
    const [thread] = sent(spy).filter((r) => r.route.endsWith("/threads"));
    // 09:00 in Kolkata on 15 June 2030 is 03:30 UTC.
    expect(text(thread?.body.message?.components ?? [])).toContain(
      "**When:** Sat, 15 Jun 2030 · 09:00 (<t:1907724600:R>)",
    );
  });

  it("is timed in the guild's zone at the time of a retry", async () => {
    const guild = "200000000000000309";
    const view = await dateVoting(guild);
    discord(guild, forbidden);
    await closeDateVote(guild, view);
    vi.restoreAllMocks();
    await runInDurableObject(stub(guild), (_i, state) => {
      new GuildConfig(state.storage).setTimezone("Europe/Berlin");
    });
    const spy = discord(guild, created);
    const ctx = createExecutionContext();
    await send(click(HIKE_THREAD_IDS.create(1), guild), ctx);
    await waitOnExecutionContext(ctx);
    const [thread] = sent(spy).filter((r) => r.route.endsWith("/threads"));
    // 09:00 in Berlin on 15 June 2030 is 07:00 UTC.
    expect(text(thread?.body.message?.components ?? [])).toContain(
      "**When:** Sat, 15 Jun 2030 · 09:00 (<t:1907737200:R>)",
    );
  });
});

describe("Create hike thread", () => {
  it("retries after a failure: stores the thread, posts no announcement, and the button is gone", async () => {
    const guild = "200000000000000301";
    const view = await dateVoting(guild);
    discord(guild, forbidden);
    await closeDateVote(guild, view);
    vi.restoreAllMocks();

    const spy = discord(guild, created);
    const ctx = createExecutionContext();
    const reply = await send(click(HIKE_THREAD_IDS.create(1), guild), ctx);
    expect(reply.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    await waitOnExecutionContext(ctx);
    const requests = sent(spy);
    expect(requests.map((r) => r.route)).toEqual([
      `POST /channels/${FORUM}/threads`,
      "PATCH /webhooks/100/interaction-token/messages/@original",
    ]);
    const panel = requests[1]?.body.components ?? [];
    expect(text(panel)).toContain(`The hike thread is open: <#${THREAD}>.`);
    expect(text(panel)).toContain(`**Hike thread:** <#${THREAD}>`);
    expect(ids(panel)).not.toContain(HIKE_THREAD_IDS.create(1));
    expect((await lastRound(guild))?.threadId).toBe(THREAD);

    // A click on an old panel creates nothing.
    const again = await send(click(HIKE_THREAD_IDS.create(1), guild));
    expect(again.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(again.data?.components ?? [])).toContain(
      `The hike thread already exists: <#${THREAD}>.`,
    );
    expect(sent(spy).filter((r) => r.route.endsWith("/threads"))).toHaveLength(
      1,
    );
  });

  it("creates one thread when the button is clicked twice quickly", async () => {
    const guild = "200000000000000302";
    const view = await dateVoting(guild);
    discord(guild, forbidden);
    await closeDateVote(guild, view);
    vi.restoreAllMocks();

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = discord(guild, () => held.then(created));
    const first = createExecutionContext();
    const one = await send(click(HIKE_THREAD_IDS.create(1), guild), first);
    const two = await send(click(HIKE_THREAD_IDS.create(1), guild));
    expect(one.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    expect(two.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(two.data?.components ?? [])).toContain(
      "The hike thread is being created.",
    );
    expect(text(two.data?.components ?? [])).toContain(
      "**Hike thread:** being created.",
    );
    expect(ids(two.data?.components ?? [])).not.toContain(
      HIKE_THREAD_IDS.create(1),
    );
    release();
    await waitOnExecutionContext(first);
    expect(sent(spy).filter((r) => r.route.endsWith("/threads"))).toHaveLength(
      1,
    );
    expect((await lastRound(guild))?.threadId).toBe(THREAD);
  });

  it("no longer applies once a new round has started", async () => {
    const guild = "200000000000000303";
    const view = await dateVoting(guild);
    discord(guild, forbidden);
    await closeDateVote(guild, view);
    await runInDurableObject(stub(guild), (_i, state) => {
      new PollStore(state.storage).startRound(OWNER, []);
    });
    vi.restoreAllMocks();
    const spy = discord(guild, created);
    const reply = await send(click(HIKE_THREAD_IDS.create(1), guild));
    expect(text(reply.data?.components ?? [])).toContain(
      "That hike is no longer the last one",
    );
    expect(ids(reply.data?.components ?? [])).not.toContain(
      HIKE_THREAD_IDS.create(1),
    );
    expect(sent(spy)).toEqual([]);
  });

  it("refuses a member who is not an admin", async () => {
    const guild = "200000000000000304";
    const view = await dateVoting(guild);
    discord(guild, forbidden);
    await closeDateVote(guild, view);
    vi.restoreAllMocks();
    const spy = discord(guild, created);
    const reply = await send(click(HIKE_THREAD_IDS.create(1), guild, STRANGER));
    expect(reply.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(sent(spy)).toEqual([]);
    expect((await lastRound(guild))?.threadId).toBeNull();
  });
});
