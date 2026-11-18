/**
 * The round's actions, one function each, for every caller: the admin
 * panel's handlers, the web pages and the bot acting on its own schedule.
 * Each takes a `RoundContext`, the acting user's id and its input, makes
 * its stored change before it returns, and returns an `ActionOutcome`: a
 * refusal with a code and the sentence the panel shows, or success with
 * what changed and `work`, the Discord calls that follow, which resolve to
 * the panel's notes. An interaction handler runs `work` in its follow-up
 * and redraws the panel with the notes (`answerPanel` in `poll-ui.ts`); any
 * other caller awaits it.
 *
 * None of these functions checks that the actor may act: the caller must
 * (interaction handlers through `adminOnly`). The bot acting by itself
 * passes the application's id (`DISCORD_APPLICATION_ID`) as the actor,
 * which messages name as hikebot.
 */
import { discordApi, eventUrl } from "../discord/api";
import { messageBody } from "../discord/components";
import { GuildConfig, setupComplete } from "../guild/config";
import type { HandlerContext } from "../guild/router";
import { schedule } from "../guild/schedule";
import { defaultDateCandidates, todayIn } from "../polls/dates";
import { isPollError } from "../polls/errors";
import { PollStore, type PollView, type RoundView } from "../polls/store";
import { listing, missingSettings } from "./admin-panel";
import {
  announcementContent,
  announcementStatus,
  claimAnnouncement,
} from "./announcement-state";
import { recordPendingClose } from "./close-flow-state";
import { DATE_POLL, parseCandidateDates } from "./date-vote";
import { postHikeDay } from "./hike-day";
import { claimHikeDay, hikeDayHours, hikeDayStatus } from "./hike-day-state";
import { START_PASSED_MESSAGE, createHikeEvent } from "./hike-event";
import { claimHikeEvent, hikeEventStatus } from "./hike-event-state";
import { createHikeThread } from "./hike-thread";
import { claimHikeThread, hikeThreadStatus } from "./hike-thread-state";
import {
  LOCATION_POLL,
  parseInitialLocations,
  restingRefusal,
} from "./location-vote";
import {
  CLOSE_FLOW_DELAY_MS,
  CLOSE_FLOW_JOB,
  errorText,
  postAnnouncement,
  queuePollEdit,
  renderPollMessage,
  runCloseFlow,
  type PollWording,
  type PollWordings,
} from "./poll-ui";
import {
  claimVoteMessage,
  clearVoteMessageAttempt,
  recordVoteMessageFailure,
} from "./vote-message-state";

/** What an action works with: the guild's object and the guild's id. */
export interface RoundContext extends HandlerContext {
  /** The guild the object serves. */
  guildId: string;
  /** The store to use; a new one on `storage` when left out. */
  store?: PollStore;
  /** The poll kinds' wordings; `pollWordings()` when left out. */
  wordings?: PollWordings;
}

/** An action that was refused: nothing was changed. */
export interface Refusal<Code extends string> {
  ok: false;
  code: Code;
  /** The sentence the panel shows. */
  message: string;
}

/** An action that was done: what changed, and the Discord work to follow. */
export type Done<Changed> = Changed & {
  ok: true;
  /** The Discord calls that follow; resolves to the panel's notes. */
  work: () => Promise<string[]>;
};

export type ActionOutcome<Code extends string, Changed> =
  Refusal<Code> | Done<Changed>;

/** The poll kinds every action and shared poll control serves, by kind. */
export function pollWordings(): PollWordings {
  return { location: LOCATION_POLL, date: DATE_POLL };
}

function refuse<Code extends string>(
  code: Code,
  message: string,
): Refusal<Code> {
  return { ok: false, code, message };
}

function storeOf(context: RoundContext): PollStore {
  return context.store ?? new PollStore(context.storage);
}

function wordingsOf(context: RoundContext): PollWordings {
  return context.wordings ?? pollWordings();
}

function setupMissing(storage: DurableObjectStorage): string {
  const settings = new GuildConfig(storage).get();
  return `Set the ${listing(missingSettings(settings))} under Settings before starting a vote.`;
}

const ROUND_ACTIVE = "A round is already active.";
const NOT_DECIDED = "The date vote starts once the location is decided.";
const NOT_OPEN = "That vote is no longer open.";
const ROUND_ENDED = "That round has already ended.";

