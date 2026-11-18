import { describe, expect, it } from "vitest";
import type { FakeMessage } from "./harness/fake-discord";
import { eventually, Member, messageText } from "./harness/helpers";
import {
  buttonLabels,
  idStarting,
  ROUND_IDS,
  RoundPlayer,
  type TestGuild,
} from "./harness/rounds";
import { subcommand } from "./harness/interactions";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

/**
 * Plays a round up to an open date vote that the first of `dates` wins,
 * with `location` as the only location.
 */
async function upToDateVote(
  g: TestGuild,
  location: string,
  dates: [string, string] = ["2030-06-15 09:00", "2030-06-08"],
  winner = "Sat, 15 Jun 2030 · 09:00",
) {
  const [ana] = g.members as [Member];
  const panel = await play.setUpPanel(g);
  const where = await play.startLocationVote(g, panel, location);
  await play.vote(ana, where, [location]);
  await play.closeVote(g.owner, panel, "location vote");
  const when = await play.startDateVote(g, panel, dates.join("\n"));
  await play.vote(ana, when, [winner]);
  return { panel };
}

function announcements(g: TestGuild): string[] {
  return e2e.discord.channelMessages(g.channels.news).map(messageText);
}

/** The starter message of the guild's only hike thread. */
function threadMessage(g: TestGuild): FakeMessage {
  const [thread] = e2e.discord.threads(g.channels.forum);
  const [first] = e2e.discord.channelMessages(thread?.id ?? "");
  if (!thread || !first) throw new Error("the hike thread was not created");
  return first;
}

function eventRequests(g: TestGuild) {
  return e2e.discord.requests.filter(
    (r) =>
      r.method === "POST" && r.path === `/guilds/${g.guildId}/scheduled-events`,
  );
}

/** Today's date in Los Angeles, the default zone, as `YYYY-MM-DD`. */
function todayInLosAngeles(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(Date.now());
}

