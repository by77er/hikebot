/**
 * The data the Worker holds before a page is screenshotted, by the name a
 * page gives as `seed` in `pages.json`. Each seed starts from a fresh Worker
 * and sets its state up as members would, through the fake Discord API and
 * signed interactions (see "Play a hike round in an end-to-end scenario" in
 * `test/AGENTS.md`), with fixed names and with dates written as fixed values
 * years ahead, so every run renders the same page. Avatars and server icons
 * are hashes `discord-cdn.ts` answers with fixed pictures.
 */
import type { FakeMessage } from "../e2e/harness/fake-discord";
import { Member } from "../e2e/harness/helpers";
import { RoundPlayer, type TestGuild } from "../e2e/harness/rounds";
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

/** What a seed of a server's page does once the server is set up. */
type ServerSteps = (
  play: RoundPlayer,
  g: TestGuild,
  panel: FakeMessage,
  viewer: Member,
) => Promise<void>;

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
    const viewer = new Member(e2e.client, {
      guildId: g.guildId,
      channelId: g.channels.text,
      userId: MEMBER_ID,
    });
    await steps(play, g, await play.setUpPanel(g), viewer);
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

/** A date option's label as the bot writes it: `Sat, 15 Jun 2030 · 11:00`. */
function dateLabel(value: string): string {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday] ?? ""}, ${String(day)} ${MONTHS[month - 1] ?? ""} ${String(year)} · 11:00`;
}

const SNOW_LAKE_DETAILS =
  "6.7 miles round trip, 1,800 ft of gain. Meet at the Alpental lot at 8:30; bring a Northwest Forest Pass and microspikes.";

/**
 * An open location vote of four locations, one with details, that six
 * members have voted on; with `viewerVotes`, MEMBER_ID votes too.
 */
function locationVote(viewerVotes: string[] = []): ServerSteps {
  return async (play, g, panel, viewer) => {
    const poll = await play.startLocationVote(
      g,
      panel,
      ["Mailbox Peak", "Rattlesnake Ledge", "Lake Serene"].join("\n"),
    );
    const [a, b, c, d, e, f] = g.members as [
      Member,
      Member,
      Member,
      Member,
      Member,
      Member,
    ];
    await play.proposeLocation(a, poll, "Snow Lake", SNOW_LAKE_DETAILS);
    await play.vote(a, poll, ["Snow Lake", "Mailbox Peak"]);
    await play.vote(b, poll, ["Snow Lake"]);
    await play.vote(c, poll, ["Snow Lake", "Lake Serene"]);
    await play.vote(d, poll, ["Mailbox Peak"]);
    await play.vote(e, poll, ["Rattlesnake Ledge", "Snow Lake"]);
    await play.vote(f, poll, ["Mailbox Peak"]);
    if (viewerVotes.length > 0) await play.vote(viewer, poll, viewerVotes);
  };
}

/** The location vote above, closed: Snow Lake won. */
const locationDecided: ServerSteps = async (play, g, panel, viewer) => {
  await locationVote(["Snow Lake"])(play, g, panel, viewer);
  await play.closeVote(g.owner, panel, "location vote");
};

const DATES = ["2030-06-08", "2030-06-09", "2030-06-15"];

/** The date vote after it, on three dates, with MEMBER_ID's votes. */
const dateVote: ServerSteps = async (play, g, panel, viewer) => {
  await locationDecided(play, g, panel, viewer);
  const poll = await play.startDateVote(g, panel, DATES.join("\n"));
  const [a, b, c] = g.members as [Member, Member, Member];
  await play.vote(a, poll, [dateLabel("2030-06-08"), dateLabel("2030-06-15")]);
  await play.vote(b, poll, [dateLabel("2030-06-15")]);
  await play.vote(c, poll, [dateLabel("2030-06-09"), dateLabel("2030-06-15")]);
  await play.vote(viewer, poll, [dateLabel("2030-06-15")]);
};

/** The date vote above, closed: Snow Lake on Sat, 15 Jun 2030 is planned. */
const hikePlanned: ServerSteps = async (play, g, panel, viewer) => {
  await dateVote(play, g, panel, viewer);
  await play.closeVote(g.owner, panel, "date vote");
};

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

/**
 * Twelve hikes, one a month of 2030, then moved to 2019 (the same
 * calendar), so all twelve are past: the log has two pages.
 */
const hikeLog: ServerSteps = async (play, g, panel) => {
  for (const [index, location] of LOG_HIKES.entries()) {
    const month = String(index + 1).padStart(2, "0");
    const dates: [string, string] = [`2030-${month}-05`, `2030-${month}-12`];
    await play.playHike(g, panel, {
      location,
      dates,
      date: dateLabel(dates[1]),
    });
  }
  await play.moveHikeYears(g, "2030", "2019");
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
  "server-date-vote": server(dateVote),
  "server-hike-planned": server(hikePlanned),
  "server-hike-log": server(hikeLog),
  "server-not-member": server(locationVote(), "stranger"),
};
