import { describe, expect, it } from "vitest";
import {
  eventually,
  Member,
  messageText,
  waitForMessage,
} from "./harness/helpers";
import {
  buttonLabels,
  idStarting,
  ROUND_IDS,
  RoundPlayer,
  type TestGuild,
} from "./harness/rounds";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

/**
 * A fixed-offset zone whose clock reads about noon now, so that a hike at
 * 23:00 today there has not started and its 07:00 announcement time has
 * passed. `Etc/GMT-5` is five hours ahead of UTC.
 */
function noonZone(): { zone: string; today: string; weekday: string } {
  const now = new Date();
  const ahead = 12 - now.getUTCHours();
  const zone =
    ahead === 0
      ? "UTC"
      : `Etc/GMT${ahead > 0 ? "-" : "+"}${String(Math.abs(ahead))}`;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(
    now,
  );
  return {
    zone,
    today,
    weekday: `${parts.weekday ?? ""}, ${parts.day ?? ""} ${parts.month ?? ""} ${parts.year ?? ""}`,
  };
}

/**
 * Plays a round in `g` up to an open date vote that 23:00 today wins, in a
 * zone where it is about noon now, and returns the panel and the zone.
 */
async function upToTodaysDateVote(g: TestGuild) {
  const [ana] = g.members as [Member];
  const { zone, today, weekday } = noonZone();
  const panel = await play.setUpPanel(g);
  await play.setTimezone(g, panel, zone, zone);
  const where = await play.startLocationVote(g, panel, "Lake Loop");
  await play.vote(ana, where, ["Lake Loop"]);
  await play.closeVote(g.owner, panel, "location vote");
  const when = await play.startDateVote(
    g,
    panel,
    [`${today} 23:00`, `${today} 23:30`].join("\n"),
  );
  await play.vote(ana, when, [`${weekday} · 23:00`]);
  return { panel, zone };
}

function hikeDays(g: TestGuild) {
  return e2e.discord
    .channelMessages(g.channels.news)
    .filter((m) => messageText(m).includes("## Hike today"));
}

describe("the hike-day announcement", () => {
  it("is posted once, at once, for a hike decided on its own day that has not started", async () => {
    const g = play.guild(1);
    const { panel, zone } = await upToTodaysDateVote(g);
    await play.closeVote(g.owner, panel, "date vote");

    const announcement = await waitForMessage(
      e2e.discord,
      g.channels.news,
      (m) => messageText(m).includes("## Hike today: Lake Loop"),
      { timeout: 20_000 },
    );
    const [thread] = e2e.discord.threads(g.channels.forum);
    const [event] = e2e.discord.scheduledEvents(g.guildId);
    const lines = messageText(announcement).split("\n");
    expect(lines[0]).toBe("## Hike today: Lake Loop");
    expect(lines[1]).toMatch(
      new RegExp(
        `^\\*\\*Starts:\\*\\* 23:00 \\(${zone.replace("+", "\\+")}\\), <t:\\d+:t> in your time zone, <t:\\d+:R>$`,
      ),
    );
    expect(lines.slice(2)).toEqual([
      `**Hike thread:** <#${thread?.id ?? "?"}>`,
      `**Discord event:** https://discord.com/events/${g.guildId}/${event?.id ?? "?"}`,
      expect.stringMatching(
        new RegExp(`^\\*\\*Calendar:\\*\\* http\\S+/calendar/${g.guildId}/`),
      ) as string,
      `Coming? Say so in <#${thread?.id ?? "?"}>, so the group knows who to expect.`,
    ]);
    // The result was announced first.
    expect(
      e2e.discord
        .channelMessages(g.channels.news)
        .map((m) => messageText(m).split("\n")[0]),
    ).toEqual([
      "## Hike location decided",
      "## Hike planned",
      "## Hike today: Lake Loop",
    ]);

    // The panel shows it posted; it is not posted again.
    await eventually(async () => {
      await g.owner.click(panel, ROUND_IDS.refresh);
      expect(messageText(play.shown(panel))).toContain(
        `**Hike-day announcement:** posted in <#${g.channels.news}>.`,
      );
    });
    expect(hikeDays(g)).toHaveLength(1);
  });

  it("is posted once from the panel after Discord refused it, even when the retry is clicked twice", async () => {
    const g = play.guild(2);
    const { panel } = await upToTodaysDateVote(g);
    await play.closeVote(g.owner, panel, "date vote");
    // The result is announced at once; the hike-day post follows seconds
    // later, when the bot can no longer post in the channel.
    await waitForMessage(e2e.discord, g.channels.news, (m) =>
      messageText(m).includes("## Hike planned"),
    );
    e2e.discord.failChannel(g.channels.news, "missing-permissions");
    await eventually(
      async () => {
        await g.owner.click(panel, ROUND_IDS.refresh);
        expect(messageText(play.shown(panel))).toContain(
          `**Hike-day announcement:** not posted. Could not post the hike-day announcement in <#${g.channels.news}>: Discord answered: Missing Permissions (HTTP 403, code 50013). Check that the bot can post there, then click Post hike-day announcement.`,
        );
      },
      { timeout: 20_000 },
    );
    expect(buttonLabels(play.shown(panel))).toContain(
      "Post hike-day announcement",
    );
    expect(hikeDays(g)).toEqual([]);

    e2e.discord.clearChannelFailure(g.channels.news);
    const id = idStarting(play.shown(panel), "hb:hike-day:post:");
    await Promise.all([g.owner.click(panel, id), g.owner.click(panel, id)]);
    await eventually(async () => {
      await g.owner.click(panel, ROUND_IDS.refresh);
      expect(messageText(play.shown(panel))).toContain(
        `**Hike-day announcement:** posted in <#${g.channels.news}>.`,
      );
    });
    expect(hikeDays(g)).toHaveLength(1);
    expect(buttonLabels(play.shown(panel))).not.toContain(
      "Post hike-day announcement",
    );
  });
});
