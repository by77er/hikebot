import {
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  ComponentType,
  InteractionResponseType,
  TextInputStyle,
  type APIMessageTopLevelComponent,
  type APIModalSubmitInteraction,
} from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  LOCATION_IDS,
  parseInitialLocations,
  renderSuggestAgain,
  restingRefusal,
} from "../../src/features/location-vote";
import { VOTE_CLOSED_MESSAGE } from "../../src/features/poll-ui";
import { GuildConfig } from "../../src/guild/config";
import {
  PollStore,
  type PastLocation,
  type RestingLocation,
} from "../../src/polls/store";
import {
  callWorker,
  componentInteraction,
  createSigner,
  modalInteraction,
  signedRequest,
  type Signer,
} from "../helpers";
import { playRound } from "../polls/helpers";

const OWNER = "400000000000000001";
const MEMBER = "400000000000000002";
const TEXT = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface Node {
  type: ComponentType;
  content?: string;
  custom_id?: string;
  label?: string;
  options?: { label: string; value: string; description?: string }[];
  components?: Node[];
  component?: Node;
}

function flatten(components: readonly Node[]): Node[] {
  return components.flatMap((c) => [
    c,
    ...flatten(c.components ?? []),
    ...flatten(c.component ? [c.component] : []),
  ]);
}

function text(components: readonly unknown[]): string {
  return flatten(components as Node[])
    .map((c) => c.content ?? "")
    .filter((c) => c !== "")
    .join("\n");
}

describe("parseInitialLocations", () => {
  it("trims lines, drops blank ones and collapses duplicates", () => {
    expect(
      parseInitialLocations(" Ridge Trail \r\n\n ridge  trail\nLake\n  \n"),
    ).toEqual({ ok: true, labels: ["Ridge Trail", "Lake"] });
    expect(parseInitialLocations("")).toEqual({ ok: true, labels: [] });
  });

  it("refuses a line over 80 characters, naming the line", () => {
    const result = parseInitialLocations(`Ridge\n${"x".repeat(81)}`);
    expect(result).toEqual({
      ok: false,
      error:
        "Line 2 is 81 characters long; a location can have at most 80. Shorten it and try again.",
    });
    expect(parseInitialLocations("x".repeat(80)).ok).toBe(true);
  });

  it("refuses more than 25 locations", () => {
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => `Place ${String(i)}`).join("\n");
    expect(parseInitialLocations(lines(25)).ok).toBe(true);
    expect(parseInitialLocations(lines(26))).toEqual({
      ok: false,
      error:
        "You listed 26 locations; a vote holds at most 25. Remove some and try again.",
    });
  });
});

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

async function configure(guildId: string, complete = true) {
  await runInDurableObject(stub(guildId), (_i, state) => {
    const config = new GuildConfig(state.storage);
    config.set("voteChannelId", TEXT);
    if (complete) {
      config.set("announceChannelId", NEWS);
      config.set("forumChannelId", FORUM);
    }
  });
}

/** Stubs Discord: the guild owner, then `channel` answers for messages. */
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

function startSubmit(
  guildId: string,
  initial: string,
  userId = OWNER,
): APIModalSubmitInteraction {
  const interaction = modalInteraction(LOCATION_IDS.start, guildId);
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
          custom_id: LOCATION_IDS.initial,
          value: initial,
        },
      },
    ],
  });
  return interaction;
}

