import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ephemeralNotice } from "../../src/discord/responses";
import { ADMIN_PANEL_IDS } from "../../src/features/admin-panel";
import { registerFeatures } from "../../src/features";
import { ADMIN_ONLY_NO_ROLE_MESSAGE } from "../../src/guild/permissions";
import { Router, UNAVAILABLE_MESSAGE } from "../../src/guild/router";
import { commandInteraction, componentInteraction } from "../helpers";

const OWNER = "400000000000000001";
const STRANGER = "400000000000000003";

afterEach(() => {
  vi.restoreAllMocks();
});

function asMember<T extends object>(interaction: T, userId: string): T {
  return Object.assign(interaction, {
    member: { user: { id: userId }, roles: [] },
  });
}

describe("registerFeatures", () => {
  it("routes /hike and the admin panel's controls to their handlers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({ id: "1", owner_id: OWNER })),
    );
    const router = registerFeatures(new Router());
    const command = asMember(
      commandInteraction("hike", "features-registered"),
      STRANGER,
    );
    Object.assign(command.data, {
      options: [
        { type: ApplicationCommandOptionType.Subcommand, name: "admin" },
      ],
    });

    const results = await runInDurableObject(
      env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName("features-registered")),
      async (_instance, state) => {
        const context = { env, storage: state.storage };
        return [
          await router.dispatch(command, context),
          ...(await Promise.all(
            Object.values(ADMIN_PANEL_IDS).map((id) =>
              router.dispatch(
                asMember(
                  componentInteraction(id, "features-registered"),
                  STRANGER,
                ),
                context,
              ),
            ),
          )),
        ];
      },
    );

    // The admin check answers, so each reached its admin-only handler
    // rather than the router's unavailable notice.
    for (const result of results) {
      expect(result.response).toEqual(
        ephemeralNotice(ADMIN_ONLY_NO_ROLE_MESSAGE),
      );
    }
  });

  it("leaves other commands unrouted", async () => {
    const router = registerFeatures(new Router());
    expect(
      await router.dispatch(commandInteraction("trail"), {
        env,
      } as Parameters<Router["dispatch"]>[1]),
    ).toEqual({ response: ephemeralNotice(UNAVAILABLE_MESSAGE) });
  });
});
