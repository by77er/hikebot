import {
  createExecutionContext,
  evictDurableObject,
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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ADMIN_PANEL_IDS,
  POLL_CONTROL_IDS,
} from "../../src/features/admin-panel";
import {
  FINALIZE_PART,
  finishPart,
  pendingClose,
  startPart,
} from "../../src/features/close-flow-state";
import { DATE_POLL } from "../../src/features/date-vote";
import { createHikeEventStep } from "../../src/features/hike-event";
import {
  createHikeThreadStep,
  updateThreadPin,
} from "../../src/features/hike-thread";
import { MAP_PIN_HOOKS } from "../../src/features/index";
import {
  MAP_PICTURE_FILE,
  MAP_PICTURE_URL,
  showMapPicture,
} from "../../src/features/map-picture";
import {
  PICTURE_CLAIM_MS,
  claimMapPicture,
  mapPictureStatus,
} from "../../src/features/map-picture-state";
import { setMapPin, storeMapPin } from "../../src/features/map-pin";
import { POLL_IDS, type ClosedPoll } from "../../src/features/poll-ui";
import { retryMapPicture } from "../../src/features/round-actions";
import { GuildConfig } from "../../src/guild/config";
import { MapPainter } from "../../src/maps/map-painter";
import {
  PollStore,
  type OptionPlace,
  type PollView,
} from "../../src/polls/store";
import {
  callWorker,
  componentInteraction,
  createSigner,
  signedRequest,
  type Signer,
} from "../helpers";
import {
  SAMPLE,
  clearBucket,
  manifestOf,
  putManifest,
  putSample,
  sampleArchive,
} from "../maps/helpers";

const OWNER = "400000000000000001";
const TEXT = "300000000000000001";
const NEWS = "300000000000000002";
const FORUM = "300000000000000003";
const THREAD = "900000000000000001";
const EVENT = "950000000000000001";
const DATE_MESSAGE = "700000000000000002";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const THREAD_MESSAGE = `/channels/${THREAD}/messages/${THREAD}`;

/** The sample's point, inside our map data. */
const INSIDE: OptionPlace = {
  status: "found",
  point: { lat: SAMPLE.point.lat, lon: SAMPLE.point.lon },
  name: "Mount Si, King County, Washington",
  attempts: 1,
};

/** Another point inside the sample's bounds. */
const MOVED = { lat: 47.5, lon: -121.75 };

/** A point far outside the sample's bounds. */
const OUTSIDE: OptionPlace = {
  status: "given",
  point: { lat: 40, lon: -100 },
  name: null,
  attempts: 0,
};

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});
beforeEach(async () => {
  await clearBucket();
  await putSample("builds/test/region.pmtiles");
  await putManifest(manifestOf([sampleArchive()]));
});
afterEach(() => {
  vi.restoreAllMocks();
});

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

function inObject<T>(
  guildId: string,
  run: (storage: DurableObjectStorage) => T | Promise<T>,
): Promise<T> {
  return runInDurableObject(stub(guildId), (_i, state) => run(state.storage));
}

/**
 * A guild whose date vote is open, with its message posted, that
 * Sat, 15 Jun 2030 wins at Mount Si, pinned at `place` (none when null).
 */
async function dateVoting(
  guildId: string,
  place: OptionPlace | null,
): Promise<PollView> {
  return inObject(guildId, (storage) => {
    const config = new GuildConfig(storage);
    config.set("voteChannelId", TEXT);
    config.set("announceChannelId", NEWS);
    config.set("forumChannelId", FORUM);
    const store = new PollStore(storage);
    const started = store.startRound(OWNER, [
      {
        label: "Mount Si",
        details: null,
        proposedBy: OWNER,
        ...(place === null ? {} : { place }),
      },
    ]);
    const location = started.locationPoll?.id ?? 0;
    store.setVotes(location, "u1", [started.locationPoll?.options[0]?.id ?? 0]);
    store.closePoll(location, OWNER);
    const date = store.startDatePoll(started.id, OWNER, [
      "2030-06-15",
      "2030-06-22",
    ]);
    store.setPollMessage(date.id, TEXT, DATE_MESSAGE);
    store.setVotes(date.id, "u1", [
      date.options.find((o) => o.dateValue?.startsWith("2030-06-15"))?.id ?? 0,
    ]);
    return store.getPoll(date.id) as PollView;
  });
}

