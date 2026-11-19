/**
 * The data the Worker holds before a page is screenshotted, by the name a
 * page gives as `seed` in `pages.json`. Each seed starts from a fresh Worker
 * and sets its state up as members would, through the fake Discord API and
 * signed interactions (see "Play a hike round in an end-to-end scenario" in
 * `test/AGENTS.md`), with fixed names and with dates written as fixed values
 * years ahead, so every run renders the same page. Avatars and server icons
 * are hashes `discord-cdn.ts` answers with fixed pictures.
 */
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
};
