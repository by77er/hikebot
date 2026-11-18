import { MessageFlags } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import { eventually, Member, messageText } from "./harness/helpers";
import {
  buttonLabels,
  expectNoButtons,
  ROUND_IDS,
  RoundPlayer,
} from "./harness/rounds";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

describe("a whole hike round", () => {
  it("runs from Start location vote to a completed date vote with several members, and a new round starts after it", async () => {
    const g = play.guild(1);
    const [ana, ben, cy, dee] = g.members as [Member, Member, Member, Member];
    const channel = (id: string) =>
      e2e.discord.channelMessages(id).map((m) => messageText(m));

    // Setup: nothing posted yet.
    const panel = await play.setUpPanel(g);
    expect(messageText(panel)).toContain("No hike is being planned.");
    expect(channel(g.channels.text)).toEqual([]);
    expect(channel(g.channels.news)).toEqual([]);

    // The location vote: one poll in the voting channel.
    const locationPoll = await play.startLocationVote(
      g,
      panel,
      "Ridge Trail\nLake Loop\nCanyon Rim",
    );
    expect(channel(g.channels.text)).toHaveLength(1);
    expect(messageText(locationPoll)).toContain("## Where should we hike?");
    await play.vote(ana, locationPoll, ["Lake Loop", "Canyon Rim"]);
    await play.vote(ben, locationPoll, ["Lake Loop"]);
    await play.vote(cy, locationPoll, ["Ridge Trail", "Lake Loop"]);
    await play.vote(dee, locationPoll, ["Canyon Rim"]);
    await eventually(() => {
      expect(messageText(play.shown(locationPoll))).toContain(
        "4 members have voted.",
      );
    });
    await play.closeVote(g.owner, panel, "location vote");

    // Location decided: the poll is final and the first announcement is out.
    const locationFinal = messageText(play.shown(locationPoll));
    expect(locationFinal).toContain("## Where should we hike? (closed)");
    expect(locationFinal).toContain("🏆 **Lake Loop** won with 3 votes.");
    expectNoButtons(play.shown(locationPoll));
    await eventually(() => {
      expect(channel(g.channels.news)).toHaveLength(1);
    });
    const [locationAnnouncement] = channel(g.channels.news);
    expect(locationAnnouncement).toContain("## Hike location decided");
    expect(locationAnnouncement).toContain(
      "**Lake Loop** won the location vote with 3 votes.",
    );
    expect(messageText(play.shown(panel))).toContain(
      "**Location decided:** Lake Loop (3 votes).",
    );
    expect(buttonLabels(play.shown(panel))).toEqual([
      "Start date vote",
      "Cancel round",
      "Settings",
      "Refresh",
    ]);

    // The date vote: a second poll in the voting channel.
    const datePoll = await play.startDateVote(
      g,
      panel,
      "2030-06-15 09:00\n2030-06-08\n2030-06-16",
    );
    expect(channel(g.channels.text)).toHaveLength(2);
    const dateText = messageText(datePoll);
    expect(dateText).toContain("## When should we hike Lake Loop?");
    expect(dateText.indexOf("Sat, 8 Jun 2030")).toBeLessThan(
      dateText.indexOf("Sat, 15 Jun 2030 · 09:00"),
    );
    expect(dateText.indexOf("Sat, 15 Jun 2030 · 09:00")).toBeLessThan(
      dateText.indexOf("Sun, 16 Jun 2030"),
    );
    expect(buttonLabels(datePoll)).toEqual(["Vote"]);
    await play.vote(ana, datePoll, ["Sat, 15 Jun 2030 · 09:00"]);
    await play.vote(ben, datePoll, [
      "Sat, 15 Jun 2030 · 09:00",
      "Sun, 16 Jun 2030",
    ]);
    await play.vote(cy, datePoll, ["Sat, 8 Jun 2030"]);
    // A member changes their mind: the select is preselected and replaced.
    const changed = await play.vote(cy, datePoll, [
      "Sat, 8 Jun 2030",
      "Sat, 15 Jun 2030 · 09:00",
    ]);
    expect(messageText(changed)).toContain(
      "Your votes are saved: **Sat, 8 Jun 2030**, **Sat, 15 Jun 2030 · 09:00**.",
    );
    await eventually(() => {
      expect(messageText(play.shown(datePoll))).toContain(
        "3 members have voted.",
      );
    });
    expect(messageText(play.shown(datePoll))).toContain(
      "**Sat, 15 Jun 2030 · 09:00** · 3 votes",
    );
    await g.owner.click(panel, ROUND_IDS.refresh);
    expect(messageText(play.shown(panel))).toContain(
      "1. Sat, 15 Jun 2030 · 09:00: 3 votes",
    );
    await play.closeVote(g.owner, panel, "date vote");

    // Complete: both polls final, both announcements out, the panel sums up.
    const dateFinal = messageText(play.shown(datePoll));
    expect(dateFinal).toContain("## When should we hike Lake Loop? (closed)");
    expect(dateFinal).toContain(
      "🏆 **Sat, 15 Jun 2030 · 09:00** won with 3 votes.",
    );
    expect(dateFinal).not.toContain("drawn at random");
    expectNoButtons(play.shown(datePoll));
    expect(messageText(play.shown(locationPoll))).toBe(locationFinal);
    await eventually(() => {
      expect(channel(g.channels.news)).toHaveLength(2);
    });
    // The hike's thread in the forum channel, linked from the announcement.
    const [thread] = e2e.discord.threads(g.channels.forum);
    expect(e2e.discord.threads(g.channels.forum)).toHaveLength(1);
    expect(thread?.name).toBe("Lake Loop — Sat, 15 Jun 2030 · 09:00");
    const threadText = channel(thread?.id ?? "")[0] ?? "";
    expect(threadText).toContain("## Lake Loop");
    expect(threadText).toContain(`Proposed by <@${g.owner.actor.userId}>`);
    expect(threadText).toContain("**When:** Sat, 15 Jun 2030 · 09:00");
    expect(threadText).toContain(
      "**Location vote:** **Lake Loop** won with 3 votes; 4 members voted.",
    );
    expect(threadText).toContain(
      `**Date vote:** **Sat, 15 Jun 2030 · 09:00** won with 3 votes; 3 members voted. [See the date vote](https://discord.com/channels/${g.guildId}/${g.channels.text}/${datePoll.id})`,
    );
    const [, hikeAnnouncement] = channel(g.channels.news);
    expect(hikeAnnouncement?.split("\n")).toEqual([
      "## Hike planned",
      "**Where:** Lake Loop",
      "**When:** Sat, 15 Jun 2030 · 09:00",
      "**Sat, 15 Jun 2030 · 09:00** won the date vote with 3 votes.",
      `[See the vote](https://discord.com/channels/${g.guildId}/${g.channels.text}/${datePoll.id})`,
      `**Hike thread:** <#${thread?.id ?? ""}>`,
    ]);
    expect(channel(g.channels.text)).toHaveLength(2);
    const summary = messageText(play.shown(panel));
    expect(summary).toContain(
      "**Last hike:** **Lake Loop** on **Sat, 15 Jun 2030 · 09:00**.",
    );
    expect(summary).toContain(`**Hike thread:** <#${thread?.id ?? ""}>`);
    expect(summary).toContain("No hike is being planned.");
    expect(buttonLabels(play.shown(panel))).toEqual([
      "Start location vote",
      "Settings",
      "Refresh",
    ]);

    // Every message the bot sent is Components V2 and pings no one.
    for (const request of e2e.discord.requests) {
      if (request.method === "POST" || request.method === "PATCH") {
        expect(request.body).toMatchObject({
          allowed_mentions: { parse: [] },
        });
      }
    }
    for (const message of [
      ...e2e.discord.channelMessages(g.channels.text),
      ...e2e.discord.channelMessages(g.channels.news),
      ...e2e.discord.channelMessages(thread?.id ?? ""),
    ]) {
      expect(message.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    }

    // A second round starts after the completed one.
    const second = await play.startLocationVote(g, panel, "Summit Path");
    expect(second.id).not.toBe(locationPoll.id);
    expect(channel(g.channels.text)).toHaveLength(3);
    expect(messageText(play.shown(panel))).not.toContain("Last hike");
    await play.vote(dee, second, ["Summit Path"]);
    await play.closeVote(g.owner, panel, "location vote");
    const secondDates = await play.startDateVote(
      g,
      panel,
      "2030-07-06\n2030-07-07",
    );
    expect(messageText(secondDates)).toContain(
      "When should we hike Summit Path?",
    );
    await play.vote(ana, secondDates, ["Sun, 7 Jul 2030"]);
    await play.closeVote(g.owner, panel, "date vote");
    expect(messageText(play.shown(panel))).toContain(
      "**Last hike:** **Summit Path** on **Sun, 7 Jul 2030**.",
    );
    await eventually(() => {
      expect(channel(g.channels.news)).toHaveLength(4);
    });
    expect(e2e.discord.threads(g.channels.forum).map((t) => t.name)).toEqual([
      "Lake Loop — Sat, 15 Jun 2030 · 09:00",
      "Summit Path — Sun, 7 Jul 2030",
    ]);
  });
});
