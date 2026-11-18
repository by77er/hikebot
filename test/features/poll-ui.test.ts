import {
  createExecutionContext,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  ComponentType,
  InteractionResponseType,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LOCATION_POLL } from "../../src/features/location-vote";
import {
  MAX_MESSAGE_COMPONENTS,
  MAX_MESSAGE_TEXT,
  POLL_IDS,
  REFRESH_DELAY_MS,
  VOTE_CLOSED_MESSAGE,
  closePoll,
  renderAnnouncement,
  renderPollMessage,
  renderVoteSelect,
  scheduleRefresh,
  shortenAll,
} from "../../src/features/poll-ui";
import { GuildConfig } from "../../src/guild/config";
import { PollStore, type PollView } from "../../src/polls/store";
import {
  callWorker,
  componentInteraction,
  createSigner,
  signedRequest,
  type Signer,
} from "../helpers";
import { clock, sequence } from "../polls/helpers";

const OWNER = "400000000000000001";
const TEXT = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";
const POLL_MESSAGE = "700000000000000001";

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

function nodes(components: APIMessageTopLevelComponent[]): Node[] {
  return components;
}

function text(components: APIMessageTopLevelComponent[]): string {
  return flatten(nodes(components))
    .map((c) => c.content ?? "")
    .filter((c) => c !== "")
    .join("\n");
}

function textLength(components: APIMessageTopLevelComponent[]): number {
  return flatten(nodes(components)).reduce(
    (sum, c) => sum + (c.content?.length ?? 0),
    0,
  );
}

function ids(components: APIMessageTopLevelComponent[]): string[] {
  return flatten(nodes(components)).flatMap((c) =>
    c.custom_id === undefined ? [] : [c.custom_id],
  );
}

function expectWithinLimits(components: APIMessageTopLevelComponent[]) {
  expect(flatten(nodes(components)).length).toBeLessThanOrEqual(
    MAX_MESSAGE_COMPONENTS,
  );
  expect(textLength(components)).toBeLessThanOrEqual(MAX_MESSAGE_TEXT);
}

function option(id: number, label: string, votes: number, details?: string) {
  return {
    id,
    pollId: 1,
    label,
    details: details ?? null,
    dateValue: null,
    proposedBy: `4000000000000000${String(id).padStart(2, "0")}`,
    createdAt: 0,
    place: null,
    votes,
  };
}

function poll(overrides: Partial<PollView> = {}): PollView {
  return {
    id: 1,
    roundId: 1,
    kind: "location",
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
    options: [],
    voterCount: 0,
    viewerVotes: [],
    ...overrides,
  };
}

/** 25 options at the longest label and details, with 20-digit proposers. */
function fullPoll(overrides: Partial<PollView> = {}): PollView {
  return poll({
    options: Array.from({ length: 25 }, (_, i) => ({
      ...option(i + 1, `${String(i).padStart(2, "0")}${"L".repeat(78)}`, 999),
      details: "D".repeat(300),
      proposedBy: `1${String(i).padStart(19, "9")}`,
    })),
    voterCount: 99_999,
    ...overrides,
  });
}

