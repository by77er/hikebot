/**
 * The data the Worker holds before a page is screenshotted, by the name a
 * page gives as `seed` in `pages.json`. Each seed starts from a fresh Worker
 * and sets its state up as members would, through the fake Discord API and
 * signed interactions (see "Play a hike round in an end-to-end scenario" in
 * `test/AGENTS.md`), with fixed names and with dates written as fixed values
 * years ahead, so every run renders the same page. Avatars and server icons
 * are hashes `discord-cdn.ts` answers with fixed pictures.
 */
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
type ServerSteps = (play: RoundPlayer, g: TestGuild) => Promise<void>;

/**
 * The server SERVER, id 220000000000000101, with its panel set up and then
 * `steps` taken, and MEMBER_ID in it, signing in with it listed: a member
 * without roles, with `as: "admin"` the server's owner, or with
 * `as: "stranger"` a member who has left by the time they open the page.
 */
function server(
  steps: ServerSteps = () => Promise.resolve(),
  as: "member" | "admin" | "stranger" = "member",
): Seed {
  return async (e2e) => {
    const play = new RoundPlayer(e2e);
    const g = play.guild(1, {
      ...SERVER,
      ...(as === "admin" && { ownerId: MEMBER_ID }),
    });
    e2e.discord.addMember(g.guildId, MEMBER_ID);
    await play.setUpPanel(g);
    await steps(play, g);
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
  "server-date-vote": server(dateVote),
  "server-date-vote-admin": server(dateVote, "admin"),
  /** The date vote open for its owner, and Discord refusing the forum. */
  "server-date-vote-forum-refused-admin": (e2e) =>
    server(async (play, g) => {
      await dateVote(play, g);
      e2e.discord.failChannel(g.channels.forum, "missing-permissions");
    }, "admin")(e2e),
  "server-hike-planned": server(hikePlanned),
  "server-hike-planned-admin": server(hikePlanned, "admin"),
  "server-hike-log": server(hikeLog),
  "server-not-member": server(locationVote(), "stranger"),
};
