import { describe, expect, it } from "vitest";
import type { FakeMessage } from "./harness/fake-discord";
import { eventually, Member, messageText } from "./harness/helpers";
import {
  ROUND_IDS,
  RoundPlayer,
  expectEphemeral,
  idStarting,
  type TestGuild,
} from "./harness/rounds";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

const ATTRIBUTION = "-# © OpenStreetMap contributors";
const SI_OSM =
  "https://www.openstreetmap.org/?mlat=47.4875&mlon=-121.7234#map=13/47.4875/-121.7234";
const SI_GOOGLE =
  "https://www.google.com/maps/search/?api=1&query=47.4875,-121.7234";

/** Lookups wait two seconds after a proposal, then run 1.1 s apart. */
const LOOKUP_TIMEOUT = { timeout: 15_000 };

function addMountSi(): void {
  e2e.geocoder.addPlace("Mount Si", {
    lat: 47.4875,
    lon: -121.7234,
    displayName: "Mount Si, King County, Washington, United States",
  });
}

/** The starter message of the guild's only hike thread. */
function threadMessage(g: TestGuild): FakeMessage {
  const [thread] = e2e.discord.threads(g.channels.forum);
  const [first] = e2e.discord.channelMessages(thread?.id ?? "");
  if (!thread || !first) throw new Error("the hike thread was not created");
  return first;
}

function eventDescription(g: TestGuild): string {
  return e2e.discord.scheduledEvents(g.guildId)[0]?.description ?? "";
}

/** Proposes `name` on the location `poll` through the propose modal. */
async function propose(
  member: Member,
  poll: FakeMessage,
  name: string,
  map = "",
): Promise<void> {
  const form = await member.click(
    poll,
    idStarting(play.shown(poll), "hb:location:propose:"),
  );
  await member.submitModal(
    form,
    { "hb:location:name": name, "hb:location:map": map },
    poll,
  );
  expectEphemeral(member, `Added **${name}** to the location vote.`);
}

/** Closes the location vote, then plays the date vote to its close. */
async function finishDates(
  g: TestGuild,
  panel: FakeMessage,
  voter: Member,
): Promise<void> {
  await play.closeVote(g.owner, panel, "location vote");
  const when = await play.startDateVote(
    g,
    panel,
    ["2030-06-08", "2030-06-15"].join("\n"),
  );
  await play.vote(voter, when, ["Sat, 15 Jun 2030 · 11:00"]);
  await play.closeVote(g.owner, panel, "date vote");
}

