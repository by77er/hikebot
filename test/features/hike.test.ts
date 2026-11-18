import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  ApplicationCommandOptionType,
  type APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ephemeralReply } from "../../src/discord/components";
import { ephemeralNotice } from "../../src/discord/responses";
import { hikeCommand } from "../../src/features/hike";
import { renderAdminPanel } from "../../src/features/admin-panel";
import { GuildConfig, type GuildSettings } from "../../src/guild/config";
import {
  UNAVAILABLE_MESSAGE,
  type HandlerResult,
} from "../../src/guild/router";
import { commandInteraction } from "../helpers";

const OWNER = "400000000000000001";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(Response.json({ id: "1", owner_id: OWNER })),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** `/hike` from the owner of `guildId`, with `options` as Discord sends them. */
function hike(
  guildId: string,
  options?: unknown[],
): APIChatInputApplicationCommandInteraction {
  const interaction = commandInteraction("hike", guildId);
  Object.assign(interaction, { member: { user: { id: OWNER }, roles: [] } });
  if (options !== undefined) Object.assign(interaction.data, { options });
  return interaction;
}

/** Runs `/hike` against the storage of the guild named `guildId`. */
function run(
  guildId: string,
  interaction: APIChatInputApplicationCommandInteraction,
): Promise<{ result: HandlerResult; settings: GuildSettings }> {
  return runInDurableObject(
    env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId)),
    async (_instance, state) => ({
      result: await hikeCommand(interaction, { env, storage: state.storage }),
      settings: new GuildConfig(state.storage).get(),
    }),
  );
}

describe("/hike", () => {
  it("hands admin to the admin panel", async () => {
    const { result, settings } = await run(
      "hike-admin",
      hike("hike-admin", [
        { type: ApplicationCommandOptionType.Subcommand, name: "admin" },
      ]),
    );
    expect(result.response).toEqual(
      ephemeralReply(renderAdminPanel({ settings, round: null })),
    );
  });

  it("answers an unknown subcommand with the unavailable notice", async () => {
    const { result } = await run(
      "hike-unknown",
      hike("hike-unknown", [
        { type: ApplicationCommandOptionType.Subcommand, name: "plan" },
      ]),
    );
    expect(result.response).toEqual(ephemeralNotice(UNAVAILABLE_MESSAGE));
  });

  it("answers a missing subcommand with the unavailable notice", async () => {
    const { result } = await run("hike-none", hike("hike-none"));
    expect(result.response).toEqual(ephemeralNotice(UNAVAILABLE_MESSAGE));
  });

  it("answers an option that is not a subcommand with the unavailable notice", async () => {
    const { result } = await run(
      "hike-option",
      hike("hike-option", [
        {
          type: ApplicationCommandOptionType.String,
          name: "admin",
          value: "x",
        },
      ]),
    );
    expect(result.response).toEqual(ephemeralNotice(UNAVAILABLE_MESSAGE));
  });
});
