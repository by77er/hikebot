/**
 * The guild object's own check before a web page's action changes
 * something only an admin may change: the session and the form were
 * checked by the Worker (`requireServer`, `checkPost`), and the page's read
 * said the user is an admin, but that answer may be a minute old, so the
 * object asks again, with the same caches and the same rule as the read
 * (`readWebView`), before it acts.
 */
import { discordApi, type DiscordApi } from "../discord/api";
import { PollStore } from "../polls/store";
import { decideAdmin } from "./permissions";
import type { HandlerContext } from "./router";
import type { WebViewCache } from "./web-view";

/** Why an action was not taken: not a member, not an admin, or Discord did not answer. */
export type WebAdminRefusal =
  { kind: "not_member" } | { kind: "not_admin" } | { kind: "unavailable" };

/**
 * Whether user `userId` of guild `guildId` is an admin now: `{ kind:
 * "admin" }`, or the refusal. `api` and `now` default to the guild's Discord
 * client and the store's clock.
 */
export async function checkWebAdmin(
  context: HandlerContext,
  cache: WebViewCache,
  request: { guildId: string; userId: string },
  options: { api?: DiscordApi; now?: number } = {},
): Promise<{ kind: "admin" } | WebAdminRefusal> {
  const { guildId, userId } = request;
  const now = options.now ?? new PollStore(context.storage).now();
  const api = options.api ?? discordApi(context.env);
  const roleIds = await cache.member(api, guildId, userId, now);
  if (roleIds === "error") return { kind: "unavailable" };
  if (roleIds === null) return { kind: "not_member" };
  const decision = await decideAdmin(
    context.storage,
    api,
    { guildId, userId, roleIds },
    now,
  );
  if (!decision.ok) {
    console.error(
      `admin check of guild ${guildId}: ${decision.error instanceof Error ? decision.error.message : String(decision.error)}`,
    );
    return { kind: "unavailable" };
  }
  return decision.isAdmin ? { kind: "admin" } : { kind: "not_admin" };
}
