import { InteractionResponseType } from "discord-api-types/v10";
import { beforeAll, expect, it } from "vitest";
import { eventually, messageText, type Member } from "./harness/helpers";
import {
  expectEphemeral,
  idStarting,
  RoundPlayer,
  type TestGuild,
} from "./harness/rounds";
import { PageClient, type PageResponse } from "./harness/web";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

const ID = {
  name: "hb:location:name",
  details: "hb:location:details",
};

/**
 * The file's guilds, by number. The Worker remembers which guilds the bot
 * is in for a minute after a sign-in reads them, so every guild is added
 * before the first sign-in.
 */
const guilds = new Map<number, TestGuild>();

beforeAll(() => {
  for (const n of [20, 21, 22, 23, 24, 25]) {
    guilds.set(n, play.guild(n, { name: "Ridge Walkers" }));
  }
});

function guild(n: number): TestGuild {
  const g = guilds.get(n);
  if (!g) throw new Error(`guild ${String(n)} was not added`);
  return g;
}

/**
 * Signs the guild's member `member` in to the web pages, with the guild in
 * their list, and returns their client.
 */
async function signIn(g: TestGuild, member: Member): Promise<PageClient> {
  e2e.discord.addUser({
    id: member.actor.userId,
    username: "ana",
    globalName: "Ana",
    guilds: [{ id: g.guildId, name: "Ridge Walkers" }],
  });
  const client = new PageClient(e2e.url);
  expect((await client.signIn({ id: member.actor.userId })).status).toBe(303);
  return client;
}

/** The page's text without its tags, whitespace collapsed. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The vote form's option ids by label, and the ones ticked. */
function voteOptions(page: PageResponse): {
  ids: Record<string, string>;
  ticked: string[];
} {
  const ids: Record<string, string> = {};
  const ticked: string[] = [];
  for (const [, value = "", attributes = "", label = ""] of page.body.matchAll(
    /name="option" value="(\d+)"([^>]*)\/><span>([^<]*)<\/span>/g,
  )) {
    ids[label] = value;
    if (/\bchecked\b/.test(attributes)) ticked.push(label);
  }
  return { ids, ticked };
}

/** The path a form of `page` posts to, ending in `suffix`. */
function actionOf(page: PageResponse, suffix: "votes" | "options"): string {
  const match = new RegExp(`action="(/g/\\d+/polls/\\d+/${suffix})"`).exec(
    page.body,
  );
  if (!match?.[1]) throw new Error(`the page has no form to .../${suffix}`);
  return match[1];
}

/** Follows the redirect of a done action and returns the page it shows. */
async function followed(
  client: PageClient,
  response: PageResponse,
): Promise<PageResponse> {
  expect(response.status).toBe(303);
  expect(response.location?.pathname).toMatch(/^\/g\/\d+$/);
  return client.get(response.location?.pathname ?? "/");
}

/** Today in Los Angeles, the default zone, as `YYYY-MM-DD`. */
function todayInLosAngeles(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(Date.now());
}

