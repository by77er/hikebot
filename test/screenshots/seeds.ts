/**
 * The data the Worker holds before a page is screenshotted, by the name a
 * page gives as `seed` in `pages.json`. Each seed starts from a fresh Worker
 * and sets its state up as members would, through the fake Discord API and
 * signed interactions (see "Play a hike round in an end-to-end scenario" in
 * `test/AGENTS.md`), with fixed names and with dates written as fixed values
 * years ahead, so every run renders the same page. Avatars and server icons
 * are hashes `discord-cdn.ts` answers with fixed pictures.
 */
import { ChannelType } from "discord-api-types/v10";
import {
  RoundPlayer,
  type SeededOption,
  type TestGuild,
} from "../e2e/harness/rounds";
import type { E2E } from "../e2e/harness/start";
import { MISSING_PICTURE, picture } from "./discord-cdn";

export type Seed = (e2e: E2E) => Promise<void>;

/** The Discord user the sign-in pages' seeds add, by `user` in pages.json. */
export const MEMBER_ID = "400000000000000001";

interface SeedGuild {
  id: string;
  name: string;
  /** The icon's hash: `picture(n)`, MISSING_PICTURE, or none. */
  icon?: string;
}

interface SeedUser {
  globalName: string;
  /** The avatar's hash: `picture(n)`, MISSING_PICTURE, or none. */
  avatar?: string;
}

const ANA: SeedUser = { globalName: "Ana Hiker", avatar: picture(1) };

/**
 * Adds MEMBER_ID to Discord as `user`, in `guilds`, of which the bot is in
 * `withBot`.
 */
function member(
  e2e: E2E,
  guilds: SeedGuild[],
  withBot: (index: number) => boolean,
  user: SeedUser = ANA,
): Promise<void> {
  for (const [index, guild] of guilds.entries()) {
    if (withBot(index)) e2e.discord.addGuild({ ...guild, ownerId: MEMBER_ID });
  }
  e2e.discord.addUser({
    id: MEMBER_ID,
    username: "ana.hikes",
    globalName: user.globalName,
    avatar: user.avatar ?? null,
    guilds: guilds.map((guild) => ({ ...guild, icon: guild.icon ?? null })),
  });
  return Promise.resolve();
}

const guildId = (n: number) => String(200000000000000100n + BigInt(n));

/** The server of the server's page's seeds, as `RoundPlayer.guild(1)` makes it. */
export const SERVER = { name: "Ridge Walkers", icon: picture(2) };

/** What a seed of a server's page stores once the server is set up. */
type ServerSteps = (play: RoundPlayer, g: TestGuild, e2e: E2E) => Promise<void>;

/**
 * The server SERVER, id 220000000000000101, with its panel set up and then
 * `steps` taken, and MEMBER_ID in it, signing in with it listed: a member
 * without roles, with `as: "admin"` the server's owner, or with
 * `as: "stranger"` a member who has left by the time they open the page.
 * With `setUp` false, the panel is never opened: no channel is set.
 */
function server(
  steps: ServerSteps = () => Promise.resolve(),
  as: "member" | "admin" | "stranger" = "member",
  setUp = true,
): Seed {
  return async (e2e) => {
    const play = new RoundPlayer(e2e);
    const g = play.guild(1, {
      ...SERVER,
      ...(as === "admin" && { ownerId: MEMBER_ID }),
    });
    e2e.discord.addMember(g.guildId, MEMBER_ID);
    if (setUp) await play.setUpPanel(g);
    await steps(play, g, e2e);
    e2e.discord.addUser({
      id: MEMBER_ID,
      username: "ana.hikes",
      globalName: ANA.globalName,
      avatar: ANA.avatar ?? null,
      guilds: [{ id: g.guildId, ...SERVER }],
    });
    if (as === "stranger") e2e.discord.removeMember(g.guildId, MEMBER_ID);
  };
}

/** The user ids of the guild's members at the indexes `picks`. */
function voters(g: TestGuild, ...picks: number[]): string[] {
  return picks.map((i) => g.members[i]?.actor.userId ?? "");
}

const SNOW_LAKE_DETAILS =
  "6.7 miles round trip, 1,800 ft of gain. Meet at the Alpental lot at 8:30; bring a Northwest Forest Pass and microspikes.";

/** A round started on Sunday 2 June 2030, 18:00 UTC. */
const STARTED = Date.UTC(2030, 5, 2, 18);

/**
 * The location vote of the seeds: four locations, one with details, that
 * six members voted on, and MEMBER_ID for `viewer`.
 */