// Starting the location vote.

export type StartLocationVoteCode =
  "invalid_labels" | "setup_incomplete" | "resting" | "round_active";

/**
 * Why a location vote cannot start now, or null if it can: setup is not
 * complete, or a round is active. The panel asks this before it opens the
 * start modal.
 */
export function locationVoteRefusal(
  context: HandlerContext,
): Refusal<"setup_incomplete" | "round_active"> | null {
  if (!setupComplete(new GuildConfig(context.storage).get())) {
    return refuse("setup_incomplete", setupMissing(context.storage));
  }
  if (new PollStore(context.storage).getActiveRound() !== null) {
    return refuse("round_active", ROUND_ACTIVE);
  }
  return null;
}

/**
 * Starts a round with its location vote, on `labels` (one location each,
 * read as the start modal reads its lines: may be none), recording the
 * actor as starter and as proposer of each. `work` posts the poll message
 * in the voting channel and records it; if Discord refuses, the round is
 * taken back, unless it was cancelled or its vote closed meanwhile, and a
 * message posted after that is edited to show it. Does not check that the
 * actor is an admin: the caller must.
 */
export function startLocationVote(
  context: RoundContext,
  actor: string,
  input: { labels: readonly string[] },
): ActionOutcome<StartLocationVoteCode, { round: RoundView; poll: PollView }> {
  const parsed = parseInitialLocations(input.labels.join("\n"));
  if (!parsed.ok) return refuse("invalid_labels", parsed.error);
  const settings = new GuildConfig(context.storage).get();
  const channelId = settings.voteChannelId;
  if (!setupComplete(settings) || channelId === null) {
    return refuse("setup_incomplete", setupMissing(context.storage));
  }
  const store = storeOf(context);
  const resting = restingRefusal(parsed.labels, store.restingLocations());
  if (resting !== null) return refuse("resting", resting);
  let round: RoundView;
  try {
    round = store.startRound(
      actor,
      parsed.labels.map((label) => ({ label, proposedBy: actor })),
    );
  } catch (error) {
    if (isPollError(error, "round_active")) {
      return refuse("round_active", ROUND_ACTIVE);
    }
    if (isPollError(error)) return refuse("invalid_labels", error.message);
    throw error;
  }
  const poll = round.locationPoll;
  if (poll === null) throw new Error("startRound returned no location poll");
  return {
    ok: true,
    round,
    poll,
    work: async () => {
      const sent = await claimAndSend(context, poll.id, channelId);
      if (sent.ok) return [sent.note];
      if ("skipped" in sent) return [sent.skipped];
      return [
        `Could not post the location vote in <#${channelId}>: ${errorText(sent.error)}. ${withdrawStarted(store, poll, actor)}`,
      ];
    },
  };
}

/**
 * After the location vote's message could not be posted: takes the round
 * back with `withdrawLocationRound` and returns the end of the panel note.
 * If the round was cancelled or the vote closed while the post was in
 * flight, nothing is taken back and the note says so.
 */
function withdrawStarted(
  store: PollStore,
  started: PollView,
  actor: string,
): string {
  try {
    store.withdrawLocationRound(started.id, actor);
    return "No round was started; check the bot's permissions in that channel and try again.";
  } catch (error) {
    if (!isPollError(error)) throw error;
  }
  if (store.getRound(started.roundId)?.status === "cancelled") {
    return "The round had already been cancelled, so there was nothing to take back.";
  }
  const poll = store.getPoll(started.id);
  const winner = poll?.options.find((o) => o.id === poll.winnerOptionId);
  const won = winner === undefined ? "" : ` and **${winner.label}** won`;
  return `The vote had already been closed${won}, so the round was kept.`;
}

// Posting the vote message.

/** What posting a poll's message came to. */
type Sent =
  | { ok: true; note: string }
  | { ok: false; error: unknown }
  | { ok: false; skipped: string };

/**
 * Claims the poll's message and posts it, for a start action's `work`. A
 * failed post leaves no claim behind: the start action takes the vote back.
 */