describe("renderPollMessage", () => {
  it("says there are no locations yet and offers Vote and Propose a location", () => {
    const view = renderPollMessage(poll(), LOCATION_POLL);
    expect(text(view)).toContain("## Where should we hike?");
    expect(text(view)).toContain(LOCATION_POLL.instructions);
    expect(text(view)).toContain("No locations yet.");
    expect(text(view)).toContain("No one has voted yet.");
    expect(ids(view)).toEqual([POLL_IDS.vote(1), "hb:location:propose:1"]);
    expectWithinLimits(view);
  });

  it("lists the options by votes, ties in proposal order, with details and proposer", () => {
    const view = renderPollMessage(
      poll({
        options: [
          option(1, "Ridge", 1),
          option(2, "Lake", 3, "Loop, 8 km"),
          option(3, "Canyon", 1),
        ],
        voterCount: 3,
      }),
      LOCATION_POLL,
    );
    const shown = text(view);
    expect(shown.indexOf("**Lake** · 3 votes")).toBeGreaterThan(-1);
    expect(shown.indexOf("**Lake**")).toBeLessThan(shown.indexOf("**Ridge**"));
    expect(shown.indexOf("**Ridge** · 1 vote")).toBeLessThan(
      shown.indexOf("**Canyon** · 1 vote"),
    );
    expect(shown).toContain("Loop, 8 km");
    expect(shown).toContain("Proposed by <@400000000000000002>");
    expect(shown).toContain("3 members have voted.");
    expectWithinLimits(view);
  });

  it("stays within Discord's limits with 25 options at full length, open and closed", () => {
    const open = renderPollMessage(fullPoll(), LOCATION_POLL);
    expectWithinLimits(open);
    expect(text(open)).toContain("…");
    expect(text(open)).toContain(`**00${"L".repeat(78)}** · 999 votes`);
    expect(text(open).match(/Proposed by <@1\d{19}>/g)).toHaveLength(25);

    const closed = renderPollMessage(
      fullPoll({
        status: "closed",
        winnerOptionId: 7,
        tieBroken: true,
        tiedOptionIds: Array.from({ length: 25 }, (_, i) => i + 1),
      }),
      LOCATION_POLL,
    );
    expectWithinLimits(closed);
    expect(text(closed)).toContain(
      "25 options tied with 999 votes each; the winner was drawn at random.",
    );
  });

  it("marks the winner and drops the buttons once closed", () => {
    const view = renderPollMessage(
      poll({
        status: "closed",
        options: [option(1, "Ridge", 2), option(2, "Lake", 1)],
        winnerOptionId: 1,
        voterCount: 2,
      }),
      LOCATION_POLL,
    );
    expect(text(view)).toContain("## Where should we hike? (closed)");
    expect(text(view)).toContain("🏆 **Ridge** won with 2 votes.");
    expect(text(view)).toContain("🏆 **Ridge** · 2 votes · winner");
    expect(text(view)).not.toContain("drawn at random");
    expect(ids(view)).toEqual([]);
  });

  it("says a cancelled vote was cancelled, without buttons", () => {
    const view = renderPollMessage(
      poll({ status: "closed", options: [option(1, "Ridge", 0)] }),
      LOCATION_POLL,
    );
    expect(text(view)).toContain("(cancelled)");
    expect(text(view)).toContain("This vote was cancelled.");
    expect(ids(view)).toEqual([]);
  });
});

describe("shortenAll", () => {
  it("keeps texts that fit and cuts the longest ones evenly with an ellipsis", () => {
    expect(shortenAll(["abc", "de"], 10)).toEqual(["abc", "de"]);
    const cut = shortenAll(["a".repeat(100), "b".repeat(100), "c"], 41);
    expect(cut[2]).toBe("c");
    expect(cut[0]).toBe(`${"a".repeat(19)}…`);
    expect(cut.join("").length).toBeLessThanOrEqual(41);
  });

  it("drops every text when there is no room", () => {
    expect(shortenAll(["abc", "de"], 0)).toEqual(["", ""]);
  });
});

describe("renderVoteSelect", () => {
  it("offers every option, from none up to all, preselected with the member's votes", () => {
    const view = renderVoteSelect(
      poll({
        options: [
          option(1, "Ridge", 1),
          option(2, "Lake", 0, "x".repeat(300)),
          option(3, "Canyon", 1),
        ],
        viewerVotes: [1, 3],
      }),
      LOCATION_POLL,
    );
    const select = flatten(nodes(view)).find(
      (c) => c.type === (ComponentType.StringSelect as number),
    ) as unknown as {
      custom_id: string;
      min_values: number;
      max_values: number;
      options: { value: string; default: boolean; description?: string }[];
    };
    expect(select.custom_id).toBe(POLL_IDS.choose(1));
    expect(select.min_values).toBe(0);
    expect(select.max_values).toBe(3);
    expect(select.options.map((o) => [o.value, o.default])).toEqual([
      ["1", true],
      ["2", false],
      ["3", true],
    ]);
    expect(select.options[1]?.description?.length).toBe(100);
  });
});

describe("renderAnnouncement", () => {
  it("names the winner, its votes, the tie and links the poll message", () => {
    const view = renderAnnouncement(
      {
        poll: poll({
          status: "closed",
          options: [option(1, "Ridge", 2, "Trail link"), option(2, "Lake", 2)],
          winnerOptionId: 2,
          tieBroken: true,
          tiedOptionIds: [1, 2],
        }),
        round: null,
        guildId: "200000000000000001",
        timeZone: "America/Los_Angeles",
      },
      LOCATION_POLL,
    );
    const shown = text(view);
    expect(shown).toContain("## Hike location decided");
    expect(shown).toContain("**Lake** won the location vote with 2 votes.");
    expect(shown).toContain("2 options tied with 2 votes each");
    expect(shown).toContain(
      `https://discord.com/channels/200000000000000001/${TEXT}/${POLL_MESSAGE}`,
    );
    expect(shown).not.toContain("<@");
  });
});