function locations(g: TestGuild, viewer: string[] = []): SeededOption[] {
  const mine = (label: string) => (viewer.includes(label) ? [MEMBER_ID] : []);
  return [
    {
      label: "Snow Lake",
      details: SNOW_LAKE_DETAILS,
      voters: [...voters(g, 0, 1, 2, 4), ...mine("Snow Lake")],
    },
    {
      label: "Mailbox Peak",
      voters: [...voters(g, 0, 3, 5), ...mine("Mailbox Peak")],
    },
    {
      label: "Rattlesnake Ledge",
      voters: [...voters(g, 4), ...mine("Rattlesnake Ledge")],
    },
    { label: "Lake Serene", voters: [...voters(g, 2), ...mine("Lake Serene")] },
  ];
}

/** An open location vote; MEMBER_ID voted for `viewer`. */
function locationVote(viewer: string[] = []): ServerSteps {
  return (play, g) =>
    play.seedRound(g, {
      status: "location_voting",
      startedAt: STARTED,
      locations: locations(g, viewer),
    });
}

/** The location vote closed: Snow Lake won; no date vote yet. */
const locationDecided: ServerSteps = (play, g) =>
  play.seedRound(g, {
    status: "location_decided",
    startedAt: STARTED,
    locations: locations(g, ["Snow Lake"]),
    location: "Snow Lake",
  });

/** The date vote on three days, MEMBER_ID voting for the 15th. */
function dates(g: TestGuild): SeededOption[] {
  return [
    { label: "2030-06-08 11:00", voters: voters(g, 0) },
    { label: "2030-06-09 09:00", voters: voters(g, 2) },
    {
      label: "2030-06-15 11:00",
      voters: [...voters(g, 0, 1, 2), MEMBER_ID],
    },
  ];
}

/** The date vote open, for Snow Lake. */
const dateVote: ServerSteps = (play, g) =>
  play.seedRound(g, {
    status: "date_voting",
    startedAt: STARTED,
    locations: locations(g, ["Snow Lake"]),
    location: "Snow Lake",
    dates: dates(g),
  });

/**
 * The date vote open, with the weekly schedule on: members may propose the
 * round's days, fixed by the seeded vote, so the page's Propose a date does
 * not change with today's date.
 */
const scheduledDateVote: ServerSteps = async (play, g, e2e) => {
  await dateVote(play, g, e2e);
  await play.seedSchedule(g, STARTED - 86_400_000);
};

/**
 * Two hikes of 2019, Mount Si then Wallace Falls, from votes with other
 * locations, then the open location vote: Poo Poo Point, Heather Lake and
 * Twin Falls can be suggested again; Wallace Falls rests two more hikes
 * and Mount Si one.
 */
const suggestAgain: ServerSteps = async (play, g, e2e) => {
  const past = [
    ["Mount Si", "Poo Poo Point", "Heather Lake"],
    ["Wallace Falls", "Twin Falls"],
  ];
  for (const [index, labels] of past.entries()) {
    const month = String(index + 3).padStart(2, "0");
    await play.seedRound(g, {
      status: "complete",
      startedAt: Date.UTC(2019, index + 2, 1, 18),
      locations: labels.map((label) => ({ label, voters: voters(g, 0) })),
      location: labels[0] ?? "",
      dates: [{ label: `2019-${month}-16 10:00`, voters: voters(g, 0) }],
      date: `2019-${month}-16 10:00`,
    });
  }
  await locationVote()(play, g, e2e);
};

/** The round complete: Snow Lake on Sat, 15 Jun 2030 at 11:00 is planned. */
const hikePlanned: ServerSteps = (play, g) =>
  play.seedRound(g, {
    status: "complete",
    startedAt: STARTED,
    locations: locations(g, ["Snow Lake"]),
    location: "Snow Lake",
    dates: dates(g),
    date: "2030-06-15 11:00",
    threadId: "320000000000000101",
    eventId: "330000000000000101",
  });

/** The guild object's SQLite storage, for what `seedRound` does not store. */
function storage(e2e: E2E, g: TestGuild) {
  return e2e.harness
    .getWorker()
    .getDurableObjectStorage("GUILD_HIKE", { name: g.guildId });
}

/** Snow Lake's trailhead. */
const SNOW_LAKE = { lat: 47.44535, lon: -121.42316 };

/**
 * Pins the location `label` of the guild's newest location vote at
 * `point`, with `name` as the geocoder's place name (null: coordinates a
 * member gave).
 */
