import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { APIChatInputApplicationCommandInteraction } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import { DiscordApi } from "../../src/discord/api";
import {
  ephemeralNotice,
  GUILD_ONLY_MESSAGE,
} from "../../src/discord/responses";
import { snowflakeAt } from "../../src/discord/snowflake";
import { GuildConfig } from "../../src/guild/config";
import {
  ADMIN_ONLY_MESSAGE,
  ADMIN_ONLY_NO_ROLE_MESSAGE,
  adminOnly,
  checkAdmin,
  OWNER_CACHE_MS,
} from "../../src/guild/permissions";
import type { HandlerContext } from "../../src/guild/router";
import { commandInteraction } from "../helpers";

const OWNER = "700000000000000001";
const NEW_OWNER = "700000000000000002";
const ROLE_MEMBER = "700000000000000003";
const STRANGER = "700000000000000004";
const ADMIN_ROLE = "800000000000000001";
const OTHER_ROLE = "800000000000000002";
const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);

/** `/hike admin` from `userId` with `roles`, sent at `time`. */
function from(
  guildId: string,
  userId: string,
  options: { roles?: string[]; time?: number } = {},
): APIChatInputApplicationCommandInteraction {
  return {
    ...commandInteraction("hike", guildId),
    id: snowflakeAt(options.time ?? T0),
    member: { user: { id: userId }, roles: options.roles ?? [] },
  } as unknown as APIChatInputApplicationCommandInteraction;
}

/** The URL a fetch call was made with. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** A Discord API whose getGuild answers with `owners` in turn. */
function guildApi(...owners: (string | Response | Error)[]) {
  const fetch = vi.fn((input: RequestInfo | URL) => {
    const next = owners.shift();
    if (next === undefined)
      throw new Error(`unexpected request ${urlOf(input)}`);
    if (next instanceof Error) return Promise.reject(next);
    if (next instanceof Response) return Promise.resolve(next);
    return Promise.resolve(Response.json({ id: "1", owner_id: next }));
  });
  const api = new DiscordApi({
    token: "test-token",
    fetch,
    sleep: () => Promise.resolve(),
  });
  return { api, fetch };
}

/** Runs `body` against the storage of the guild named `guildId`. */
function inGuild<T>(
  guildId: string,
  body: (context: HandlerContext, config: GuildConfig) => Promise<T>,
): Promise<T> {
  return runInDurableObject(
    env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId)),
    (_instance, state) =>
      body({ env, storage: state.storage }, new GuildConfig(state.storage)),
  );
}

