import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  ComponentType,
  InteractionResponseType,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POLL_IDS } from "../../src/features/poll-ui";
import { GuildConfig } from "../../src/guild/config";
import type { WebView } from "../../src/guild/web-view";
import { PollStore, type PollView } from "../../src/polls/store";
import {
  callWorker,
  componentInteraction,
  createSigner,
  signedRequest,
  type Signer,
} from "../helpers";
import { discordFetch, type DiscordGuild } from "../guild/web-view-helpers";

const OWNER = "400000000000000001";
const ANA = "400000000000000002";
const BEN = "400000000000000003";
const VOTE = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";
const MESSAGE = "700000000000000001";

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

let counter = 0;

/** A fresh guild with its channels set, and Discord answering for it. */
async function setUp() {
  counter++;
  const guildId = `20000000000000${String(2000 + counter)}`;
  const guild: DiscordGuild = {
    id: guildId,
    ownerId: OWNER,
    members: { [OWNER]: [], [ANA]: [], [BEN]: [] },
    channels: { [VOTE]: "votes", [NEWS]: "news", [FORUM]: "hikes" },
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(discordFetch(guild));
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
  await runInDurableObject(stub, (_instance, state) => {
    const config = new GuildConfig(state.storage);
    config.set("voteChannelId", VOTE);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
  });
  /** Runs `body` on the guild's poll store. */
  const store = <T>(body: (store: PollStore) => T) =>
    runInDurableObject(stub, (_instance, state) =>
      body(new PollStore(state.storage)),
    );
  /** The view `userId` gets. */
  const view = async (userId: string): Promise<WebView> => {
    const result = await stub.webView({ guildId, userId });
    if (result.kind !== "view") throw new Error(`no view: ${result.kind}`);
    return result.view;
  };
  /** `userId` picks `labels` in the poll's Vote select, through the Worker. */
  const vote = async (poll: PollView, userId: string, labels: string[]) => {
    const values = labels.map((label) =>
      String(poll.options.find((o) => o.label === label)?.id),
    );
    const response = await callWorker(
      signer,
      await signedRequest(signer, choose(guildId, poll, userId, values)),
    );
    expect(response.status).toBe(200);
    expect((await response.json<{ type: number }>()).type).toBe(
      InteractionResponseType.UpdateMessage,
    );
  };
  return { guildId, store, view, vote };
}

/** The Vote select's submit, listing every option of `poll`. */
function choose(
  guildId: string,
  poll: PollView,
  userId: string,
  values: string[],
): APIMessageComponentInteraction {
  const interaction = componentInteraction(POLL_IDS.choose(poll.id), guildId);
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
              custom_id: POLL_IDS.choose(poll.id),
              options: poll.options.map((o) => ({
                label: o.label,
                value: String(o.id),
              })),
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

/** Starts a location vote on `labels`, its message posted. */
function startLocationVote(store: PollStore, labels: string[]): PollView {
  const round = store.startRound(
    OWNER,
    labels.map((label) => ({ label, proposedBy: OWNER })),
  );
  const id = round.locationPoll?.id ?? 0;
  store.setPollMessage(id, VOTE, MESSAGE);
  return store.getPoll(id) as PollView;
}

describe("the web view's round", () => {
  it("is null with no round, as is the planned hike, and the log is empty", async () => {
    const g = await setUp();
    const view = await g.view(ANA);
    expect(view.round).toBeNull();
    expect(view.plannedHike).toBeNull();
    expect(view.log).toEqual({
      entries: [],
      page: 1,
      pageSize: 10,
      pages: 1,
      total: 0,
    });
  });

  it("shows an open location vote with the counts and each viewer's own votes", async () => {
    const g = await setUp();
    const poll = await g.store((s) =>
      startLocationVote(s, ["Ridge", "Lake", "Canyon"]),
    );
    await g.vote(poll, ANA, ["Lake", "Canyon"]);
    await g.vote(poll, OWNER, ["Lake"]);

    const ana = await g.view(ANA);
    const ids = Object.fromEntries(poll.options.map((o) => [o.label, o.id]));
    expect(ana.round).toEqual({
      roundId: poll.roundId,
      step: "location_vote_open",
      location: null,
      vote: {
        pollId: poll.id,
        kind: "location",
        options: [
          {
            optionId: ids.Lake,
            label: "Lake",
            details: null,
            dateValue: null,
            proposedBy: OWNER,
            place: null,
            votes: 2,
            viewerVoted: true,
          },
          {
            optionId: ids.Canyon,
            label: "Canyon",
            details: null,
            dateValue: null,
            proposedBy: OWNER,
            place: null,
            votes: 1,
            viewerVoted: true,
          },
          {
            optionId: ids.Ridge,
            label: "Ridge",
            details: null,
            dateValue: null,
            proposedBy: OWNER,
            place: null,
            votes: 0,
            viewerVoted: false,
          },
        ],
        voterCount: 2,
        closesAt: null,
        messageUrl: `https://discord.com/channels/${g.guildId}/${VOTE}/${MESSAGE}`,
        instructions:
          "Vote for every location you would go to; you can change your votes until the vote closes.",
        propose: { kind: "location", refusal: null, again: [], resting: null },
      },
    });

    const ben = await g.view(BEN);
    expect(
      ben.round?.vote?.options.map((o) => [o.label, o.votes, o.viewerVoted]),
    ).toEqual([
      ["Lake", 2, false],
      ["Canyon", 1, false],
      ["Ridge", 0, false],
    ]);
    expect(ben.round?.vote?.voterCount).toBe(2);
  });

  it("gives a located option its short place name and map links, as the poll message does", async () => {
    const g = await setUp();
    await g.store((s) => {
      const poll = startLocationVote(s, ["Ridge", "Lake", "Canyon"]);
      const [ridge, lake] = poll.options;
      s.setOptionPin(ridge?.id ?? 0, { lat: 47.4875, lon: -121.7234 });
      s.recordPlaceLookup(lake?.id ?? 0, {
        kind: "found",
        point: { lat: 47.5, lon: -121.6 },
        name: "Lake Serene, Snohomish County",
      });
    });
    const places = (await g.view(ANA)).round?.vote?.options.map((o) => [
      o.label,
      o.place,
    ]);
    expect(places).toEqual([
      [
        "Ridge",
        expect.objectContaining({ name: null, text: "47.4875, -121.7234" }),
      ],
      [
        "Lake",
        {
          lat: 47.5,
          lon: -121.6,
          text: "47.5, -121.6",
          name: "Lake Serene, Snohomish County",
          osmUrl:
            "https://www.openstreetmap.org/?mlat=47.5&mlon=-121.6#map=13/47.5/-121.6",
          googleUrl:
            "https://www.google.com/maps/search/?api=1&query=47.5,-121.6",
        },
      ],
      ["Canyon", null],
    ]);
  });

  it("has no message link before the poll's message is posted", async () => {
    const g = await setUp();
    await g.store((s) =>
      s.startRound(OWNER, [{ label: "Ridge", proposedBy: OWNER }]),
    );
    expect((await g.view(ANA)).round?.vote?.messageUrl).toBeNull();
  });

  it("shows the decided location once the location vote closes", async () => {
    const g = await setUp();
    const poll = await g.store((s) => startLocationVote(s, ["Ridge", "Lake"]));
    await g.vote(poll, ANA, ["Lake"]);
    await g.store((s) => s.closePoll(poll.id, OWNER));
    expect((await g.view(ANA)).round).toEqual({
      roundId: poll.roundId,
      step: "location_decided",
      location: { label: "Lake", details: null },
      vote: null,
    });
  });

  it("shows an open date vote in date order, with the decided location", async () => {
    const g = await setUp();
    const where = await g.store((s) => startLocationVote(s, ["Lake"]));
    const when = await g.store((s) => {
      s.closePoll(where.id, OWNER);
      const poll = s.startDatePoll(where.roundId, OWNER, [
        "2030-06-15",
        "2030-06-08 09:00",
        "2030-06-22",
      ]);
      s.setPollMessage(poll.id, VOTE, "700000000000000002");
      return s.getPoll(poll.id) as PollView;
    });
    await g.vote(when, ANA, ["Sat, 15 Jun 2030 · 11:00"]);
    await g.vote(when, BEN, [
      "Sat, 15 Jun 2030 · 11:00",
      "Sat, 22 Jun 2030 · 11:00",
    ]);

    const round = (await g.view(ANA)).round;
    expect(round).toMatchObject({
      step: "date_vote_open",
      location: { label: "Lake", details: null },
      vote: {
        pollId: when.id,
        kind: "date",
        voterCount: 2,
        closesAt: null,
        messageUrl: `https://discord.com/channels/${g.guildId}/${VOTE}/700000000000000002`,
      },
    });
    expect(
      round?.vote?.options.map((o) => [
        o.dateValue,
        o.label,
        o.votes,
        o.viewerVoted,
      ]),
    ).toEqual([
      ["2030-06-08 09:00", "Sat, 8 Jun 2030 · 09:00", 0, false],
      ["2030-06-15 11:00", "Sat, 15 Jun 2030 · 11:00", 2, true],
      ["2030-06-22 11:00", "Sat, 22 Jun 2030 · 11:00", 1, false],
    ]);
  });

  it("offers past locations to suggest again, and names the resting ones as the bot does", async () => {
    const g = await setUp();
    await g.store((s) => {
      const first = startLocationVote(s, ["Lake", "Canyon"]);
      const lake = first.options.find((o) => o.label === "Lake");
      s.setVotes(first.id, ANA, [lake?.id ?? 0]);
      s.closePoll(first.id, OWNER);
      const dates = s.startDatePoll(first.roundId, OWNER, [
        "2030-06-08",
        "2030-06-15",
      ]);
      s.closePoll(dates.id, OWNER);
      startLocationVote(s, ["Ridge"]);
    });
    const propose = (await g.view(ANA)).round?.vote?.propose;
    expect(propose).toMatchObject({
      kind: "location",
      refusal: null,
      again: [{ label: "Canyon", details: null }],
    });
    expect(propose?.kind === "location" && propose.resting).toBe(
      "Resting: **Lake** (2 more hikes)",
    );
  });

  it("refuses more locations with the bot's sentence once the vote is full", async () => {
    const g = await setUp();
    await g.store((s) =>
      startLocationVote(
        s,
        Array.from({ length: 25 }, (_, i) => `Place ${String(i + 1)}`),
      ),
    );
    expect((await g.view(ANA)).round?.vote?.propose).toMatchObject({
      kind: "location",
      refusal:
        "This vote already has 25 locations, the most it can hold. Vote for one of them instead.",
    });
  });

  it("names the days a member may propose for an open date vote", async () => {
    const g = await setUp();
    vi.useFakeTimers({ toFake: ["Date"] });
    // 1 June 2030, 11:00 in Los Angeles.
    vi.setSystemTime(Date.UTC(2030, 5, 1, 18));
    await g.store((s) => {
      const where = startLocationVote(s, ["Lake"]);
      s.closePoll(where.id, OWNER);
      s.startDatePoll(where.roundId, OWNER, ["2030-06-08", "2030-06-15"]);
    });
    expect((await g.view(ANA)).round?.vote?.propose).toEqual({
      kind: "date",
      refusal: null,
      first: "2030-06-01",
      last: "2030-07-02",
      defaultTime: "11:00",
    });
  });

  it("refuses a member who proposed a location with the bot's sentence naming it, and no one else", async () => {
    const g = await setUp();
    await g.store((s) => {
      const poll = startLocationVote(s, ["Ridge", "Lake"]);
      s.addOption(poll.id, { label: "Summit", proposedBy: ANA });
    });
    expect((await g.view(ANA)).round?.vote?.propose).toMatchObject({
      kind: "location",
      refusal:
        "You've already proposed **Summit** for this location vote. Each member proposes one location per round.",
    });
    expect((await g.view(BEN)).round?.vote?.propose.refusal).toBeNull();
    // The owner's starting list does not count.
    expect((await g.view(OWNER)).round?.vote?.propose.refusal).toBeNull();
  });

  it("refuses a member who proposed a date with the bot's sentence naming it, and no one else", async () => {
    const g = await setUp();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2030, 5, 1, 18));
    await g.store((s) => {
      const where = startLocationVote(s, ["Lake"]);
      s.closePoll(where.id, OWNER);
      const poll = s.startDatePoll(where.roundId, OWNER, [
        "2030-06-08",
        "2030-06-15",
      ]);
      s.proposeDate(poll.id, ANA, "2030-06-09", "America/Los_Angeles");
    });
    expect((await g.view(ANA)).round?.vote?.propose).toMatchObject({
      kind: "date",
      refusal:
        "You've already proposed **Sun, 9 Jun 2030 · 11:00** for this date vote. Each member proposes one date per round.",
    });
    expect((await g.view(BEN)).round?.vote?.propose.refusal).toBeNull();
    expect((await g.view(OWNER)).round?.vote?.propose.refusal).toBeNull();
  });
});