async function claimAndSend(
  context: RoundContext,
  pollId: number,
  channelId: string,
): Promise<Sent> {
  const store = storeOf(context);
  const poll = store.getPoll(pollId);
  const wording = poll && wordingsOf(context)[poll.kind];
  if (!poll || !wording) {
    return {
      ok: false,
      skipped: "The vote was withdrawn before its message was posted.",
    };
  }
  if (!claimVoteMessage(context.storage, poll, store.now())) {
    return {
      ok: false,
      skipped: `The ${wording.name}'s message is being posted.`,
    };
  }
  const sent = await sendPollMessage(context, poll, wording, channelId);
  if (!sent.ok) clearVoteMessageAttempt(context.storage, pollId);
  return sent;
}

/**
 * Posts the poll's message in `channelId` and records it, then, if the
 * poll was closed or its round cancelled while the post was in flight,
 * edits it to that state. The caller has claimed it with
 * `claimVoteMessage`.
 */
async function sendPollMessage(
  context: RoundContext,
  poll: PollView,
  wording: PollWording,
  channelId: string,
): Promise<Sent> {
  const store = storeOf(context);
  let messageId: string;
  try {
    const message = await discordApi(context.env).createMessage(
      channelId,
      messageBody(
        renderPollMessage(
          poll,
          wording,
          store.getRound(poll.roundId),
          context.env.DISCORD_APPLICATION_ID,
        ),
      ),
    );
    messageId = message.id;
  } catch (error) {
    return { ok: false, error };
  }
  store.setPollMessage(poll.id, channelId, messageId);
  clearVoteMessageAttempt(context.storage, poll.id);
  return {
    ok: true,
    note: await retireIfOver(context, poll.id, wording, channelId, messageId),
  };
}

/**
 * After the poll's message was posted and recorded: if the round was
 * cancelled or the vote closed while the post was in flight, edits the
 * message to its cancelled or closed state, without buttons. Returns the
 * panel note.
 */
async function retireIfOver(
  context: RoundContext,
  pollId: number,
  wording: PollWording,
  channelId: string,
  messageId: string,
): Promise<string> {
  const store = storeOf(context);
  const poll = store.getPoll(pollId);
  if (!poll || poll.status === "open") {
    return `The ${wording.name} is open in <#${channelId}>.`;
  }
  const [why, shows] =
    poll.winnerOptionId === null
      ? ["the round had been cancelled", "cancelled"]
      : ["the vote had been closed", "closed"];
  const posted = `The ${wording.name} was posted in <#${channelId}>, but ${why} meanwhile`;
  try {
    await queuePollEdit(context.storage, () =>
      discordApi(context.env).editMessage(
        channelId,
        messageId,
        messageBody(
          renderPollMessage(
            poll,
            wording,
            store.getRound(poll.roundId),
            context.env.DISCORD_APPLICATION_ID,
          ),
        ),
      ),
    );
    return `${posted}, so the message now shows it as ${shows}.`;
  } catch (error) {
    return `${posted}, and the message could not be marked as ${shows}: ${errorText(error)}.`;
  }
}

export type PostVoteMessageCode =
  "not_open" | "already_posted" | "posting" | "no_channel";

/**
 * Posts the message of an open poll that has none recorded, for example
 * because the start's `work` was lost in a restart of the object, in the
 * voting channel, and records it. The post is claimed before this returns,
 * so a second call while it runs, or after it was recorded, posts nothing.
 * A failure is kept for the panel, which offers the action again. Does not
 * check that the actor is an admin: the caller must.
 */
export function postVoteMessage(
  context: RoundContext,
  _actor: string,
  input: { pollId: number },
): ActionOutcome<PostVoteMessageCode, { poll: PollView }> {
  const store = storeOf(context);
  const poll = store.getPoll(input.pollId);
  const wording = poll && wordingsOf(context)[poll.kind];
  if (!poll || !wording || poll.status !== "open") {
    return refuse("not_open", NOT_OPEN);
  }
  if (poll.channelId !== null && poll.messageId !== null) {
    return refuse(
      "already_posted",
      `The ${wording.name}'s message is already posted in <#${poll.channelId}>.`,
    );
  }
  const channelId = new GuildConfig(context.storage).get().voteChannelId;
  if (channelId === null) {
    return refuse(
      "no_channel",
      "No voting channel is set. Pick one under Settings, then click Post vote message.",
    );
  }
  if (!claimVoteMessage(context.storage, poll, store.now())) {
    return refuse("posting", `The ${wording.name}'s message is being posted.`);
  }
  return {
    ok: true,
    poll,
    work: async () => {
      const sent = await sendPollMessage(context, poll, wording, channelId);
      if (sent.ok) return [sent.note];
      const reason =
        "error" in sent
          ? `Could not post the ${wording.name} in <#${channelId}>: ${errorText(sent.error)}. Check that the bot can post there, then click Post vote message.`
          : sent.skipped;
      recordVoteMessageFailure(context.storage, poll.id, reason);
      return [reason];
    },
  };
}

