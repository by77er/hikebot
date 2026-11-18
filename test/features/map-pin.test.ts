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
} from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POLL_CONTROL_IDS } from "../../src/features/admin-panel";
import {
  MAP_PIN_IDS,
  setMapPin,
  type MapPinChange,
  type MapPinHook,
} from "../../src/features/map-pin";
import { GuildConfig } from "../../src/guild/config";
import { googleLink, osmLink } from "../../src/geo/links";
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
const VOTER = "400000000000000002";
const TEXT = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";
const THREAD = "900000000000000001";
const EVENT = "950000000000000001";
const PANEL = "/webhooks/100/interaction-token/messages/@original";

/** Mount Si, as Nominatim found it. */
const FOUND: OptionPlace = {
  status: "found",
  point: { lat: 47.4875, lon: -121.7234 },
  name: "Mount Si, King County, Washington",
  attempts: 1,
};

/** A Google Maps link that pins 47.5, -121.8. */
const LINK = "https://www.google.com/maps/place/Little+Si/@47.5,-121.8,15z";
const LINKED = { lat: 47.5, lon: -121.8 };

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

/**
 * A guild whose round decided Mount Si (with `place`), still active at
 * location_decided, or `complete` with its thread and event.
 */
async function decided(
  guildId: string,
  { complete, place }: { complete: boolean; place: OptionPlace | null },
): Promise<number> {
  return runInDurableObject(stub(guildId), (_i, state) => {
    const config = new GuildConfig(state.storage);
    config.set("voteChannelId", TEXT);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
    const store = new PollStore(state.storage);
    const round = store.startRound(OWNER, [
      {
        label: "Mount Si",
        details: "Steep, 13 km",
        proposedBy: OWNER,
        ...(place === null ? {} : { place }),
      },
    ]);
    const location = round.locationPoll;
    if (location === null) throw new Error("no location poll");
    store.setVotes(location.id, VOTER, [location.options[0]?.id ?? 0]);
    store.closePoll(location.id, OWNER);
    if (complete) {
      const dates = store.startDatePoll(round.id, OWNER, [
        "2030-06-15 09:00",
        "2030-06-22 09:00",
      ]);
      store.setVotes(dates.id, VOTER, [dates.options[0]?.id ?? 0]);
      store.closePoll(dates.id, OWNER);
      store.setRoundThread(round.id, THREAD);
      store.setRoundEvent(round.id, EVENT);
    }
    return round.id;
  });
}

function pinOf(guildId: string, roundId: number) {
  return runInDurableObject(stub(guildId), (_i, state) => {
    const store = new PollStore(state.storage);
    const round = store.getRound(roundId);
    return (
      round?.locationPoll?.options.find((o) => o.id === round.locationOptionId)
        ?.place ?? null
    );
  });
}

interface Sent {
  method: string;
  path: string;
  body: string;
}

/**
 * Stubs Discord: the guild owner answers; the edit of the thread's first
 * message answers `threadEdit()`; anything else gets an id.
 */
function discord(
  guildId: string,
  threadEdit: () => Response = () => Response.json({ id: THREAD }),
) {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname.replace("/api/v10", "");
    if (request.method !== "GET") {
      sent.push({ method: request.method, path, body: await request.text() });
    }
    if (path.endsWith(`/guilds/${guildId}`)) {
      return Response.json({ id: guildId, owner_id: OWNER });
    }
    if (path === `/channels/${THREAD}/messages/${THREAD}`) return threadEdit();
    return Response.json({ id: "1" });
  });
  return sent;
}

const forbidden = () =>
  Response.json(
    { message: "Missing Permissions", code: 50013 },
    { status: 403 },
  );

function asAdmin<T extends object>(interaction: T): T {
  return Object.assign(interaction, {
    member: { user: { id: OWNER }, roles: [] },
    message: { id: "800000000000000009", components: [] },
  });
}

function click(customId: string, guildId: string) {
  return asAdmin(componentInteraction(customId, guildId));
}

function submit(roundId: number, guildId: string, value: string) {
  const interaction = asAdmin(
    modalInteraction(MAP_PIN_IDS.set(roundId), guildId),
  );
  Object.assign(interaction.data, {
    components: [
      {
        type: ComponentType.Label,
        component: {
          type: ComponentType.TextInput,
          custom_id: MAP_PIN_IDS.point,
          value,
        },
      },
    ],
  });
  return interaction;
}

interface Reply {
  type: InteractionResponseType;
  data?: { flags?: number; custom_id?: string; components?: unknown[] };
}

async function send(interaction: unknown, ctx = createExecutionContext()) {
  const response = await callWorker(
    signer,
    await signedRequest(signer, interaction),
    ctx,
  );
  expect(response.status).toBe(200);
  return response.json<Reply>();
}

