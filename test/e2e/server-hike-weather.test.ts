/**
 * The server's page shows what the hike thread shows about a planned hike:
 * where it is, with its map links, and its hourly forecast; an admin sets
 * its map pin there; the weekly schedule's next step; the located options
 * of an open location vote. And the page loads nothing from another site.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { FakeMessage } from "./harness/fake-discord";
import { DEFAULT_WEATHER } from "./harness/fake-open-meteo";
import { eventually, Member, messageText } from "./harness/helpers";
import {
  RoundPlayer,
  expectEphemeral,
  idStarting,
  type TestGuild,
} from "./harness/rounds";
import { formFields, PageClient, withoutCairnScripts } from "./harness/web";
import { useE2E } from "./harness/worker";

const e2e = useE2E();
const play = new RoundPlayer(e2e);

/** Paradise, on Mount Rainier. */
const PARADISE = "46.78591, -121.73532";

/** The forecast arrives after the close flow and the job's first run. */
const FORECAST_TIMEOUT = { timeout: 15_000 };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * The file's guilds, by number. The Worker remembers which guilds the bot
 * is in for a minute after a sign-in reads them, so every guild is added
 * before the first sign-in.
 */
const guilds = new Map<number, TestGuild>();

beforeAll(() => {
  for (const n of [41, 42, 43, 44]) {
    guilds.set(n, play.guild(n, { name: "Ridge Walkers" }));
  }
});

function guild(n: number): TestGuild {
  const g = guilds.get(n);
  if (!g) throw new Error(`guild ${String(n)} was not added`);
  return g;
}