// Closing a vote.

export type CloseVoteCode = "not_open" | "no_options";

function noOptionsToClose(wording: PollWording): string {
  return `The ${wording.name} has no ${wording.nouns} yet, so it cannot be closed. Wait for a proposal, or cancel the round.`;
}

/**
 * The poll `pollId` and its wording if it can be closed now, or why not:
 * it is not open, or has no options. The panel asks this before it asks
 * the admin to confirm.
 */
export function closeVoteCheck(
  context: RoundContext,
  pollId: number,
): Refusal<CloseVoteCode> | { ok: true; poll: PollView; wording: PollWording } {
  const poll = storeOf(context).getPoll(pollId);
  const wording = poll && wordingsOf(context)[poll.kind];
  if (!poll || !wording || poll.status !== "open") {
    return refuse("not_open", NOT_OPEN);
  }
  if (poll.options.length === 0) {
    return refuse("no_options", noOptionsToClose(wording));
  }
  return { ok: true, poll, wording };
}

/**
 * Closes the open poll `pollId`: the poll core picks the winner (a tie at
 * random) and the actor is recorded as closer, and the close work still to
 * do is recorded in the same transaction, with the `poll:close-flow` job
 * scheduled as a backstop, before this returns. `work` runs the close flow
 * (`runCloseFlow`): the final edit of the poll message, the kind's close
 * steps and the announcement. Does not check that the actor is an admin:
 * the caller must.
 */
export async function closeVote(
  context: RoundContext,
  actor: string,
  input: { pollId: number },
): Promise<ActionOutcome<CloseVoteCode, { poll: PollView }>> {
  const { storage } = context;
  const { pollId } = input;
  const store = storeOf(context);
  const wordings = wordingsOf(context);
  const before = store.getPoll(pollId);
  const wording = before && wordings[before.kind];
  if (!before || !wording) return refuse("not_open", NOT_OPEN);
  let poll: PollView;
  try {
    poll = storage.transactionSync(() => {
      const closed = store.closePoll(pollId, actor);
      recordPendingClose(
        storage,
        pollId,
        context.guildId,
        new GuildConfig(storage).get().timezone,
        wording.closeSteps.map((step) => step.name),
      );
      return closed;
    });
  } catch (error) {
    if (isPollError(error, "no_options")) {
      return refuse("no_options", noOptionsToClose(wording));
    }
    if (isPollError(error)) return refuse("not_open", NOT_OPEN);
    throw error;
  }
  await schedule(storage, CLOSE_FLOW_JOB, store.now() + CLOSE_FLOW_DELAY_MS);
  return {
    ok: true,
    poll,
    work: async () => (await runCloseFlow(pollId, context, wordings)).notes,
  };
}

// Starting and withdrawing the date vote.

export type StartDateVoteCode =
  "invalid_dates" | "setup_incomplete" | "not_decided" | "refused";

/**
 * Why a date vote cannot start now, or null if it can: setup is not
 * complete, or the active round's location is not decided. The panel asks
 * this before it opens the start modal.
 */
export function dateVoteRefusal(
  context: HandlerContext,
): Refusal<"setup_incomplete" | "not_decided"> | null {
  if (!setupComplete(new GuildConfig(context.storage).get())) {
    return refuse("setup_incomplete", setupMissing(context.storage));
  }
  if (
    new PollStore(context.storage).getActiveRound()?.status !==
    "location_decided"
  ) {
    return refuse("not_decided", NOT_DECIDED);
  }
  return null;
}

/**
 * The dates a date vote starts on when none are given: the next two
 * weekends after today in the guild's time zone, as the start modal is
 * prefilled.
 */
export function defaultDates(context: RoundContext): string[] {
  const timeZone = new GuildConfig(context.storage).get().timezone;
  return defaultDateCandidates(todayIn(timeZone, storeOf(context).now()));
}