/** The pin field of a modal answer. */
function pinField(reply: Reply): { value?: string; custom_id?: string } {
  const field = JSON.stringify(reply.data?.components ?? []);
  const found = /\{[^{}]*"custom_id":"hb:pin:point"[^{}]*\}/.exec(field);
  if (found === null) throw new Error(`no pin field in ${field}`);
  return JSON.parse(found[0]) as { value?: string; custom_id?: string };
}

describe("Set map pin's modal", () => {
  it("opens prefilled with the decided location's pin", async () => {
    const guild = "200000000000000801";
    const roundId = await decided(guild, { complete: false, place: FOUND });
    discord(guild);
    const reply = await send(click(POLL_CONTROL_IDS.setMapPin(roundId), guild));
    expect(reply.type).toBe(InteractionResponseType.Modal);
    expect(reply.data?.custom_id).toBe(MAP_PIN_IDS.set(roundId));
    expect(pinField(reply).value).toBe("47.4875, -121.7234");
  });

  it("opens empty when the location has no pin", async () => {
    const guild = "200000000000000802";
    const roundId = await decided(guild, { complete: true, place: null });
    discord(guild);
    const reply = await send(click(POLL_CONTROL_IDS.setMapPin(roundId), guild));
    expect(reply.type).toBe(InteractionResponseType.Modal);
    expect(pinField(reply).value).toBeUndefined();
  });

  it("is refused for a round whose pin cannot be set", async () => {
    const guild = "200000000000000803";
    const roundId = await decided(guild, { complete: false, place: FOUND });
    const sent = discord(guild);
    const reply = await send(
      click(POLL_CONTROL_IDS.setMapPin(roundId + 1), guild),
    );
    expect(reply.type).toBe(InteractionResponseType.UpdateMessage);
    expect(JSON.stringify(reply.data)).toContain(
      "That hike's location can no longer be pinned from here.",
    );
    const submitted = await send(submit(roundId + 1, guild, LINK));
    expect(submitted.type).toBe(
      InteractionResponseType.ChannelMessageWithSource,
    );
    expect(submitted.data?.flags).toBe(
      MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    );
    expect(JSON.stringify(submitted.data)).toContain(
      "can no longer be pinned from here",
    );
    expect(await pinOf(guild, roundId)).toEqual(FOUND);
    expect(sent).toEqual([]);
  });

  it("is refused while the location vote is still open", async () => {
    const guild = "200000000000000804";
    const roundId = await runInDurableObject(
      stub(guild),
      (_i, state) =>
        new PollStore(state.storage).startRound(OWNER, [
          { label: "Mount Si", proposedBy: OWNER },
        ]).id,
    );
    discord(guild);
    const reply = await send(click(POLL_CONTROL_IDS.setMapPin(roundId), guild));
    expect(reply.type).toBe(InteractionResponseType.UpdateMessage);
    expect(JSON.stringify(reply.data)).toContain(
      "can no longer be pinned from here",
    );
  });
});