// Through the guild object.

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

/** A guild with its channels set and an open location poll on a posted message. */
async function openPoll(guildId: string, labels: string[]): Promise<PollView> {
  return runInDurableObject(stub(guildId), (_instance, state) => {
    const config = new GuildConfig(state.storage);
    config.set("voteChannelId", TEXT);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
    const store = new PollStore(state.storage);
    const round = store.startRound(
      OWNER,
      labels.map((label) => ({ label, proposedBy: OWNER })),
    );
    const id = round.locationPoll?.id ?? 0;
    store.setPollMessage(id, TEXT, POLL_MESSAGE);
    return store.getPoll(id) as PollView;
  });
}

function choose(
  guildId: string,
  view: PollView,
  userId: string,
  values: string[],
  listed = view.options.map((o) => String(o.id)),
): APIMessageComponentInteraction {
  const interaction = componentInteraction(POLL_IDS.choose(view.id), guildId);
  Object.assign(interaction, {
    member: { user: { id: userId }, roles: [] },
    message: {
      id: "800000000000000001",
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.StringSelect,
              custom_id: POLL_IDS.choose(view.id),
              options: listed.map((value) => ({ label: value, value })),
            },
          ],
        },
      ],
    },
  });
  Object.assign(interaction.data, {
    component_type: ComponentType.StringSelect,
    values,
  });
  return interaction;
}

async function send(interaction: unknown) {
  const response = await callWorker(
    signer,
    await signedRequest(signer, interaction),
  );
  expect(response.status).toBe(200);
  return response.json<{
    type: InteractionResponseType;
    data: { components: APIMessageTopLevelComponent[] };
  }>();
}

interface Sent {
  method: string;
  url: string;
  body: string;
}

function requests(spy: {
  mock: { calls: Parameters<typeof fetch>[] };
}): Sent[] {
  return spy.mock.calls.map(([input, init]) => {
    const request = new Request(input, init);
    return {
      method: request.method,
      url: request.url,
      body: typeof init?.body === "string" ? init.body : "",
    };
  });
}

function bodyOf(sent: Sent | undefined): {
  components: APIMessageTopLevelComponent[];
  allowed_mentions?: unknown;
} {
  return JSON.parse(sent?.body ?? "{}") as {
    components: APIMessageTopLevelComponent[];
    allowed_mentions?: unknown;
  };
}

describe("voting", () => {
  it("replaces a member's votes, keeps votes for options the select did not list, and clears on an empty pick", async () => {
    const guild = "poll-ui-votes";
    const view = await openPoll(guild, ["Ridge", "Lake", "Canyon"]);
    const [ridge, lake, canyon] = view.options.map((o) => String(o.id));
    const user = "400000000000000011";
    let reply = await send(
      choose(guild, view, user, [ridge ?? "", lake ?? ""]),
    );
    expect(reply.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(reply.data.components)).toContain(
      "Your votes are saved: **Ridge**, **Lake**.",
    );
    // A select shown before Canyon existed lists only Ridge and Lake.
    reply = await send(
      choose(guild, view, user, [canyon ?? ""], [canyon ?? ""]),
    );
    expect(text(reply.data.components)).toContain(
      "**Ridge**, **Lake**, **Canyon**",
    );
    reply = await send(
      choose(guild, view, user, [], [ridge ?? "", lake ?? ""]),
    );
    expect(text(reply.data.components)).toContain(
      "Your votes are saved: **Canyon**.",
    );
    reply = await send(choose(guild, view, user, []));
    expect(text(reply.data.components)).toContain("Your votes are cleared.");
  });

  it("answers a stale select after the close with: This vote has closed.", async () => {
    const guild = "poll-ui-stale";
    const view = await openPoll(guild, ["Ridge"]);
    await runInDurableObject(stub(guild), (_instance, state) => {
      new PollStore(state.storage).closePoll(view.id, OWNER);
    });
    const reply = await send(
      choose(guild, view, "400000000000000011", [String(view.options[0]?.id)]),
    );
    expect(reply.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(reply.data.components)).toBe(VOTE_CLOSED_MESSAGE);
  });
});

