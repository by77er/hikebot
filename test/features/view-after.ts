/**
 * The web view of a fresh guild after a test filled its storage, for the
 * tests of the view's sections: Discord answers for the guild, with Ana a
 * member without roles and OWNER its owner.
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { GuildConfig } from "../../src/guild/config";
import type { WebView } from "../../src/guild/web-view";
import { PollStore, type PlacePoint } from "../../src/polls/store";
import { discordFetch } from "../guild/web-view-helpers";

export const OWNER = "400000000000000001";
export const ANA = "400000000000000002";

let counter = 0;

/**
 * A fresh guild whose store `seed` fills, and the view `viewer` (Ana by
 * default) gets of it. `prefix` keeps each test file's guilds apart.
 */
export async function viewAfter(
  prefix: number,
  seed: (store: PollStore, config: GuildConfig) => void,
  viewer: string = ANA,
): Promise<{ guildId: string; view: WebView }> {
  counter++;
  const guildId = `2000000000${String(prefix)}${String(counter).padStart(4, "0")}`;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    discordFetch({
      id: guildId,
      ownerId: OWNER,
      members: { [OWNER]: [], [ANA]: [] },
    }),
  );
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
  await runInDurableObject(stub, (_instance, state) => {
    seed(new PollStore(state.storage), new GuildConfig(state.storage));
  });
  const result = await stub.webView({ guildId, userId: viewer });
  if (result.kind !== "view") throw new Error(`no view: ${result.kind}`);
  return { guildId, view: result.view };
}

/** Sets the pin of round `roundId`'s decided location (null clears it). */
export function pinRound(
  store: PollStore,
  roundId: number,
  point: PlacePoint | null,
): void {
  const optionId = store.getRound(roundId)?.locationOptionId;
  if (optionId == null) throw new Error("the round has no decided location");
  store.setOptionPin(optionId, point);
}
