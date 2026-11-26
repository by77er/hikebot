import { ChannelType } from "discord-api-types/v10";
import { beforeAll, expect, it } from "vitest";
import { messageText } from "./harness/helpers";
import { subcommand } from "./harness/interactions";
import { ROUND_IDS, RoundPlayer, type TestGuild } from "./harness/rounds";
import { PageClient, type PageResponse } from "./harness/web";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

/** The admin who owns every guild of the file and signs in to the web. */
const ADMIN = "400000000000009101";
/** A member of every guild who is not an admin. */
const MEMBER = "400000000000009102";
const ROLE = "500000000000009101";

/**
 * The file's guilds, by number. The Worker remembers which guilds the bot
 * is in for a minute after a sign-in reads them, so every guild is added
 * before the first sign-in.
 */
const guilds = new Map<number, TestGuild>();

beforeAll(() => {
  for (const n of [11, 12, 13, 14]) {
    const g = play.guild(n, { name: "Ridge Walkers", ownerId: ADMIN });
    e2e.discord.addMember(g.guildId, MEMBER);
    e2e.discord.addRole(g.guildId, {
      id: ROLE,
      name: "Hike leads",
      position: 1,
    });
    guilds.set(n, g);
  }
});

function guild(n: number): TestGuild {
  const g = guilds.get(n);
  if (!g) throw new Error(`guild ${String(n)} was not added`);
  return g;
}