describe("the debounced refresh", () => {
  it("edits the poll message once for several votes, when the alarm runs", async () => {
    const guild = "poll-ui-debounce";
    const view = await openPoll(guild, ["Ridge", "Lake"]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(Response.json({ id: POLL_MESSAGE })),
      );
    for (const user of ["11", "12", "13", "14"]) {
      await send(
        choose(guild, view, `4000000000000000${user}`, [
          String(view.options[0]?.id),
        ]),
      );
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    const alarm = await runInDurableObject(stub(guild), (_i, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).not.toBeNull();

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    const sent = requests(fetchSpy);
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `PATCH /api/v10/channels/${TEXT}/messages/${POLL_MESSAGE}`,
    ]);
    const body = bodyOf(sent[0]);
    expect(text(body.components)).toContain("4 members have voted.");
    expect(await runDurableObjectAlarm(stub(guild))).toBe(false);
  });

  it("gives a vote that arrives during a refresh a refresh of its own", async () => {
    const guild = "poll-ui-refresh-during-run";
    const view = await openPoll(guild, ["Ridge", "Lake"]);
    let editingStarted = () => {};
    const editing = new Promise<void>((resolve) => {
      editingStarted = resolve;
    });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => {
        editingStarted();
        await held;
        return Response.json({ id: POLL_MESSAGE });
      })
      .mockImplementation(() =>
        Promise.resolve(Response.json({ id: POLL_MESSAGE })),
      );
    const vote = (user: string) =>
      send(choose(guild, view, user, [String(view.options[0]?.id)]));
    await vote("400000000000000011");

    const firstRun = runDurableObjectAlarm(stub(guild));
    await editing;
    await vote("400000000000000012");
    release();
    expect(await firstRun).toBe(true);
    expect(requests(fetchSpy)).toHaveLength(1);
    expect(text(bodyOf(requests(fetchSpy)[0]).components)).toContain(
      "1 member has voted.",
    );

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    const sent = requests(fetchSpy);
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `PATCH /api/v10/channels/${TEXT}/messages/${POLL_MESSAGE}`,
      `PATCH /api/v10/channels/${TEXT}/messages/${POLL_MESSAGE}`,
    ]);
    expect(text(bodyOf(sent[1]).components)).toContain("2 members have voted.");
    expect(await runDurableObjectAlarm(stub(guild))).toBe(false);
  });

  it("sets the alarm about two seconds after the change", async () => {
    const guild = "poll-ui-alarm-time";
    const view = await openPoll(guild, ["Ridge"]);
    const at = await runInDurableObject(stub(guild), async (_i, state) => {
      const store = new PollStore(state.storage, {
        now: clock(1_900_000_000_000, 0),
      });
      store.setVotes(view.id, "u1", [view.options[0]?.id ?? 0]);
      await scheduleRefresh(state.storage, view.id, store.now());
      return state.storage.getAlarm();
    });
    expect(at).toBe(1_900_000_000_000 + REFRESH_DELAY_MS);
  });

  it("logs a failed refresh and keeps voting working", async () => {
    const guild = "poll-ui-refresh-fails";
    const view = await openPoll(guild, ["Ridge"]);
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        Response.json(
          { message: "Missing Access", code: 50001 },
          { status: 403 },
        ),
      ),
    );
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const vote = (user: string) =>
      send(choose(guild, view, user, [String(view.options[0]?.id)]));
    expect((await vote("400000000000000011")).type).toBe(
      InteractionResponseType.UpdateMessage,
    );
    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining(
        "Discord answered: Missing Access (HTTP 403, code 50001)",
      ),
    );
    expect((await vote("400000000000000012")).type).toBe(
      InteractionResponseType.UpdateMessage,
    );
  });
});