describe("saving the map pin", () => {
  it("refuses input with no coordinates and changes nothing", async () => {
    const guild = "200000000000000811";
    const roundId = await decided(guild, { complete: true, place: FOUND });
    const sent = discord(guild);
    const ctx = createExecutionContext();
    const reply = await send(
      submit(roundId, guild, "https://maps.app.goo.gl/abc123"),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(reply.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(reply.data?.flags).toBe(
      MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    );
    expect(JSON.stringify(reply.data)).toContain(
      "No coordinates could be read from that, so the pin is unchanged.",
    );
    expect(await pinOf(guild, roundId)).toEqual(FOUND);
    expect(sent).toEqual([]);
  });

  it("stores a map link's point as given before answering, then updates the thread, the event and the panel", async () => {
    const guild = "200000000000000812";
    const roundId = await decided(guild, { complete: true, place: FOUND });
    const sent = discord(guild);
    const ctx = createExecutionContext();
    const reply = await send(submit(roundId, guild, `  ${LINK} `), ctx);
    expect(reply.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    expect(await pinOf(guild, roundId)).toEqual({
      status: "given",
      point: LINKED,
      name: null,
      attempts: 1,
    });
    await waitOnExecutionContext(ctx);
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      `PATCH /channels/${THREAD}/messages/${THREAD}`,
      `PATCH /guilds/${guild}/scheduled-events/${EVENT}`,
      `PATCH ${PANEL}`,
    ]);
    const [thread, event, panel] = sent;
    expect(thread?.body).toContain(osmLink(LINKED));
    expect(thread?.body).toContain(googleLink(LINKED));
    expect(thread?.body).toContain("📍 [OpenStreetMap]");
    expect(thread?.body).not.toContain("Mount Si, King County");
    const description = (
      JSON.parse(event?.body ?? "{}") as { description?: string }
    ).description;
    expect(description).toContain("Steep, 13 km");
    expect(description).toContain(`OpenStreetMap: ${osmLink(LINKED)}`);
    expect(description).toContain(`Google Maps: ${googleLink(LINKED)}`);
    expect(description).toContain(
      `Hike thread: https://discord.com/channels/${guild}/${THREAD}`,
    );
    expect(panel?.body).toContain(
      "The map pin of **Mount Si** is set to 47.5, -121.8.",
    );
    expect(panel?.body).not.toContain("Could not");
  });

  it("removes the pin when the field is empty, and the thread no longer shows one", async () => {
    const guild = "200000000000000813";
    const roundId = await decided(guild, { complete: true, place: FOUND });
    const sent = discord(guild);
    const ctx = createExecutionContext();
    const reply = await send(submit(roundId, guild, "   "), ctx);
    expect(reply.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    expect(await pinOf(guild, roundId)).toEqual({
      status: "cleared",
      point: null,
      name: null,
      attempts: 1,
    });
    await waitOnExecutionContext(ctx);
    const [thread, event, panel] = sent;
    expect(thread?.path).toBe(`/channels/${THREAD}/messages/${THREAD}`);
    expect(thread?.body).not.toContain("📍");
    expect(thread?.body).not.toContain("openstreetmap.org");
    expect(thread?.body).not.toContain("© OpenStreetMap contributors");
    expect(event?.path).toBe(`/guilds/${guild}/scheduled-events/${EVENT}`);
    expect(event?.body).not.toContain("openstreetmap.org");
    expect(event?.body).toContain("Steep, 13 km");
    expect(panel?.body).toContain("The map pin of **Mount Si** is removed.");
  });

  it("names a hook that failed in the panel, and still runs the others", async () => {
    const guild = "200000000000000814";
    const roundId = await decided(guild, { complete: true, place: null });
    const sent = discord(guild, forbidden);
    const ctx = createExecutionContext();
    const reply = await send(submit(roundId, guild, "47.50, -121.80"), ctx);
    expect(reply.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    await waitOnExecutionContext(ctx);
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      `PATCH /channels/${THREAD}/messages/${THREAD}`,
      `PATCH /guilds/${guild}/scheduled-events/${EVENT}`,
      `PATCH ${PANEL}`,
    ]);
    expect(sent[1]?.body).toContain(osmLink(LINKED));
    const panel = sent[2]?.body ?? "";
    expect(panel).toContain(
      "The map pin of **Mount Si** is set to 47.5, -121.8.",
    );
    expect(panel).toContain(
      "Could not update the hike thread: Discord answered: Missing Permissions (HTTP 403, code 50013).",
    );
    expect(panel).not.toContain("Could not update the hike event");
    expect((await pinOf(guild, roundId))?.status).toBe("given");
  });

  it("edits only the panel when the round has no thread or event yet", async () => {
    const guild = "200000000000000815";
    const roundId = await decided(guild, { complete: false, place: FOUND });
    const sent = discord(guild);
    const ctx = createExecutionContext();
    const reply = await send(submit(roundId, guild, LINK), ctx);
    expect(reply.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    await waitOnExecutionContext(ctx);
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      `PATCH ${PANEL}`,
    ]);
    expect(sent[0]?.body).toContain(
      "The map pin of **Mount Si** is set to 47.5, -121.8.",
    );
    expect(await pinOf(guild, roundId)).toMatchObject({
      status: "given",
      point: LINKED,
    });
  });
});

describe("setMapPin", () => {
  it("stores the pin and runs the given hooks with the change, collecting the failures", async () => {
    const guild = "200000000000000821";
    const roundId = await decided(guild, { complete: true, place: FOUND });
    const sent = discord(guild);
    const seen: MapPinChange[] = [];
    const hooks: MapPinHook[] = [
      {
        name: "record the change",
        run: (change) => {
          seen.push(change);
          return Promise.resolve();
        },
      },
      {
        name: "break",
        run: () => Promise.reject(new Error("boom")),
      },
    ];
    const result = await runInDurableObject(stub(guild), (_i, state) =>
      setMapPin(
        { env, storage: state.storage },
        { roundId, point: LINKED, guildId: guild },
        hooks,
      ),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      guildId: guild,
      timeZone: "America/Los_Angeles",
      location: {
        label: "Mount Si",
        place: { status: "given", point: LINKED, name: null },
      },
      round: { id: roundId, threadId: THREAD, eventId: EVENT },
    });
    expect(result?.notes).toEqual([
      "Could not break: Discord could not be reached.",
    ]);
    expect(await pinOf(guild, roundId)).toMatchObject({ point: LINKED });
    // Only the given hooks ran: no thread or event edit.
    expect(sent).toEqual([]);
  });

  it("does nothing for a round whose pin cannot be set", async () => {
    const guild = "200000000000000822";
    const roundId = await decided(guild, { complete: false, place: FOUND });
    const run = vi.fn(() => Promise.resolve());
    const result = await runInDurableObject(stub(guild), (_i, state) =>
      setMapPin(
        { env, storage: state.storage },
        { roundId: roundId + 1, point: null, guildId: guild },
        [{ name: "never", run }],
      ),
    );
    expect(result).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(await pinOf(guild, roundId)).toEqual(FOUND);
  });
});
