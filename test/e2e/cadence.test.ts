import { describe, expect, it } from "vitest";
import { Member, messageText, waitForMessage } from "./harness/helpers";
import { RoundPlayer, type TestGuild } from "./harness/rounds";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

const LA = "America/Los_Angeles";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The calendar day (`YYYY-MM-DD`) and time (`HH:MM`) at `at` in LA. */
function inLosAngeles(at: number): {
  day: string;
  time: string;
  weekday: number;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: LA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: `${parts.year ?? ""}-${parts.month ?? ""}-${parts.day ?? ""}`,
    time: `${parts.hour ?? ""}:${parts.minute ?? ""}`,
    weekday: WEEKDAYS.indexOf(parts.weekday ?? ""),
  };
}

function plusDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Sets up the panel and decides the location as Ridge Trail. */
async function decided(g: TestGuild) {
  const [ana] = g.members as [Member];
  const panel = await play.setUpPanel(g);
  const poll = await play.startLocationVote(g, panel, "Ridge Trail");
  await play.vote(ana, poll, ["Ridge Trail"]);
  await play.closeVote(g.owner, panel, "location vote");
  await waitForMessage(e2e.discord, g.channels.news, (m) =>
    messageText(m).includes("Hike location decided"),
  );
  return panel;
}

const notice = (g: TestGuild, text: string) =>
  waitForMessage(
    e2e.discord,
    g.channels.news,
    (m) => messageText(m).includes(text),
    { timeout: 200_000 },
  );

describe("the weekly schedule's job", () => {
  // The Worker's clock cannot be moved, so the votes are aged in storage and
  // the schedule is set to a minute or two from now; the test waits for the
  // object's real alarm, through what the bot posts.
  it("holds a quiet location vote, holds a quiet date vote, and cancels a round nobody voted a date for", async () => {
    const today = inLosAngeles(Date.now()).day;

    // A location vote open a week with an option and no votes.
    const quietWhere = play.guild(1);
    const wherePanel = await play.setUpPanel(quietWhere);
    await play.startLocationVote(quietWhere, wherePanel, "Ridge Trail");
    await play.backdateVotes(quietWhere, 7);

    // A date vote open three days with no votes, its dates days ahead.
    const quietWhen = play.guild(2);
    const whenPanel = await decided(quietWhen);
    await play.startDateVote(
      quietWhen,
      whenPanel,
      [plusDays(today, 10), plusDays(today, 11)].join("\n"),
    );
    await play.backdateVotes(quietWhen, 3);

    // A date vote open three days with no votes, its first date less than
    // a day away.
    const tooLate = play.guild(3);
    const latePanel = await decided(tooLate);
    const soon = inLosAngeles(Date.now() + 12 * 3_600_000);
    await play.startDateVote(
      tooLate,
      latePanel,
      [`${soon.day} ${soon.time}`, plusDays(today, 10)].join("\n"),
    );
    await play.backdateVotes(tooLate, 3);

    // The schedule's next instant: the whole minute at least 75 s from now.
    const at = Math.ceil((Date.now() + 75_000) / 60_000) * 60_000;
    const { weekday, time } = inLosAngeles(at);
    for (const [g, panel] of [
      [quietWhere, wherePanel],
      [quietWhen, whenPanel],
      [tooLate, latePanel],
    ] as const) {
      await play.turnScheduleOn(g, panel, weekday, time);
    }

    const [where, when, cancelled] = await Promise.all([
      notice(quietWhere, "The location vote stays open another week."),
      notice(quietWhen, "The date vote stays open."),
      notice(tooLate, "This round is cancelled."),
    ]);
    const again = new RegExp(
      `^\\*\\*The location vote stays open another week\\.\\*\\*\\nNobody has voted yet, so hikebot did not close it\\. Propose a location or vote in <#${quietWhere.channels.text}>; hikebot tries again <t:(\\d+):F>\\.$`,
    ).exec(messageText(where));
    expect(again, messageText(where)).not.toBeNull();
    // A week later at the same time there (an hour off across a clock change).
    expect(
      Math.abs(Number(again?.[1]) - (at / 1000 + 7 * 86_400)),
    ).toBeLessThanOrEqual(3_600);
    expect(messageText(when)).toBe(
      `**The date vote stays open.**\nNobody has voted on a date yet, so hikebot did not close it. Vote in <#${quietWhen.channels.text}>: hikebot closes it at ${time} (America/Los_Angeles) on the first day someone has voted, and cancels the round if nobody has voted by the day before the earliest date.`,
    );
    expect(messageText(cancelled)).toMatch(
      /^\*\*This round is cancelled\.\*\*\nNobody voted on a date for \*\*Ridge Trail\*\*, so hikebot cancelled the round\. A new location vote opens <t:\d+:F>\.$/,
    );

    // What the panels show after the job's run.
    await quietWhere.owner.click(wherePanel, "hb:admin:refresh");
    expect(messageText(play.shown(wherePanel))).toContain(
      "**The location vote is open**",
    );
    await quietWhen.owner.click(whenPanel, "hb:admin:refresh");
    expect(messageText(play.shown(whenPanel))).toContain(
      "**The date vote is open**",
    );
    await tooLate.owner.click(latePanel, "hb:admin:refresh");
    expect(messageText(play.shown(latePanel))).toContain(
      "**Next:** Opens a location vote",
    );
  }, 240_000);
});
