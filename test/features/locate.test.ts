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
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  LOCATE_JOB,
  LOOKUP_SPACING_MS,
  RETRY_DELAYS_MS,
  givenPlace,
  retryDelay,
  scheduleLocate,
} from "../../src/features/locate";
import { LOCATION_IDS } from "../../src/features/location-vote";
import { POLL_IDS, REFRESH_JOB } from "../../src/features/poll-ui";
import { GuildConfig } from "../../src/guild/config";
import { scheduledJobs } from "../../src/guild/schedule";
import { PollStore, type OptionPlace } from "../../src/polls/store";
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
const GEOCODER = "https://nominatim.test/search";

/** The time the tests start at: Saturday 1 May 2027, 12:00 UTC. */
const T = Date.UTC(2027, 4, 1, 12);

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

/** Sets the clock the guild object reads, as the store's `now`. */
function setClock(at: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

type Geocoder = (url: URL) => Promise<Response> | Response;

const SI = [
  {
    lat: "47.4875",
    lon: "-121.7234",
    display_name: "Mount Si, King County, Washington, United States",
  },
];

/**
 * Stubs Discord (the guild owner, then any message) and the geocoder,
 * which `geocoder` answers; returns the URLs the geocoder was asked.
 */
function stubFetch(guildId: string, geocoder: Geocoder) {
  const asked: URL[] = [];
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (request.url.startsWith(GEOCODER)) {
        asked.push(url);
        return geocoder(url);
      }
      if (request.url.endsWith(`/guilds/${guildId}`)) {
        return Response.json({ id: guildId, owner_id: OWNER });
      }
      return Response.json({ id: "900000000000000001", channel_id: TEXT });
    });
  return { asked, spy };
}

async function startRound(
  guildId: string,
  labels: string[],
): Promise<{ pollId: number; optionIds: number[] }> {
  return runInDurableObject(stub(guildId), async (_i, state) => {
    const config = new GuildConfig(state.storage);
    config.set("voteChannelId", TEXT);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
    const store = new PollStore(state.storage);
    const round = store.startRound(
      OWNER,
      labels.map((label) => ({ label, proposedBy: OWNER })),
    );
    const poll = round.locationPoll;
    if (poll === null) throw new Error("no location poll");
    store.setPollMessage(poll.id, TEXT, "900000000000000009");
    await scheduleLocate(state.storage, store, store.now());
    return { pollId: poll.id, optionIds: poll.options.map((o) => o.id) };
  });
}

function places(guildId: string): Promise<(OptionPlace | null)[]> {
  return runInDurableObject(stub(guildId), (_i, state) => {
    const round = new PollStore(state.storage).getActiveRound();
    return (round?.locationPoll?.options ?? []).map((o) => o.place);
  });
}

function jobs(guildId: string): Promise<Map<string, number>> {
  return runInDurableObject(stub(guildId), (_i, state) =>
    scheduledJobs(state.storage),
  );
}

function refreshMarks(guildId: string): Promise<string[]> {
  return runInDurableObject(stub(guildId), async (_i, state) => [
    ...(await state.storage.list({ prefix: "poll-refresh:" })).keys(),
  ]);
}

describe("givenPlace", () => {
  it("takes the first field holding coordinates, as given", () => {
    expect(givenPlace(["", "Mount Si 47.48, -121.72", "geo:1.5,2.5"])).toEqual({
      status: "given",
      point: { lat: 47.48, lon: -121.72 },
      name: null,
      attempts: 0,
    });
    expect(givenPlace([undefined, "Mount Si", null])).toBeUndefined();
  });
});

describe("retryDelay", () => {
  it("grows after each failed attempt", () => {
    expect(retryDelay(1)).toBe(RETRY_DELAYS_MS[0]);
    expect(retryDelay(2)).toBe(RETRY_DELAYS_MS[1]);
    expect(RETRY_DELAYS_MS[1]).toBeGreaterThan(RETRY_DELAYS_MS[0]);
  });
});