/**
 * Opens the date vote of the active round once its location is decided,
 * on `dates` (one each, read as the start modal reads its lines), or on
 * `defaultDates` when none are given, recording the actor as opener.
 * `work` posts the poll message in the voting channel and records it; if
 * Discord refuses, the date vote is withdrawn, so the round is back at
 * `location_decided`. Does not check that the actor is an admin: the caller
 * must.
 */
export function startDateVote(
  context: RoundContext,
  actor: string,
  input: { dates?: readonly string[] } = {},
): ActionOutcome<StartDateVoteCode, { round: RoundView; poll: PollView }> {
  const store = storeOf(context);
  const settings = new GuildConfig(context.storage).get();
  const parsed = parseCandidateDates(
    (input.dates ?? defaultDates(context)).join("\n"),
    store.now(),
    settings.timezone,
  );
  if (!parsed.ok) return refuse("invalid_dates", parsed.error);
  const channelId = settings.voteChannelId;
  if (!setupComplete(settings) || channelId === null) {
    return refuse("setup_incomplete", setupMissing(context.storage));
  }
  const round = store.getActiveRound();
  if (round?.status !== "location_decided") {
    return refuse("not_decided", NOT_DECIDED);
  }
  let poll: PollView;
  try {
    poll = store.startDatePoll(round.id, actor, parsed.dates);
  } catch (error) {
    if (isPollError(error)) return refuse("refused", error.message);
    throw error;
  }
  return {
    ok: true,
    round: store.getRound(round.id) ?? round,
    poll,
    work: async () => {
      const sent = await claimAndSend(context, poll.id, channelId);
      if (sent.ok) return [sent.note];
      if ("skipped" in sent) return [sent.skipped];
      // Withdrawn already, or the round cancelled meanwhile: nothing to take back.
      withdrawDateVote(context, actor, { pollId: poll.id });
      return [
        `Could not post the date vote in <#${channelId}>: ${errorText(sent.error)}. The date vote was not started; check the bot's permissions in that channel and try again.`,
      ];
    },
  };
}

export type WithdrawDateVoteCode = "not_open";

/**
 * Takes back the open date vote `pollId` with its options and votes, so
 * the round is back at `location_decided` and the date vote can start
 * again. `work` marks its message, if one was posted, as cancelled,
 * without buttons. Does not check that the actor is an admin: the caller
 * must.
 */
export function withdrawDateVote(
  context: RoundContext,
  _actor: string,
  input: { pollId: number },
): ActionOutcome<WithdrawDateVoteCode, { round: RoundView }> {
  const store = storeOf(context);
  const poll = store.getPoll(input.pollId);
  let round: RoundView;
  try {
    round = store.withdrawDatePoll(input.pollId);
  } catch (error) {
    if (isPollError(error)) {
      return refuse("not_open", "There is no open date vote to withdraw.");
    }
    throw error;
  }
  clearVoteMessageAttempt(context.storage, input.pollId);
  return {
    ok: true,
    round,
    work: async () => {
      const notes = ["The date vote is withdrawn."];
      const wording = wordingsOf(context).date;
      if (!poll || !wording || !poll.channelId || !poll.messageId) {
        return notes;
      }
      const { channelId, messageId } = poll;
      const withdrawn: PollView = {
        ...poll,
        status: "closed",
        winnerOptionId: null,
      };
      try {
        await queuePollEdit(context.storage, () =>
          discordApi(context.env).editMessage(
            channelId,
            messageId,
            messageBody(
              renderPollMessage(
                withdrawn,
                wording,
                round,
                context.env.DISCORD_APPLICATION_ID,
              ),
            ),
          ),
        );
      } catch (error) {
        notes.push(
          `Could not mark the poll message in <#${channelId}> as cancelled: ${errorText(error)}.`,
        );
      }
      return notes;
    },
  };
}

// Cancelling the round.

export type CancelRoundCode = "ended";

/**
 * The round `roundId` if it can be cancelled now, or why not: it has
 * ended. The panel asks this before it asks the admin to confirm.
 */
export function cancelRoundCheck(
  context: RoundContext,
  roundId: number,
): Refusal<CancelRoundCode> | { ok: true; round: RoundView } {
  const round = storeOf(context).getRound(roundId);
  if (!round || round.status === "complete" || round.status === "cancelled") {
    return refuse("ended", ROUND_ENDED);
  }
  return { ok: true, round };
}

