/**
 * The web pages' one way to change a guild: an admin's round control,
 * posted from a server's page. `GuildHike.adminAction` calls
 * `runWebAction`, which checks with Discord, at the moment of the action,
 * that the user is still a member and an admin (the rule of "Admin
 * permission", the same as for the panel's buttons), then runs the control
 * with `runWebAdminAction` (`src/features/web-admin.ts`) as that user.
 */
import { discordApi, type DiscordApi } from "../discord/api";
import {
  runWebAdminAction,
  type WebAdminOutcome,
  type WebAdminRequest,
} from "../features/web-admin";
import { PollStore } from "../polls/store";
import { decideAdmin } from "./permissions";
import type { HandlerContext } from "./router";
import type { WebViewCache } from "./web-view";

/** A control posted by the signed-in user `userId` on guild `guildId`. */
export interface WebActionRequest extends WebAdminRequest {
  guildId: string;
  userId: string;
}

/**
 * The action's answer: not a member, Discord unavailable, not an admin
 * (`forbidden`: nothing was changed), or the control's outcome.
 */
export type WebActionResult =
  | { kind: "not_member" }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | WebAdminOutcome;

/**
 * Asks Discord for the user's membership and roles afresh (refreshing
 * `cache`), decides with `decideAdmin` whether they are an admin, and only
 * then runs the control with the user as its actor. `api`, `now` and
 * `waitMs` are for tests.
 */
export async function runWebAction(
  context: HandlerContext,
  cache: WebViewCache,
  request: WebActionRequest,
  options: { api?: DiscordApi; now?: number; waitMs?: number } = {},
): Promise<WebActionResult> {
  const { guildId, userId } = request;
  const store = new PollStore(context.storage);
  const now = options.now ?? store.now();
  const api = options.api ?? discordApi(context.env);
  const roleIds = await cache.member(api, guildId, userId, now, { ask: true });
  if (roleIds === "error") return { kind: "unavailable" };
  if (roleIds === null) return { kind: "not_member" };
  const decision = await decideAdmin(
    context.storage,
    api,
    { guildId, userId, roleIds },
    now,
  );
  if (!decision.ok) return { kind: "unavailable" };
  if (!decision.isAdmin) return { kind: "forbidden" };
  return runWebAdminAction(
    { ...context, guildId, store },
    userId,
    { action: request.action, target: request.target, text: request.text },
    options.waitMs,
  );
}
