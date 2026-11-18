import { describe, expect, it } from "vitest";
import { eventually, Member, messageText } from "./harness/helpers";
import { subcommand } from "./harness/interactions";
import { buttonLabels, idStarting, RoundPlayer } from "./harness/rounds";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

describe("Announce <vote>", () => {
  it("posts the announcement Discord refused at the close once, and a stale panel's second click posts nothing", async () => {
    const g = play.guild(1);
    const [ana] = g.members as [Member];
    const panel = await play.setUpPanel(g);
    const where = await play.startLocationVote(
      g,
      panel,
      ["Lake Loop", "Ridge Trail"].join("\n"),
    );
    await play.vote(ana, where, ["Lake Loop"]);
    await play.closeVote(g.owner, panel, "location vote");
    const when = await play.startDateVote(
      g,
      panel,
      ["2030-06-08", "2030-06-15"].join("\n"),
    );
    await play.vote(ana, when, ["Sat, 15 Jun 2030 · 11:00"]);
    const planned = () =>
      e2e.discord
        .channelMessages(g.channels.news)
        .filter((m) => messageText(m).includes("## Hike planned"));

    e2e.discord.failChannel(g.channels.news, "missing-permissions");
    await play.closeVote(g.owner, panel, "date vote");
    const closed = messageText(play.shown(panel));
    expect(closed).toContain(
      `**Date vote announcement:** not posted. Could not post the announcement in <#${g.channels.news}>: Discord answered: Missing Permissions (HTTP 403, code 50013). Check that the bot can post there, then click Announce date vote.`,
    );
    expect(buttonLabels(play.shown(panel))).toContain("Announce date vote");
    expect(planned()).toEqual([]);
    expect(e2e.discord.threads(g.channels.forum)).toHaveLength(1);

    // A second panel, opened while the button is offered.
    await g.owner.run("hike", [subcommand("admin")]);
    const stale = g.owner.lastReply();
    expect(buttonLabels(stale)).toContain("Announce date vote");

    e2e.discord.clearChannelFailure(g.channels.news);
    const announce = idStarting(play.shown(panel), "hb:poll:announce:");
    await g.owner.click(panel, announce);
    await eventually(() => {
      expect(messageText(play.shown(panel))).toContain(
        `The date vote's result is announced in <#${g.channels.news}>.`,
      );
    });
    expect(buttonLabels(play.shown(panel))).not.toContain("Announce date vote");
    expect(messageText(play.shown(panel))).not.toContain(
      "**Date vote announcement:**",
    );
    expect(planned()).toHaveLength(1);
    const announced = messageText(planned()[0] ?? { components: [] });
    expect(announced).toContain("**When:** Sat, 15 Jun 2030 · 11:00");
    expect(announced).toContain("**Hike thread:** <#");
    expect(announced).toContain(
      `**Hike event:** https://discord.com/events/${g.guildId}/`,
    );

    await g.owner.click(stale, announce);
    expect(messageText(play.shown(stale))).toContain(
      "The date vote's announcement is already posted.",
    );
    expect(planned()).toHaveLength(1);
  });
});