/**
 * Cancels the round `roundId` through the poll core, recording the actor:
 * any open vote closes without a result. `work` rewrites the message of
 * each poll that was open as cancelled, without buttons. Does not check
 * that the actor is an admin: the caller must.
 */
export function cancelRound(
  context: RoundContext,
  actor: string,
  input: { roundId: number },
): ActionOutcome<CancelRoundCode, { round: RoundView }> {
  const { roundId } = input;
  const store = storeOf(context);
  const before = store.getRound(roundId);
  if (!before) return refuse("ended", ROUND_ENDED);
  const open = [before.locationPoll, before.datePoll].filter(
    (poll): poll is PollView => poll?.status === "open",
  );
  let round: RoundView;
  try {
    round = store.cancelRound(roundId, actor);
  } catch (error) {
    if (isPollError(error)) return refuse("ended", ROUND_ENDED);
    throw error;
  }
  return {
    ok: true,
    round,
    work: async () => {
      const notes = ["The round is cancelled."];
      for (const { id } of open) {
        const poll = store.getPoll(id);
        const wording = poll && wordingsOf(context)[poll.kind];
        if (!poll || !wording || !poll.channelId || !poll.messageId) continue;
        const { channelId, messageId } = poll;
        try {
          await queuePollEdit(context.storage, () =>
            discordApi(context.env).editMessage(
              channelId,
              messageId,
              messageBody(
                renderPollMessage(
                  poll,
                  wording,
                  store.getRound(roundId),
                  context.env.DISCORD_APPLICATION_ID,
                ),
              ),
            ),
          );
        } catch (error) {
          notes.push(
            `Could not mark the poll message in <#${channelId}> as cancelled: ${errorText(error)}.`,
          );
        }
      }
      return notes;
    },
  };
}

// The panel's retries.

export type RetryHikeThreadCode = "not_last" | "created" | "creating";

/**
 * Creates the forum thread of the last round again, while it is complete
 * without one (its creation failed or was cut off). The creation is
 * claimed before this returns, so a second call while it runs creates
 * nothing. Does not check that the actor is an admin: the caller must.
 */
export function retryHikeThread(
  context: RoundContext,
  _actor: string,
  input: { roundId: number },
): ActionOutcome<RetryHikeThreadCode, { round: RoundView }> {
  const store = storeOf(context);
  const round = store.getLastRound();
  if (
    round === null ||
    round.id !== input.roundId ||
    round.status !== "complete"
  ) {
    return refuse(
      "not_last",
      "That hike is no longer the last one, so its thread is not created from here.",
    );
  }
  const status = hikeThreadStatus(context.storage, round, store.now());
  if (status.state === "created") {
    return refuse(
      "created",
      `The hike thread already exists: <#${status.threadId}>.`,
    );
  }
  if (!claimHikeThread(context.storage, round, store.now())) {
    return refuse("creating", "The hike thread is being created.");
  }
  return {
    ok: true,
    round,
    work: async () => {
      const created = await createHikeThread(
        round,
        context.guildId,
        new GuildConfig(context.storage).get().timezone,
        context,
      );
      return [
        created.ok
          ? `The hike thread is open: <#${created.threadId}>.`
          : created.reason,
      ];
    },
  };
}

export type RetryHikeEventCode = "not_last" | "created" | "past" | "creating";

/**
 * Creates the Discord scheduled event of the last round again, while it
 * is complete without one and its start is ahead. The creation is claimed
 * before this returns, so a second call while it runs creates nothing.
 * Does not check that the actor is an admin: the caller must.
 */
export function retryHikeEvent(
  context: RoundContext,
  _actor: string,
  input: { roundId: number },
): ActionOutcome<RetryHikeEventCode, { round: RoundView }> {
  const { guildId } = context;
  const store = storeOf(context);
  const round = store.getLastRound();
  if (
    round === null ||
    round.id !== input.roundId ||
    round.status !== "complete"
  ) {
    return refuse(
      "not_last",
      "That hike is no longer the last one, so its event is not created from here.",
    );
  }
  const timeZone = new GuildConfig(context.storage).get().timezone;
  const now = store.now();
  const status = hikeEventStatus(context.storage, round, now, timeZone);
  if (status.state === "created") {
    return refuse(
      "created",
      `The hike event already exists: ${eventUrl(guildId, status.eventId)}`,
    );
  }
  if (status.state === "past") return refuse("past", START_PASSED_MESSAGE);
  if (!claimHikeEvent(context.storage, round, now, timeZone)) {
    return refuse("creating", "The hike event is being created.");
  }
  return {
    ok: true,
    round,
    work: async () => {
      const created = await createHikeEvent(
        round.id,
        guildId,
        timeZone,
        context,
      );
      return [
        created.ok
          ? `The hike event is created: ${eventUrl(guildId, created.eventId)}`
          : created.reason,
      ];
    },
  };
}