async function pinLocation(
  e2e: E2E,
  g: TestGuild,
  label: string,
  point: { lat: number; lon: number },
  name: string | null,
): Promise<void> {
  const sql = await storage(e2e, g);
  await sql.exec(
    `UPDATE poll_options SET place_lat = ?, place_lon = ?, place_name = ?,
       place_status = ?, place_attempts = 1
     WHERE label = ? AND poll_id =
       (SELECT max(id) FROM polls WHERE kind = 'location')`,
    point.lat,
    point.lon,
    name,
    name === null ? "given" : "found",
    label,
  );
}

const HOUR = 3_600_000;

/**
 * One hour of a seeded forecast, in the forecast's units: the WMO code,
 * temperature, feels-like, chance and amount of precipitation, wind and
 * gusts.
 */
type SeedHour = [number, number, number, number, number, number, number];

/**
 * Stores, with the newest round, the forecast the weather job would have
 * fetched for Snow Lake on Sat, 15 Jun 2030 (11:00 in Los Angeles): `hours`
 * from 08:00, in `units`, fetched at `fetched` (by default 14 minutes
 * before the screenshots' frozen clock, so it reads "Updated 14 min ago"),
 * the freezing level at `freezing` and the UV index at `uv`, and sets the
 * server's units.
 */
async function storeForecast(
  e2e: E2E,
  g: TestGuild,
  units: "imperial" | "metric",
  hours: SeedHour[],
  levels: { elevation: number; freezing: number; uv: (i: number) => number },
  fetched = Date.UTC(2030, 5, 1, 8, 46),
): Promise<void> {
  // 08:00 PDT is 15:00 UTC.
  const first = Date.UTC(2030, 5, 15, 15);
  const forecast = {
    point: SNOW_LAKE,
    units,
    elevation: levels.elevation,
    hours: hours.map(
      ([code, temperature, feelsLike, chance, amount, wind, gusts], i) => ({
        at: first + i * HOUR,
        code,
        temperature,
        feelsLike,
        precipitationChance: chance,
        precipitation: amount,
        wind,
        gusts,
        snowfall: 0,
        freezingLevel: levels.freezing,
        uvIndex: levels.uv(i),
      }),
    ),
    // 05:11 and 21:10 PDT.
    days: [
      {
        sunrise: Date.UTC(2030, 5, 15, 12, 11),
        sunset: Date.UTC(2030, 5, 16, 4, 10),
      },
    ],
  };
  const updated = fetched;
  const sql = await storage(e2e, g);
  await sql.exec(
    `UPDATE rounds SET forecast = ?, forecast_fetched_at = ?,
       forecast_updated_at = ? WHERE id = (SELECT max(id) FROM rounds)`,
    JSON.stringify(forecast),
    updated,
    updated,
  );
  await sql.exec("UPDATE guild_settings SET units = ?", units);
}

/** A fair June day at Snow Lake, in °F, inches and mph. */
const FAIR: SeedHour[] = [
  [0, 52, 50, 0, 0, 3, 6],
  [0, 55, 54, 0, 0, 3, 7],
  [1, 58, 57, 0, 0, 4, 8],
  [1, 61, 60, 0, 0, 5, 9],
  [2, 63, 62, 5, 0, 6, 11],
  [2, 65, 64, 5, 0, 7, 13],
  [3, 66, 65, 10, 0, 8, 14],
  [2, 66, 65, 10, 0, 8, 15],
  [2, 64, 63, 5, 0, 7, 13],
  [1, 61, 60, 0, 0, 5, 10],
  [0, 58, 57, 0, 0, 4, 8],
];

/** A wet, windy day, in °C, mm and km/h. */
const STORM: SeedHour[] = [
  [3, 9, 6, 60, 0, 22, 41],
  [61, 9, 5, 75, 0.6, 25, 50],
  [63, 9, 5, 85, 2.4, 29, 61],
  [63, 8, 4, 90, 3.1, 33, 70],
  [65, 8, 3, 100, 6.2, 41, 88],
  [82, 7, 2, 100, 11.8, 45, 97],
  [81, 7, 3, 95, 4.6, 38, 79],
  [80, 8, 4, 85, 1.7, 30, 62],
  [61, 8, 5, 80, 0.8, 26, 52],
  [3, 8, 5, 60, 0.1, 22, 44],
  [3, 7, 4, 50, 0, 19, 38],
];

