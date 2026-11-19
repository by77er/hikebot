/**
 * The admin controls of a server's web page: an admin plays a whole round
 * from the web while members vote in Discord, a member's forged POST is
 * refused, a control submitted after the round moved on is refused with
 * the panel's sentence, and a hike thread Discord refused is created again
 * from the page.
 */
import { beforeAll, expect, it } from "vitest";
import { messageText, type Member } from "./harness/helpers";
import { buttonLabels, RoundPlayer, type TestGuild } from "./harness/rounds";
import { PageClient, type PageResponse } from "./harness/web";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

/** The user who owns each guild and signs in to the web page as its admin. */
const ADMIN = "400000000000009501";
/** A member of each guild who is not an admin. */
const MEMBER = "400000000000009502";

/**
 * The file's guilds, by number. The Worker remembers which guilds the bot
 * is in for a minute after a sign-in reads them, so every guild is added
 * before the first sign-in.
 */
const guilds = new Map<number, TestGuild>();

beforeAll(() => {
  for (const n of [41, 42, 43, 44]) {
    const g = play.guild(n, { name: "Ridge Walkers", ownerId: ADMIN });
    e2e.discord.addMember(g.guildId, ADMIN);
    e2e.discord.addMember(g.guildId, MEMBER);
    guilds.set(n, g);
  }
});

function guild(n: number): TestGuild {
  const g = guilds.get(n);
  if (!g) throw new Error(`guild ${String(n)} was not added`);
  return g;
}