describe("closePoll", () => {
  function closeClick(view: PollView): APIMessageComponentInteraction {
    const interaction = componentInteraction(
      POLL_IDS.closeConfirm(view.id),
      "unused",
    );
    Object.assign(interaction, {
      guild_id: "200000000000000001",
      member: { user: { id: OWNER }, roles: [] },
      message: { id: "800000000000000009", components: [] },
    });
    return interaction;
  }

  /** Votes for options 1 and 2 once each, so they tie. */
  async function tiedPoll(guild: string): Promise<PollView> {
    const view = await openPoll(guild, ["Ridge", "Lake", "Canyon"]);
    await runInDurableObject(stub(guild), (_i, state) => {
      const store = new PollStore(state.storage);
      store.setVotes(view.id, "u1", [view.options[0]?.id ?? 0]);
      store.setVotes(view.id, "u2", [view.options[1]?.id ?? 0]);
    });
    return view;
  }

  it("draws the winner of a tie from the injected source, then edits, announces and redraws", async () => {
    const guild = "poll-ui-close-tie";
    const view = await tiedPoll(guild);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(Response.json({ id: "1" })));
    await runInDurableObject(stub(guild), async (_i, state) => {
      const store = new PollStore(state.storage, { random: sequence(1) });
      const result = await closePoll(
        closeClick(view),
        { env, storage: state.storage },
        { location: LOCATION_POLL },
        store,
      );
      expect(result.response).toEqual({
        type: InteractionResponseType.DeferredMessageUpdate,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(store.getPoll(view.id)?.winnerOptionId).toBe(view.options[1]?.id);
      await result.followUp?.();
    });
    const sent = requests(fetchSpy);
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `PATCH /api/v10/channels/${TEXT}/messages/${POLL_MESSAGE}`,
      `POST /api/v10/channels/${NEWS}/messages`,
      "PATCH /api/v10/webhooks/100/interaction-token/messages/@original",
    ]);
    const bodies = sent.map(bodyOf);
    expect(text(bodies[0]?.components ?? [])).toContain(
      "🏆 **Lake** won with 1 vote.",
    );
    expect(ids(bodies[0]?.components ?? [])).toEqual([]);
    expect(text(bodies[1]?.components ?? [])).toContain(
      "2 options tied with 1 vote each; the winner was drawn at random.",
    );
    expect(text(bodies[2]?.components ?? [])).toContain(
      "**Location decided:** Lake (1 vote), drawn at random from a tie.",
    );
    for (const body of bodies) {
      expect(body.allowed_mentions).toEqual({ parse: [] });
    }
  });

  it("keeps the result and names each step Discord refused", async () => {
    const guild = "poll-ui-close-fails";
    const view = await tiedPoll(guild);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const request = new Request(input, init);
        return Promise.resolve(
          request.url.includes("/webhooks/")
            ? Response.json({ id: "1" })
            : Response.json(
                { message: "Missing Permissions", code: 50013 },
                { status: 403 },
              ),
        );
      });
    await runInDurableObject(stub(guild), async (_i, state) => {
      const result = await closePoll(
        closeClick(view),
        { env, storage: state.storage },
        { location: LOCATION_POLL },
        new PollStore(state.storage, { random: sequence(0) }),
      );
      await result.followUp?.();
      expect(new PollStore(state.storage).getActiveRound()?.status).toBe(
        "location_decided",
      );
    });
    const panel = requests(fetchSpy).at(-1);
    const shown = text(bodyOf(panel).components);
    expect(shown).toContain(
      `Could not update the poll message in <#${TEXT}>: Discord answered: Missing Permissions (HTTP 403, code 50013).`,
    );
    expect(shown).toContain(
      `Could not post the announcement in <#${NEWS}>: Discord answered: Missing Permissions (HTTP 403, code 50013).`,
    );
    expect(shown).toContain("**Location decided:** Ridge (1 vote)");
  });

  it("refuses to close a poll without options", async () => {
    const guild = "poll-ui-close-empty";
    const view = await openPoll(guild, []);
    await runInDurableObject(stub(guild), async (_i, state) => {
      const result = await closePoll(
        closeClick(view),
        { env, storage: state.storage },
        { location: LOCATION_POLL },
      );
      expect(result.followUp).toBeUndefined();
      expect(
        text(
          (
            result.response as {
              data: { components: APIMessageTopLevelComponent[] };
            }
          ).data.components,
        ),
      ).toContain(
        "The location vote has no locations yet, so it cannot be closed.",
      );
      expect(new PollStore(state.storage).getPoll(view.id)?.status).toBe(
        "open",
      );
    });
  });
});

