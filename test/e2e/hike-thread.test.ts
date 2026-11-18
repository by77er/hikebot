import { ChannelType, MessageFlags } from "discord-api-types/v10";
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
 * Plays a round up to an open date vote that `Sat, 15 Jun 2030 · 09:00`
 * wins, with `location` as the only location.
 */
async function upToDateVote(g: TestGuild, location: string) {
  const [ana] = g.members as [Member];
  const panel = await play.setUpPanel(g);
  const where = await play.startLocationVote(g, panel, location);
  await play.vote(ana, where, [location]);
  await play.closeVote(g.owner, panel, "location vote");
  const when = await play.startDateVote(
    g,
    panel,
    "2030-06-15 09:00\n2030-06-08",
  );
  await play.vote(ana, when, ["Sat, 15 Jun 2030 · 09:00"]);
  return { panel, where, when };
}

function announcements(g: TestGuild): string[] {
  return e2e.discord.channelMessages(g.channels.news).map(messageText);
}

/** The starter message of a forum thread. */
function starter(threadId: string): FakeMessage {
  const [first] = e2e.discord.channelMessages(threadId);
  if (!first) throw new Error(`thread ${threadId} has no message`);
  return first;
}

async function retry(g: TestGuild, panel: FakeMessage): Promise<void> {
  await g.owner.click(
    panel,
    idStarting(play.shown(panel), "hb:thread:create:"),
  );
}