function click(
  customId: string,
  guildId: string,
): APIMessageComponentInteraction {
  const interaction = componentInteraction(customId, guildId);
  Object.assign(interaction, {
    member: { user: { id: OWNER }, roles: [] },
    message: { id: "800000000000000009", components: [] },
  });
  return interaction;
}

interface Upload {
  field: string;
  name: string;
  type: string;
  bytes: Uint8Array;
}

interface Sent {
  host: string;
  route: string;
  /** The JSON body, or a multipart request's `payload_json`. */
  body: {
    components?: APIMessageTopLevelComponent[];
    attachments?: unknown[];
    image?: string | null;
  };
  files: Upload[];
}

/**
 * Stubs every request the code under test makes: Discord's answers for the
 * guild, a thread `THREAD`, an event `EVENT` and anything else id 1, or
 * `refuse(route)`'s answer when it gives one. Returns what was sent, GETs
 * left out, multipart bodies read into their payload and files.
 */
function discord(
  guildId: string,
  refuse: (
    route: string,
  ) => Response | undefined | Promise<Response | undefined> = () => undefined,
) {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname.replace("/api/v10", "");
    const route = `${request.method} ${path}`;
    if (request.method !== "GET") {
      const type = request.headers.get("Content-Type") ?? "";
      let body: Sent["body"] = {};
      const files: Upload[] = [];
      if (type.startsWith("multipart/form-data")) {
        const form = await request.formData();
        for (const [field, value] of form) {
          if (typeof value === "string") {
            body = JSON.parse(value) as Sent["body"];
          } else {
            files.push({
              field,
              name: value.name,
              type: value.type,
              bytes: new Uint8Array(await value.arrayBuffer()),
            });
          }
        }
      } else if (type === "application/json") {
        body = await request.json<Sent["body"]>();
      }
      sent.push({ host: url.host, route, body, files });
    }
    const refused = await refuse(route);
    if (refused) return refused;
    if (path === `/guilds/${guildId}`) {
      return Response.json({ id: guildId, owner_id: OWNER });
    }
    if (path.endsWith("/threads")) {
      return Response.json({ id: THREAD, parent_id: FORUM }, { status: 201 });
    }
    if (path.endsWith("/scheduled-events")) {
      return Response.json({ id: EVENT, guild_id: guildId });
    }
    return Response.json({ id: "1" });
  });
  return sent;
}

const uploads = (sent: Sent[]) =>
  sent.filter((r) => r.route === `PATCH ${THREAD_MESSAGE}` && r.files.length);
const eventEdits = (guildId: string, sent: Sent[]) =>
  sent.filter(
    (r) => r.route === `PATCH /guilds/${guildId}/scheduled-events/${EVENT}`,
  );

/** Sends the interaction through the Worker and waits for its follow-up. */
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
    data?: { components: APIMessageTopLevelComponent[] };
  }>();
  await waitOnExecutionContext(ctx);
  return body;
}

interface Node {
  type: number;
  content?: string;
  custom_id?: string;
  components?: Node[];
  items?: { media: { url: string } }[];
}

/** The media gallery's component type, as the nodes hold it. */
const GALLERY: number = ComponentType.MediaGallery;

function flatten(components: readonly Node[]): Node[] {
  return components.flatMap((c) => [c, ...flatten(c.components ?? [])]);
}

function text(components: readonly unknown[] = []): string {
  return flatten(components as Node[])
    .map((c) => c.content ?? "")
    .filter((c) => c !== "")
    .join("\n");
}

/** The panel's status view, redrawn through Refresh. */
async function panel(guildId: string) {
  const reply = await send(click(ADMIN_PANEL_IDS.refresh, guildId));
  const nodes = flatten(reply.data?.components ?? []);
  return {
    shown: text(reply.data?.components),
    buttons: nodes.flatMap((c) => (c.custom_id ? [c.custom_id] : [])),
  };
}

