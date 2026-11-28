/**
 * One event has one time ("Content rules" in docs/design-system.md): the
 * hike's date and time on the server's web page read exactly as in the
 * hike thread's message in Discord, both drawn from the same stored round.
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { renderThreadMessage } from "../../src/features/hike-thread";
import { readWebView, WebViewCache } from "../../src/guild/web-view";
import { PollStore } from "../../src/polls/store";
import { ServerPage } from "../../src/web/pages/server/page";
import { discordFor } from "../guild/web-view-helpers";
import { completeRound } from "../polls/helpers";
import { render } from "./components/render";

const GUILD = "200000000000009301";
const OWNER = "700000000000009301";
const MEMBER = "700000000000009302";
/** A day before the hike, so it is the planned hike. */
const NOW = Date.UTC(2030, 5, 14, 9);

/** Every string in a Discord message's components, in order. */
function contents(components: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (key === "content" && typeof inner === "string") found.push(inner);
        else walk(inner);
      }
    }
  };
  walk(components);
  return found;
}

it("writes the hike's date and time on the web page exactly as the hike thread's message does", async () => {
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(GUILD));
  const { web, discord } = await runInDurableObject(
    stub,
    async (_instance, state) => {
      const store = new PollStore(state.storage);
      const roundId = completeRound(store, "Snow Lake", "2030-06-15 11:00");
      const round = store.getRound(roundId);
      if (!round) throw new Error("no round");
      const { api } = discordFor({
        id: GUILD,
        name: "Ridge Walkers",
        ownerId: OWNER,
        members: { [OWNER]: [], [MEMBER]: [] },
      });
      const result = await readWebView(
        { env, storage: state.storage },
        new WebViewCache(),
        { guildId: GUILD, userId: MEMBER },
        { api, now: NOW },
      );
      if (result.kind !== "view") throw new Error(result.kind);
      const timeZone = result.view.settings.timeZone;
      return {
        web: render(
          <ServerPage
            user={{ name: "Ana", avatar: null, csrf: "token" }}
            view={result.view}
            forms={{ csrf: "token", refusal: null }}
          />,
        ),
        discord: contents(renderThreadMessage(round, GUILD, timeZone)).join(
          "\n",
        ),
      };
    },
  );

  const when = /\*\*When:\*\* (.+?) \(<t:/.exec(discord)?.[1];
  expect(when).toBe("Sat, 15 Jun 2030 · 11:00");
  // The planned hike's card and its entry in the hike log.
  const times = [
    ...web.matchAll(/<time datetime="2030-06-15T11:00">([^<]*)<\/time>/g),
  ].map(([, text]) => text);
  expect(times).toHaveLength(2);
  for (const text of times) expect(text).toBe(when);
});
