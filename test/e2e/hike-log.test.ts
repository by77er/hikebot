import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { InteractionResponseType } from "discord-api-types/v10";
import { expect, it } from "vitest";
import {
  allComponents,
  eventually,
  messageText,
  type Member,
} from "./harness/helpers";
import { subcommand } from "./harness/interactions";
import { buttonLabels, expectEphemeral, RoundPlayer } from "./harness/rounds";
import { APPLICATION_ID, BOT_TOKEN, useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

it("shows a member who is not an admin the group's hikes, newest first", async () => {
  const g = play.guild(1);
  const [, member] = g.members as [Member, Member];
  const panel = await play.setUpPanel(g);
  await play.playHike(g, panel, {
    location: "Ridge",
    dates: ["2030-06-08", "2030-06-15"],
    date: "Sat, 15 Jun 2030 · 11:00",
  });
  await play.playHike(g, panel, {
    location: "Lake",
    dates: ["2030-03-02", "2030-03-09"],
    date: "Sat, 2 Mar 2030 · 11:00",
  });

  await eventually(async () => {
    const answer = await member.run("hike", [subcommand("log")]);
    expect(answer.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(
      messageText(member.lastReply()).match(/Thread: <#\d+> · \[Event\]/g),
    ).toHaveLength(2);
  });
  const [ridge, lake] = e2e.discord.threads(g.channels.forum);
  if (!ridge || !lake) throw new Error("the hike threads were not created");
  const [ridgeEvent, lakeEvent] = e2e.discord.scheduledEvents(g.guildId);
  if (!ridgeEvent || !lakeEvent) {
    throw new Error("the hike events were not created");
  }
  const events = `https://discord.com/events/${g.guildId}`;
  expectEphemeral(member, "Hike log");
  const shown = messageText(member.lastReply());
  expect(shown).toContain("2 hikes");
  expect(shown).toContain(
    [
      "Sat, 15 Jun 2030 · 11:00 · **Ridge**",
      `Thread: <#${ridge.id}> · [Event](${events}/${ridgeEvent.id})`,
      "Sat, 2 Mar 2030 · 11:00 · **Lake**",
      `Thread: <#${lake.id}> · [Event](${events}/${lakeEvent.id})`,
    ].join("\n"),
  );
  expect(buttonLabels(member.lastReply())).toEqual([]);
});

/** The Newer and Older buttons of a log message, with whether each is disabled. */
function pageButtons(message: { components: unknown[] }) {
  return allComponents(message.components)
    .filter((c) => typeof c.custom_id === "string")
    .map((c) => [c.label, c.custom_id, c.disabled === true]);
}

it("pages more than ten hikes with Newer and Older, in place", async () => {
  const g = play.guild(3);
  const [, member] = g.members as [Member, Member];
  const panel = await play.setUpPanel(g);
  // 1 Jan 2031 is a Wednesday.
  const weekdays = ["Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue"];
  for (let day = 1; day <= 11; day++) {
    await play.playHike(g, panel, {
      location: `Hike ${String(day)}`,
      dates: [
        `2031-01-${String(day).padStart(2, "0")}`,
        `2031-01-${String(day + 14).padStart(2, "0")}`,
      ],
      date: `${weekdays[(day - 1) % 7] ?? ""}, ${String(day)} Jan 2031 · 11:00`,
    });
  }

  await member.run("hike", [subcommand("log")]);
  const log = member.lastReply();
  expectEphemeral(member, "11 hikes · page 1 of 2");
  expect(messageText(log)).not.toContain("Wed, 1 Jan 2031 · 11:00");
  expect(messageText(log)).toMatch(
    /Sat, 11 Jan 2031 · 11:00 · \*\*Hike 11\*\*/,
  );
  expect(messageText(log)).not.toContain("**Hike 1**");
  expect(pageButtons(log)).toEqual([
    ["Newer", "hb:log:page:0", true],
    ["Older", "hb:log:page:2", false],
  ]);

  const older = await member.click(log, "hb:log:page:2");
  expect(older.type).toBe(InteractionResponseType.UpdateMessage);
  const second = play.shown(log);
  expect(messageText(second)).toContain("11 hikes · page 2 of 2");
  expect(messageText(second)).toContain("Wed, 1 Jan 2031 · 11:00 · **Hike 1**");
  expect(messageText(second)).not.toContain("**Hike 2**");
  expect(pageButtons(second)).toEqual([
    ["Newer", "hb:log:page:1", false],
    ["Older", "hb:log:page:3", true],
  ]);

  await member.click(log, "hb:log:page:1");
  expect(messageText(play.shown(log))).toContain("11 hikes · page 1 of 2");
});

it("tells a guild without hikes that the first one appears when a date vote closes", async () => {
  const g = play.guild(2);
  const [member] = g.members as [Member];
  await member.run("hike", [subcommand("log")]);
  expectEphemeral(
    member,
    "No hikes yet. The first one appears here when a date vote closes.",
  );
  expect(buttonLabels(member.lastReply())).toEqual([]);
});

it("registers /hike with its admin and log subcommands", async () => {
  const { stdout } = await promisify(execFile)(
    "npx",
    ["tsx", "scripts/register-commands.ts"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DISCORD_API_BASE: e2e.discord.apiBase,
        DISCORD_APPLICATION_ID: APPLICATION_ID,
        DISCORD_BOT_TOKEN: BOT_TOKEN,
      },
    },
  );
  expect(stdout).toContain("/hike (admin, log)");
  expect(e2e.discord.commands).toMatchObject([
    { name: "hike", options: [{ name: "admin" }, { name: "log" }] },
  ]);
});