/** The day `n` days after today in Los Angeles, the default zone. */
function daysAhead(n: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(Date.now());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** How the poll shows `day` at `time`: `Sat, 5 Dec 2026 · 13:00`. */
function shownAs(day: string, time: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()] ?? ""}, ${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ""} ${String(date.getUTCFullYear())} · ${time}`;
}

/** The starter message of the guild's only hike thread. */
function threadMessage(g: TestGuild): FakeMessage {
  const [thread] = e2e.discord.threads(g.channels.forum);
  const [first] = e2e.discord.channelMessages(thread?.id ?? "");
  if (!thread || !first) throw new Error("the hike thread was not created");
  return first;
}

function eventDescription(g: TestGuild): string {
  return e2e.discord.scheduledEvents(g.guildId)[0]?.description ?? "";
}

/**
 * Plays a hike at `location`, proposed with `map` as its map pin (none
 * when empty), three days from now at 13:00, through both votes.
 */
async function planHike(
  g: TestGuild,
  location: string,
  map: string,
): Promise<FakeMessage> {
  const [ana, ben] = g.members as [Member, Member];
  const panel = await play.setUpPanel(g);
  const poll = await play.startLocationVote(g, panel, "Snow Lake");
  const form = await ana.click(
    poll,
    idStarting(play.shown(poll), "hb:location:propose:"),
  );
  await ana.submitModal(
    form,
    { "hb:location:name": location, "hb:location:map": map },
    poll,
  );
  expectEphemeral(ana, `Added **${location}** to the location vote.`);
  await play.vote(ben, poll, [location]);
  await play.closeVote(g.owner, panel, "location vote");
  const day = daysAhead(3);
  const when = await play.startDateVote(
    g,
    panel,
    [`${day} 13:00`, `${daysAhead(4)} 13:00`].join("\n"),
  );
  await play.vote(ben, when, [shownAs(day, "13:00")]);
  await play.closeVote(g.owner, panel, "date vote");
  return panel;
}

/** Signs `userId` in as a Discord user in the guild, and returns the client. */
async function signIn(userId: string, g: TestGuild): Promise<PageClient> {
  e2e.discord.addUser({
    id: userId,
    username: "ana",
    globalName: "Ana",
    guilds: [{ id: g.guildId, name: "Ridge Walkers" }],
  });
  const client = new PageClient(e2e.url);
  const back = await client.signIn({ id: userId });
  expect(back.status).toBe(303);
  return client;
}

/** The page's text without its tags, whitespace collapsed, entities read. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every address the page makes the browser load: each element's `src`,
 * `srcset` and `poster`, and the `href` of each `<link>` (stylesheets,
 * preloaded fonts, icons).
 */
function loadedUrls(html: string, base: URL): URL[] {
  const urls: string[] = [];
  for (const [tag] of html.matchAll(/<[a-z][^>]*>/gi)) {
    for (const [, , value = ""] of tag.matchAll(/\s(src|poster)="([^"]*)"/gi)) {
      urls.push(value);
    }
    for (const [, value = ""] of tag.matchAll(/\ssrcset="([^"]*)"/gi)) {
      urls.push(
        ...value.split(",").map((part) => part.trim().split(" ")[0] ?? ""),
      );
    }
    if (/^<link\b/i.test(tag)) {
      const href = /\shref="([^"]*)"/i.exec(tag)?.[1];
      if (href !== undefined) urls.push(href);
    }
  }
  return urls.map((url) => new URL(url.replace(/&amp;/g, "&"), base));
}

describe("the server's page about a planned hike", () => {
  it("shows where the hike is and its hourly forecast, as the hike thread does, in the server's units and time zone", async () => {
    const g = guild(41);
    e2e.weather.setWeather(DEFAULT_WEATHER);
    await planHike(g, "Paradise", PARADISE);
    // 10 °C, feeling 8 °C, 0.2 mm, wind 10 km/h with gusts of 20, in the
    // server's default imperial units.
    await eventually(() => {
      expect(messageText(threadMessage(g))).toMatch(
        /\n13:00 +50\/46 +20% +0\.01 +6\/12 +Overcast\n/,
      );
    }, FORECAST_TIMEOUT);
    const thread = messageText(threadMessage(g));

    const viewer = "400000000000009401";
    e2e.discord.addMember(g.guildId, viewer);
    const client = await signIn(viewer, g);
    const page = await client.get(`/g/${g.guildId}`);
    expect(page.status).toBe(200);
    const text = textOf(page.body);

    // Where: both links the thread has, and OpenStreetMap's credit.
    const osm =
      "https://www.openstreetmap.org/?mlat=46.78591&mlon=-121.73532#map=13/46.78591/-121.73532";
    const google =
      "https://www.google.com/maps/search/?api=1&query=46.78591,-121.73532";
    expect(thread).toContain(osm);
    expect(thread).toContain(google);
    expect(page.body).toContain(`href="${osm.replace(/&/g, "&amp;")}"`);
    expect(page.body).toContain(`href="${google.replace(/&/g, "&amp;")}"`);
    expect(text).toContain("46.78591, -121.73532");
    expect(text).toContain("© OpenStreetMap contributors");

    // The forecast: the thread's 13:00 row, its sun times and its credit.
    // The units are in the column heads; the cells are bare figures.
    for (const head of [
      "Temperature, °F",
      "Chance of rain or snow, %",
      "Rain or snow, in",
      "Wind, mph",
    ]) {
      expect(text).toContain(head);
    }
    expect(text).toContain("13:00 Overcast 50 feels 46 20 0.01 6 gusts 12");
    expect(text).toContain("times in America/Los_Angeles");
    const sun = /Sunrise (\d\d:\d\d) · Sunset (\d\d:\d\d)/.exec(thread);
    expect(sun).not.toBeNull();
    expect(text).toContain(
      `Sunrise ${sun?.[1] ?? ""} Sunset ${sun?.[2] ?? ""}`,
    );
    expect(text).toMatch(
      /Updated (just now|\d+ s ago|\d+ min ago) · Weather data by Open-Meteo\.com/,
    );
    expect(page.body).toContain('href="https://open-meteo.com/"');
    // Every hour the thread shows is a row of the page's table.
    const threadHours = [...thread.matchAll(/\n(\d\d:\d\d) +\S+\/\S+ /g)].map(
      (match) => match[1],
    );
    const pageHours = [
      ...page.body.matchAll(/<th scope="row"><time [^>]*>(\d\d:\d\d)</g),
    ].map((match) => match[1]);
    expect(pageHours).toEqual(threadHours);
    // A member gets no Set map pin.
    expect(page.body).not.toContain(`/g/${g.guildId}/admin/set-map-pin`);
  });

  it("lets an admin set the map pin from the page, which updates the thread and the event, and refuses a forged form and a member", async () => {
    const g = guild(42);
    e2e.weather.setWeather(DEFAULT_WEATHER);
    await planHike(g, "Somewhere Nice", "");
    const noPin =
      "No forecast: this hike has no map pin. An admin can set one from /hike admin.";
    await eventually(() => {
      expect(messageText(threadMessage(g))).toContain(noPin);
    });

    // The member sees the thread's words and no form.
    const member = "400000000000009402";
    e2e.discord.addMember(g.guildId, member);
    const memberClient = await signIn(member, g);
    const memberPage = await memberClient.get(`/g/${g.guildId}`);
    expect(textOf(memberPage.body)).toContain(noPin);
    expect(textOf(memberPage.body)).toMatch(
      /Where (This hike has no map pin|The map pin is being looked up)/,
    );
    expect(memberPage.body).not.toContain(
      `action="/g/${g.guildId}/admin/set-map-pin"`,
    );

    // The owner signs in and finds the form.
    const owner = await signIn(g.owner.actor.userId, g);
    const page = await owner.get(`/g/${g.guildId}`);
    expect(page.body).toContain(`action="/g/${g.guildId}/admin/set-map-pin"`);

    // A forged form, from another site, is refused and changes nothing.
    const forged = await owner.request(`/g/${g.guildId}/admin/set-map-pin`, {
      form: { target: "1", text: PARADISE },
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
    });
    expect(forged.status).toBe(403);
    // A member posting the form with their own token is refused too.
    const memberToken = formFields(memberPage.body, "/logout")?.csrf ?? "";
    expect(memberToken).not.toBe("");
    const refused = await memberClient.request(
      `/g/${g.guildId}/admin/set-map-pin`,
      {
        form: { csrf: memberToken, target: "1", text: PARADISE },
        headers: {
          Origin: memberPage.url.origin,
          "Sec-Fetch-Site": "same-origin",
        },
      },
    );
    expect(refused.status).toBe(403);
    expect(textOf(refused.body)).toContain("Only admins can do this");
    expect(messageText(threadMessage(g))).toContain(noPin);

    // Coordinates the panel cannot read come back with the error.
    const unreadable = await owner.submitForm(
      page,
      `/g/${g.guildId}/admin/set-map-pin`,
      {
        text: "somewhere near the lake",
      },
    );
    expect(unreadable.status).toBe(400);
    expect(textOf(unreadable.body)).toContain("No coordinates could be read");

    const set = await owner.submitForm(
      page,
      `/g/${g.guildId}/admin/set-map-pin`,
      {
        text: PARADISE,
      },
    );
    expect(set.status).toBe(303);
    expect(set.location?.pathname).toBe(`/g/${g.guildId}`);

    await eventually(() => {
      const thread = messageText(threadMessage(g));
      expect(thread).toContain("46.78591");
      expect(thread).toMatch(/\n13:00 +50\/46 /);
      expect(eventDescription(g)).toContain("Weather: 50°F");
      expect(eventDescription(g)).toContain("46.78591");
    }, FORECAST_TIMEOUT);
    const after = textOf((await owner.get(`/g/${g.guildId}`)).body);
    // The notice says what was set, in the panel's words.
    expect(after).toContain(
      "The map pin of Somewhere Nice is set to 46.78591, -121.73532.",
    );
    expect(after).toContain("46.78591, -121.73532");
    expect(after).toContain("13:00 Overcast 50 feels 46");
  });

  it("loads nothing from another site, with the content security policy unchanged", async () => {
    const g = guild(43);
    e2e.weather.setWeather(DEFAULT_WEATHER);
    await planHike(g, "Paradise", PARADISE);
    await eventually(() => {
      expect(messageText(threadMessage(g))).toMatch(/\n13:00 +50\/46 /);
    }, FORECAST_TIMEOUT);
    const owner = await signIn(g.owner.actor.userId, g);
    for (const path of [
      `/g/${g.guildId}`,
      `/g/${g.guildId}/admin/set-map-pin`,
    ]) {
      const page = await owner.get(path);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toBe(
        "default-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self' data: https://cdn.discordapp.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      );
      const loaded = loadedUrls(page.body, page.url);
      expect(loaded.length).toBeGreaterThan(0);
      for (const url of loaded) {
        // Only the Worker's own files, and avatars from Discord's CDN,
        // which the policy allows; the map links are plain links.
        expect(
          url.origin === page.url.origin ||
            url.origin === "https://cdn.discordapp.com",
          `${path} loads ${url.href}`,
        ).toBe(true);
      }
      // Only Cairn's own modules: the press and age scripts.
      expect(withoutCairnScripts(page.body)).not.toMatch(/<(script|iframe)\b/);
      expect(page.body).toContain("openstreetmap.org");
    }
  });
});

describe("the server's page", () => {
  it("says when the weekly schedule opens the next location vote, in the server's time zone", async () => {
    const g = guild(44);
    const panel = await play.setUpPanel(g);
    await play.turnScheduleOn(g, panel);
    const member = "400000000000009404";
    e2e.discord.addMember(g.guildId, member);
    const client = await signIn(member, g);
    const text = textOf((await client.get(`/g/${g.guildId}`)).body);
    expect(text).toMatch(
      /Schedule The next location vote opens Wed, \d{1,2} [A-Z][a-z]{2} \d{4} · 09:00\./,
    );
    expect(text).toContain(
      "The bot opens and closes the votes on Wednesdays at 09:00 (America/Los_Angeles)",
    );

    // An open location vote shows a located option's map link.
    const [ana] = g.members as [Member];
    const poll = await play.startLocationVote(g, panel, "Snow Lake");
    const form = await ana.click(
      poll,
      idStarting(play.shown(poll), "hb:location:propose:"),
    );
    await ana.submitModal(
      form,
      { "hb:location:name": "Paradise", "hb:location:map": PARADISE },
      poll,
    );
    expectEphemeral(ana, "Added **Paradise** to the location vote.");
    const vote = await client.get(`/g/${g.guildId}`);
    expect(textOf(vote.body)).toContain("Paradise 0 votes Map of Paradise");
    expect(vote.body).toContain(
      'href="https://www.openstreetmap.org/?mlat=46.78591&amp;mlon=-121.73532#map=13/46.78591/-121.73532"',
    );
    // In the vote's own card, as the bot writes times.
    expect(textOf(vote.body)).toMatch(
      /Open The location vote closes Wed, \d{1,2} [A-Z][a-z]{2} \d{4} · 09:00/,
    );
  });
});