/** Closes the date vote and finishes its close flow through the job. */
async function close(guildId: string, view: PollView) {
  const outcome = await stub(guildId).handleInteraction(
    click(POLL_IDS.closeConfirm(view.id), guildId),
  );
  expect(outcome).toMatchObject({ followUp: true });
  await evictDurableObject(stub(guildId));
  expect(await runDurableObjectAlarm(stub(guildId))).toBe(true);
}

function roundOf(guildId: string, view: PollView) {
  return inObject(guildId, (storage) =>
    new PollStore(storage).getRound(view.roundId),
  );
}

/** The media gallery items of a message, as urls, in order. */
function galleryUrls(components: readonly unknown[] = []): string[] {
  return flatten(components as Node[])
    .filter((c) => c.type === GALLERY)
    .flatMap((c) => (c.items ?? []).map((item) => item.media.url));
}

/** The decoded bytes of an image data URI. */
function dataBytes(uri: string | null | undefined): number[] {
  const [, base64 = ""] = /^data:image\/png;base64,(.*)$/.exec(uri ?? "") ?? [];
  return [...Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))];
}

describe("the map picture close step", () => {
  it("uploads one picture to the thread's first message, above the map links, and sets it as the event's cover", async () => {
    const guild = "200000000000000901";
    const view = await dateVoting(guild, INSIDE);
    const sent = discord(guild);
    await close(guild, view);

    // Nothing leaves for any host but Discord's.
    expect(new Set(sent.map((r) => r.host))).toEqual(new Set(["discord.com"]));
    const [upload, ...more] = uploads(sent);
    expect(more).toEqual([]);
    expect(upload?.files).toHaveLength(1);
    expect(upload?.files[0]).toMatchObject({
      field: "files[0]",
      name: MAP_PICTURE_FILE,
      type: "image/png",
    });
    expect([...(upload?.files[0]?.bytes.subarray(0, 8) ?? [])]).toEqual(
      PNG_SIGNATURE,
    );
    expect(upload?.body.attachments).toEqual([
      { id: 0, filename: MAP_PICTURE_FILE },
    ]);
    // The gallery comes before the text with the map links.
    const nodes = flatten(upload?.body.components ?? []);
    const gallery = nodes.findIndex((c) => c.type === GALLERY);
    const links = nodes.findIndex((c) => c.content?.includes("openstreetmap"));
    expect(galleryUrls(upload?.body.components)).toEqual([MAP_PICTURE_URL]);
    expect(gallery).toBeGreaterThan(-1);
    expect(links).toBeGreaterThan(gallery);
    // The edit keeps the weather block the thread shows.
    expect(text(upload?.body.components)).toContain(
      "### Weather\nThe forecast appears 16 days before the hike.",
    );

    const [cover, ...moreCovers] = eventEdits(guild, sent);
    expect(moreCovers).toEqual([]);
    expect(dataBytes(cover?.body.image).slice(0, 8)).toEqual(PNG_SIGNATURE);
    expect(dataBytes(cover?.body.image)).toEqual([
      ...(upload?.files[0]?.bytes ?? []),
    ]);

    // After the thread and the event, before the announcement.
    const order = sent.map((r) => r.route);
    expect(
      order.indexOf(`POST /guilds/${guild}/scheduled-events`),
    ).toBeLessThan(sent.indexOf(upload as Sent));
    expect(
      order.lastIndexOf(`POST /channels/${NEWS}/messages`),
    ).toBeGreaterThan(sent.indexOf(cover as Sent));

    const round = await roundOf(guild, view);
    expect(round?.mapPictureKey).toMatch(/^pictures\/.*\.png$/);
    const kept = await env.MAPS.get(round?.mapPictureKey ?? "");
    expect(new Uint8Array((await kept?.arrayBuffer()) ?? [])).toEqual(
      upload?.files[0]?.bytes,
    );
    const { shown, buttons } = await panel(guild);
    expect(shown).toContain("**Map picture:** on the hike thread and event.");
    expect(buttons).not.toContain(
      POLL_CONTROL_IDS.showMapPicture(view.roundId),
    );
  });

  it("is drawn once when the object restarts between the event and the picture", async () => {
    const guild = "200000000000000902";
    const view = await dateVoting(guild, INSIDE);
    const sent = discord(guild);
    const outcome = await stub(guild).handleInteraction(
      click(POLL_IDS.closeConfirm(view.id), guild),
    );
    expect(outcome).toMatchObject({ followUp: true });
    // The follow-up does the final edit, the thread and the event, then the
    // object restarts before the picture step starts.
    await inObject(guild, async (storage) => {
      const store = new PollStore(storage);
      const closed: ClosedPoll = {
        poll: store.getPoll(view.id) as PollView,
        round: store.getRound(view.roundId),
        guildId: guild,
        timeZone: "America/Los_Angeles",
      };
      startPart(storage, view.id, FINALIZE_PART, store.now());
      finishPart(storage, view.id, FINALIZE_PART);
      for (const step of [createHikeThreadStep, createHikeEventStep]) {
        startPart(storage, view.id, step.name, store.now());
        const result = await step.run(closed, { env, storage });
        finishPart(storage, view.id, step.name, result.announce);
      }
      expect(pendingClose(storage, view.id)?.parts[0]?.name).toBe(
        "show the map picture",
      );
    });
    await evictDurableObject(stub(guild));
    expect(uploads(sent)).toEqual([]);

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(uploads(sent)).toHaveLength(1);
    expect(eventEdits(guild, sent)).toHaveLength(1);
    expect(
      sent.filter((r) => r.route === `POST /channels/${FORUM}/threads`),
    ).toHaveLength(1);
    expect(await inObject(guild, (s) => pendingClose(s, view.id))).toBeNull();

    // Another run of the job draws nothing more.
    await runDurableObjectAlarm(stub(guild));
    expect(uploads(sent)).toHaveLength(1);
    expect(eventEdits(guild, sent)).toHaveLength(1);
  });

  it("is not drawn again when it was cut off; the panel shows it unconfirmed and Show map picture shows it once", async () => {
    const guild = "200000000000000903";
    const view = await dateVoting(guild, INSIDE);
    const sent = discord(guild);
    const outcome = await stub(guild).handleInteraction(
      click(POLL_IDS.closeConfirm(view.id), guild),
    );
    expect(outcome).toMatchObject({ followUp: true });
    await evictDurableObject(stub(guild));
    await inObject(guild, (storage) => {
      const store = new PollStore(storage);
      const long = store.now() - 2 * PICTURE_CLAIM_MS;
      // The thread and the event exist; the picture step started and was
      // cut off before Discord answered.
      store.setRoundThread(view.roundId, THREAD);
      store.setRoundEvent(view.roundId, EVENT);
      const record = pendingClose(storage, view.id);
      for (const part of record?.parts ?? []) {
        if (part.name === "show the map picture") break;
        finishPart(storage, view.id, part.name);
      }
      startPart(storage, view.id, "show the map picture", long);
      const round = store.getRound(view.roundId);
      if (round === null) throw new Error("no round");
      expect(claimMapPicture(storage, round, long)).toBe(true);
    });
    await evictDurableObject(stub(guild));
    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(uploads(sent)).toEqual([]);

    const before = await panel(guild);
    expect(before.shown).toContain(
      "**Map picture:** not confirmed: showing it was cut off",
    );
    expect(before.buttons).toContain(
      POLL_CONTROL_IDS.showMapPicture(view.roundId),
    );
    await send(click(POLL_CONTROL_IDS.showMapPicture(view.roundId), guild));
    expect(uploads(sent)).toHaveLength(1);
    expect(eventEdits(guild, sent)).toHaveLength(1);
    expect((await panel(guild)).shown).toContain(
      "**Map picture:** on the hike thread and event.",
    );
  });

  it("draws nothing for a hike without a pin, and the panel shows no step", async () => {
    const guild = "200000000000000904";
    const view = await dateVoting(guild, null);
    const sent = discord(guild);
    const painted = vi.spyOn(MapPainter.prototype, "picture");
    await close(guild, view);
    expect(painted).not.toHaveBeenCalled();
    expect(uploads(sent)).toEqual([]);
    expect(eventEdits(guild, sent)).toEqual([]);
    expect((await roundOf(guild, view))?.mapPictureKey).toBeNull();
    const { shown, buttons } = await panel(guild);
    expect(shown).not.toContain("Map picture");
    expect(buttons).not.toContain(
      POLL_CONTROL_IDS.showMapPicture(view.roundId),
    );
  });

  it("shows nothing for a pin outside our map data, keeps the links, and the panel shows no step", async () => {
    const guild = "200000000000000905";
    const view = await dateVoting(guild, OUTSIDE);
    const sent = discord(guild);
    await close(guild, view);
    expect(uploads(sent)).toEqual([]);
    expect(eventEdits(guild, sent)).toEqual([]);
    const thread = sent.find(
      (r) => r.route === `POST /channels/${FORUM}/threads`,
    );
    expect(JSON.stringify(thread?.body)).toContain("openstreetmap.org");
    expect((await roundOf(guild, view))?.mapPictureKey).toBeNull();
    const { shown, buttons } = await panel(guild);
    expect(shown).not.toContain("Map picture");
    expect(buttons).not.toContain(
      POLL_CONTROL_IDS.showMapPicture(view.roundId),
    );
    expect(
      await inObject(guild, async (storage) => {
        const store = new PollStore(storage);
        const round = await Promise.resolve(store.getRound(view.roundId));
        return round && mapPictureStatus(storage, round, store.now());
      }),
    ).toEqual({ state: "none" });
  });

  it("does not fail the close when drawing fails, and the retry draws it", async () => {
    const guild = "200000000000000906";
    const view = await dateVoting(guild, INSIDE);
    const sent = discord(guild);
    const painted = vi
      .spyOn(MapPainter.prototype, "picture")
      .mockImplementationOnce(() => {
        throw new Error("out of memory");
      });
    await close(guild, view);
    expect(painted).toHaveBeenCalledTimes(1);
    expect(uploads(sent)).toEqual([]);
    // The announcement still went out.
    expect(sent.map((r) => r.route)).toContain(
      `POST /channels/${NEWS}/messages`,
    );
    const failed = await panel(guild);
    expect(failed.shown).toContain(
      "**Map picture:** not shown. Could not draw the map picture: out of memory. Click Show map picture to try again.",
    );
    expect(failed.buttons).toContain(
      POLL_CONTROL_IDS.showMapPicture(view.roundId),
    );

    await send(click(POLL_CONTROL_IDS.showMapPicture(view.roundId), guild));
    expect(uploads(sent)).toHaveLength(1);
    expect(eventEdits(guild, sent)).toHaveLength(1);
    expect((await panel(guild)).shown).toContain(
      "**Map picture:** on the hike thread and event.",
    );
  });

  it("leaves the links when Discord refuses the upload, and the retry uploads it", async () => {
    const guild = "200000000000000907";
    const view = await dateVoting(guild, INSIDE);
    let refusals = 1;
    const sent = discord(guild, (route) => {
      if (route !== `PATCH ${THREAD_MESSAGE}` || refusals === 0) {
        return undefined;
      }
      // Only the upload is refused, not the edit that links the event.
      const last = sent[sent.length - 1];
      if (!last?.files.length) return undefined;
      refusals -= 1;
      return Response.json(
        { message: "Request entity too large", code: 40005 },
        { status: 413 },
      );
    });
    await close(guild, view);
    expect(uploads(sent)).toHaveLength(1);
    // The event's cover was not set either: the step stops at the failure.
    expect(eventEdits(guild, sent)).toEqual([]);
    expect((await roundOf(guild, view))?.mapPictureKey).toBeNull();
    const failed = await panel(guild);
    expect(failed.shown).toContain(
      "**Map picture:** not shown. Could not show the map picture on the hike thread: Discord answered: Request entity too large (HTTP 413, code 40005). Click Show map picture to try again.",
    );
    expect(failed.buttons).toContain(
      POLL_CONTROL_IDS.showMapPicture(view.roundId),
    );

    await send(click(POLL_CONTROL_IDS.showMapPicture(view.roundId), guild));
    expect(uploads(sent)).toHaveLength(2);
    expect(eventEdits(guild, sent)).toHaveLength(1);
    expect((await roundOf(guild, view))?.mapPictureKey).toMatch(/^pictures\//);
  });
});

describe("after the picture is shown", () => {
  /** A closed round whose picture is shown; returns what was sent. */
  async function shownRound(guild: string) {
    const view = await dateVoting(guild, INSIDE);
    const sent = discord(guild);
    await close(guild, view);
    expect(uploads(sent)).toHaveLength(1);
    return { view, sent };
  }

  it("keeps the picture when another feature edits the thread's first message", async () => {
    const guild = "200000000000000911";
    const { view, sent } = await shownRound(guild);
    await inObject(guild, async (storage) => {
      const store = new PollStore(storage);
      const round = store.getRound(view.roundId);
      const location = round?.locationPoll?.options[0];
      if (!round || !location) throw new Error("no round");
      await updateThreadPin.run(
        { round, location, guildId: guild, timeZone: "America/Los_Angeles" },
        { env, storage },
      );
    });
    const edit = sent[sent.length - 1];
    expect(edit?.route).toBe(`PATCH ${THREAD_MESSAGE}`);
    expect(edit?.files).toEqual([]);
    // Without `attachments`, Discord keeps the message's attachments, and
    // the gallery still shows the picture.
    expect(edit?.body).not.toHaveProperty("attachments");
    expect(galleryUrls(edit?.body.components)).toEqual([MAP_PICTURE_URL]);
  });

  it("replaces the picture on both when the pin moves", async () => {
    const guild = "200000000000000912";
    const { view, sent } = await shownRound(guild);
    const first = await roundOf(guild, view);
    const [oldUpload] = uploads(sent);
    const [oldCover] = eventEdits(guild, sent);
    const notes = await inObject(guild, async (storage) => {
      const set = await setMapPin(
        { env, storage },
        { roundId: view.roundId, point: MOVED, guildId: guild },
        MAP_PIN_HOOKS,
      );
      return set?.notes;
    });
    expect(notes).toEqual([]);
    const [, upload] = uploads(sent);
    // Only the new file is listed, so Discord removes the old one.
    expect(upload?.body.attachments).toEqual([
      { id: 0, filename: MAP_PICTURE_FILE },
    ]);
    expect(upload?.files[0]?.bytes).not.toEqual(oldUpload?.files[0]?.bytes);
    const [, cover] = eventEdits(guild, sent).filter(
      (r) => r.body.image !== undefined,
    );
    expect(cover?.body.image).not.toEqual(oldCover?.body.image);
    expect(dataBytes(cover?.body.image)).toEqual([
      ...(upload?.files[0]?.bytes ?? []),
    ]);
    const round = await roundOf(guild, view);
    expect(round?.mapPictureKey).toMatch(/^pictures\//);
    expect(round?.mapPictureKey).not.toBe(first?.mapPictureKey);
    expect(round?.mapPictureKey).toContain(
      `${MOVED.lat.toFixed(5)},${MOVED.lon.toFixed(5)}`,
    );
  });

  it("offers Show map picture when the pin moved and its hooks never ran", async () => {
    const guild = "200000000000000915";
    const { view, sent } = await shownRound(guild);
    await inObject(guild, (storage) => {
      expect(
        storeMapPin(storage, view.roundId, MOVED, guild, "America/Los_Angeles"),
      ).not.toBeNull();
    });
    const { shown, buttons } = await panel(guild);
    expect(shown).toContain(
      "**Map picture:** not shown. Click Show map picture to draw it.",
    );
    expect(buttons).toContain(POLL_CONTROL_IDS.showMapPicture(view.roundId));
    await send(click(POLL_CONTROL_IDS.showMapPicture(view.roundId), guild));
    expect(uploads(sent)).toHaveLength(2);
    expect((await roundOf(guild, view))?.mapPictureKey).toContain(
      `${MOVED.lat.toFixed(5)},${MOVED.lon.toFixed(5)}`,
    );
  });

  it("shows the new pin when the pin moves while a run is drawing the old one", async () => {
    const guild = "200000000000000916";
    const { view, sent } = await shownRound(guild);
    const original = Object.getOwnPropertyDescriptor(
      MapPainter.prototype,
      "picture",
    )?.value as MapPainter["picture"];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const painted = vi
      .spyOn(MapPainter.prototype, "picture")
      .mockImplementationOnce(async function (this: MapPainter, request) {
        await held;
        return original.call(this, request);
      });
    // A run (Show map picture) starts drawing the old pin...
    const showing = inObject(guild, (storage) => {
      const store = new PollStore(storage);
      const round = store.getRound(view.roundId);
      if (round === null) throw new Error("no round");
      expect(claimMapPicture(storage, round, store.now())).toBe(true);
      return showMapPicture(view.roundId, guild, "America/Los_Angeles", {
        env,
        storage,
      });
    });
    await vi.waitFor(() => {
      expect(painted).toHaveBeenCalledTimes(1);
    });
    // ...the admin moves the pin meanwhile: its hook leaves it to that run.
    const notes = await inObject(guild, async (storage) => {
      const set = await setMapPin(
        { env, storage },
        { roundId: view.roundId, point: MOVED, guildId: guild },
        MAP_PIN_HOOKS,
      );
      const store = new PollStore(storage);
      const round = store.getRound(view.roundId);
      expect(round && mapPictureStatus(storage, round, store.now())).toEqual({
        state: "showing",
      });
      return set?.notes;
    });
    expect(notes).toEqual([]);
    expect(uploads(sent)).toHaveLength(1);
    release();
    expect(await showing).toMatchObject({ ok: true });

    // The run drew the new pin and uploaded only that.
    expect(painted).toHaveBeenCalledTimes(2);
    expect(painted.mock.calls[1]?.[0]).toMatchObject(MOVED);
    expect(uploads(sent)).toHaveLength(2);
    const round = await roundOf(guild, view);
    expect(round?.mapPictureKey).toContain(
      `${MOVED.lat.toFixed(5)},${MOVED.lon.toFixed(5)}`,
    );
    expect((await panel(guild)).shown).toContain(
      "**Map picture:** on the hike thread and event.",
    );
  });

  it("offers the new pin when the pin moves while the old one is being uploaded", async () => {
    const guild = "200000000000000917";
    const view = await dateVoting(guild, INSIDE);
    let moved = false;
    const sent = discord(guild);
    await close(guild, view);
    vi.restoreAllMocks();
    // Discord answers the next upload only after the pin moved.
    const moving = discord(guild, async (route) => {
      const last = moving[moving.length - 1];
      if (route === `PATCH ${THREAD_MESSAGE}` && last?.files.length && !moved) {
        moved = true;
        await inObject(guild, (storage) => {
          storeMapPin(storage, view.roundId, MOVED, guild, "UTC");
        });
      }
      return undefined;
    });
    expect(uploads(sent)).toHaveLength(1);
    const status = await inObject(guild, async (storage) => {
      const store = new PollStore(storage);
      const round = store.getRound(view.roundId);
      if (round === null) throw new Error("no round");
      claimMapPicture(storage, round, store.now());
      const shown = await showMapPicture(
        view.roundId,
        guild,
        "America/Los_Angeles",
        { env, storage },
      );
      expect(shown).toMatchObject({ ok: true });
      const after = store.getRound(view.roundId);
      return after && mapPictureStatus(storage, after, store.now());
    });
    expect(moved).toBe(true);
    expect(uploads(moving)).toHaveLength(1);
    // What is shown is the old pin's, so the panel offers the new one.
    expect(status).toEqual({ state: "missing" });
    const { shown, buttons } = await panel(guild);
    expect(shown).toContain(
      "**Map picture:** not shown. Click Show map picture to draw it.",
    );
    expect(buttons).toContain(POLL_CONTROL_IDS.showMapPicture(view.roundId));
  });

  it("takes the picture off both when the pin is cleared", async () => {
    const guild = "200000000000000913";
    const { view, sent } = await shownRound(guild);
    const count = sent.length;
    await inObject(guild, async (storage) => {
      await setMapPin(
        { env, storage },
        { roundId: view.roundId, point: null, guildId: guild },
        MAP_PIN_HOOKS,
      );
    });
    const after = sent.slice(count);
    const removal = after.filter(
      (r) => r.route === `PATCH ${THREAD_MESSAGE}` && r.body.attachments,
    );
    expect(removal).toHaveLength(1);
    expect(removal[0]?.body.attachments).toEqual([]);
    expect(galleryUrls(removal[0]?.body.components)).toEqual([]);
    expect(
      eventEdits(guild, after).filter((r) => r.body.image !== undefined),
    ).toEqual([
      expect.objectContaining({ body: { image: null } }) as unknown as Sent,
    ]);
    expect((await roundOf(guild, view))?.mapPictureKey).toBeNull();
    expect((await panel(guild)).shown).not.toContain("Map picture");
  });

  it("shows it again on a thread that a retry created", async () => {
    const guild = "200000000000000914";
    const view = await dateVoting(guild, INSIDE);
    let failThread = true;
    const sent = discord(guild, (route) =>
      route === `POST /channels/${FORUM}/threads` && failThread
        ? Response.json(
            { message: "Missing Permissions", code: 50013 },
            { status: 403 },
          )
        : undefined,
    );
    await close(guild, view);
    // Without a thread, the picture went on the event alone.
    expect(uploads(sent)).toEqual([]);
    expect(eventEdits(guild, sent)).toHaveLength(1);
    expect((await roundOf(guild, view))?.mapPictureKey).toMatch(/^pictures\//);

    failThread = false;
    await send(click(POLL_CONTROL_IDS.createHikeThread(view.roundId), guild));
    const thread = sent.filter(
      (r) => r.route === `POST /channels/${FORUM}/threads`,
    );
    expect(thread).toHaveLength(2);
    // The new thread is created without the gallery, then gets the upload.
    expect(galleryUrls(thread[1]?.body.components)).toEqual([]);
    expect(uploads(sent)).toHaveLength(1);
    expect((await panel(guild)).shown).toContain(
      "**Map picture:** on the hike thread and event.",
    );
  });
});

describe("retryMapPicture", () => {
  it("refuses another round, a shown picture, nothing to draw and a run in progress", async () => {
    const guild = "200000000000000921";
    const view = await dateVoting(guild, INSIDE);
    discord(guild);
    await close(guild, view);
    await inObject(guild, async (storage) => {
      const context = { env, storage, guildId: guild };
      expect(
        retryMapPicture(context, OWNER, { roundId: view.roundId + 1 }),
      ).toMatchObject({ ok: false, code: "not_last" });
      expect(
        retryMapPicture(context, OWNER, { roundId: view.roundId }),
      ).toMatchObject({ ok: false, code: "shown" });

      const store = new PollStore(storage);
      const round = store.getRound(view.roundId);
      if (round === null) throw new Error("no round");
      store.setOptionPin(round.locationOptionId ?? 0, null);
      store.setRoundMapPicture(round.id, null);
      expect(
        retryMapPicture(context, OWNER, { roundId: view.roundId }),
      ).toMatchObject({ ok: false, code: "none" });

      store.setOptionPin(round.locationOptionId ?? 0, MOVED);
      const first = retryMapPicture(context, OWNER, { roundId: view.roundId });
      expect(first.ok).toBe(true);
      expect(
        retryMapPicture(context, OWNER, { roundId: view.roundId }),
      ).toEqual({
        ok: false,
        code: "showing",
        message: "The map picture is being drawn.",
      });
      if (first.ok) {
        expect(await first.work()).toEqual([
          "The map picture is on the hike thread and event.",
        ]);
      }
    });
  });
});

describe("the date vote's close steps", () => {
  it("runs the picture after the thread and the event", () => {
    const names = DATE_POLL.closeSteps.map((step) => step.name);
    expect(names.indexOf("show the map picture")).toBeGreaterThan(
      names.indexOf("create the hike event"),
    );
    expect(names.indexOf("create the hike event")).toBeGreaterThan(
      names.indexOf("create the hike thread"),
    );
  });
});