describe("cancel round", () => {
  it("rewrites the open poll as cancelled and names a refused edit", async () => {
    const guild = "200000000000000077";
    const view = await openPoll(guild, ["Ridge"]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith(`/guilds/${guild}`)) {
          return Promise.resolve(Response.json({ id: guild, owner_id: OWNER }));
        }
        return Promise.resolve(
          request.url.includes("/webhooks/")
            ? Response.json({ id: "1" })
            : Response.json(
                { message: "Unknown Message", code: 10008 },
                { status: 404 },
              ),
        );
      });
    const interaction = componentInteraction(
      POLL_IDS.cancelConfirm(view.roundId),
      guild,
    );
    Object.assign(interaction, {
      member: { user: { id: OWNER }, roles: [] },
      message: { id: "800000000000000009", components: [] },
    });
    const ctx = createExecutionContext();
    const response = await callWorker(
      signer,
      await signedRequest(signer, interaction),
      ctx,
    );
    expect(await response.json()).toEqual({
      type: InteractionResponseType.DeferredMessageUpdate,
    });
    await waitOnExecutionContext(ctx);
    const sent = requests(fetchSpy).filter((r) => r.method === "PATCH");
    const edit = bodyOf(sent[0]);
    expect(text(edit.components)).toContain("This vote was cancelled.");
    expect(ids(edit.components)).toEqual([]);
    const panel = bodyOf(sent[1]);
    expect(text(panel.components)).toContain(
      `Could not mark the poll message in <#${TEXT}> as cancelled: Discord answered: Unknown Message (HTTP 404, code 10008).`,
    );
    expect(text(panel.components)).toContain("No hike is being planned.");
  });
});

describe("Post vote message", () => {
  it("posts the message of a poll that has none once, however often it is clicked", async () => {
    const guild = "200000000000000078";
    const pollId = await runInDurableObject(stub(guild), (_i, state) => {
      const config = new GuildConfig(state.storage);
      config.set("voteChannelId", TEXT);
      config.set("announceChannelId", NEWS);
      config.set("forumChannelId", FORUM);
      const round = new PollStore(state.storage).startRound(OWNER, [
        { label: "Ridge", proposedBy: OWNER },
      ]);
      return round.locationPoll?.id ?? 0;
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith(`/guilds/${guild}`)) {
          return Promise.resolve(Response.json({ id: guild, owner_id: OWNER }));
        }
        // The post waits until the second click has been answered.
        return held.then(() => Response.json({ id: POLL_MESSAGE }));
      });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const click = () => {
      const interaction = componentInteraction(POLL_IDS.post(pollId), guild);
      Object.assign(interaction, {
        member: { user: { id: OWNER }, roles: [] },
        message: { id: "800000000000000009", components: [] },
      });
      return interaction;
    };
    const ctx = createExecutionContext();
    const first = await callWorker(
      signer,
      await signedRequest(signer, click()),
      ctx,
    );
    expect(await first.json()).toEqual({
      type: InteractionResponseType.DeferredMessageUpdate,
    });
    const second = await send(click());
    expect(second.type).toBe(InteractionResponseType.UpdateMessage);
    expect(text(second.data.components)).toContain(
      "The location vote's message is being posted.",
    );
    release();
    await waitOnExecutionContext(ctx);
    const posts = requests(fetchSpy).filter((r) => r.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(new RegExp(`/channels/${TEXT}/messages$`));
    const panel = bodyOf(
      requests(fetchSpy).find((r) => r.url.includes("/webhooks/")),
    );
    expect(text(panel.components)).toContain(
      `The location vote is open in <#${TEXT}>.`,
    );
    const third = await send(click());
    expect(text(third.data.components)).toContain(
      `The location vote's message is already posted in <#${TEXT}>.`,
    );
    expect(requests(fetchSpy).filter((r) => r.method === "POST")).toHaveLength(
      1,
    );
  });
});

describe("a proposer that is the application", () => {
  it("is named hikebot, not mentioned", () => {
    const view = renderPollMessage(
      poll({
        options: [
          option(1, "Ridge", 0),
          { ...option(2, "Lake", 0), proposedBy: env.DISCORD_APPLICATION_ID },
        ],
      }),
      LOCATION_POLL,
      null,
      env.DISCORD_APPLICATION_ID,
    );
    expect(text(view)).toContain("Proposed by hikebot");
    expect(text(view)).toContain(`Proposed by <@${OWNER}>`);
    expect(text(view)).not.toContain(`<@${env.DISCORD_APPLICATION_ID}>`);
  });
});