describe("the geo:locate job", () => {
  it("looks up one option per run, at least 1.1 s apart, and marks the poll for a refresh", async () => {
    const guild = "200000000000000701";
    setClock(T);
    const { asked } = stubFetch(guild, (url) =>
      Response.json(url.searchParams.get("q") === "Mount Si" ? SI : []),
    );
    const { pollId } = await startRound(guild, ["Mount Si", "Nowhere"]);
    expect(await jobs(guild)).toEqual(new Map([[LOCATE_JOB, T]]));
    expect(asked).toEqual([]);

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(asked.map((u) => u.searchParams.get("q"))).toEqual(["Mount Si"]);
    expect(await places(guild)).toEqual([
      {
        status: "found",
        point: { lat: 47.4875, lon: -121.7234 },
        name: "Mount Si, King County, Washington",
        attempts: 1,
      },
      { status: "pending", point: null, name: null, attempts: 0 },
    ]);
    expect(await refreshMarks(guild)).toEqual([
      `poll-refresh:${String(pollId)}`,
    ]);
    expect((await jobs(guild)).get(LOCATE_JOB)).toBe(T + LOOKUP_SPACING_MS);

    // Run early, by the clock still at T: it waits for its turn.
    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(asked).toHaveLength(1);
    expect((await jobs(guild)).get(LOCATE_JOB)).toBe(T + LOOKUP_SPACING_MS);

    vi.setSystemTime(T + LOOKUP_SPACING_MS);
    while ((await jobs(guild)).has(LOCATE_JOB)) {
      expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    }
    expect(asked.map((u) => u.searchParams.get("q"))).toEqual([
      "Mount Si",
      "Nowhere",
    ]);
    expect((await places(guild))[1]).toEqual({
      status: "not_found",
      point: null,
      name: null,
      attempts: 1,
    });
    expect((await jobs(guild)).has(REFRESH_JOB)).toBe(true);
  });

  it("tries an erroring lookup three times with a growing delay, then gives up", async () => {
    const guild = "200000000000000702";
    setClock(T);
    const statuses = [500, 429];
    const { asked } = stubFetch(
      guild,
      () => new Response("busy", { status: statuses.shift() ?? 503 }),
    );
    await startRound(guild, ["Flaky"]);

    await runDurableObjectAlarm(stub(guild));
    expect(await places(guild)).toEqual([
      { status: "pending", point: null, name: null, attempts: 1 },
    ]);
    expect((await jobs(guild)).get(LOCATE_JOB)).toBe(T + RETRY_DELAYS_MS[0]);
    expect(await refreshMarks(guild)).toEqual([]);

    vi.setSystemTime(T + RETRY_DELAYS_MS[0]);
    await runDurableObjectAlarm(stub(guild));
    expect((await places(guild))[0]).toMatchObject({ attempts: 2 });
    expect((await jobs(guild)).get(LOCATE_JOB)).toBe(
      T + RETRY_DELAYS_MS[0] + RETRY_DELAYS_MS[1],
    );

    vi.setSystemTime(T + RETRY_DELAYS_MS[0] + RETRY_DELAYS_MS[1]);
    await runDurableObjectAlarm(stub(guild));
    expect(await places(guild)).toEqual([
      { status: "failed", point: null, name: null, attempts: 3 },
    ]);
    expect(asked).toHaveLength(3);
    expect((await jobs(guild)).has(LOCATE_JOB)).toBe(false);
    expect((await refreshMarks(guild)).length).toBe(1);
  });

  it("counts a geocoder that times out as a failed attempt", async () => {
    const guild = "200000000000000703";
    setClock(T);
    stubFetch(guild, () =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    );
    await startRound(guild, ["Slow"]);
    await runDurableObjectAlarm(stub(guild));
    expect(await places(guild)).toEqual([
      { status: "pending", point: null, name: null, attempts: 1 },
    ]);
    expect((await jobs(guild)).get(LOCATE_JOB)).toBe(T + RETRY_DELAYS_MS[0]);
  });

  it("searches near the home area with a viewbox and bounded=0", async () => {
    const guild = "200000000000000704";
    setClock(T);
    const { asked } = stubFetch(guild, () => Response.json(SI));
    await runInDurableObject(stub(guild), (_i, state) => {
      new GuildConfig(state.storage).setHomeArea({
        text: "Seattle",
        name: "Seattle, King County, Washington",
        lat: 47.6,
        lon: -122.3,
      });
    });
    await startRound(guild, ["Mount Si"]);
    await runDurableObjectAlarm(stub(guild));
    expect(asked[0]?.searchParams.get("viewbox")).toBe(
      "-123.3,48.6,-121.3,46.6",
    );
    expect(asked[0]?.searchParams.get("bounded")).toBe("0");
  });

  it("schedules nothing when no place is pending", async () => {
    const guild = "200000000000000705";
    setClock(T);
    stubFetch(guild, () => Response.json([]));
    await runInDurableObject(stub(guild), async (_i, state) => {
      const store = new PollStore(state.storage);
      store.startRound(OWNER, [
        {
          label: "Given",
          proposedBy: OWNER,
          place: {
            status: "given",
            point: { lat: 1, lon: 2 },
            name: null,
            attempts: 0,
          },
        },
      ]);
      await scheduleLocate(state.storage, store, store.now());
    });
    expect(await jobs(guild)).toEqual(new Map());
  });
});