/** The planned hike of `hikePlanned`, with Snow Lake pinned. */
const hikePinned: ServerSteps = async (play, g, e2e) => {
  await hikePlanned(play, g, e2e);
  await pinLocation(e2e, g, "Snow Lake", SNOW_LAKE, "Snow Lake, King County");
};

/** The planned hike, pinned, with a fair forecast and a high UV index. */
const hikeForecast: ServerSteps = async (play, g, e2e) => {
  await hikePinned(play, g, e2e);
  await storeForecast(e2e, g, "imperial", FAIR, {
    elevation: 4012,
    freezing: 12_500,
    uv: (i) => (i >= 4 && i <= 7 ? 7.2 : 4),
  });
};

/** The planned hike, pinned, with rain, wind and the freezing level near. */
const hikeStorm: ServerSteps = async (play, g, e2e) => {
  await hikePinned(play, g, e2e);
  await storeForecast(e2e, g, "metric", STORM, {
    elevation: 1223,
    freezing: 1450,
    uv: () => 1,
  });
};

/**
 * The fair forecast, last fetched on 1 Jan 2026: before the Worker's own
 * clock by more than the three hours after which fetching it again counts
 * as failing, so the page warns that it could not fetch a newer one.
 */
const hikeForecastStale: ServerSteps = async (play, g, e2e) => {
  await hikePinned(play, g, e2e);
  await storeForecast(
    e2e,
    g,
    "imperial",
    FAIR,
    { elevation: 4012, freezing: 12_500, uv: () => 4 },
    Date.UTC(2026, 0, 1, 12),
  );
};

/**
 * The fair forecast as it is 16 days ahead: Open-Meteo's hours end at
 * 12:00, before the hike's hours do.
 */
const hikeForecastPartial: ServerSteps = async (play, g, e2e) => {
  await hikePinned(play, g, e2e);
  await storeForecast(e2e, g, "imperial", FAIR.slice(0, 5), {
    elevation: 4012,
    freezing: 12_500,
    uv: () => 4,
  });
};

/**
 * An open location vote with located options: one the geocoder named, one
 * at coordinates a member gave, one at a long place name, one not found.
 */
const locationVoteLocated: ServerSteps = async (play, g, e2e) => {
  await locationVote()(play, g, e2e);
  await pinLocation(e2e, g, "Snow Lake", SNOW_LAKE, "Snow Lake, King County");
  await pinLocation(
    e2e,
    g,
    "Mailbox Peak",
    { lat: 47.4669, lon: -121.6746 },
    null,
  );
  await pinLocation(
    e2e,
    g,
    "Rattlesnake Ledge",
    { lat: 47.4344, lon: -121.7686 },
    "Rattlesnake Ledge Trailhead, Cedar Falls Road Southeast, North Bend, King County",
  );
};

/** No round and no hike, with the weekly schedule on, Wednesdays at 09:00. */
const scheduleOn: ServerSteps = async (_play, g, e2e) => {
  const sql = await storage(e2e, g);
  await sql.exec(
    "UPDATE guild_settings SET cadence_enabled = 1, cadence_on_since = ?",
    Date.UTC(2030, 0, 1),
  );
};
/**
 * The places of the map seeds, inside the committed sample map data
 * (`maps/sample/sample.json`): the sample point, where the stored picture
 * `trailhead-z12.png` is drawn, and named places round it.
 */
const SAMPLE_POINT = { lat: 47.4881, lon: -121.7232 };
const SAMPLE_PICTURE = "public/assets/maps/samples/trailhead-z12.png";

/** The round complete for Mount Si, pinned, with its stored map picture. */
const hikeOnTheMap: ServerSteps = (play, g) =>
  play.seedRound(g, {
    status: "complete",
    startedAt: STARTED,
    locations: [
      { label: "Mount Si", point: SAMPLE_POINT, voters: voters(g, 0, 1) },
    ],
    location: "Mount Si",
    dates: dates(g),
    date: "2030-06-15 11:00",
    threadId: "320000000000000101",
    eventId: "330000000000000101",
    mapPicture: SAMPLE_PICTURE,
  });

/**
 * The round complete for Snow Lake, pinned where the map data has nothing,
 * so no picture was drawn.
 */
const hikeOffTheMap: ServerSteps = (play, g) =>
  play.seedRound(g, {
    status: "complete",
    startedAt: STARTED,
    locations: [
      {
        label: "Snow Lake",
        details: SNOW_LAKE_DETAILS,
        point: { lat: 47.4555, lon: -121.4507 },
        voters: voters(g, 0, 1),
      },
    ],
    location: "Snow Lake",
    dates: dates(g),
    date: "2030-06-15 11:00",
    threadId: "320000000000000101",
    eventId: "330000000000000101",
  });

