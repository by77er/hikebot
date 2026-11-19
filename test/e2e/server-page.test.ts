import { expect, it } from "vitest";
import { type Member } from "./harness/helpers";
import { RoundPlayer } from "./harness/rounds";
import { PageClient } from "./harness/web";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

/** Signs `userId` in as a Discord user in `guilds`, and returns the client. */
async function signIn(
  userId: string,
  guilds: { id: string; name: string }[],
): Promise<PageClient> {
  e2e.discord.addUser({ id: userId, username: "ana", globalName: "Ana", guilds });
  const client = new PageClient(e2e.url);
  const back = await client.signIn({ id: userId });
  expect(back.status).toBe(303);
  return client;
}

/** The page's text without its tags, whitespace collapsed. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

it("shows a member the location vote's tally as members voted in Discord", async () => {
  const g = play.guild(1, { name: "Ridge Walkers" });
  const viewer = "400000000000009001";
  e2e.discord.addMember(g.guildId, viewer);
  const [ana, ben, cy] = g.members as [Member, Member, Member];
  const panel = await play.setUpPanel(g);
  const poll = await play.startLocationVote(
    g,
    panel,
    ["Ridge", "Lake", "Canyon"].join("\n"),
  );
  await play.vote(ana, poll, ["Lake", "Ridge"]);
  await play.vote(ben, poll, ["Lake"]);
  await play.vote(cy, poll, ["Lake", "Canyon"]);

  const client = await signIn(viewer, [{ id: g.guildId, name: "Ridge Walkers" }]);
  const page = await client.get(`/g/${g.guildId}`);
  expect(page.status).toBe(200);
  const text = textOf(page.body);
  expect(text).toContain("Ridge Walkers");
  expect(text).toContain("3 members have voted.");
  expect(text).toContain("Lake 3 votes");
  expect(text).toContain("Ridge 1 vote");
  expect(text).toContain("Canyon 1 vote");
  expect(text.indexOf("Lake 3 votes")).toBeLessThan(text.indexOf("Ridge 1 vote"));
  expect(text).toContain("You have not voted yet.");
  expect(page.body).toContain(
    `href="https://discord.com/channels/${g.guildId}/${g.channels.text}/${poll.id}"`,
  );
});

it("refuses a signed-in user who is no longer a member", async () => {
  const g = play.guild(2, { name: "Ridge Walkers" });
  const leaver = "400000000000009002";
  e2e.discord.addMember(g.guildId, leaver);
  const client = await signIn(leaver, [{ id: g.guildId, name: "Ridge Walkers" }]);
  e2e.discord.removeMember(g.guildId, leaver);

  const page = await client.get(`/g/${g.guildId}`);
  expect(page.status).toBe(403);
  expect(textOf(page.body)).toContain(
    "You are not a member of this server any more",
  );
  expect(page.body).toContain('href="/login?next=/servers"');
  expect(page.body).not.toContain("Ridge Walkers");
});

it("answers a server outside the session's list as not found", async () => {
  const g = play.guild(3, { name: "Ridge Walkers" });
  const member = "400000000000009003";
  e2e.discord.addMember(g.guildId, member);
  const client = await signIn(member, []);

  const page = await client.get(`/g/${g.guildId}`);
  expect(page.status).toBe(404);
  expect(textOf(page.body)).toContain("Page not found");
  const log = await client.get(`/g/${g.guildId}/log`);
  expect(log.status).toBe(404);
});

it("sends someone signed out to sign in and back to the server", async () => {
  const page = await new PageClient(e2e.url).get("/g/220000000000000104/log?page=2");
  expect(page.status).toBe(303);
  expect(page.location?.pathname).toBe("/login");
  expect(page.location?.searchParams.get("next")).toBe(
    "/g/220000000000000104/log?page=2",
  );
});

it("pages the hike log ten at a time, the older hikes on the second page", async () => {
  const g = play.guild(5, { name: "Ridge Walkers" });
  const member = "400000000000009005";
  e2e.discord.addMember(g.guildId, member);
  const panel = await play.setUpPanel(g);
  // 1 Jan 2031 is a Wednesday; hike n is on the nth, a Saturday or not.
  const weekdays = ["Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue"];
  for (let day = 1; day <= 11; day++) {
    const dd = String(day).padStart(2, "0");
    await play.playHike(g, panel, {
      location: `Hike ${String(day)}`,
      dates: [`2031-01-${dd}`, `2031-02-${dd}`],
      date: `${weekdays[(day - 1) % 7] ?? ""}, ${String(day)} Jan 2031 · 11:00`,
    });
  }
  const client = await signIn(member, [{ id: g.guildId, name: "Ridge Walkers" }]);

  const server = textOf((await client.get(`/g/${g.guildId}`)).body);
  expect(server).toContain("11 hikes");
  expect(server).toContain("Hike 11");
  expect(server).toContain("Hike 7");
  expect(server).not.toContain("Hike 6 ");

  const first = await client.get(`/g/${g.guildId}/log`);
  expect(first.status).toBe(200);
  expect(textOf(first.body)).toContain("11 hikes · page 1 of 2");
  expect(textOf(first.body)).toContain("Hike 2 ");
  expect(textOf(first.body)).not.toContain("Hike 1 ");
  expect(first.body).toContain(`href="/g/${g.guildId}/log?page=2"`);

  const second = await client.get(`/g/${g.guildId}/log?page=2`);
  expect(second.status).toBe(200);
  const older = textOf(second.body);
  expect(older).toContain("11 hikes · page 2 of 2");
  expect(older).toContain("Hike 1 ");
  expect(older).toContain("Wed, 1 Jan 2031 · 11:00 America/Los_Angeles");
  expect(older).not.toContain("Hike 2 ");
});
