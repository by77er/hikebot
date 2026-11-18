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
} from "../../src/features/location-vote";
import { VOTE_CLOSED_MESSAGE } from "../../src/features/poll-ui";
import { GuildConfig } from "../../src/guild/config";
import { PollStore } from "../../src/polls/store";
import {
  callWorker,
  componentInteraction,
  createSigner,
  modalInteraction,
  signedRequest,
  type Signer,
} from "../helpers";

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
  type: number;
  content?: string;
  custom_id?: string;
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