/** An open location vote on six places, five of them found on the map. */
const locationVoteOnTheMap: ServerSteps = (play, g) =>
  play.seedRound(g, {
    status: "location_voting",
    startedAt: STARTED,
    locations: [
      {
        label: "Mount Si",
        point: { lat: 47.5069, lon: -121.739 },
        voters: voters(g, 0, 1, 2, 4),
      },
      {
        label: "Little Si",
        point: { lat: 47.4987, lon: -121.756 },
        voters: voters(g, 0, 3, 5),
      },
      { label: "Lake Serene", voters: voters(g, 2) },
      {
        label: "Crater Lake Peak",
        point: { lat: 47.5184, lon: -121.7294 },
        voters: voters(g, 4),
      },
      {
        label: "Three Forks Park",
        point: { lat: 47.521, lon: -121.7749 },
        voters: [],
      },
      {
        label: "Tanner",
        point: { lat: 47.461, lon: -121.7378 },
        voters: [],
      },
    ],
  });

const LOG_HIKES = [
  "Mailbox Peak",
  "Rattlesnake Ledge",
  "Lake Serene",
  "Snow Lake",
  "Mount Si",
  "Poo Poo Point",
  "Heather Lake",
  "Wallace Falls",
  "Lake 22",
  "Annette Lake",
  "Tiger Mountain",
  "Twin Falls",
];

/** Twelve past hikes, one a month of 2019: two pages of the log. */
const hikeLog: ServerSteps = async (play, g) => {
  for (const [index, location] of LOG_HIKES.entries()) {
    const month = String(index + 1).padStart(2, "0");
    await play.seedRound(g, {
      status: "complete",
      startedAt: Date.UTC(2019, index, 1, 18),
      locations: [{ label: location, voters: voters(g, 0) }],
      location,
      dates: [{ label: `2019-${month}-12 10:00`, voters: voters(g, 0) }],
      date: `2019-${month}-12 10:00`,
      threadId: `3200000000000002${month}`,
      ...(index % 3 !== 0 && { eventId: `3300000000000002${month}` }),
    });
  }
};

/** The admin role of the settings seeds. */
const HIKE_LEADS = "520000000000000101";

/**
 * The server's roles, and its channels named and in categories, as the
 * settings page lists them: the guild's text, announcement and forum
 * channels in Hiking, a general channel in none, and a voice channel no
 * setting takes.
 */
const settingsDirectory: ServerSteps = (_play, g, e2e) => {
  const { discord } = e2e;
  discord.addRole(g.guildId, {
    id: HIKE_LEADS,
    name: "Hike leads",
    position: 3,
  });
  discord.addRole(g.guildId, {
    id: "520000000000000102",
    name: "Trail crew",
    position: 2,
  });
  discord.addRole(g.guildId, {
    id: "520000000000000103",
    name: "Members",
    position: 1,
  });
  const hiking = "320000000000000110";
  discord.addChannel({
    id: hiking,
    guildId: g.guildId,
    type: ChannelType.GuildCategory,
    name: "Hiking",
    position: 1,
  });
  discord.addChannel({
    id: "320000000000000111",
    guildId: g.guildId,
    name: "general",
    position: 0,
  });
  discord.addChannel({
    id: g.channels.text,
    guildId: g.guildId,
    name: "hike-votes",
    parentId: hiking,
    position: 2,
  });
  discord.addChannel({
    id: g.channels.news,
    guildId: g.guildId,
    type: ChannelType.GuildAnnouncement,
    name: "announcements",
    parentId: hiking,
    position: 3,
  });
  discord.addChannel({
    id: g.channels.forum,
    guildId: g.guildId,
    type: ChannelType.GuildForum,
    name: "hikes",
    parentId: hiking,
    position: 4,
  });
  discord.addChannel({
    id: "320000000000000112",
    guildId: g.guildId,
    type: ChannelType.GuildVoice,
    name: "Trailhead voice",
    position: 5,
  });
  return Promise.resolve();
};

/** Every setting set, besides the channels the panel's set-up set. */
const everySetting: ServerSteps = async (play, g, e2e) => {
  await settingsDirectory(play, g, e2e);
  await play.seedSettings(g, {
    adminRoleId: HIKE_LEADS,
    timezone: "America/Denver",
    homeArea: {
      text: "Seattle, Washington",
      name: "Seattle, King County, Washington",
      lat: 47.6038321,
      lon: -122.330062,
    },
    units: "metric",
    cadence: { enabled: true, weekday: 3, time: "09:00", dateVoteDays: 2 },
  });
};

