/**
 * The hike's map picture through a whole round: when the date vote closes,
 * the bot draws the map round the decided location's pin from our own map
 * data (the sample archive in the `MAPS` bucket, which covers Mount Si,
 * `maps/sample/sample.json`), uploads it to the hike thread's first message,
 * shown by a media gallery above the map links, and sets it as the cover of
 * the hike's scheduled event. It replaces both when the pin moves, can be
 * shown again from the panel after a failure, and is left out when the hike
 * has no pin or our map data does not cover it.
 */
import { ComponentType } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import type {
  FakeMessage,
  FakeScheduledEvent,
  RecordedRequest,
} from "./harness/fake-discord";
import {
  allComponents,
  eventually,
  findComponent,
  Member,
  messageText,
} from "./harness/helpers";
import {
  ROUND_IDS,
  RoundPlayer,
  idStarting,
  idsStarting,
  type TestGuild,
} from "./harness/rounds";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PICTURE_URL = "attachment://hike-map.png";
const SHOWN = "**Map picture:** on the hike thread and event.";
/** Drawing a picture takes a few seconds, the first one up to about ten. */
const DRAW = { timeout: 30_000 };
/** Lookups wait two seconds after a proposal, then run 1.1 s apart. */
const LOOKUP = { timeout: 15_000 };

/** Inside the sample map data (bbox -121.8, 47.45, -121.65, 47.55). */
const MOUNT_SI = {
  lat: 47.4875,
  lon: -121.7234,
  displayName: "Mount Si, King County, Washington, United States",
};
const LITTLE_SI = {
  lat: 47.4867,
  lon: -121.7533,
  displayName: "Little Si, King County, Washington, United States",
};
/** Far outside the sample map data, on another continent. */
const MONT_BLANC = {
  lat: 45.8326,
  lon: 6.8652,
  displayName: "Mont Blanc, Chamonix, Haute-Savoie, France",
};

/** The starter message of the guild's only hike thread. */
function threadMessage(g: TestGuild): FakeMessage {
  const [thread] = e2e.discord.threads(g.channels.forum);
  const [first] = e2e.discord.channelMessages(thread?.id ?? "");
  if (!thread || !first) throw new Error("the hike thread was not created");
  return first;
}

/** The guild's only scheduled event. */
function hikeEvent(g: TestGuild): FakeScheduledEvent {
  const [event] = e2e.discord.scheduledEvents(g.guildId);
  if (!event) throw new Error("the hike event was not created");
  return event;
}

function eventImage(g: TestGuild): Uint8Array | undefined {
  return e2e.discord.scheduledEventImage(g.guildId, hikeEvent(g).id);
}

function expectPng(bytes: Uint8Array | undefined): void {
  expect([...(bytes ?? new Uint8Array()).subarray(0, 8)]).toEqual(
    PNG_SIGNATURE,
  );
}

/** The media galleries of a message, in display order. */
function galleries(message: { components: unknown[] }) {
  return allComponents(message.components).filter(
    (c) => c.type === ComponentType.MediaGallery,
  );
}

/**
 * Checks the thread's first message shows the uploaded picture through a
 * media gallery above the Text Display with the map links.
 */
function expectPictureAboveLinks(message: FakeMessage): void {
  const components = allComponents(message.components);
  const gallery = components.findIndex(
    (c) => c.type === ComponentType.MediaGallery,
  );
  const links = components.findIndex(
    (c) =>
      c.type === ComponentType.TextDisplay &&
      String(c.content).includes("[OpenStreetMap]("),
  );
  expect(gallery).toBeGreaterThanOrEqual(0);
  expect(links).toBeGreaterThan(gallery);
  expect(components[gallery]?.items).toMatchObject([
    { media: { url: PICTURE_URL } },
  ]);
  expect(message.attachments.map((a) => a.filename)).toEqual(["hike-map.png"]);
  expectPng(message.attachments[0]?.bytes);
}