describe("checkAdmin", () => {
  it("lets the owner in when no admin role is set, and caches the owner", async () => {
    await inGuild("perm-owner", async (context, config) => {
      const { api, fetch } = guildApi(OWNER);
      const check = await checkAdmin(from("perm-owner", OWNER), context, api);
      expect(check.allowed).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [input] = fetch.mock.calls[0] ?? [""];
      expect(urlOf(input)).toMatch(/\/guilds\/perm-owner$/);
      expect(config.get()).toMatchObject({
        ownerId: OWNER,
        ownerFetchedAt: T0,
      });
    });
  });

  it("trusts the cached owner for an hour without asking Discord", async () => {
    await inGuild("perm-cached", async (context, config) => {
      config.setOwner(OWNER, T0);
      const { api, fetch } = guildApi();
      const time = T0 + OWNER_CACHE_MS - 1;
      const owner = await checkAdmin(
        from("perm-cached", OWNER, { time }),
        context,
        api,
      );
      const stranger = await checkAdmin(
        from("perm-cached", STRANGER, { time }),
        context,
        api,
      );
      expect(owner.allowed).toBe(true);
      expect(stranger.allowed).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it("lets a member with the admin role in without asking Discord", async () => {
    await inGuild("perm-role", async (context, config) => {
      config.set("adminRoleId", ADMIN_ROLE);
      const { api, fetch } = guildApi();
      const check = await checkAdmin(
        from("perm-role", ROLE_MEMBER, { roles: [OTHER_ROLE, ADMIN_ROLE] }),
        context,
        api,
      );
      expect(check).toMatchObject({
        allowed: true,
        settings: { adminRoleId: ADMIN_ROLE },
      });
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it("refuses a member without the admin role, naming who may use the panel", async () => {
    await inGuild("perm-stranger", async (context, config) => {
      config.set("adminRoleId", ADMIN_ROLE);
      const { api } = guildApi(OWNER);
      const check = await checkAdmin(
        from("perm-stranger", STRANGER, { roles: [OTHER_ROLE] }),
        context,
        api,
      );
      expect(check).toEqual({
        allowed: false,
        response: ephemeralNotice(ADMIN_ONLY_MESSAGE),
      });
    });
  });

  it("refuses everyone but the owner before an admin role is set", async () => {
    await inGuild("perm-no-role", async (context) => {
      const { api } = guildApi(OWNER);
      const check = await checkAdmin(
        from("perm-no-role", STRANGER, { roles: [OTHER_ROLE] }),
        context,
        api,
      );
      expect(check).toEqual({
        allowed: false,
        response: ephemeralNotice(ADMIN_ONLY_NO_ROLE_MESSAGE),
      });
    });
  });

  it("lets a new owner in once the cached owner is an hour old", async () => {
    await inGuild("perm-new-owner", async (context, config) => {
      config.setOwner(OWNER, T0);
      const { api, fetch } = guildApi(NEW_OWNER);
      const time = T0 + OWNER_CACHE_MS;
      const check = await checkAdmin(
        from("perm-new-owner", NEW_OWNER, { time }),
        context,
        api,
      );
      expect(check.allowed).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(config.get()).toMatchObject({
        ownerId: NEW_OWNER,
        ownerFetchedAt: time,
      });
    });
  });

  it("refuses the former owner once the cached owner is an hour old", async () => {
    await inGuild("perm-former-owner", async (context, config) => {
      config.setOwner(OWNER, T0);
      const { api, fetch } = guildApi(NEW_OWNER);
      const time = T0 + OWNER_CACHE_MS;
      const check = await checkAdmin(
        from("perm-former-owner", OWNER, { time }),
        context,
        api,
      );
      expect(check).toEqual({
        allowed: false,
        response: ephemeralNotice(ADMIN_ONLY_NO_ROLE_MESSAGE),
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(config.get().ownerId).toBe(NEW_OWNER);
    });
  });

  it("refuses with Discord's reason when getGuild fails, keeping the cache", async () => {
    await inGuild("perm-guild-fails", async (context, config) => {
      config.setOwner(OWNER, T0);
      const { api } = guildApi(
        Response.json(
          { message: "Missing Access", code: 50001 },
          { status: 403 },
        ),
      );
      const check = await checkAdmin(
        from("perm-guild-fails", OWNER, { time: T0 + OWNER_CACHE_MS }),
        context,
        api,
      );
      expect(check).toEqual({
        allowed: false,
        response: ephemeralNotice(
          "Could not check who owns this server, so the admin panel stays closed. Discord answered: Missing Access (HTTP 403). Try again in a moment.",
        ),
      });
      expect(config.get()).toMatchObject({
        ownerId: OWNER,
        ownerFetchedAt: T0,
      });
    });
  });

  it("refuses with a clear reason when Discord cannot be reached", async () => {
    await inGuild("perm-guild-offline", async (context) => {
      const { api } = guildApi(new TypeError("fetch failed"));
      const check = await checkAdmin(
        from("perm-guild-offline", OWNER),
        context,
        api,
      );
      expect(check).toEqual({
        allowed: false,
        response: ephemeralNotice(
          "Could not check who owns this server, so the admin panel stays closed. Discord could not be reached. Try again in a moment.",
        ),
      });
    });
  });

  it("refuses an interaction from outside a server", async () => {
    await inGuild("perm-dm", async (context) => {
      const { api, fetch } = guildApi();
      const interaction = {
        ...commandInteraction("hike", null),
        user: { id: OWNER },
      } as unknown as APIChatInputApplicationCommandInteraction;
      const check = await checkAdmin(interaction, context, api);
      expect(check).toEqual({
        allowed: false,
        response: ephemeralNotice(GUILD_ONLY_MESSAGE),
      });
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});

describe("adminOnly", () => {
  it("runs the handler for an admin, with the settings", async () => {
    await inGuild("perm-wrap-admin", async (context, config) => {
      config.set("adminRoleId", ADMIN_ROLE);
      const handler = vi.fn(() => ({ response: ephemeralNotice("ok") }));
      const result = await adminOnly(handler)(
        from("perm-wrap-admin", ROLE_MEMBER, { roles: [ADMIN_ROLE] }),
        context,
      );
      expect(result).toEqual({ response: ephemeralNotice("ok") });
      expect(handler).toHaveBeenCalledWith(
        expect.anything(),
        context,
        expect.objectContaining({ adminRoleId: ADMIN_ROLE }),
      );
    });
  });

  it("answers with the refusal and does not run the handler for anyone else", async () => {
    await inGuild("perm-wrap-stranger", async (context, config) => {
      config.set("adminRoleId", ADMIN_ROLE);
      config.setOwner(OWNER, T0);
      const handler = vi.fn(() => ({ response: ephemeralNotice("ok") }));
      const result = await adminOnly(handler)(
        from("perm-wrap-stranger", STRANGER),
        context,
      );
      expect(result).toEqual({ response: ephemeralNotice(ADMIN_ONLY_MESSAGE) });
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
