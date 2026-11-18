/**
 * The data the Worker holds before a page is screenshotted, by the name a
 * page gives as `seed` in `pages.json`. Each seed starts from a fresh Worker
 * and sets its state up as members would, through the fake Discord API and
 * signed interactions (see "Play a hike round in an end-to-end scenario" in
 * `test/AGENTS.md`), with fixed names and with dates written as fixed values
 * years ahead, so every run renders the same page.
 */
import type { E2E } from "../e2e/harness/start";

export type Seed = (e2e: E2E) => Promise<void>;

/** The Discord user the sign-in pages' seeds add, by `user` in pages.json. */
export const MEMBER_ID = "400000000000000001";

/** Adds MEMBER_ID to Discord, in `guilds`, of which the bot is in `withBot`. */
function member(
  e2e: E2E,
  guilds: { id: string; name: string }[],
  withBot: (index: number) => boolean,
): Promise<void> {
  for (const [index, guild] of guilds.entries()) {
    if (withBot(index)) e2e.discord.addGuild({ ...guild, ownerId: MEMBER_ID });
  }
  e2e.discord.addUser({
    id: MEMBER_ID,
    username: "ana.hikes",
    globalName: "Ana Hiker",
    guilds,
  });
  return Promise.resolve();
}

const guildId = (n: number) => String(200000000000000100n + BigInt(n));

export const SEEDS: Record<string, Seed> = {
  /** A Worker that has never been used: no guilds, no hikes. */
  empty: () => Promise.resolve(),
  /** A member of three servers with hikebot and one without. */
  member: (e2e) =>
    member(
      e2e,
      [
        { id: guildId(1), name: "Ridge Walkers" },
        { id: guildId(2), name: "Book Club" },
        { id: guildId(3), name: "Lake Loop Trail Runners" },
        { id: guildId(4), name: "Sunday Summit Society" },
      ],
      (index) => index !== 1,
    ),
  /**
   * A member of 30 servers with hikebot, some named with Discord's longest
   * 100 characters; the session lists 25.
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
      })),
      () => true,
    ),
  /** A member of one server, which hikebot is not in. */
  "member-no-servers": (e2e) =>
    member(e2e, [{ id: guildId(1), name: "Book Club" }], () => false),
};