describe("the hike event", () => {
  it("is created once when the date vote closes, and the thread and the announcement link it", async () => {
    const g = play.guild(1);
    const { panel } = await upToDateVote(g, "Lake Loop");
    await play.closeVote(g.owner, panel, "date vote");

    expect(messageText(play.shown(panel))).toContain(
      "**Hike event:** created.",
    );
    const events = e2e.discord.scheduledEvents(g.guildId);
    expect(events).toHaveLength(1);
    const [event] = events;
    const [thread] = e2e.discord.threads(g.channels.forum);
    expect(event).toEqual({
      id: event?.id,
      guild_id: g.guildId,
      channel_id: null,
      creator_id: e2e.discord.applicationId,
      name: "Lake Loop",
      // 09:00 in Los Angeles on 15 June 2030 is 16:00 UTC; four hours long.
      scheduled_start_time: "2030-06-15T16:00:00.000Z",
      scheduled_end_time: "2030-06-15T20:00:00.000Z",
      privacy_level: 2,
      status: 1,
      entity_type: 3,
      entity_id: null,
      entity_metadata: { location: "Lake Loop" },
      description: `Hike thread: https://discord.com/channels/${g.guildId}/${thread?.id ?? ""}`,
    });
    const link = `**Hike event:** https://discord.com/events/${g.guildId}/${event?.id ?? ""}`;
    expect(messageText(threadMessage(g)).split("\n")).toContain(link);
    expect(threadMessage(g).edits).toBe(1);
    await eventually(() => {
      expect(announcements(g)).toHaveLength(2);
    });
    expect(announcements(g)[1]?.split("\n").slice(-2)).toEqual([
      `**Hike thread:** <#${thread?.id ?? ""}>`,
      link,
    ]);
    expect(buttonLabels(play.shown(panel))).not.toContain("Create hike event");
  });

  it("is retried from the panel after Discord refused it for a missing permission: one event, one announcement", async () => {
    const g = play.guild(2);
    const { panel } = await upToDateVote(g, "Lake Loop");
    e2e.discord.revokeCreateEvents(g.guildId);
    await play.closeVote(g.owner, panel, "date vote");

    await eventually(() => {
      expect(announcements(g)).toHaveLength(2);
    });
    expect(announcements(g)[1]).not.toContain("Hike event");
    expect(e2e.discord.scheduledEvents(g.guildId)).toEqual([]);
    expect(messageText(play.shown(panel))).toContain(
      "**Hike event:** not created. Could not create the hike event: Discord answered: Missing Permissions (HTTP 403, code 50013). Give the bot the Create Events permission in the server's settings, then click Create hike event.",
    );
    expect(buttonLabels(play.shown(panel))).toEqual([
      "Start location vote",
      "Create hike event",
      "Settings",
      "Refresh",
    ]);
    expect(messageText(threadMessage(g))).not.toContain("Hike event");

    // Refresh keeps the reason and the button.
    await g.owner.click(panel, ROUND_IDS.refresh);
    expect(messageText(play.shown(panel))).toContain(
      "**Hike event:** not created.",
    );
    expect(buttonLabels(play.shown(panel))).toContain("Create hike event");

    // A second panel, opened now, keeps the button for the replay below.
    await g.owner.run("hike", [subcommand("admin")]);
    const stale = g.owner.lastReply();

    e2e.discord.grantCreateEvents(g.guildId);
    const id = idStarting(play.shown(panel), "hb:event:create:");
    await g.owner.click(panel, id);
    await eventually(async () => {
      await g.owner.click(panel, ROUND_IDS.refresh);
      expect(messageText(play.shown(panel))).toContain(
        "**Hike event:** created.",
      );
    });
    const events = e2e.discord.scheduledEvents(g.guildId);
    expect(events).toHaveLength(1);
    expect(messageText(threadMessage(g))).toContain(
      `**Hike event:** https://discord.com/events/${g.guildId}/${events[0]?.id ?? ""}`,
    );
    expect(buttonLabels(play.shown(panel))).toEqual([
      "Start location vote",
      "Settings",
      "Refresh",
    ]);

    // Clicking it again on the older panel creates nothing more.
    await g.owner.click(stale, id);
    expect(messageText(play.shown(stale))).toContain(
      "The hike event already exists: https://discord.com/events/",
    );
    expect(e2e.discord.scheduledEvents(g.guildId)).toHaveLength(1);
    expect(eventRequests(g)).toHaveLength(2);
    expect(announcements(g)).toHaveLength(2);
  });

  it("is created once when Create hike event is clicked twice quickly", async () => {
    const g = play.guild(3);
    const { panel } = await upToDateVote(g, "Lake Loop");
    e2e.discord.revokeCreateEvents(g.guildId);
    await play.closeVote(g.owner, panel, "date vote");
    expect(buttonLabels(play.shown(panel))).toContain("Create hike event");
    e2e.discord.grantCreateEvents(g.guildId);

    const id = idStarting(play.shown(panel), "hb:event:create:");
    await Promise.all([g.owner.click(panel, id), g.owner.click(panel, id)]);
    // The fake holds the event before the Worker has stored its id, so wait
    // until a Refresh, answered from storage, shows it.
    await eventually(async () => {
      await g.owner.click(panel, ROUND_IDS.refresh);
      expect(messageText(play.shown(panel))).toContain(
        "**Hike event:** created.",
      );
    });
    expect(e2e.discord.scheduledEvents(g.guildId)).toHaveLength(1);
    expect(eventRequests(g)).toHaveLength(2);
    expect(buttonLabels(play.shown(panel))).not.toContain("Create hike event");
    await eventually(() => {
      expect(announcements(g)).toHaveLength(2);
    });
  });

  it("is not asked for when the hike's start has passed, and the panel says so without a retry", async () => {
    const g = play.guild(4);
    const [ana] = g.members as [Member];
    const panel = await play.setUpPanel(g);
    const where = await play.startLocationVote(g, panel, "Lake Loop");
    await play.vote(ana, where, ["Lake Loop"]);
    await play.closeVote(g.owner, panel, "location vote");
    // Today counts as a date in the future; its first minutes have passed.
    const today = todayInLosAngeles();
    await play.startDateVote(g, panel, `${today} 00:00\n${today} 00:01`);
    await play.closeVote(g.owner, panel, "date vote");

    expect(messageText(play.shown(panel))).toContain(
      "**Hike event:** The hike's start time has passed, so no event was created.",
    );
    expect(buttonLabels(play.shown(panel))).toEqual([
      "Start location vote",
      "Settings",
      "Refresh",
    ]);
    expect(eventRequests(g)).toEqual([]);
    expect(e2e.discord.scheduledEvents(g.guildId)).toEqual([]);
    await eventually(() => {
      expect(announcements(g)).toHaveLength(2);
    });
    expect(announcements(g)[1]).not.toContain("Hike event");
    expect(messageText(threadMessage(g))).not.toContain("Hike event");
  });

  it("refuses the retry to a member who is not an admin", async () => {
    const g = play.guild(5);
    const [ana] = g.members as [Member];
    const { panel } = await upToDateVote(g, "Lake Loop");
    e2e.discord.revokeCreateEvents(g.guildId);
    await play.closeVote(g.owner, panel, "date vote");
    e2e.discord.grantCreateEvents(g.guildId);
    await ana.click(panel, idStarting(play.shown(panel), "hb:event:create:"));
    expect(messageText(ana.lastReply())).toContain(
      "The hikebot admin panel is limited to the server owner",
    );
    expect(e2e.discord.scheduledEvents(g.guildId)).toEqual([]);
  });
});
