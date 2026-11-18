import { vi } from "vitest";
import { DiscordApi } from "../../src/discord/api";

/** What Discord holds about one guild, for the web read's requests. */
export interface DiscordGuild {
  id: string;
  name?: string;
  icon?: string | null;
  ownerId: string;
  /** Role ids by member user id; anyone else is not a member. */
  members: Record<string, string[]>;
  /** Channel names by id. */
  channels?: Record<string, string>;
  /** Answer the member route with this status and nothing else. */
  memberStatus?: number;
  /** Answer the guild route with this status. */
  guildStatus?: number;
}

/** The URL a fetch call was made with. */
export function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * A fetch that answers Get Guild Member, Get Guild and Get Guild Channels
 * from `guild` (it may change between calls), and every other request with
 * `{ id: "1" }`. Builds a new `Response` per call, so it also works inside
 * the guild object.
 */
export function discordFetch(guild: DiscordGuild) {
  return vi.fn((input: RequestInfo | URL) => {
    const path = new URL(urlOf(input)).pathname.replace(/^\/api\/v10/, "");
    const member = /^\/guilds\/([^/]+)\/members\/([^/]+)$/.exec(path);
    if (member) {
      if (guild.memberStatus !== undefined) {
        return Promise.resolve(
          Response.json(
            { message: "Internal Server Error", code: 0 },
            { status: guild.memberStatus },
          ),
        );
      }
      const roles = guild.members[member[2] ?? ""];
      return Promise.resolve(
        roles === undefined
          ? Response.json(
              { message: "Unknown Member", code: 10007 },
              { status: 404 },
            )
          : Response.json({ user: { id: member[2] }, roles }),
      );
    }
    if (/^\/guilds\/[^/]+\/channels$/.test(path)) {
      return Promise.resolve(
        Response.json(
          Object.entries(guild.channels ?? {}).map(([id, name]) => ({
            id,
            name,
            type: 0,
          })),
        ),
      );
    }
    if (/^\/guilds\/[^/]+$/.test(path)) {
      return Promise.resolve(
        guild.guildStatus === undefined
          ? Response.json({
              id: guild.id,
              name: guild.name ?? `Guild ${guild.id}`,
              icon: guild.icon ?? null,
              owner_id: guild.ownerId,
            })
          : Response.json(
              { message: "Missing Access", code: 50001 },
              { status: guild.guildStatus },
            ),
      );
    }
    return Promise.resolve(Response.json({ id: "1" }));
  });
}

/** A Discord client over `discordFetch(guild)`, and its fetch spy. */
export function discordFor(guild: DiscordGuild) {
  const fetch = discordFetch(guild);
  const api = new DiscordApi({
    token: "test-token",
    fetch,
    sleep: () => Promise.resolve(),
  });
  return { api, fetch };
}

/** The paths below the API base that `fetch` was called with, in order. */
export function paths(fetch: { mock: { calls: unknown[][] } }): string[] {
  return fetch.mock.calls.map(([input]) =>
    new URL(urlOf(input as RequestInfo | URL)).pathname.replace(
      /^\/api\/v10/,
      "",
    ),
  );
}
