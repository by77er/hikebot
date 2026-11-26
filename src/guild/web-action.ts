/**
 * The web pages' ways to change a guild, posted from a server's page: an
 * admin's round control, and a member's vote or proposal.
 *
 * Each asks Discord, at the moment of the action, whether the user is still
 * a member (`memberNow`, never trusting the page's earlier read or the
 * member cache) before anything is changed.
 *
 * - `runWebAction` (`GuildHike.adminAction`) then checks that the user is an
 *   admin (the rule of "Admin permission", the same as for the panel's
 *   buttons) and runs the control with `runWebAdminAction`
 *   (`src/features/web-admin.ts`) as that user.
 * - `webVote` and `webPropose` (`GuildHike.webVote`, `GuildHike.webPropose`)
 *   call the same feature function as the Vote and Propose controls'
 *   handlers, with the member's Discord user id as voter or proposer, so
 *   the rules, the refusals' sentences and the debounced refresh of the
 *   poll message are the bot's.
 *
 * Results are plain data, for the Durable Object RPC boundary.
 */
import { discordApi, type DiscordApi } from "../discord/api";
import { proposeDateOption } from "../features/date-vote";
import {
  UNREAD_MAP_NOTE,
  proposeLocation,
  suggestAgain,
} from "../features/location-vote";
import { castVotes, type MemberOutcome } from "../features/poll-ui";
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

/** For tests: Discord's client, the clock, and how long a control waits. */
interface ActionOptions {
  api?: DiscordApi;
  now?: number;
  waitMs?: number;
}

/**
 * The user's role ids as Discord says them now, asked past `cache` (whose
 * entry the answer replaces), with the clock, client and store used; or
 * the answer to an action of someone who is not a member, or about whom
 * Discord could not be asked.
 */
async function memberNow(
  context: HandlerContext,
  cache: WebViewCache,
  request: { guildId: string; userId: string },
  options: ActionOptions,
): Promise<
  | { roleIds: string[]; now: number; api: DiscordApi; store: PollStore }
  | { kind: "not_member" }
  | { kind: "unavailable" }
> {
  const store = new PollStore(context.storage);
  const now = options.now ?? store.now();
  const api = options.api ?? discordApi(context.env);
  const roleIds = await cache.member(
    api,
    request.guildId,
    request.userId,
    now,
    { ask: true },
  );
  if (roleIds === "error") return { kind: "unavailable" };
  if (roleIds === null) return { kind: "not_member" };
  return { roleIds, now, api, store };
}

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
  options: ActionOptions = {},
): Promise<WebActionResult> {
  const { guildId, userId } = request;
  const member = await memberNow(context, cache, request, options);
  if ("kind" in member) return member;
  const { roleIds, now, api, store } = member;
  const decision = await decideAdmin(
    context.storage,
    api,
    { guildId, userId, roleIds },
    now,
  );
  if (!decision.ok) {
    console.error(
      `admin action on guild ${guildId}: ${decision.error instanceof Error ? decision.error.message : String(decision.error)}`,
    );
    return { kind: "unavailable" };
  }
  if (!decision.isAdmin) return { kind: "forbidden" };
  return runWebAdminAction(
    { ...context, guildId, store },
    userId,
    { action: request.action, target: request.target, text: request.text },
    options.waitMs,
  );
}

/** Save votes: the member's votes in the poll become exactly `optionIds`. */
export interface WebVoteRequest {
  guildId: string;
  userId: string;
  pollId: number;
  /** The options ticked; none clears the member's votes. */
  optionIds: number[];
}

/** What a member proposes, as the web page's forms send it. */
export type WebProposal =
  /** A new location: the fields of the Propose a location modal. */
  | { kind: "location"; name: string; details: string; map: string }
  /** A past location again, by the option id the page listed. */
  | { kind: "again"; optionId: number }
  /** A date (`YYYY-MM-DD`) and an optional time (`HH:MM`, or ""). */
  | { kind: "date"; date: string; time: string };

export interface WebProposeRequest {
  guildId: string;
  userId: string;
  pollId: number;
  proposal: WebProposal;
}

/**
 * What a member's vote or proposal came to. Only `done` and `refused` say
 * anything about the guild: a user who is not a member, or one Discord
 * could not be asked about, changes nothing and learns nothing.
 */
export type WebMemberResult =
  | { kind: "not_member" }
  | { kind: "unavailable" }
  /** Stored; `banner` says what happened, `note` adds to it. */
  | { kind: "done"; banner: string; note: string | null }
  /** Nothing stored; `message` is the bot's sentence, in Discord markdown. */
  | { kind: "refused"; code: string; message: string };

/** The refusal of a date form sent without a date. */
export const NO_DATE_MESSAGE = "Pick a date.";

/** Saves the member's votes with `castVotes`, the Vote select's operation. */
export async function webVote(
  context: HandlerContext,
  cache: WebViewCache,
  request: WebVoteRequest,
  options: ActionOptions = {},
): Promise<WebMemberResult> {
  const member = await memberNow(context, cache, request, options);
  if ("kind" in member) return member;
  const outcome = await castVotes(
    context,
    request.userId,
    request.pollId,
    request.optionIds,
  );
  if (!outcome.ok) return refusal(outcome);
  return {
    kind: "done",
    banner:
      outcome.value.viewerVotes.length === 0
        ? "Your votes are cleared."
        : "Your votes are saved.",
    note: null,
  };
}

/**
 * Adds the member's proposal with the function behind the matching Discord
 * control: `proposeLocation` (the modal), `suggestAgain` (the select) or
 * `proposeDateOption` (the date modal).
 */
export async function webPropose(
  context: HandlerContext,
  cache: WebViewCache,
  request: WebProposeRequest,
  options: ActionOptions = {},
): Promise<WebMemberResult> {
  const member = await memberNow(context, cache, request, options);
  if ("kind" in member) return member;
  const { userId, pollId, proposal } = request;
  switch (proposal.kind) {
    case "location": {
      const outcome = await proposeLocation(context, userId, pollId, {
        name: proposal.name,
        details: proposal.details,
        map: proposal.map,
      });
      if (!outcome.ok) return refusal(outcome);
      return {
        kind: "done",
        banner: added(outcome.value.option.label),
        note: outcome.value.unreadMap ? UNREAD_MAP_NOTE : null,
      };
    }
    case "again": {
      const outcome = await suggestAgain(
        context,
        userId,
        pollId,
        proposal.optionId,
      );
      if (!outcome.ok) return refusal(outcome);
      return { kind: "done", banner: added(outcome.value.label), note: null };
    }
    case "date": {
      const date = proposal.date.trim();
      if (date === "") {
        return {
          kind: "refused",
          code: "invalid_date",
          message: NO_DATE_MESSAGE,
        };
      }
      const time = proposal.time.trim();
      const outcome = await proposeDateOption(
        context,
        userId,
        pollId,
        time === "" ? date : `${date} ${time}`,
      );
      if (!outcome.ok) return refusal(outcome);
      return { kind: "done", banner: added(outcome.value.label), note: null };
    }
  }
}

function added(label: string): string {
  return `Added ${label}.`;
}

function refusal(
  outcome: Extract<MemberOutcome<unknown>, { ok: false }>,
): WebMemberResult {
  return { kind: "refused", code: outcome.code, message: outcome.message };
}