describe("locating hikes", () => {
  it("looks a proposed location up, shows its place and map link on the vote, and links the map from the announcement, the thread and the event", async () => {
    const g = play.guild(1);
    const [ana, ben] = g.members as [Member, Member];
    addMountSi();
    const panel = await play.setUpPanel(g);
    const poll = await play.startLocationVote(
      g,
      panel,
      ["Mount Si", "Snow Lake"].join("\n"),
    );
    await propose(
      ana,
      poll,
      "Rattlesnake Ledge",
      "https://www.openstreetmap.org/#map=16/47.4347/-121.7686",
    );

    await eventually(() => {
      const shown = messageText(play.shown(poll));
      expect(shown).toContain(
        "📍 Mount Si, King County, Washington · [map](https://www.openstreetmap.org/?mlat=47.4875&mlon=-121.7234)",
      );
      expect(shown).toContain(
        "📍 [map](https://www.openstreetmap.org/?mlat=47.4347&mlon=-121.7686)",
      );
      expect(shown).toContain(ATTRIBUTION);
      // Snow Lake is unknown to the geocoder: no place, and no lookup left.
      expect(e2e.geocoder.requests).toHaveLength(2);
    }, LOOKUP_TIMEOUT);
    expect(messageText(play.shown(poll))).not.toMatch(
      /Snow Lake\*\*[^\n]*\n📍/,
    );

    // One request per lookup, at most one a second, identifying the bot;
    // coordinates the proposer gave are not looked up.
    const [first, second] = e2e.geocoder.requests;
    expect([first?.query.q, second?.query.q]).toEqual([
      "Mount Si",
      "Snow Lake",
    ]);
    expect(first?.query).toMatchObject({ format: "jsonv2", limit: "1" });
    expect(first?.userAgent).toContain("hikebot");
    expect((second?.at ?? 0) - (first?.at ?? 0)).toBeGreaterThanOrEqual(1_000);

    await play.vote(ben, poll, ["Mount Si"]);
    await finishDates(g, panel, ben);

    const [locationNews, hikeNews] = e2e.discord
      .channelMessages(g.channels.news)
      .map(messageText);
    for (const news of [locationNews, hikeNews]) {
      expect(news).toContain(
        `📍 Mount Si, King County, Washington · [OpenStreetMap](${SI_OSM}) · [Google Maps](${SI_GOOGLE})`,
      );
      expect(news).toContain(ATTRIBUTION);
    }
    const thread = messageText(threadMessage(g));
    expect(thread).toContain(`[OpenStreetMap](${SI_OSM})`);
    expect(thread).toContain(`[Google Maps](${SI_GOOGLE})`);
    expect(thread).toContain(ATTRIBUTION);
    await eventually(() => {
      expect(eventDescription(g)).toContain(`OpenStreetMap: ${SI_OSM}`);
    });
    expect(eventDescription(g)).toContain(`Google Maps: ${SI_GOOGLE}`);
    expect(eventDescription(g)).toContain("© OpenStreetMap contributors");
  });

  it("completes the round while the geocoder fails, and the admin sets, then clears, the map pin", async () => {
    const g = play.guild(2);
    const [ana] = g.members as [Member];
    e2e.geocoder.failAlways(503);
    try {
      const panel = await play.setUpPanel(g);
      const poll = await play.startLocationVote(g, panel, "Ridge");
      await e2e.geocoder.nextRequest((r) => r.query.q === "Ridge", 10_000);
      await play.vote(ana, poll, ["Ridge"]);
      await finishDates(g, panel, ana);
      expect(messageText(play.shown(poll))).not.toContain("📍");
      expect(messageText(threadMessage(g))).not.toContain("📍");
      expect(messageText(play.shown(panel))).toContain(
        "**Map pin:** being looked up on OpenStreetMap.",
      );
    } finally {
      e2e.geocoder.clearFailures();
    }

    const panel = play.shown(g.owner.lastReply());
    const pin = idStarting(play.shown(panel), "hb:pin:set:");
    const refused = await g.owner.click(panel, pin);
    await g.owner.submitModal(
      refused,
      { "hb:pin:point": "near the lake" },
      panel,
    );
    expectEphemeral(
      g.owner,
      "No coordinates could be read from that, so the pin is unchanged.",
    );

    const form = await g.owner.click(panel, pin);
    await g.owner.submitModal(
      form,
      { "hb:pin:point": "https://www.google.com/maps/@47.5,-121.6,14z" },
      panel,
    );
    await eventually(() => {
      expect(messageText(play.shown(panel))).toContain(
        "The map pin of **Ridge** is set to 47.5, -121.6.",
      );
    });
    const osm =
      "https://www.openstreetmap.org/?mlat=47.5&mlon=-121.6#map=13/47.5/-121.6";
    expect(messageText(play.shown(panel))).toContain(
      "**Map pin:** 47.5, -121.6 · [map](https://www.openstreetmap.org/?mlat=47.5&mlon=-121.6)",
    );
    expect(messageText(threadMessage(g))).toContain(
      `📍 [OpenStreetMap](${osm}) · [Google Maps](https://www.google.com/maps/search/?api=1&query=47.5,-121.6)`,
    );
    expect(eventDescription(g)).toContain(`OpenStreetMap: ${osm}`);

    const clear = await g.owner.click(panel, pin);
    await g.owner.submitModal(clear, { "hb:pin:point": "" }, panel);
    await eventually(() => {
      expect(messageText(play.shown(panel))).toContain(
        "The map pin of **Ridge** is removed.",
      );
    });
    expect(messageText(threadMessage(g))).not.toContain("📍");
    expect(eventDescription(g)).not.toContain("OpenStreetMap");
  });

  it("answers proposals, votes and the close while a lookup is held", async () => {
    const g = play.guild(3);
    const [ana] = g.members as [Member];
    const release = e2e.geocoder.hold();
    try {
      const panel = await play.setUpPanel(g);
      const poll = await play.startLocationVote(g, panel, "Slow Peak");
      await e2e.geocoder.nextRequest((r) => r.query.q === "Slow Peak", 10_000);
      await propose(ana, poll, "Quick Lake");
      await play.vote(ana, poll, ["Quick Lake"]);
      await play.closeVote(g.owner, panel, "location vote");
      expect(messageText(play.shown(panel))).toContain(
        "**Location decided:** Quick Lake (1 vote).",
      );
    } finally {
      release();
    }
  });

  it("sets the home area from Settings, refuses an unknown one, and focuses lookups near it", async () => {
    const g = play.guild(4);
    e2e.geocoder.addPlace("Seattle, Washington", {
      lat: 47.6,
      lon: -122.3,
      displayName: "Seattle, King County, Washington, United States",
    });
    addMountSi();
    const panel = await play.setUpPanel(g);
    await g.owner.click(panel, ROUND_IDS.settings);
    expect(messageText(play.shown(panel))).toContain(
      "**Home area:** not set (locations are looked up worldwide)",
    );

    const unknown = await g.owner.click(panel, "hb:admin:home-area");
    await g.owner.submitModal(
      unknown,
      { "hb:admin:home-area-name": "Atlantis" },
      panel,
    );
    await eventually(() => {
      expect(messageText(play.shown(panel))).toContain(
        "**Atlantis** was not found on OpenStreetMap, so the home area is unchanged.",
      );
    });

    const form = await g.owner.click(panel, "hb:admin:home-area");
    await g.owner.submitModal(
      form,
      { "hb:admin:home-area-name": "Seattle, Washington" },
      panel,
    );
    await eventually(() => {
      expect(messageText(play.shown(panel))).toContain(
        "Home area set to **Seattle, Washington**, found as Seattle, King County, Washington.",
      );
    });
    expect(messageText(play.shown(panel))).toContain(
      "**Home area:** Seattle, Washington (found as Seattle, King County, Washington)",
    );
    const [refusedLookup, homeLookup] = e2e.geocoder.requests.filter((r) =>
      ["Atlantis", "Seattle, Washington"].includes(r.query.q ?? ""),
    );
    expect(refusedLookup?.query.viewbox).toBeUndefined();
    expect(
      (homeLookup?.at ?? 0) - (refusedLookup?.at ?? 0),
    ).toBeGreaterThanOrEqual(1_000);

    await g.owner.click(panel, ROUND_IDS.back);
    const poll = await play.startLocationVote(g, panel, "Mount Si");
    const lookup = await e2e.geocoder.nextRequest(
      (r) => r.query.q === "Mount Si" && r.query.viewbox !== undefined,
      10_000,
    );
    expect(lookup.query).toMatchObject({
      viewbox: "-123.3,48.6,-121.3,46.6",
      bounded: "0",
    });
    await eventually(() => {
      expect(messageText(play.shown(poll))).toContain("📍 Mount Si");
    }, LOOKUP_TIMEOUT);

    await g.owner.click(panel, ROUND_IDS.settings);
    const clear = await g.owner.click(panel, "hb:admin:home-area");
    await g.owner.submitModal(clear, { "hb:admin:home-area-name": "" }, panel);
    expect(messageText(play.shown(panel))).toContain(
      "Home area cleared: locations are looked up worldwide.",
    );
  });
});
