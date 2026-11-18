import { InteractionResponseType } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import type { FakeMessage } from "./harness/fake-discord";
import {
  eventually,
  findComponent,
  Member,
  messageText,
  waitForMessage,
} from "./harness/helpers";
import {
  buttonLabels,
  expectEphemeral,
  expectNoButtons,
  idStarting,
  optionValues,
  ROUND_IDS,
  RoundPlayer,
  type TestGuild,
} from "./harness/rounds";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

const FORMATS =
  "Write one date per line as `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` (24-hour), for example `2026-12-05` or `2026-12-05 09:00`; a date without a time starts at 11:00.";

/** Sets up the panel and decides the location as Ridge Trail. */
async function decided(g: TestGuild): Promise<FakeMessage> {
  const [ana] = g.members as [Member];
  const panel = await play.setUpPanel(g);
  const poll = await play.startLocationVote(g, panel, "Ridge Trail\nLake Loop");
  await play.vote(ana, poll, ["Ridge Trail"]);
  await play.closeVote(g.owner, panel, "location vote");
  await waitForMessage(e2e.discord, g.channels.news);
  return panel;
}

describe("the date vote", () => {
  it("is offered once the location is decided, through a modal for the candidate dates", async () => {
    const g = play.guild(1);
    const panel = await decided(g);
    expect(messageText(play.shown(panel))).toContain(
      "**Location decided:** Ridge Trail (1 vote).",
    );
    expect(buttonLabels(play.shown(panel))).toEqual([
      "Start date vote",
      "Cancel round",
      "Settings",
      "Refresh",
    ]);
    const form = await g.owner.click(panel, ROUND_IDS.startDate);
    expect(form).toMatchObject({
      type: InteractionResponseType.Modal,
      data: {
        custom_id: ROUND_IDS.startDate,
        title: "Start date vote",
        components: [
          {
            label: "Candidate dates (one per line)",
            description:
              "2 to 25 dates, as YYYY-MM-DD or YYYY-MM-DD HH:MM (24-hour); the time defaults to 11:00.",
            component: {
              custom_id: ROUND_IDS.dates,
              required: true,
              placeholder: "2026-12-05 (starts at 11:00) or 2026-12-05 09:00",
            },
          },
        ],
      },
    });
  });

  it("refuses each kind of invalid input with the offending lines and starts nothing", async () => {
    const g = play.guild(2);
    const panel = await decided(g);
    const cases: [string, string[]][] = [
      [
        "2030-06-08\n2030/06/15\n\nnext Saturday",
        [
          "Line 2: `2030/06/15` is not a date.",
          "Line 4: `next Saturday` is not a date.",
        ],
      ],
      ["2030-06-08", ["You listed 1 date; a date vote needs 2 to 25"]],
      [
        "2030-06-08\n 2030-06-08 ",
        ["You listed 1 date; a date vote needs 2 to 25"],
      ],
      [
        Array.from(
          { length: 26 },
          (_, i) => `2030-07-${String(i + 1).padStart(2, "0")}`,
        ).join("\n"),
        ["You listed 26 different dates; a date vote holds at most 25."],
      ],
      [
        "2020-03-01\n2030-06-08\n2020-03-08 10:00",
        [
          "Line 1: `2020-03-01` (Sun, 1 Mar 2020 · 11:00) is in the past: today is ",
          "Line 3: `2020-03-08 10:00` (Sun, 8 Mar 2020 · 10:00) is in the past: today is ",
          " in America/Los_Angeles.",
        ],
      ],
    ];
    for (const [input, lines] of cases) {
      const response = await play.submitDates(g, panel, input);
      expect(response.type).toBe(
        InteractionResponseType.ChannelMessageWithSource,
      );
      expectEphemeral(g.owner, "**The date vote was not started.**");
      for (const line of lines) expectEphemeral(g.owner, line);
      expectEphemeral(g.owner, FORMATS);
    }
    expect(e2e.discord.channelMessages(g.channels.text)).toHaveLength(1);
    await g.owner.click(panel, ROUND_IDS.refresh);
    expect(buttonLabels(play.shown(panel))).toContain("Start date vote");
  });

  it("posts the dates in date order, then breaks a tie at random and announces the hike with the tie", async () => {
    const g = play.guild(3);
    const [ana, ben, cy] = g.members as [Member, Member, Member];
    const panel = await decided(g);
    const poll = await play.startDateVote(
      g,
      panel,
      "2030-06-22\n2030-06-15 09:00\n2030-06-08",
    );
    const text = messageText(poll);
    expect(text).toContain("## When should we hike Ridge Trail?");
    const order = [
      "**Sat, 8 Jun 2030 · 11:00** · 0 votes",
      "**Sat, 15 Jun 2030 · 09:00** · 0 votes",
      "**Sat, 22 Jun 2030 · 11:00** · 0 votes",
    ].map((line) => text.indexOf(line));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(buttonLabels(poll)).toEqual(["Vote", "Propose a date"]);

    await play.vote(ana, poll, [
      "Sat, 8 Jun 2030 · 11:00",
      "Sat, 22 Jun 2030 · 11:00",
    ]);
    await play.vote(ben, poll, ["Sat, 22 Jun 2030 · 11:00"]);
    await play.vote(cy, poll, ["Sat, 8 Jun 2030 · 11:00"]);
    await eventually(() => {
      expect(messageText(play.shown(poll))).toContain("3 members have voted.");
    });
    // Votes do not reorder the dates.
    const voted = messageText(play.shown(poll));
    expect(voted.indexOf("**Sat, 8 Jun 2030 · 11:00** · 2 votes")).toBeLessThan(
      voted.indexOf("**Sat, 15 Jun 2030 · 09:00** · 0 votes"),
    );

    await g.owner.click(panel, ROUND_IDS.refresh);
    expect(messageText(play.shown(panel))).toContain(
      "**The date vote is open**",
    );
    expect(buttonLabels(play.shown(panel))).toEqual([
      "Close date vote",
      "Cancel round",
      "Settings",
      "Refresh",
    ]);
    await play.closeVote(g.owner, panel, "date vote");

    const final = messageText(play.shown(poll));
    const winner =
      /🏆 \*\*(Sat, \d+ Jun 2030 · 11:00)\*\* won with 2 votes\./.exec(
        final,
      )?.[1];
    expect(["Sat, 8 Jun 2030 · 11:00", "Sat, 22 Jun 2030 · 11:00"]).toContain(
      winner,
    );
    expect(final).toContain(
      "2 options tied with 2 votes each; the winner was drawn at random.",
    );
    expectNoButtons(play.shown(poll));

    const announcement = await waitForMessage(
      e2e.discord,
      g.channels.news,
      (m) => messageText(m).includes("Hike planned"),
    );
    const announced = messageText(announcement);
    expect(announced).toContain("**Where:** Ridge Trail");
    // 11:00 in Los Angeles, the default zone, is 18:00 UTC in June.
    const starts: Record<string, number> = {
      "Sat, 8 Jun 2030 · 11:00": 1907172000,
      "Sat, 22 Jun 2030 · 11:00": 1908381600,
    };
    expect(announced).toContain(
      `**When:** ${winner ?? "?"} (<t:${String(starts[winner ?? ""])}:R>)`,
    );
    expect(announced).toContain(
      `**${winner ?? "?"}** won the date vote with 2 votes.`,
    );
    expect(announced).toContain(
      "2 options tied with 2 votes each; the winner was drawn at random.",
    );
    expect(announced).toContain(
      `https://discord.com/channels/${g.guildId}/${poll.channel_id}/${poll.id}`,
    );
    expect(messageText(play.shown(panel))).toContain(
      `**Last hike:** **Ridge Trail** on **${winner ?? "?"}**.`,
    );
  });

  it("answers a vote after the close with: This vote has closed.", async () => {
    const g = play.guild(4);
    const [ana, ben] = g.members as [Member, Member];
    const panel = await decided(g);
    const poll = await play.startDateVote(g, panel, "2030-06-08\n2030-06-15");
    await ana.click(poll, idStarting(play.shown(poll), "hb:poll:vote:"));
    const stale = ana.lastReply();
    await play.vote(ben, poll, ["Sat, 15 Jun 2030 · 11:00"]);
    await play.closeVote(g.owner, panel, "date vote");
    expectNoButtons(play.shown(poll));
    await ana.select(stale, idStarting(stale, "hb:poll:choose:"), [
      optionValues(stale)["Sat, 8 Jun 2030 · 11:00"] ?? "",
    ]);
    expect(messageText(play.shown(stale))).toBe("This vote has closed.");
    expect(messageText(play.shown(poll))).toContain(
      "🏆 **Sat, 15 Jun 2030 · 11:00** won with 1 vote.",
    );
  });

  it("keeps the location decided when the voting channel refuses the date poll, and says why", async () => {
    const g = play.guild(5);
    const panel = await decided(g);
    e2e.discord.failChannel(g.channels.text, "missing-permissions");
    const response = await play.submitDates(g, panel, "2030-06-08\n2030-06-15");
    expect(response.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    await eventually(() => {
      expect(messageText(play.shown(panel))).toContain(
        `Could not post the date vote in <#${g.channels.text}>: Discord answered: Missing Permissions (HTTP 403, code 50013). The date vote was not started;`,
      );
    });
    expect(messageText(play.shown(panel))).toContain(
      "**Location decided:** Ridge Trail",
    );
    expect(buttonLabels(play.shown(panel))).toContain("Start date vote");

    e2e.discord.clearChannelFailure(g.channels.text);
    const poll = await play.startDateVote(g, panel, "2030-06-08\n2030-06-15");
    expect(messageText(poll)).toContain("When should we hike Ridge Trail?");
  });

  it("cancels the round during the date vote, marks the date poll cancelled, and starts afresh", async () => {
    const g = play.guild(6);
    const [ana] = g.members as [Member];
    const panel = await decided(g);
    const poll = await play.startDateVote(g, panel, "2030-06-08\n2030-06-15");
    await play.vote(ana, poll, ["Sat, 8 Jun 2030 · 11:00"]);
    await play.cancelRound(g.owner, panel);
    expect(messageText(play.shown(poll))).toContain("This vote was cancelled.");
    expectNoButtons(play.shown(poll));
    expect(
      e2e.discord
        .channelMessages(g.channels.news)
        .filter((m) => messageText(m).includes("Hike planned")),
    ).toEqual([]);
    expect(messageText(play.shown(panel))).toContain(
      "No hike is being planned.",
    );
    expect(messageText(play.shown(panel))).not.toContain("Last hike");

    const fresh = await play.startLocationVote(g, panel, "Canyon");
    expect(fresh.id).not.toBe(poll.id);
    await play.vote(ana, fresh, ["Canyon"]);
  });

  it("refuses non-admins at Start date vote and at Close date vote", async () => {
    const g = play.guild(7);
    const [ana] = g.members as [Member];
    const panel = await decided(g);
    const refusal =
      "The hikebot admin panel is limited to the server owner and members with the admin role.";
    await ana.click(panel, ROUND_IDS.startDate);
    expectEphemeral(ana, refusal);
    const poll = await play.startDateVote(g, panel, "2030-06-08\n2030-06-15");
    await ana.click(panel, idStarting(play.shown(panel), "hb:poll:close:"));
    expectEphemeral(ana, refusal);
    await g.owner.click(panel, idStarting(play.shown(panel), "hb:poll:close:"));
    await ana.click(
      panel,
      idStarting(play.shown(panel), "hb:poll:close-confirm:"),
    );
    expectEphemeral(ana, refusal);
    expect(
      findComponent(
        play.shown(poll).components,
        idStarting(play.shown(poll), "hb:poll:vote:"),
      ),
    ).toBeDefined();
  });
});