export type RetryHikeDayCode =
  "not_last" | "posted" | "over" | "not_due" | "posting";

/**
 * Posts the hike-day announcement of the last round again, while it is
 * complete, its announcement failed or was cut off, and its hike is not
 * over. The post is claimed before this returns, so a second call while it
 * runs, or after it was posted, posts nothing. Does not check that the
 * actor is an admin: the caller must.
 */
export function retryHikeDay(
  context: RoundContext,
  _actor: string,
  input: { roundId: number },
): ActionOutcome<RetryHikeDayCode, { round: RoundView }> {
  const { guildId, storage } = context;
  const store = storeOf(context);
  const round = store.getLastRound();
  if (
    round === null ||
    round.id !== input.roundId ||
    round.status !== "complete"
  ) {
    return refuse(
      "not_last",
      "That hike is no longer the last one, so its hike-day announcement is not posted from here.",
    );
  }
  const now = store.now();
  const status = hikeDayStatus(storage, round, now);
  if (status.state === "posted") {
    return refuse(
      "posted",
      `The hike-day announcement is already posted in <#${status.channelId}>.`,
    );
  }
  const timeZone = new GuildConfig(storage).get().timezone;
  if (!(hikeDayHours(round, timeZone).end > now)) {
    return refuse(
      "over",
      "The hike is over, so its hike-day announcement is not posted.",
    );
  }
  if (status.state === "none" || status.state === "planned") {
    return refuse(
      "not_due",
      "The hike-day announcement is not due, so it was not posted.",
    );
  }
  if (!claimHikeDay(storage, round, guildId, now)) {
    return refuse("posting", "The hike-day announcement is being posted.");
  }
  return {
    ok: true,
    round,
    work: async () => {
      const posted = await postHikeDay(round.id, guildId, context);
      return [
        posted.ok
          ? `The hike-day announcement is posted in <#${posted.channelId}>.`
          : posted.reason,
      ];
    },
  };
}

export type RetryAnnouncementCode = "not_last" | "posted" | "posting";

/**
 * Posts the announcement of a closed poll of the last round again, after
 * it failed or was cut off, made as the close flow made it. The post is
 * claimed before this returns, so a second call while it runs, or after
 * it was posted, posts nothing. Does not check that the actor is an admin:
 * the caller must.
 */
export function retryAnnouncement(
  context: RoundContext,
  _actor: string,
  input: { pollId: number },
): ActionOutcome<RetryAnnouncementCode, { poll: PollView }> {
  const { storage } = context;
  const store = storeOf(context);
  const poll = store.getPoll(input.pollId);
  const wording = poll && wordingsOf(context)[poll.kind];
  const content = poll && announcementContent(storage, poll.id);
  if (
    !poll ||
    !wording ||
    !content ||
    poll.roundId !== store.getLastRound()?.id
  ) {
    return refuse(
      "not_last",
      "That vote is no longer in the last round, so its announcement is not posted from here.",
    );
  }
  const now = store.now();
  if (announcementStatus(storage, poll.id, now).state === "posted") {
    return refuse(
      "posted",
      `The ${wording.name}'s announcement is already posted.`,
    );
  }
  if (!claimAnnouncement(storage, poll.id, content, now)) {
    return refuse(
      "posting",
      `The ${wording.name}'s announcement is being posted.`,
    );
  }
  return {
    ok: true,
    poll,
    work: async () => {
      const posted = await postAnnouncement(
        { poll, round: store.getRound(poll.roundId) },
        wording,
        content,
        context,
      );
      return [
        posted.ok
          ? `The ${wording.name}'s result is announced in <#${posted.channelId}>.`
          : posted.reason,
      ];
    },
  };
}