/** Signs `userId` in, a Discord user in every guild of the file. */
async function signIn(userId: string): Promise<PageClient> {
  e2e.discord.addUser({
    id: userId,
    username: userId === ADMIN ? "ana" : "ben",
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

/**
 * The page's text without its tags, whitespace collapsed; links and strong
 * text run on with the words around them.
 */
function textOf(html: string): string {
  return html
    .replace(/<\/?(a|strong)\b[^>]*>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The address of the link on `page` that reads `label`. */
function linkTo(page: PageResponse, label: string): string {
  for (const match of page.body.matchAll(
    /<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs,
  )) {
    if (textOf(match[2] ?? "") === label) {
      return (match[1] ?? "").replaceAll("&amp;", "&");
    }
  }
  throw new Error(`no link "${label}" on ${page.url.pathname}`);
}

/**
 * Submits the form of `page` posting to `action` with `fields`, checks the
 * Worker redirects to the server's page, and returns that page as it shows
 * the result.
 */
async function act(
  client: PageClient,
  page: PageResponse,
  action: string,
  fields: Record<string, string> = {},
): Promise<PageResponse> {
  const answer = await client.submitForm(page, action, fields);
  expect(answer.status).toBe(303);
  const back = answer.location?.pathname ?? "";
  expect(back).toMatch(/^\/g\/\d+$/);
  const result = await client.get(back);
  expect(result.status).toBe(200);
  return result;
}

/** Follows the page's link `label` to a confirmation page and confirms it. */
async function confirm(
  client: PageClient,
  page: PageResponse,
  label: string,
  question: string,
): Promise<PageResponse> {
  const href = linkTo(page, label);
  const asked = await client.get(href);
  expect(asked.status).toBe(200);
  expect(textOf(asked.body)).toContain(question);
  return act(client, asked, new URL(href, asked.url).pathname);
}

it("lets an admin play a whole round from the web while a member votes in Discord", async () => {
  const g = guild(41);
  const [voter] = g.members as [Member];
  await play.setUpPanel(g);
  const admin = await signIn(ADMIN);

  let page = await admin.get(`/g/${g.guildId}`);
  expect(textOf(page.body)).toContain("Admin");
  const start = await admin.get(linkTo(page, "Start location vote"));
  expect(start.status).toBe(200);
  expect(textOf(start.body)).toContain("Initial locations (one per line)");
  page = await act(admin, start, `/g/${g.guildId}/admin/start-location-vote`, {
    text: "Ridge Trail\nLake Loop",
  });
  expect(textOf(page.body)).toContain(
    `The location vote is open in #channel-${g.channels.text}.`,
  );
  const [where] = e2e.discord.channelMessages(g.channels.text);
  if (!where) throw new Error("the location vote was not posted");
  // The poll message names the admin as the proposer of the initial locations.
  expect(messageText(where)).toContain(`Proposed by <@${ADMIN}>`);

  await play.vote(voter, where, ["Lake Loop"]);
  page = await admin.get(`/g/${g.guildId}`);
  expect(textOf(page.body)).toContain("Lake Loop 1 vote");
  page = await confirm(
    admin,
    page,
    "Close location vote",
    "Close the location vote now?",
  );
  expect(textOf(page.body)).toContain(
    "The location vote is closed: Lake Loop won with 1 vote.",
  );
  expect(buttonLabels(play.shown(where))).toEqual([]);

  const dates = await admin.get(linkTo(page, "Start date vote"));
  expect(textOf(dates.body)).toContain("Candidate dates (one per line)");
  expect(dates.body).toMatch(/<textarea[^>]*>\s*\d{4}-\d{2}-\d{2}/);
  page = await act(admin, dates, `/g/${g.guildId}/admin/start-date-vote`, {
    text: "2030-06-15 09:00\n2030-06-08",
  });
  expect(textOf(page.body)).toContain(
    `The date vote is open in #channel-${g.channels.text}.`,
  );
  const when = e2e.discord.channelMessages(g.channels.text)[1];
  if (!when) throw new Error("the date vote was not posted");
  await play.vote(voter, when, ["Sat, 15 Jun 2030 · 09:00"]);
  page = await confirm(
    admin,
    await admin.get(`/g/${g.guildId}`),
    "Close date vote",
    "Close the date vote now?",
  );
  expect(textOf(page.body)).toContain(
    "The date vote is closed: Sat, 15 Jun 2030 · 09:00 won with 1 vote.",
  );
  expect(textOf(page.body)).not.toContain("A step failed.");
  expect(buttonLabels(play.shown(when))).toEqual([]);

  expect(e2e.discord.threads(g.channels.forum)).toHaveLength(1);
  expect(e2e.discord.scheduledEvents(g.guildId)).toHaveLength(1);
  const news = e2e.discord.channelMessages(g.channels.news).map(messageText);
  expect(news.filter((text) => text.includes("won the location vote"))).toEqual(
    [expect.stringContaining("**Lake Loop** won the location vote")],
  );
  expect(news.filter((text) => text.includes("won the date vote"))).toEqual([
    expect.stringContaining("won the date vote"),
  ]);
  // The round is over: the next step is a new location vote.
  expect(linkTo(page, "Start location vote")).toBe(
    `/g/${g.guildId}/admin/start-location-vote`,
  );
});

it("shows a member no controls and refuses their forged POST, changing nothing", async () => {
  const g = guild(42);
  await play.setUpPanel(g);
  const member = await signIn(MEMBER);
  const page = await member.get(`/g/${g.guildId}`);
  expect(page.status).toBe(200);
  expect(page.body).not.toContain("/admin/");

  // The member's own token, from the page's Sign out form, sent from the site.
  const token = /name="csrf" value="([^"]+)"/.exec(page.body)?.[1] ?? "";
  expect(token).not.toBe("");
  const refused = await member.request(
    `/g/${g.guildId}/admin/start-location-vote`,
    {
      form: { csrf: token, text: "Ridge Trail" },
      headers: { Origin: e2e.url.origin, "Sec-Fetch-Site": "same-origin" },
    },
  );
  expect(refused.status).toBe(403);
  expect(textOf(refused.body)).toContain("Only admins can do this");

  const crossSite = await member.request(
    `/g/${g.guildId}/admin/start-location-vote`,
    {
      form: { csrf: token, text: "Ridge Trail" },
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
    },
  );
  expect(crossSite.status).toBe(403);
  expect(
    (await member.get(`/g/${g.guildId}/admin/start-location-vote`)).status,
  ).toBe(403);
  expect(e2e.discord.channelMessages(g.channels.text)).toEqual([]);

  const admin = await signIn(ADMIN);
  const adminPage = await admin.get(`/g/${g.guildId}`);
  expect(linkTo(adminPage, "Start location vote")).toBe(
    `/g/${g.guildId}/admin/start-location-vote`,
  );
});

it("refuses a close submitted after the vote was closed in Discord, with the panel's sentence", async () => {
  const g = guild(43);
  const [voter] = g.members as [Member];
  const panel = await play.setUpPanel(g);
  const where = await play.startLocationVote(
    g,
    panel,
    "Ridge Trail\nLake Loop",
  );
  await play.vote(voter, where, ["Ridge Trail"]);
  const admin = await signIn(ADMIN);
  const page = await admin.get(`/g/${g.guildId}`);
  const href = linkTo(page, "Close location vote");
  const asked = await admin.get(href);
  expect(textOf(asked.body)).toContain("Ridge Trail 1 vote");

  await play.closeVote(g.owner, panel, "location vote");
  const news = e2e.discord.channelMessages(g.channels.news).length;

  const result = await act(admin, asked, new URL(href, asked.url).pathname);
  const text = textOf(result.body);
  expect(text).toContain("Nothing was changed.");
  expect(text).toContain("That vote is no longer open.");
  expect(e2e.discord.channelMessages(g.channels.news)).toHaveLength(news);
});

it("creates the hike thread again from the page after Discord refused it once", async () => {
  const g = guild(44);
  const [voter] = g.members as [Member];
  const panel = await play.setUpPanel(g);
  const where = await play.startLocationVote(
    g,
    panel,
    "Lake Loop\nRidge Trail",
  );
  await play.vote(voter, where, ["Lake Loop"]);
  await play.closeVote(g.owner, panel, "location vote");
  const when = await play.startDateVote(
    g,
    panel,
    "2030-06-15 09:00\n2030-06-08",
  );
  await play.vote(voter, when, ["Sat, 15 Jun 2030 · 09:00"]);

  const admin = await signIn(ADMIN);
  e2e.discord.failChannel(g.channels.forum, "missing-permissions");
  const closed = await confirm(
    admin,
    await admin.get(`/g/${g.guildId}`),
    "Close date vote",
    "Close the date vote now?",
  );
  e2e.discord.clearChannelFailure(g.channels.forum);
  const text = textOf(closed.body);
  expect(text).toContain("A step failed. Try it again:");
  expect(text).toContain(
    "Hike thread: not created. Could not create the hike thread in",
  );
  expect(e2e.discord.threads(g.channels.forum)).toEqual([]);

  const retried = await act(
    admin,
    closed,
    `/g/${g.guildId}/admin/create-hike-thread`,
  );
  expect(textOf(retried.body)).toContain("The hike thread is open:");
  expect(textOf(retried.body)).not.toContain("A step failed.");
  expect(e2e.discord.threads(g.channels.forum)).toHaveLength(1);
});