export const SEEDS: Record<string, Seed> = {
  /** A Worker that has never been used: no guilds, no hikes. */
  empty: () => Promise.resolve(),
  /**
   * A member, with an avatar, of six servers with hikebot and one without:
   * some with icons, some without, one whose icon fails to load.
   */
  member: (e2e) =>
    member(
      e2e,
      [
        { id: guildId(1), name: "Ridge Walkers", icon: picture(2) },
        { id: guildId(2), name: "Book Club" },
        { id: guildId(3), name: "Lake Loop Trail Runners" },
        { id: guildId(4), name: "Sunday Summit Society", icon: picture(3) },
        { id: guildId(5), name: "North Cascades Day Hikers" },
        { id: guildId(6), name: "Moss & Mountains", icon: MISSING_PICTURE },
        { id: guildId(7), name: "Trailhead Coffee", icon: picture(4) },
      ],
      (index) => index !== 1,
    ),
  /**
   * A member of one server with hikebot, with the longest display name
   * Discord allows (32 characters) and an avatar that fails to load.
   */
  "member-one-server": (e2e) =>
    member(
      e2e,
      [{ id: guildId(1), name: "Ridge Walkers", icon: picture(2) }],
      () => true,
      {
        globalName: "Alexandria Montgomery-Whitfield",
        avatar: MISSING_PICTURE,
      },
    ),
  /**
   * A member of 30 servers with hikebot, some named with Discord's longest
   * 100 characters, some with icons; the session lists 25.
   */
  "member-many-servers": (e2e) =>
    member(
      e2e,
      Array.from({ length: 30 }, (_, i) => ({
        id: guildId(i + 1),
        name:
          i % 5 === 0
            ? `Hiking club ${String(i + 1).padStart(2, "0")} ${"of the long and winding mountain trails ".repeat(3)}`.slice(
                0,
                100,
              )
            : `Hiking club ${String(i + 1).padStart(2, "0")}`,
        ...(i % 3 === 0 && { icon: picture((i % 5) + 1) }),
      })),
      () => true,
    ),
  /** A member, without an avatar, of one server, which hikebot is not in. */
  "member-no-servers": (e2e) =>
    member(e2e, [{ id: guildId(1), name: "Book Club" }], () => false, {
      globalName: "Ana Hiker",
    }),
  /** The server's page seeds; `server` says what each holds. */
  "server-empty": server(),
  "server-empty-admin": server(() => Promise.resolve(), "admin"),
  "server-location-vote": server(locationVote()),
  "server-location-vote-voted": server(
    locationVote(["Snow Lake", "Lake Serene"]),
  ),
  "server-location-decided": server(locationDecided),
  "server-location-decided-admin": server(locationDecided, "admin"),
  "server-location-vote-admin": server(locationVote(), "admin"),
  "server-date-vote": server(scheduledDateVote),
  "server-date-vote-admin": server(scheduledDateVote, "admin"),
  /** The date vote open for its owner, and Discord refusing the forum. */
  "server-date-vote-forum-refused-admin": (e2e) =>
    server(async (play, g) => {
      await dateVote(play, g, e2e);
      e2e.discord.failChannel(g.channels.forum, "missing-permissions");
    }, "admin")(e2e),
  "server-suggest-again": server(suggestAgain),
  "server-hike-planned": server(hikePlanned),
  "server-hike-planned-admin": server(hikePlanned, "admin"),
  "server-hike-no-forecast": server(hikePinned),
  "server-hike-forecast": server(hikeForecast),
  "server-hike-forecast-rain": server(hikeStorm),
  "server-hike-forecast-stale": server(hikeForecastStale),
  "server-hike-forecast-partial": server(hikeForecastPartial),
  "server-map-pin": server(hikeForecast, "admin"),
  "server-location-vote-located": server(locationVoteLocated),
  "server-schedule": server(scheduleOn),
  "server-hike-map": server(hikeOnTheMap),
  "server-hike-no-map": server(hikeOffTheMap),
  "server-location-vote-map": server(locationVoteOnTheMap),
  "server-hike-log": server(hikeLog),
  "server-not-member": server(locationVote(), "stranger"),
  "server-settings": server(everySetting, "admin"),
  "server-settings-empty": server(settingsDirectory, "admin", false),
};