/** Signs `userId` in with every guild of the file listed. */
async function signIn(userId: string): Promise<PageClient> {
  e2e.discord.addUser({
    id: userId,
    username: "ana",
    globalName: "Ana",
    guilds: [...guilds.values()].map((g) => ({
      id: g.guildId,
      name: "Ridge Walkers",
    })),
  });
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

/**
 * Posts group `group` of the settings page from the page, as a browser
 * does, and follows the redirect back to the page.
 */
async function save(
  client: PageClient,
  page: PageResponse,
  group: string,
  fields: Record<string, string>,
): Promise<PageResponse> {
  const action = page.url.pathname;
  const saved = await client.submitForm(page, action, { group, ...fields });
  expect(saved.status, textOf(saved.body)).toBe(303);
  expect(saved.location?.hash).toBe(`#${group}`);
  return client.get(
    `${saved.location?.pathname ?? ""}${saved.location?.search ?? ""}`,
  );
}

/** The status view of `/hike admin`, as the guild's owner opens it. */
async function panelText(g: TestGuild): Promise<string> {
  await g.owner.run("hike", [subcommand("admin")]);
  return messageText(g.owner.lastReply());
}

it("lets an admin set every group from the web, and /hike admin shows the values", async () => {
  const g = guild(11);
  e2e.geocoder.addPlace("Seattle, Washington", {
    lat: 47.6038321,
    lon: -122.330062,
    displayName: "Seattle, King County, Washington, United States",
  });
  const client = await signIn(ADMIN);
  const server = await client.get(`/g/${g.guildId}`);
  expect(server.body).toContain(`href="/g/${g.guildId}/settings"`);

  let page = await client.get(`/g/${g.guildId}/settings`);
  expect(page.status).toBe(200);
  expect(textOf(page.body)).toContain(
    "Setup is not complete: set the voting channel, announcements channel and hike threads channel under Channels.",
  );
  expect(page.body).toContain(">Hike leads</option>");

  page = await save(client, page, "admin-role", { adminRoleId: ROLE });
  expect(textOf(page.body)).toContain(
    "Admin role saved. Admin role set to @Hike leads.",
  );
  page = await save(client, page, "channels", {
    voteChannelId: g.channels.text,
    announceChannelId: g.channels.news,
    forumChannelId: g.channels.forum,
  });
  expect(textOf(page.body)).toContain(
    `Channels saved. Voting channel set to #channel-${g.channels.text}.`,
  );
  expect(textOf(page.body)).not.toContain("Setup is not complete");
  page = await save(client, page, "time-zone", { timezone: "Europe/Berlin" });
  expect(textOf(page.body)).toContain("Time zone set to Europe/Berlin.");
  expect(page.body).toContain('value="Europe/Berlin" selected');
  page = await save(client, page, "home-area", {
    homeArea: "Seattle, Washington",
  });
  expect(textOf(page.body)).toContain(
    "Home area set to Seattle, Washington , found as Seattle, King County, Washington.",
  );
  page = await save(client, page, "units", { units: "metric" });
  expect(textOf(page.body)).toContain("Units set to metric.");
  page = await save(client, page, "schedule", {
    "cadence.enabled": "on",
    "cadence.weekday": "5",
    "cadence.time": "18:30",
    "cadence.dateVoteDays": "3",
  });
  expect(textOf(page.body)).toContain("The schedule is on.");

  const status = await panelText(g);
  expect(status).toContain(`**Admin role:** <@&${ROLE}>`);
  expect(status).toContain(`**Voting channel:** <#${g.channels.text}>`);
  expect(status).toContain(`**Announcements channel:** <#${g.channels.news}>`);
  expect(status).toContain(`**Hike threads channel:** <#${g.channels.forum}>`);
  expect(status).toContain("**Time zone:** Europe/Berlin · now ");
  expect(status).toContain(
    "**Schedule:** on · Fridays at 18:30 (Europe/Berlin) · date vote 3 days",
  );
  expect(status).toContain("**Next:** ");
  const panel = g.owner.lastReply();
  await g.owner.click(panel, ROUND_IDS.settings);
  const settings = messageText(play.shown(panel));
  expect(settings).toContain(
    "**Home area:** Seattle, Washington (found as Seattle, King County, Washington)",
  );
  expect(settings).toContain("**Units:** metric");
});

it("shows a channel set in Discord as the one chosen on the page", async () => {
  const g = guild(12);
  e2e.discord.addChannel({
    id: "300000000000009121",
    guildId: g.guildId,
    type: ChannelType.GuildCategory,
    name: "Hiking",
  });
  e2e.discord.addChannel({
    id: g.channels.text,
    guildId: g.guildId,
    name: "votes",
    parentId: "300000000000009121",
  });
  await play.setUpPanel(g);
  const client = await signIn(ADMIN);
  const page = await client.get(`/g/${g.guildId}/settings`);
  expect(page.status).toBe(200);
  expect(page.body).toContain(
    `<optgroup label="Hiking"><option value="${g.channels.text}" selected>#votes</option>`,
  );
  expect(page.body).toContain(`value="${g.channels.forum}" selected`);
  expect(page.body).not.toContain(
    `value="${g.channels.forum}" selected>#votes`,
  );
});

it("refuses to turn the schedule on while a channel is missing, naming it, then turns it on", async () => {
  const g = guild(13);
  const client = await signIn(ADMIN);
  let page = await client.get(`/g/${g.guildId}/settings`);
  page = await save(client, page, "channels", {
    voteChannelId: g.channels.text,
    announceChannelId: g.channels.news,
    forumChannelId: "",
  });
  const schedule = {
    group: "schedule",
    "cadence.enabled": "on",
    "cadence.weekday": "3",
    "cadence.time": "09:00",
    "cadence.dateVoteDays": "2",
  };
  const refused = await client.submitForm(page, page.url.pathname, schedule);
  expect(refused.status).toBe(400);
  expect(textOf(refused.body)).toContain(
    "The schedule needs the hike threads channel. Set them above, then turn it on.",
  );
  expect(await panelText(g)).toContain("**Schedule:** off");

  page = await save(client, refused, "channels", {
    voteChannelId: g.channels.text,
    announceChannelId: g.channels.news,
    forumChannelId: g.channels.forum,
  });
  page = await save(client, page, "schedule", schedule);
  expect(textOf(page.body)).toContain("Schedule saved. The schedule is on.");
  const status = await panelText(g);
  expect(status).toContain(
    "**Schedule:** on · Wednesdays at 09:00 (America/Los_Angeles) · date vote 2 days",
  );
  expect(status).toContain("**Next:** ");
});

it("refuses the page and a forged save to a member who is not an admin", async () => {
  const g = guild(14);
  const client = await signIn(MEMBER);
  const page = await client.get(`/g/${g.guildId}/settings`);
  expect(page.status).toBe(403);
  expect(textOf(page.body)).toContain("Only admins can do this");
  expect(page.body).not.toContain('name="units"');
  expect((await client.get(`/g/${g.guildId}`)).body).not.toContain(
    `/g/${g.guildId}/settings`,
  );

  // The member's own token, from the Sign out form on any of their pages.
  const servers = await client.get("/servers");
  const token = /name="csrf" value="([^"]+)"/.exec(servers.body)?.[1] ?? "";
  expect(token).not.toBe("");
  const refused = await client.request(`/g/${g.guildId}/settings`, {
    form: { csrf: token, group: "units", units: "metric" },
    headers: { Origin: servers.url.origin, "Sec-Fetch-Site": "same-origin" },
  });
  expect(refused.status).toBe(403);
  expect(textOf(refused.body)).toContain("Only admins can do this");
  const fromElsewhere = await client.request(`/g/${g.guildId}/settings`, {
    form: { csrf: token, group: "units", units: "metric" },
    headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
  });
  expect(fromElsewhere.status).toBe(403);

  const panel = await play.setUpPanel(g);
  await g.owner.click(panel, ROUND_IDS.settings);
  expect(messageText(play.shown(panel))).toContain("**Units:** imperial");
});