function proposeSubmit(
  guildId: string,
  pollId: number,
  name: string,
  details = "",
): APIModalSubmitInteraction {
  const interaction = modalInteraction(LOCATION_IDS.propose(pollId), guildId);
  Object.assign(interaction, { member: { user: { id: MEMBER }, roles: [] } });
  Object.assign(interaction.data, {
    components: [
      [LOCATION_IDS.name, name],
      [LOCATION_IDS.details, details],
    ].map(([customId, value]) => ({
      type: ComponentType.Label,
      component: { type: ComponentType.TextInput, custom_id: customId, value },
    })),
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

describe("starting the location vote", () => {
  it("opens a modal with one optional paragraph for the initial locations", async () => {
    const guild = "200000000000000101";
    await configure(guild);
    discord(guild, () => Response.json({}));
    const click = componentInteraction(LOCATION_IDS.start, guild);
    Object.assign(click, { member: { user: { id: OWNER }, roles: [] } });
    const reply = await send(click);
    expect(reply.type).toBe(InteractionResponseType.Modal);
    expect(reply.data.custom_id).toBe(LOCATION_IDS.start);
    expect(reply.data.components).toEqual([
      expect.objectContaining({
        type: ComponentType.Label,
        label: "Initial locations (one per line)",
        component: expect.objectContaining({
          custom_id: LOCATION_IDS.initial,
          style: TextInputStyle.Paragraph,
          required: false,
        }) as unknown,
      }),
    ]);
  });

  it("names the missing settings instead of opening the modal", async () => {
    const guild = "200000000000000102";
    await configure(guild, false);
    discord(guild, () => Response.json({}));
    const click = componentInteraction(LOCATION_IDS.start, guild);
    Object.assign(click, { member: { user: { id: OWNER }, roles: [] } });
    const reply = await send(click);
    expect(reply.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(reply.data.components)).toContain(
      "Set the announcements channel and hike threads channel under Settings before starting a vote.",
    );
  });

  it("starts the round, posts the poll in the voting channel and stores its message id", async () => {
    const guild = "200000000000000103";
    await configure(guild);
    const fetchSpy = discord(guild, () =>
      Response.json({ id: "900000000000000001", channel_id: TEXT }),
    );
    const ctx = createExecutionContext();
    const reply = await send(startSubmit(guild, "Ridge\nLake"), ctx);
    expect(reply).toEqual({
      type: InteractionResponseType.DeferredMessageUpdate,
    });
    await waitOnExecutionContext(ctx);
    const post = fetchSpy.mock.calls
      .map(([input, init]) => new Request(input, init))
      .find((r) => r.method === "POST");
    expect(post?.url).toMatch(new RegExp(`/channels/${TEXT}/messages$`));
    const round = await activeRound(guild);
    expect(round?.status).toBe("location_voting");
    expect(round?.locationPoll).toMatchObject({
      channelId: TEXT,
      messageId: "900000000000000001",
    });
    expect(round?.locationPoll?.options.map((o) => o.label)).toEqual([
      "Ridge",
      "Lake",
    ]);
  });

  it("leaves no round active when Discord refuses the poll, and shows why", async () => {
    const guild = "200000000000000104";
    await configure(guild);
    const fetchSpy = discord(guild, () =>
      Response.json(
        { message: "Missing Access", code: 50001 },
        { status: 403 },
      ),
    );
    const ctx = createExecutionContext();
    await send(startSubmit(guild, "Ridge"), ctx);
    await waitOnExecutionContext(ctx);
    expect(await activeRound(guild)).toBeNull();
    const panel = fetchSpy.mock.calls.find(([input, init]) =>
      new Request(input, init).url.includes("/webhooks/"),
    );
    const raw = panel?.[1]?.body;
    const body = JSON.parse(typeof raw === "string" ? raw : "{}") as {
      components: unknown[];
    };
    expect(text(body.components)).toContain(
      `Could not post the location vote in <#${TEXT}>: Discord answered: Missing Access (HTTP 403, code 50001).`,
    );
  });

  it("refuses a line over 80 characters before starting anything", async () => {
    const guild = "200000000000000105";
    await configure(guild);
    discord(guild, () => Response.json({}));
    const reply = await send(startSubmit(guild, "x".repeat(81)));
    expect(reply.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(text(reply.data.components)).toContain("Line 1 is 81 characters");
    expect(await activeRound(guild)).toBeNull();
  });

  it("refuses a non-admin replaying the start modal", async () => {
    const guild = "200000000000000106";
    await configure(guild);
    discord(guild, () => Response.json({}));
    const reply = await send(startSubmit(guild, "Ridge", MEMBER));
    expect(text(reply.data.components)).toContain(
      "The hikebot admin panel is limited to the server owner",
    );
    expect(await activeRound(guild)).toBeNull();
  });
});

/**
 * Stubs Discord with the poll's post held until `release`, answered by
 * `post`; edits of channel messages succeed.
 */
function heldPost(guildId: string, post: () => Response) {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init) => {
      const request = new Request(input, init);
      if (request.url.endsWith(`/guilds/${guildId}`)) {
        return Promise.resolve(Response.json({ id: guildId, owner_id: OWNER }));
      }
      if (request.url.includes("/webhooks/") || request.method === "PATCH") {
        return Promise.resolve(Response.json({ id: "1", channel_id: TEXT }));
      }
      return held.then(post);
    });
  return { spy, release };
}

const POSTED = () =>
  Response.json({ id: "900000000000000002", channel_id: TEXT });
const REFUSED = () =>
  Response.json({ message: "Missing Access", code: 50001 }, { status: 403 });

type FetchSpy = ReturnType<typeof heldPost>["spy"];

function requests(spy: FetchSpy): { request: Request; body: string }[] {
  return spy.mock.calls.map(([input, init]) => {
    const raw = init?.body;
    return {
      request: new Request(input, init),
      body: typeof raw === "string" ? raw : "",
    };
  });
}

/** The text of the panel the follow-up drew last. */
function panelNote(spy: FetchSpy): string {
  const panel = requests(spy)
    .filter((r) => r.request.url.includes("/webhooks/"))
    .at(-1);
  const body = JSON.parse(panel?.body ?? "{}") as { components?: unknown[] };
  return text(body.components ?? []);
}

/**
 * Starts the vote with Ridge and Lake while the post is held, lets `race`
 * change the round through the store, then releases the post and waits for
 * the follow-up. Returns the round as it ends up.
 */
async function startRacing(
  guild: string,
  spyRelease: { release: () => void },
  race: (store: PollStore, pollId: number, roundId: number) => void,
) {
  const ctx = createExecutionContext();
  await send(startSubmit(guild, "Ridge\nLake"), ctx);
  const roundId = await runInDurableObject(stub(guild), (_i, state) => {
    const store = new PollStore(state.storage);
    const round = store.getActiveRound();
    race(store, round?.locationPoll?.id ?? 0, round?.id ?? 0);
    return round?.id ?? 0;
  });
  spyRelease.release();
  await waitOnExecutionContext(ctx);
  return runInDurableObject(stub(guild), (_i, state) =>
    new PollStore(state.storage).getRound(roundId),
  );
}

/** Another admin closes the vote with Ridge winning. */
function closeWithRidge(store: PollStore, pollId: number) {
  const ridge = store.getPoll(pollId)?.options[0]?.id ?? 0;
  store.setVotes(pollId, MEMBER, [ridge]);
  store.closePoll(pollId, MEMBER);
}

describe("starting the location vote while another admin acts", () => {
  it("takes the round back when the post fails and nothing raced", async () => {
    const guild = "location-race-none";
    await configure(guild);
    const held = heldPost(guild, REFUSED);
    const round = await startRacing(guild, held, () => undefined);
    expect(round).toMatchObject({ status: "cancelled", endedBy: OWNER });
    expect(panelNote(held.spy)).toContain(
      `Could not post the location vote in <#${TEXT}>: Discord answered: Missing Access (HTTP 403, code 50001). No round was started; check the bot's permissions in that channel and try again.`,
    );
  });

  it("says the round was already cancelled when the post fails after a cancel", async () => {
    const guild = "location-race-cancel-fail";
    await configure(guild);
    const held = heldPost(guild, REFUSED);
    const round = await startRacing(guild, held, (store, _pollId, roundId) => {
      store.cancelRound(roundId, MEMBER);
    });
    expect(round).toMatchObject({ status: "cancelled", endedBy: MEMBER });
    const note = panelNote(held.spy);
    expect(note).toContain(
      `Could not post the location vote in <#${TEXT}>: Discord answered: Missing Access (HTTP 403, code 50001). The round had already been cancelled, so there was nothing to take back.`,
    );
    expect(note).not.toContain("No round was started");
  });

  it("keeps the decided round when the post fails after a close", async () => {
    const guild = "location-race-close-fail";
    await configure(guild);
    const held = heldPost(guild, REFUSED);
    const round = await startRacing(guild, held, closeWithRidge);
    expect(round?.status).toBe("location_decided");
    expect(round?.locationOptionId).toBe(round?.locationPoll?.options[0]?.id);
    expect(round?.locationPoll?.options[0]?.label).toBe("Ridge");
    expect(panelNote(held.spy)).toContain(
      `Could not post the location vote in <#${TEXT}>: Discord answered: Missing Access (HTTP 403, code 50001). The vote had already been closed and **Ridge** won, so the round was kept.`,
    );
  });

  it.each([
    {
      what: "cancel",
      race: (store: PollStore, _pollId: number, roundId: number) => {
        store.cancelRound(roundId, MEMBER);
      },
      heading: "## Where should we hike? (cancelled)",
      note: `The location vote was posted in <#${TEXT}>, but the round had been cancelled meanwhile, so the message now shows it as cancelled.`,
    },
    {
      what: "close",
      race: closeWithRidge,
      heading: "## Where should we hike? (closed)",
      note: `The location vote was posted in <#${TEXT}>, but the vote had been closed meanwhile, so the message now shows it as closed.`,
    },
  ])(
    "edits the posted message to its final state after a $what",
    async ({ race, heading, note }) => {
      const guild = `location-race-${heading.includes("cancelled") ? "cancel" : "close"}-posted`;
      await configure(guild);
      const held = heldPost(guild, POSTED);
      const round = await startRacing(guild, held, race);
      expect(round?.locationPoll).toMatchObject({
        status: "closed",
        channelId: TEXT,
        messageId: "900000000000000002",
      });
      const edits = requests(held.spy).filter(
        (r) =>
          r.request.method === "PATCH" &&
          r.request.url.endsWith(
            `/channels/${TEXT}/messages/900000000000000002`,
          ),
      );
      expect(edits).toHaveLength(1);
      const edited = JSON.parse(edits[0]?.body ?? "{}") as {
        components: Node[];
      };
      expect(text(edited.components)).toContain(heading);
      expect(
        flatten(edited.components).filter((c) => c.custom_id !== undefined),
      ).toEqual([]);
      expect(panelNote(held.spy)).toContain(note);
    },
  );

  it("leaves the posted message alone when nothing raced", async () => {
    const guild = "location-race-none-posted";
    await configure(guild);
    const held = heldPost(guild, POSTED);
    const round = await startRacing(guild, held, () => undefined);
    expect(round?.status).toBe("location_voting");
    expect(
      requests(held.spy).filter(
        (r) =>
          r.request.method === "PATCH" && r.request.url.includes("/channels/"),
      ),
    ).toEqual([]);
    expect(panelNote(held.spy)).toContain(
      `The location vote is open in <#${TEXT}>.`,
    );
  });
});

describe("proposing a location", () => {
  async function openPoll(guild: string, labels: string[]) {
    return runInDurableObject(stub(guild), (_i, state) => {
      const round = new PollStore(state.storage).startRound(
        OWNER,
        labels.map((label) => ({ label, proposedBy: OWNER })),
      );
      return round.locationPoll?.id ?? 0;
    });
  }

  it("opens a modal with a name up to 80 characters and optional details up to 300", async () => {
    const guild = "location-propose-modal";
    const pollId = await openPoll(guild, []);
    const reply = await send(
      componentInteraction(LOCATION_IDS.propose(pollId), guild),
    );
    expect(reply.type).toBe(InteractionResponseType.Modal);
    expect(flatten(reply.data.components as Node[])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          custom_id: LOCATION_IDS.name,
          max_length: 80,
        }),
        expect.objectContaining({
          custom_id: LOCATION_IDS.details,
          max_length: 300,
          required: false,
        }),
      ]),
    );
  });

  it("adds the option, confirms, and schedules a refresh", async () => {
    const guild = "location-propose-ok";
    const pollId = await openPoll(guild, []);
    const reply = await send(
      proposeSubmit(guild, pollId, " Ridge Trail ", "https://example.com"),
    );
    expect(text(reply.data.components)).toContain(
      "Added **Ridge Trail** to the location vote.",
    );
    await runInDurableObject(stub(guild), async (_i, state) => {
      expect(new PollStore(state.storage).getPoll(pollId)?.options).toEqual([
        expect.objectContaining({
          label: "Ridge Trail",
          details: "https://example.com",
          proposedBy: MEMBER,
        }),
      ]);
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it("explains a duplicate, a full poll and a closed poll", async () => {
    const guild = "location-propose-refused";
    const pollId = await openPoll(
      guild,
      Array.from({ length: 24 }, (_, i) => `Place ${String(i)}`),
    );
    let reply = await send(proposeSubmit(guild, pollId, "place 3"));
    expect(text(reply.data.components)).toBe(
      "**place 3** is already on the list. Vote for it instead.",
    );
    await send(proposeSubmit(guild, pollId, "Place 24"));
    reply = await send(proposeSubmit(guild, pollId, "Place 25"));
    expect(text(reply.data.components)).toContain(
      "This vote already has 25 locations",
    );
    reply = await send(
      componentInteraction(LOCATION_IDS.propose(pollId), guild),
    );
    expect(text(reply.data.components)).toContain(
      "This vote already has 25 locations",
    );
    await runInDurableObject(stub(guild), (_i, state) => {
      new PollStore(state.storage).closePoll(pollId, OWNER);
    });
    reply = await send(proposeSubmit(guild, pollId, "Place 26"));
    expect(text(reply.data.components)).toBe(VOTE_CLOSED_MESSAGE);
    reply = await send(
      componentInteraction(LOCATION_IDS.propose(pollId), guild),
    );
    expect(text(reply.data.components)).toBe(VOTE_CLOSED_MESSAGE);
  });
});

function past(n: number, overrides: Partial<PastLocation> = {}): PastLocation {
  return {
    optionId: n,
    label: `Place ${String(n)}`,
    key: `place ${String(n)}`,
    details: null,
    proposedByViewer: false,
    lastProposedAt: 1_800_000_000_000 - n,
    timesHiked: 0,
    cooldownHikesLeft: 0,
    onPoll: false,
    place: null,
    ...overrides,
  };
}

function selectOf(components: readonly unknown[]): Node | undefined {
  return flatten(components as Node[]).find(
    (c) => c.type === ComponentType.StringSelect,
  );
}

function customIds(components: readonly unknown[]): string[] {
  return flatten(components as Node[]).flatMap((c) =>
    c.custom_id === undefined ? [] : [c.custom_id],
  );
}

describe("renderSuggestAgain", () => {
  it("offers only New location when there is nothing to suggest again", () => {
    const components = renderSuggestAgain(7, []);
    expect(selectOf(components)).toBeUndefined();
    expect(customIds(components)).toEqual([LOCATION_IDS.newLocation(7)]);
    expect(LOCATION_IDS.newLocation(7)).toBe("hb:location:new:7");
  });

  it("lists one past location with its details cut to 100 characters", () => {
    const details = "d".repeat(150);
    const components = renderSuggestAgain(7, [past(1, { details })]);
    const select = selectOf(components);
    expect(select?.custom_id).toBe("hb:location:again:7");
    expect(select?.options).toEqual([
      { label: "Place 1", value: "1", description: `${"d".repeat(99)}…` },
    ]);
    expect(customIds(components)).toEqual([
      "hb:location:again:7",
      "hb:location:new:7",
    ]);
    expect(text(components)).not.toContain("Resting");
  });

  it("holds 25 past locations, and the first 25 of 30 in order", () => {
    const list = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        past(i + 1, { label: `${String(i + 1)} ${"x".repeat(76)}` }),
      );
    expect(selectOf(renderSuggestAgain(7, list(25)))?.options).toHaveLength(25);
    const options = selectOf(renderSuggestAgain(7, list(30)))?.options ?? [];
    expect(options.map((o) => o.value)).toEqual(
      Array.from({ length: 25 }, (_, i) => String(i + 1)),
    );
  });

  it("names resting locations with their hikes left and never offers them or the poll's own", () => {
    const components = renderSuggestAgain(7, [
      past(1, { label: "Eagle Peak", cooldownHikesLeft: 2 }),
      past(2, { label: "On the poll", onPoll: true }),
      past(3, { label: "Lake", cooldownHikesLeft: 1 }),
      past(4, { label: "Ridge" }),
    ]);
    expect(selectOf(components)?.options?.map((o) => o.label)).toEqual([
      "Ridge",
    ]);
    expect(text(components)).toContain(
      "Resting: **Eagle Peak** (2 more hikes), **Lake** (1 more hike)",
    );
  });
});

describe("restingRefusal", () => {
  const resting: RestingLocation[] = [
    {
      label: "Eagle Peak",
      key: "eagle peak",
      hikedOn: "Sat, 5 Dec 2026 · 11:00",
      hikesLeft: 2,
    },
    {
      label: "Lake",
      key: "lake",
      hikedOn: "Sat, 9 Jan 2027 · 11:00",
      hikesLeft: 1,
    },
  ];

  it("names each resting line, compared as labelKey does", () => {
    expect(restingRefusal(["Ridge", " eagle  PEAK", "lake"], resting)).toBe(
      [
        "Nothing was started. Remove these locations and try again:",
        "- **Eagle Peak** was the hike on Sat, 5 Dec 2026 · 11:00. It can be suggested again after 2 more hikes.",
        "- **Lake** was the hike on Sat, 9 Jan 2027 · 11:00. It can be suggested again after 1 more hike.",
      ].join("\n"),
    );
    expect(restingRefusal(["Lake"], resting)).toContain(
      "Remove this location and try again:",
    );
    expect(restingRefusal(["Ridge"], resting)).toBeNull();
  });
});

describe("suggesting a past location again", () => {
  /**
   * A guild whose first round completed with Ridge as the hike (Lake lost,
   * with details), and whose second round's location vote is open.
   */
  async function secondRound(guild: string, initial: string[] = []) {
    return runInDurableObject(stub(guild), (_i, state) => {
      const store = new PollStore(state.storage);
      playRound(
        store,
        [
          { label: "Ridge", proposedBy: OWNER },
          {
            label: "Lake",
            details: "https://example.com/lake",
            proposedBy: OWNER,
          },
        ],
        "Ridge",
        "2026-12-05",
      );
      const lake = store
        .listPastLocations(MEMBER, 0)
        .find((p) => p.label === "Lake");
      const round = store.startRound(
        OWNER,
        initial.map((label) => ({ label, proposedBy: OWNER })),
      );
      return {
        pollId: round.locationPoll?.id ?? 0,
        lakeId: lake?.optionId ?? 0,
      };
    });
  }

  function click(customId: string, guild: string) {
    const interaction = componentInteraction(customId, guild);
    Object.assign(interaction, { member: { user: { id: MEMBER }, roles: [] } });
    return interaction;
  }

  function pick(guild: string, pollId: number, optionId: number) {
    const interaction = click(LOCATION_IDS.again(pollId), guild);
    Object.assign(interaction.data, {
      component_type: ComponentType.StringSelect,
      values: [String(optionId)],
    });
    return interaction;
  }

  it("offers the past locations that are neither on the poll nor resting, with New location", async () => {
    const guild = "location-again-offer";
    const { pollId, lakeId } = await secondRound(guild);
    const reply = await send(click(LOCATION_IDS.propose(pollId), guild));
    expect(reply.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(reply.data).toMatchObject({ flags: 32768 | 64 });
    expect(selectOf(reply.data.components)).toMatchObject({
      custom_id: `hb:location:again:${String(pollId)}`,
      placeholder: "Suggest one again",
      options: [
        {
          label: "Lake",
          value: String(lakeId),
          description: "https://example.com/lake",
        },
      ],
    });
    expect(customIds(reply.data.components)).toContain(
      `hb:location:new:${String(pollId)}`,
    );
    expect(text(reply.data.components)).toContain(
      "Resting: **Ridge** (2 more hikes)",
    );

    const form = await send(click(LOCATION_IDS.newLocation(pollId), guild));
    expect(form.type).toBe(InteractionResponseType.Modal);
    expect(form.data.custom_id).toBe(LOCATION_IDS.propose(pollId));
  });

  it("opens the modal directly when every past location is on the poll or resting", async () => {
    const guild = "location-again-none";
    const { pollId } = await secondRound(guild, ["Lake"]);
    const reply = await send(click(LOCATION_IDS.propose(pollId), guild));
    expect(reply.type).toBe(InteractionResponseType.Modal);
    expect(reply.data.custom_id).toBe(LOCATION_IDS.propose(pollId));
  });

  it("adds the pick with its saved details and the member as proposer, and schedules a refresh", async () => {
    const guild = "location-again-pick";
    const { pollId, lakeId } = await secondRound(guild);
    const reply = await send(pick(guild, pollId, lakeId));
    expect(reply.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(reply.data.components)).toContain(
      "Added **Lake** to the location vote. Use **Vote** to vote for it.",
    );
    expect(selectOf(reply.data.components)).toBeUndefined();
    await runInDurableObject(stub(guild), async (_i, state) => {
      expect(new PollStore(state.storage).getPoll(pollId)?.options).toEqual([
        expect.objectContaining({
          label: "Lake",
          details: "https://example.com/lake",
          proposedBy: MEMBER,
        }),
      ]);
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it("answers a stale pick as a typed proposal is answered, and adds nothing", async () => {
    const guild = "location-again-stale";
    const { pollId, lakeId } = await secondRound(
      guild,
      Array.from({ length: 24 }, (_, i) => `Place ${String(i)}`),
    );
    await send(pick(guild, pollId, lakeId));
    let reply = await send(pick(guild, pollId, lakeId));
    expect(text(reply.data.components)).toBe(
      "This vote already has 25 locations, the most it can hold. Vote for one of them instead.",
    );

    const other = "location-again-duplicate";
    const second = await secondRound(other, ["lake"]);
    reply = await send(pick(other, second.pollId, second.lakeId));
    expect(text(reply.data.components)).toContain(
      "**Lake** is already on the list. Vote for it instead.",
    );

    await runInDurableObject(stub(other), (_i, state) => {
      new PollStore(state.storage).closePoll(second.pollId, OWNER);
    });
    reply = await send(pick(other, second.pollId, second.lakeId));
    expect(reply.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(reply.data.components)).toBe(VOTE_CLOSED_MESSAGE);
    await runInDurableObject(stub(other), (_i, state) => {
      expect(
        new PollStore(state.storage).getPoll(second.pollId)?.options,
      ).toHaveLength(1);
    });

    reply = await send(pick(other, second.pollId, 9999));
    expect(text(reply.data.components)).toContain("no longer available");
  });

  it("refuses a resting location typed in the propose modal", async () => {
    const guild = "location-again-typed";
    const { pollId } = await secondRound(guild);
    const reply = await send(proposeSubmit(guild, pollId, "ridge"));
    expect(text(reply.data.components)).toBe(
      "**Ridge** was the hike on Sat, 5 Dec 2026 · 11:00. It can be suggested again after 2 more hikes.",
    );
  });

  it("refuses an initial list holding a resting location and starts nothing", async () => {
    const guild = "200000000000000107";
    await configure(guild);
    await runInDurableObject(stub(guild), (_i, state) => {
      playRound(
        new PollStore(state.storage),
        [{ label: "Ridge", proposedBy: OWNER }],
        "Ridge",
        "2026-12-05",
      );
    });
    discord(guild, () => Response.json({}));
    const reply = await send(startSubmit(guild, "Lake\nRIDGE"));
    expect(reply.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(text(reply.data.components)).toBe(
      "Nothing was started. Remove this location and try again:\n- **Ridge** was the hike on Sat, 5 Dec 2026 · 11:00. It can be suggested again after 2 more hikes.",
    );
    expect(await activeRound(guild)).toBeNull();
  });
});