describe("the hike thread", () => {
  it("is created in the forum channel with the hike's details, and the announcement links it", async () => {
    const g = play.guild(1);
    const { panel, where, when } = await upToDateVote(g, "Lake Loop");
    await play.closeVote(g.owner, panel, "date vote");

    const [thread] = e2e.discord.threads(g.channels.forum);
    expect(e2e.discord.threads(g.channels.forum)).toHaveLength(1);
    expect(thread?.name).toBe("Lake Loop — Sat, 15 Jun 2030 · 09:00");
    const first = starter(thread?.id ?? "");
    expect(first.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(messageText(first).split("\n")).toEqual([
      "## Lake Loop",
      `Proposed by <@${g.owner.actor.userId}>`,
      "**When:** Sat, 15 Jun 2030 · 09:00",
      `**Location vote:** **Lake Loop** won with 1 vote; 1 member voted. [See the location vote](https://discord.com/channels/${g.guildId}/${g.channels.text}/${where.id})`,
      `**Date vote:** **Sat, 15 Jun 2030 · 09:00** won with 1 vote; 1 member voted. [See the date vote](https://discord.com/channels/${g.guildId}/${g.channels.text}/${when.id})`,
    ]);

    await eventually(() => {
      expect(announcements(g)).toHaveLength(2);
    });
    expect(announcements(g)[1]?.split("\n").at(-1)).toBe(
      `**Hike thread:** <#${thread?.id ?? ""}>`,
    );
    expect(messageText(play.shown(panel))).toContain(
      `**Hike thread:** <#${thread?.id ?? ""}>`,
    );
    expect(buttonLabels(play.shown(panel))).not.toContain("Create hike thread");
  });

  it("is retried from the panel after Discord refused it, once the permission is back: one thread, one announcement", async () => {
    const g = play.guild(2);
    const { panel } = await upToDateVote(g, "Lake Loop");
    e2e.discord.failChannel(g.channels.forum, "missing-permissions");
    await play.closeVote(g.owner, panel, "date vote");

    await eventually(() => {
      expect(announcements(g)).toHaveLength(2);
    });
    expect(announcements(g)[1]).not.toContain("Hike thread");
    expect(e2e.discord.threads(g.channels.forum)).toEqual([]);
    const failed = messageText(play.shown(panel));
    expect(failed).toContain(
      `**Hike thread:** not created. Could not create the hike thread in <#${g.channels.forum}>: Discord answered: Missing Permissions (HTTP 403, code 50013).`,
    );
    expect(buttonLabels(play.shown(panel))).toEqual([
      "Start location vote",
      "Create hike thread",
      "Settings",
      "Refresh",
    ]);

    // Refresh keeps the reason and the button.
    await g.owner.click(panel, ROUND_IDS.refresh);
    expect(messageText(play.shown(panel))).toContain(
      "**Hike thread:** not created.",
    );
    expect(buttonLabels(play.shown(panel))).toContain("Create hike thread");

    e2e.discord.clearChannelFailure(g.channels.forum);
    await retry(g, panel);
    await eventually(() => {
      expect(messageText(play.shown(panel))).toContain(
        "The hike thread is open",
      );
    });
    const threads = e2e.discord.threads(g.channels.forum);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.name).toBe("Lake Loop — Sat, 15 Jun 2030 · 09:00");
    expect(messageText(play.shown(panel))).toContain(
      `**Hike thread:** <#${threads[0]?.id ?? ""}>`,
    );
    expect(buttonLabels(play.shown(panel))).toEqual([
      "Start location vote",
      "Settings",
      "Refresh",
    ]);
    expect(announcements(g)).toHaveLength(2);
  });

  it("names the problem when the forum channel was replaced by a text channel, and works again in a new forum", async () => {
    const g = play.guild(3);
    const { panel } = await upToDateVote(g, "Lake Loop");
    e2e.discord.addChannel({
      id: g.channels.forum,
      guildId: g.guildId,
      type: ChannelType.GuildText,
    });
    await play.closeVote(g.owner, panel, "date vote");

    const refused = e2e.discord.takeRejections();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      method: "POST",
      path: `/channels/${g.channels.forum}/threads`,
      status: 400,
    });
    const shown = messageText(play.shown(panel));
    expect(shown).toContain(
      `**Hike thread:** not created. Could not create the hike thread in <#${g.channels.forum}>: Discord answered: Invalid Form Body`,
    );
    expect(shown).toContain(
      "Check that it is still a forum channel and that the bot can create posts in it, then click Create hike thread.",
    );
    await eventually(() => {
      expect(announcements(g)).toHaveLength(2);
    });
    expect(announcements(g)[1]).not.toContain("Hike thread");

    // The admin picks a new forum and retries.
    const forum = `${g.channels.forum.slice(0, -2)}09`;
    e2e.discord.addChannel({
      id: forum,
      guildId: g.guildId,
      type: ChannelType.GuildForum,
    });
    await g.owner.click(panel, ROUND_IDS.settings);
    await g.owner.select(panel, ROUND_IDS.forumChannel, [forum]);
    await g.owner.click(panel, ROUND_IDS.back);
    await retry(g, panel);
    await eventually(() => {
      expect(e2e.discord.threads(forum)).toHaveLength(1);
      expect(messageText(play.shown(panel))).toContain(
        "The hike thread is open",
      );
    });
    expect(e2e.discord.threads(g.channels.forum)).toEqual([]);
  });

  it("shortens a location of the longest length in the title and keeps the date whole", async () => {
    const g = play.guild(4);
    const location = "Long Ridge Traverse ".repeat(4).slice(0, 79) + "X";
    expect(location).toHaveLength(80);
    const { panel } = await upToDateVote(g, location);
    await play.closeVote(g.owner, panel, "date vote");

    const [thread] = e2e.discord.threads(g.channels.forum);
    const name = thread?.name ?? "";
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith("… — Sat, 15 Jun 2030 · 09:00")).toBe(true);
    expect(location.startsWith(name.split("…")[0] ?? "-")).toBe(true);
    expect(messageText(starter(thread?.id ?? ""))).toContain(`## ${location}`);
  });

  it("is created once when Create hike thread is clicked twice quickly", async () => {
    const g = play.guild(5);
    const { panel } = await upToDateVote(g, "Lake Loop");
    e2e.discord.failChannel(g.channels.forum, "missing-permissions");
    await play.closeVote(g.owner, panel, "date vote");
    expect(buttonLabels(play.shown(panel))).toContain("Create hike thread");
    e2e.discord.clearChannelFailure(g.channels.forum);

    const id = idStarting(play.shown(panel), "hb:thread:create:");
    await Promise.all([g.owner.click(panel, id), g.owner.click(panel, id)]);
    // The fake holds the thread before the Worker has stored its id, and the
    // second click's "being created" update can land after the first click's
    // follow-up, so wait until a Refresh, answered from storage, shows it.
    await eventually(async () => {
      await g.owner.click(panel, ROUND_IDS.refresh);
      expect(messageText(play.shown(panel))).toContain("**Hike thread:** <#");
    });
    const threads = e2e.discord.threads(g.channels.forum);
    expect(threads).toHaveLength(1);
    const [thread] = threads;
    expect(messageText(play.shown(panel))).toContain(
      `**Hike thread:** <#${thread?.id ?? ""}>`,
    );
    expect(buttonLabels(play.shown(panel))).not.toContain("Create hike thread");
    expect(
      e2e.discord.requests.filter(
        (r) =>
          r.method === "POST" &&
          r.path === `/channels/${g.channels.forum}/threads`,
      ),
    ).toHaveLength(2);
    expect(announcements(g)).toHaveLength(2);
  });

  it("lets a new round start without the thread, and the old round's retry no longer applies", async () => {
    const g = play.guild(6);
    const { panel } = await upToDateVote(g, "Lake Loop");
    e2e.discord.failChannel(g.channels.forum, "missing-permissions");
    await play.closeVote(g.owner, panel, "date vote");
    e2e.discord.clearChannelFailure(g.channels.forum);
    // A second panel, opened now, still shows the button.
    await g.owner.run("hike", [subcommand("admin")]);
    const stale = g.owner.lastReply();
    expect(buttonLabels(stale)).toContain("Create hike thread");

    await play.startLocationVote(g, panel, "Summit Path");
    expect(buttonLabels(play.shown(panel))).not.toContain("Create hike thread");
    await retry(g, stale);
    expect(messageText(play.shown(stale))).toContain(
      "That hike is no longer the last one, so its thread is not created from here.",
    );
    expect(buttonLabels(play.shown(stale))).not.toContain("Create hike thread");
    expect(e2e.discord.threads(g.channels.forum)).toEqual([]);
  });

  it("refuses the retry to a member who is not an admin", async () => {
    const g = play.guild(7);
    const [ana] = g.members as [Member];
    const { panel } = await upToDateVote(g, "Lake Loop");
    e2e.discord.failChannel(g.channels.forum, "missing-permissions");
    await play.closeVote(g.owner, panel, "date vote");
    e2e.discord.clearChannelFailure(g.channels.forum);
    await ana.click(panel, idStarting(play.shown(panel), "hb:thread:create:"));
    expect(messageText(ana.lastReply())).toContain(
      "The hikebot admin panel is limited to the server owner",
    );
    expect(e2e.discord.threads(g.channels.forum)).toEqual([]);
  });
});