/** Clicks Refresh until the panel shows `text`. */
async function refreshUntil(
  g: TestGuild,
  panel: FakeMessage,
  text: string,
  options = {},
): Promise<void> {
  await eventually(async () => {
    await g.owner.click(panel, ROUND_IDS.refresh);
    expect(messageText(play.shown(panel))).toContain(text);
  }, options);
}

/** The edits of the thread's first message among `requests`. */
function threadEdits(
  g: TestGuild,
  requests: readonly RecordedRequest[],
): RecordedRequest[] {
  const thread = threadMessage(g).id;
  return requests.filter(
    (r) =>
      r.method === "PATCH" &&
      r.path === `/channels/${thread}/messages/${thread}`,
  );
}

/**
 * Plays the round up to an open date vote: a location vote on `location`
 * alone, waiting for its lookup to finish (`located` when the geocoder
 * knows it), closed with it the winner, then the date vote voted on.
 * Returns the panel and the date poll.
 */
async function upToDateClose(
  g: TestGuild,
  location: string,
  located: boolean,
): Promise<{ panel: FakeMessage; voter: Member; when: FakeMessage }> {
  const [voter] = g.members as [Member];
  const panel = await play.setUpPanel(g);
  const where = await play.startLocationVote(g, panel, location);
  await e2e.geocoder.nextRequest((r) => r.query.q === location, 10_000);
  if (located) {
    await eventually(() => {
      expect(messageText(play.shown(where))).toContain(`📍 ${location}`);
    }, LOOKUP);
  }
  await play.vote(voter, where, [location]);
  await play.closeVote(g.owner, panel, "location vote");
  const when = await play.startDateVote(
    g,
    panel,
    ["2030-06-08", "2030-06-15"].join("\n"),
  );
  await play.vote(voter, when, ["Sat, 15 Jun 2030 · 11:00"]);
  return { panel, voter, when };
}

/** The request log of the fake Discord API after the outbound mark `mark`. */
function discordSince(mark: number): RecordedRequest[] {
  return e2e.discord.requests.filter((r) => r.seq > mark);
}