/** The day `n` days after `day`, both `YYYY-MM-DD`. */
function plusDays(day: string, n: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

it("saves a member's votes from the web, which the Discord poll message and the Vote select then show, and the web shows votes changed in Discord", async () => {
  const g = guild(20);
  const [ana, ben] = g.members as [Member, Member];
  const panel = await play.setUpPanel(g);
  const poll = await play.startLocationVote(g, panel, "Ridge\nLake\nCanyon");
  await play.vote(ben, poll, ["Ridge"]);
  const client = await signIn(g, ana);

  const page = await client.get(`/g/${g.guildId}`);
  expect(page.status).toBe(200);
  const { ids, ticked } = voteOptions(page);
  expect(Object.keys(ids).sort()).toEqual(["Canyon", "Lake", "Ridge"]);
  expect(ticked).toEqual([]);
  expect(textOf(page.body)).toContain("Save votes");

  const saved = await client.submitForm(page, actionOf(page, "votes"), {
    option: [ids.Lake ?? "", ids.Canyon ?? ""],
  });
  const after = await followed(client, saved);
  expect(textOf(after.body)).toContain("Your votes are saved.");
  expect(voteOptions(after).ticked.sort()).toEqual(["Canyon", "Lake"]);
  expect(textOf(after.body)).toContain("2 members have voted.");

  // A reload shows the votes without the banner, and saves nothing again.
  const reloaded = await client.get(`/g/${g.guildId}`);
  expect(textOf(reloaded.body)).not.toContain("Your votes are saved.");
  expect(voteOptions(reloaded).ticked.sort()).toEqual(["Canyon", "Lake"]);

  // The poll message in Discord is refreshed with the same tally.
  await eventually(() => {
    const text = messageText(play.shown(poll));
    expect(text).toContain("**Lake** · 1 vote");
    expect(text).toContain("**Canyon** · 1 vote");
    expect(text).toContain("2 members have voted.");
  });

  // In Discord, Ana's Vote select starts from the votes she saved on the web.
  await ana.click(poll, idStarting(play.shown(poll), "hb:poll:vote:"));
  const select = ana.lastReply();
  expect(JSON.stringify(select.components)).toMatch(
    /"label":"Lake","value":"\d+","default":true/,
  );
  expect(JSON.stringify(select.components)).toMatch(
    /"label":"Ridge","value":"\d+","default":false/,
  );

  // She changes them in Discord; the web page shows the change.
  await play.vote(ana, poll, ["Ridge"]);
  const changed = await client.get(`/g/${g.guildId}`);
  expect(voteOptions(changed).ticked).toEqual(["Ridge"]);
  expect(textOf(changed.body)).toContain("Ridge 2 votes");

  // Saving none clears them.
  const cleared = await followed(
    client,
    await client.submitForm(changed, actionOf(changed, "votes"), {
      option: [],
    }),
  );
  expect(textOf(cleared.body)).toContain("Your votes are cleared.");
  expect(voteOptions(cleared).ticked).toEqual([]);
  await eventually(() => {
    expect(messageText(play.shown(poll))).toContain("**Ridge** · 1 vote");
  });
});

it("proposes a location from the web, which members then vote for in Discord, and refuses a duplicate with the bot's words", async () => {
  const g = guild(21);
  const [ana, ben] = g.members as [Member, Member];
  const panel = await play.setUpPanel(g);
  const poll = await play.startLocationVote(g, panel, "Ridge");
  const client = await signIn(g, ana);

  const page = await client.get(`/g/${g.guildId}`);
  expect(textOf(page.body)).toContain("Propose a location");
  const options = actionOf(page, "options");
  const added = await followed(
    client,
    await client.submitForm(page, options, {
      name: "Mailbox Peak",
      details: "Steep, 15 km",
      map: "",
    }),
  );
  expect(textOf(added.body)).toContain("Added Mailbox Peak.");
  await eventually(() => {
    const text = messageText(play.shown(poll));
    expect(text).toContain("**Mailbox Peak** · 0 votes");
    expect(text).toContain("Steep, 15 km");
    expect(text).toContain(`Proposed by <@${ana.actor.userId}>`);
  });

  await play.vote(ben, poll, ["Mailbox Peak"]);
  await eventually(() => {
    expect(messageText(play.shown(poll))).toContain(
      "**Mailbox Peak** · 1 vote",
    );
  });
  expect(textOf((await client.get(`/g/${g.guildId}`)).body)).toContain(
    "Mailbox Peak 1 vote",
  );

  const refused = await client.submitForm(added, options, {
    name: "mailbox peak",
    details: "Again",
    map: "",
  });
  expect(refused.status).toBe(422);
  expect(refused.body).toContain(
    "<strong>mailbox peak</strong> is already on the list. Vote for it instead.",
  );
  expect(refused.body).toContain('value="mailbox peak"');
  expect(refused.body).toContain(">Again</textarea>");
  expect(textOf(refused.body)).toContain("Your location was not added.");
});

it("suggests a past location again from the web, and refuses a resting one in both places with the same words", async () => {
  const g = guild(22);
  const [ana, ben] = g.members as [Member, Member];
  const panel = await play.setUpPanel(g);
  const first = await play.startLocationVote(
    g,
    panel,
    "Alpine Lake\nBear Creek",
  );
  await play.finishRound(
    g,
    panel,
    first,
    "Alpine Lake",
    "2030-06-08\n2030-06-15",
    "Sat, 8 Jun 2030 · 11:00",
  );
  const second = await play.startLocationVote(g, panel, "Dune Ridge");
  const client = await signIn(g, ana);

  const page = await client.get(`/g/${g.guildId}`);
  expect(textOf(page.body)).toContain("Suggest one again");
  expect(page.body).toContain(
    "Resting: <strong>Alpine Lake</strong> (2 more hikes)",
  );
  const bear = /<option value="(\d+)">Bear Creek<\/option>/.exec(
    page.body,
  )?.[1];
  expect(bear).toBeDefined();
  expect(page.body).not.toMatch(/<option value="\d+">Alpine Lake<\/option>/);

  const options = actionOf(page, "options");
  const again = await followed(
    client,
    await client.submitForm(page, options, { again: bear ?? "" }),
  );
  expect(textOf(again.body)).toContain("Added Bear Creek.");
  await eventually(() => {
    const text = messageText(play.shown(second));
    expect(text).toContain("**Bear Creek** · 0 votes");
    expect(text).toContain(`Proposed by <@${ana.actor.userId}>`);
  });

  const cooldown =
    "**Alpine Lake** was the hike on Sat, 8 Jun 2030 · 11:00. It can be suggested again after 2 more hikes.";
  const typed = await client.submitForm(again, options, {
    name: "Alpine Lake",
    details: "",
    map: "",
  });
  expect(typed.status).toBe(422);
  expect(typed.body).toContain(
    cooldown.replace("**Alpine Lake**", "<strong>Alpine Lake</strong>"),
  );

  // The same location typed in Discord gets the same sentence. With Bear
  // Creek on the vote and Alpine Lake resting, nothing can be suggested
  // again, so Propose a location opens the modal at once.
  const modal = await ben.click(
    second,
    idStarting(play.shown(second), "hb:location:propose:"),
  );
  expect(modal.type).toBe(InteractionResponseType.Modal);
  await ben.submitModal(modal, { [ID.name]: "Alpine Lake" });
  expectEphemeral(ben, cooldown);
});

it("proposes a date from the web within the allowed days, and the server refuses one outside them whatever the browser allowed", async () => {
  const g = guild(23);
  const [ana] = g.members as [Member];
  const panel = await play.setUpPanel(g);
  const where = await play.startLocationVote(g, panel, "Lake");
  await play.vote(ana, where, ["Lake"]);
  await play.closeVote(g.owner, panel, "location vote");
  const today = todayInLosAngeles();
  const when = await play.startDateVote(
    g,
    panel,
    [plusDays(today, 3), plusDays(today, 4)].join("\n"),
  );
  const client = await signIn(g, ana);

  const page = await client.get(`/g/${g.guildId}`);
  expect(page.body).toMatch(
    new RegExp(
      `name="date" type="date"[^>]*min="${today}" max="${plusDays(today, 31)}"`,
    ),
  );
  const options = actionOf(page, "options");
  const added = await followed(
    client,
    await client.submitForm(page, options, {
      date: plusDays(today, 5),
      time: "09:00",
    }),
  );
  const banner = /Added ([^.]+ · 09:00)\./.exec(textOf(added.body))?.[1];
  expect(banner).toBeDefined();
  await eventually(() => {
    expect(messageText(play.shown(when))).toContain(
      `**${banner ?? ""}** · 0 votes`,
    );
  });

  const far = await client.submitForm(added, options, {
    date: plusDays(today, 40),
    time: "",
  });
  expect(far.status).toBe(422);
  expect(textOf(far.body)).toContain(
    `is more than 31 days away. Propose a day from ${today} to ${plusDays(today, 31)}, or ask an admin to plan further ahead.`,
  );
  expect(far.body).toContain(`value="${plusDays(today, 40)}"`);
  expect(textOf(far.body)).toContain("Your date was not added.");
});

it("refuses a member removed from the server after loading the page, and a forged POST from another site", async () => {
  const g = guild(24);
  const [ana, ben] = g.members as [Member, Member];
  const panel = await play.setUpPanel(g);
  const poll = await play.startLocationVote(g, panel, "Ridge\nLake");
  const client = await signIn(g, ana);
  const page = await client.get(`/g/${g.guildId}`);
  const { ids } = voteOptions(page);
  const votes = actionOf(page, "votes");

  const forged = await client.request(votes, {
    form: { option: ids.Lake ?? "" },
    headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
  });
  expect(forged.status).toBe(403);

  e2e.discord.removeMember(g.guildId, ana.actor.userId);
  const refused = await client.submitForm(page, votes, {
    option: [ids.Lake ?? ""],
  });
  expect(refused.status).toBe(403);
  expect(textOf(refused.body)).toContain(
    "You are not a member of this server any more",
  );
  const proposed = await client.submitForm(page, actionOf(page, "options"), {
    name: "Canyon",
    details: "",
    map: "",
  });
  expect(proposed.status).toBe(403);

  // Nothing was stored: another member sees no vote and no Canyon.
  const other = await signIn(g, ben);
  const seen = await other.get(`/g/${g.guildId}`);
  expect(seen.status).toBe(200);
  expect(textOf(seen.body)).toContain("No one has voted yet.");
  expect(textOf(seen.body)).not.toContain("Canyon");
  expect(messageText(play.shown(poll))).not.toContain("Canyon");
});

it("refuses a vote on a poll that closed after the page loaded with the bot's sentence, and stores nothing", async () => {
  const g = guild(25);
  const [ana] = g.members as [Member];
  const panel = await play.setUpPanel(g);
  const poll = await play.startLocationVote(g, panel, "Ridge\nLake");
  const client = await signIn(g, ana);
  const page = await client.get(`/g/${g.guildId}`);
  const { ids } = voteOptions(page);

  await play.closeVote(g.owner, panel, "location vote");
  const refused = await client.submitForm(page, actionOf(page, "votes"), {
    option: [ids.Lake ?? ""],
  });
  expect(refused.status).toBe(422);
  const text = textOf(refused.body);
  expect(text).toContain("This vote has closed.");
  expect(text).toContain("won the location vote.");
  expect(messageText(play.shown(poll))).toContain("No one has voted yet.");
  const shown = textOf((await client.get(`/g/${g.guildId}`)).body);
  expect(shown).not.toContain("This vote has closed.");
  expect(shown).not.toContain("Save votes");
});