describe("a failing or slow geocoder", () => {
  async function send(interaction: unknown) {
    const ctx = createExecutionContext();
    const response = await callWorker(
      signer,
      await signedRequest(signer, interaction),
      ctx,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      type: InteractionResponseType;
      data?: { components?: APIMessageTopLevelComponent[] };
    }>();
    await waitOnExecutionContext(ctx);
    return body;
  }

  function as<T extends object>(interaction: T, userId: string): T {
    return Object.assign(interaction, {
      member: { user: { id: userId }, roles: [] },
    });
  }

  it.each(["errors", "never answers"])(
    "never fails or delays a proposal, a vote or a close when it %s",
    async (behaviour) => {
      const guild =
        behaviour === "errors" ? "200000000000000711" : "200000000000000712";
      // The clock is ahead of real time, so no alarm fires on its own.
      setClock(T);
      // Ends the hanging request as the client's timeout does.
      let release: () => void = () => undefined;
      const held = new Promise<Response>((_resolve, reject) => {
        release = () => {
          reject(new DOMException("timed out", "TimeoutError"));
        };
      });
      // Unused when the geocoder errors at once.
      held.catch(() => undefined);
      const { asked } = stubFetch(guild, () =>
        behaviour === "errors" ? new Response("down", { status: 503 }) : held,
      );
      const { pollId } = await startRound(guild, ["Ridge"]);
      // The job's lookup of Ridge: failed, or hanging while members act.
      const lookup = runDurableObjectAlarm(stub(guild));
      await vi.waitFor(() => {
        expect(asked).toHaveLength(1);
      });

      const propose = as(
        modalInteraction(LOCATION_IDS.propose(pollId), guild),
        MEMBER,
      );
      Object.assign(propose.data, {
        components: [
          [LOCATION_IDS.name, "Lake"],
          [LOCATION_IDS.details, ""],
          [LOCATION_IDS.map, ""],
        ].map(([custom_id, value]) => ({
          type: ComponentType.Label,
          component: { type: ComponentType.TextInput, custom_id, value },
        })),
      });
      const added = await send(propose);
      expect(added.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(JSON.stringify(added)).toContain("Added **Lake**");
      // Answering made no request to the geocoder.
      expect(asked).toHaveLength(1);

      const vote = as(
        componentInteraction(POLL_IDS.choose(pollId), guild),
        MEMBER,
      );
      const optionIds = await runInDurableObject(stub(guild), (_i, state) =>
        (new PollStore(state.storage).getPoll(pollId)?.options ?? []).map(
          (o) => o.id,
        ),
      );
      Object.assign(vote, {
        message: { id: "900000000000000002", components: [] },
      });
      Object.assign(vote.data, {
        component_type: ComponentType.StringSelect,
        values: [String(optionIds[1])],
      });
      expect((await send(vote)).type).toBe(
        InteractionResponseType.UpdateMessage,
      );

      const close = as(
        componentInteraction(`hb:poll:close-confirm:${String(pollId)}`, guild),
        OWNER,
      );
      Object.assign(close, {
        message: { id: "800000000000000001", components: [] },
      });
      expect((await send(close)).type).toBe(
        InteractionResponseType.DeferredMessageUpdate,
      );
      const round = await runInDurableObject(stub(guild), (_i, state) =>
        new PollStore(state.storage).getLastRound(),
      );
      expect(round?.status).toBe("location_decided");
      expect(round?.locationOptionId).toBe(optionIds[1]);

      release();
      await lookup;
      expect((await places(guild))[0]).toMatchObject({
        status: "pending",
        attempts: 1,
      });
    },
  );
});