describe("the hike's map picture", () => {
  it("is put on the thread and the event when the date vote closes, calling nothing but Discord, and replaced when the pin moves", async () => {
    const g = play.guild(1);
    e2e.geocoder.addPlace("Mount Si", MOUNT_SI);
    const { panel } = await upToDateClose(g, "Mount Si", true);

    const mark = e2e.outboundMark();
    await play.closeVote(g.owner, panel, "date vote", DRAW);
    await eventually(() => {
      expect(threadMessage(g).attachments).toHaveLength(1);
      expectPng(eventImage(g));
    }, DRAW);
    await refreshUntil(g, panel, SHOWN);
    const end = e2e.outboundMark();

    // During the close the bot called only Discord: the picture is drawn
    // from our own map data, not fetched from anywhere.
    const outbound = e2e.outbound(mark).filter((r) => r.seq <= end);
    expect(outbound.length).toBeGreaterThan(0);
    expect(outbound.filter((r) => r.host !== "discord")).toEqual([]);

    const message = threadMessage(g);
    expectPictureAboveLinks(message);
    expect(messageText(message)).toContain(
      "📍 Mount Si, King County, Washington · [OpenStreetMap](",
    );
    const [upload] = threadEdits(g, discordSince(mark)).filter(
      (r) => r.files !== undefined,
    );
    expect(upload?.headers["content-type"]).toMatch(/^multipart\/form-data/);
    expect(upload?.files).toMatchObject([
      { field: "files[0]", filename: "hike-map.png", contentType: "image/png" },
    ]);
    expect(upload?.body).toMatchObject({
      attachments: [{ id: 0, filename: "hike-map.png" }],
    });
    expect(upload?.status).toBe(200);
    const event = hikeEvent(g);
    expect(event.image).toEqual(expect.any(String));
    expectPng(eventImage(g));
    expect(idsStarting(play.shown(panel), "hb:map:show:")).toEqual([]);

    // Moving the pin within the map data replaces the picture on both.
    const before = message.attachments[0];
    const beforeImage = event.image;
    const pinMark = e2e.outboundMark();
    const form = await g.owner.click(
      panel,
      idStarting(play.shown(panel), "hb:pin:set:"),
    );
    await g.owner.submitModal(
      form,
      { "hb:pin:point": "47.51, -121.71" },
      panel,
    );
    await eventually(() => {
      expect(messageText(play.shown(panel))).toContain(
        "The map pin of **Mount Si** is set to 47.51, -121.71.",
      );
    }, DRAW);
    const moved = threadMessage(g);
    expect(moved.attachments).toHaveLength(1);
    expect(moved.attachments[0]?.id).not.toBe(before?.id);
    expectPictureAboveLinks(moved);
    expect(messageText(moved)).toContain("mlat=47.51&mlon=-121.71");
    expect(hikeEvent(g).image).not.toBe(beforeImage);
    expect(hikeEvent(g).image).toEqual(expect.any(String));
    expectPng(eventImage(g));
    await refreshUntil(g, panel, SHOWN);

    // The thread's own pin update came first, as a JSON edit that left
    // `attachments` out, so Discord kept the old picture its gallery names.
    const [jsonEdit] = threadEdits(g, discordSince(pinMark)).filter(
      (r) => r.files === undefined,
    );
    expect(jsonEdit?.headers["content-type"]).toBe("application/json");
    expect(jsonEdit?.status).toBe(200);
    expect(jsonEdit?.body).not.toHaveProperty("attachments");
    expect(
      galleries({
        components: (jsonEdit?.body as { components: unknown[] }).components,
      }),
    ).toMatchObject([{ items: [{ media: { url: PICTURE_URL } }] }]);
    expect(jsonEdit?.response).toMatchObject({
      attachments: [{ id: before?.id, filename: "hike-map.png" }],
    });
  });

  it("keeps the picture through the thread's JSON edit that links an event created by Create hike event, then shows it on the event", async () => {
    const g = play.guild(2);
    e2e.geocoder.addPlace("Little Si", LITTLE_SI);
    const { panel } = await upToDateClose(g, "Little Si", true);
    e2e.discord.revokeCreateEvents(g.guildId);
    await play.closeVote(g.owner, panel, "date vote", DRAW);
    await eventually(() => {
      expect(threadMessage(g).attachments).toHaveLength(1);
    }, DRAW);
    await refreshUntil(g, panel, SHOWN);
    expect(e2e.discord.scheduledEvents(g.guildId)).toEqual([]);
    const [shown] = threadMessage(g).attachments;

    e2e.discord.grantCreateEvents(g.guildId);
    const mark = e2e.outboundMark();
    await g.owner.click(
      panel,
      idStarting(play.shown(panel), "hb:event:create:"),
    );
    await eventually(() => {
      expectPng(eventImage(g));
    }, DRAW);
    await refreshUntil(g, panel, "**Hike event:** created.");
    await refreshUntil(g, panel, SHOWN);

    const edits = threadEdits(g, discordSince(mark));
    const link = edits.find((r) => r.files === undefined);
    expect(link?.headers["content-type"]).toBe("application/json");
    expect(link?.status).toBe(200);
    expect(link?.body).not.toHaveProperty("attachments");
    expect(messageText(link?.body as { components: unknown[] })).toContain(
      `**Hike event:** https://discord.com/events/${g.guildId}/${hikeEvent(g).id}`,
    );
    expect(galleries(link?.body as { components: unknown[] })).toMatchObject([
      { items: [{ media: { url: PICTURE_URL } }] },
    ]);
    expect(link?.response).toMatchObject({
      attachments: [{ id: shown?.id, filename: "hike-map.png" }],
    });
    // Shown again after the event was made: still one picture.
    const message = threadMessage(g);
    expectPictureAboveLinks(message);
    expect(messageText(message)).toContain(
      `**Hike event:** https://discord.com/events/${g.guildId}/${hikeEvent(g).id}`,
    );
  });

  it("leaves the links when the upload fails, and shows the picture from the panel's Show map picture", async () => {
    const g = play.guild(3);
    e2e.geocoder.addPlace("Mount Si East", {
      ...MOUNT_SI,
      lat: 47.49,
      lon: -121.7,
      displayName: "Mount Si East, King County, Washington, United States",
    });
    const { panel } = await upToDateClose(g, "Mount Si East", true);
    e2e.discord.failNextUpload(g.channels.forum);
    await play.closeVote(g.owner, panel, "date vote", DRAW);
    await refreshUntil(g, panel, "**Map picture:** not shown.", DRAW);

    const failed = messageText(play.shown(panel));
    expect(failed).toContain(
      "**Map picture:** not shown. Could not show the map picture on the hike thread: ",
    );
    expect(failed).toContain("Click Show map picture to try again.");
    const roundId = idStarting(play.shown(panel), "hb:pin:set:").slice(
      "hb:pin:set:".length,
    );
    const show = `hb:map:show:${roundId}`;
    expect(findComponent(play.shown(panel).components, show)).toMatchObject({
      label: "Show map picture",
    });
    const refusedUpload = threadEdits(g, e2e.discord.requests).filter(
      (r) => r.files !== undefined,
    );
    expect(refusedUpload.map((r) => r.status)).toEqual([500]);
    const message = threadMessage(g);
    expect(message.attachments).toEqual([]);
    expect(galleries(message)).toEqual([]);
    expect(messageText(message)).toContain(
      "📍 Mount Si East, King County, Washington · [OpenStreetMap](",
    );
    expect(hikeEvent(g).image).toBeNull();
    expect(eventImage(g)).toBeUndefined();

    await g.owner.click(panel, show);
    await eventually(() => {
      expect(threadMessage(g).attachments).toHaveLength(1);
      expectPng(eventImage(g));
    }, DRAW);
    await refreshUntil(g, panel, SHOWN);
    expectPictureAboveLinks(threadMessage(g));
    expect(hikeEvent(g).image).toEqual(expect.any(String));
    expect(idsStarting(play.shown(panel), "hb:map:show:")).toEqual([]);
  });

  it("is left out when the geocoder does not know the location", async () => {
    const g = play.guild(4);
    const { panel } = await upToDateClose(g, "Nowhere Ridge", false);
    const mark = e2e.outboundMark();
    await play.closeVote(g.owner, panel, "date vote", DRAW);
    await refreshUntil(g, panel, "**Hike event:** created.");
    expectNoPicture(g, panel, mark);
  });

  it("is left out when our map data does not cover the pin", async () => {
    const g = play.guild(5);
    e2e.geocoder.addPlace("Mont Blanc", MONT_BLANC);
    const { panel } = await upToDateClose(g, "Mont Blanc", true);
    const mark = e2e.outboundMark();
    await play.closeVote(g.owner, panel, "date vote", DRAW);
    await refreshUntil(g, panel, "**Hike event:** created.");
    expect(messageText(threadMessage(g))).toContain(
      "📍 Mont Blanc, Chamonix, Haute-Savoie · [OpenStreetMap](",
    );
    expectNoPicture(g, panel, mark);
  });
});

/**
 * Checks that the hike has no picture: no attachment or gallery on the
 * thread, no cover on the event, no upload or cover edit since `mark`, and
 * no Map picture line or button on the panel.
 */
function expectNoPicture(g: TestGuild, panel: FakeMessage, mark: number): void {
  const message = threadMessage(g);
  expect(message.attachments).toEqual([]);
  expect(galleries(message)).toEqual([]);
  expect(hikeEvent(g).image).toBeNull();
  expect(eventImage(g)).toBeUndefined();
  const since = discordSince(mark);
  expect(since.filter((r) => r.files !== undefined)).toEqual([]);
  expect(
    since.filter(
      (r) => typeof r.body === "object" && r.body !== null && "image" in r.body,
    ),
  ).toEqual([]);
  const shown = play.shown(panel);
  expect(messageText(shown)).toContain("**Hike thread:** <#");
  expect(messageText(shown)).not.toContain("**Map picture:**");
  expect(idsStarting(shown, "hb:map:show:")).toEqual([]);
}
