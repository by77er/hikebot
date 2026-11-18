/**
 * The parts of a poll every kind shares: the public poll message, the Vote
 * button and its ephemeral multi-select, the debounced refresh of the poll
 * message as a scheduled job (`src/guild/schedule.ts`), and the admin's close and
 * cancel flows. A poll kind (`location-vote.ts`, `date-vote.ts`) supplies
 * its wording, extra buttons and close steps as a `PollWording`. The close
 * flow's remaining work is kept in storage (`close-flow-state.ts`), so the
 * `poll:close-flow` job finishes it when the follow-up was lost.
 */
import {
  ButtonStyle,
  ComponentType,
  type APIButtonComponentWithCustomId,
  type APIComponentInContainer,
  type APIInteractionResponse,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
  type APIModalSubmitInteraction,
} from "discord-api-types/v10";
import { DiscordApiError, discordApi } from "../discord/api";
import {
  actionRow,
  button,
  container,
  customId,
  deferredReply,
  deferredUpdate,
  ephemeralReply,
  messageBody,
  parseCustomId,
  separator,
  stringSelect,
  textDisplay,
  update,
} from "../discord/components";
import { ephemeralNotice } from "../discord/responses";
import { GuildConfig } from "../guild/config";
import { adminOnly } from "../guild/permissions";
import { schedule } from "../guild/schedule";
import {
  UNAVAILABLE_MESSAGE,
  type ComponentHandler,
  type HandlerContext,
  type HandlerResult,
  type Router,
} from "../guild/router";
import { isPollError } from "../polls/errors";
import {
  MAX_DETAILS_LENGTH,
  PollStore,
  type OptionView,
  type PollKind,
  type PollView,
  type RoundView,
} from "../polls/store";
import { rankOptions } from "../polls/tally";
import {
  ADMIN_PANEL_IDS,
  adminPanelBody,
  adminPanelUpdate,
} from "./admin-panel";
import {
  announcementContent,
  announcementStatus,
  claimAnnouncement,
  recordAnnouncementFailure,
  recordAnnouncementPosted,
  type AnnouncementContent,
} from "./announcement-state";
import {
  ANNOUNCE_PART,
  FINALIZE_PART,
  dropPendingClose,
  finishPart,
  partState,
  pendingClose,
  pendingCloses,
  recordPendingClose,
  startPart,
} from "./close-flow-state";

/** What a poll kind says and adds; the shared code does the rest. */
export interface PollWording {
  kind: PollKind;
  /** The poll message's heading, from the poll's round when there is one. */
  title: (round: RoundView | null) => string;
  /** One line under the heading while the poll is open. */
  instructions: string;
  /** Shown in place of the options while there are none. */
  empty: string;
  /** The Vote button's answer while there are no options. */
  noOptions: string;
  /** What an option is, singular and plural: "location", "locations". */
  noun: string;
  nouns: string;
  /** How the panel and confirmations name the poll: "location vote". */
  name: string;
  /** Whether each option shows who proposed it. */
  showProposer: boolean;
  /**
   * How the poll message orders the options: by votes (most first, ties in
   * the order they were added) or by date (chronological, in the vote
   * select too, wherever a date was added).
   */
  order: "votes" | "date";
  /** Buttons after Vote while the poll is open. */
  extraButtons: (poll: PollView) => APIButtonComponentWithCustomId[];
  /** The announcement's heading: "Hike location decided". */
  announcement: string;
  /**
   * Lines the announcement opens with, under its heading; `timeZone` is the
   * guild's, for times.
   */
  announcementLines: (
    poll: PollView,
    round: RoundView | null,
    timeZone: string,
  ) => string[];
  /**
   * Steps the close flow runs after the poll message is final and before
   * the announcement, in order; what they return goes into the
   * announcement and the panel.
   */
  closeSteps: CloseStep[];
}

/** What a closed poll's steps work from. */
export interface ClosedPoll {
  poll: PollView;
  round: RoundView | null;
  guildId: string;
  /** The guild's time zone when the poll closed. */
  timeZone: string;
}

/**
 * One step of the close flow that runs before the announcement, such as
 * creating the hike's forum thread. A step that throws is named in the
 * panel with the error; the announcement is still posted. A step runs at
 * most once per close: one cut off half-way is not run again, so a step
 * that creates something on Discord claims it in storage and lets the
 * admin retry it from the panel.
 */
export interface CloseStep {
  /**
   * What the step does, for the panel when it fails: "create the hike
   * thread". It names the step in the stored close work, so it is unique
   * among the kind's steps.
   */
  name: string;
  run: (
    closed: ClosedPoll,
    context: HandlerContext,
  ) => Promise<CloseStepResult>;
}

export interface CloseStepResult {
  /** Lines for the announcement, such as a link to what the step made. */
  announce?: string[];
  /** A line for the panel, such as why the step did nothing. */
  note?: string;
}

/** The poll kinds the shared handlers serve, by kind. */
export type PollWordings = Partial<Record<PollKind, PollWording>>;

export const VOTE_CLOSED_MESSAGE = "This vote has closed.";

/** Discord's limits on one message. */
export const MAX_MESSAGE_COMPONENTS = 40;
export const MAX_MESSAGE_TEXT = 4000;

/** How long the refresh of a poll message waits for more changes. */
export const REFRESH_DELAY_MS = 2_000;

const REFRESH_KEY_PREFIX = "poll-refresh:";

/** The scheduled job that refreshes the marked poll messages. */
export const REFRESH_JOB = "poll:refresh";

/** The scheduled job that finishes close flows their follow-up did not. */
export const CLOSE_FLOW_JOB = "poll:close-flow";

/** How long after a close the job looks for close work left undone. */
export const CLOSE_FLOW_DELAY_MS = 30_000;

export const POLL_IDS = {
  vote: (pollId: number) => customId("poll", "vote", String(pollId)),
  choose: (pollId: number) => customId("poll", "choose", String(pollId)),
  close: (pollId: number) => customId("poll", "close", String(pollId)),
  closeConfirm: (pollId: number) =>
    customId("poll", "close-confirm", String(pollId)),
  cancel: (roundId: number) => customId("round", "cancel", String(roundId)),
  cancelConfirm: (roundId: number) =>
    customId("round", "cancel-confirm", String(roundId)),
} as const;

// The poll message.

/**
 * The public poll message: heading, instructions, the options by votes with
 * their details and proposer, the voter count and, while open, the buttons.
 * Closed, it marks the winner (and a tie broken at random) and has no
 * buttons; cancelled (closed without a winner) it says so. Details are
 * shortened so the message stays within Discord's 4000 characters with 25
 * options at the longest label and details.
 */
export function renderPollMessage(
  poll: PollView,
  wording: PollWording,
  round: RoundView | null = null,
): APIMessageTopLevelComponent[] {
  const open = poll.status === "open";
  const cancelled = !open && poll.winnerOptionId === null;
  const winner = poll.options.find((o) => o.id === poll.winnerOptionId);

  const head: string[] = [
    `## ${wording.title(round)}${open ? "" : cancelled ? " (cancelled)" : " (closed)"}`,
  ];
  if (open) head.push(wording.instructions);
  else if (cancelled) head.push("This vote was cancelled.");
  else if (winner !== undefined) {
    head.push(`🏆 **${winner.label}** won with ${votes(winner.votes)}.`);
    if (poll.tieBroken) head.push(tieNote(poll));
  }
  const foot = voters(poll.voterCount);

  const ranked =
    wording.order === "date"
      ? chronological(poll.options)
      : rankOptions(poll.options);
  const titles = ranked.map((option) => optionTitle(option, poll));
  const proposers = ranked.map((option) =>
    wording.showProposer ? `Proposed by <@${option.proposedBy}>` : "",
  );
  const fixed =
    head.join("\n").length +
    foot.length +
    (ranked.length === 0 ? wording.empty.length : 0) +
    ranked.reduce(
      (sum, _option, i) =>
        sum +
        (titles[i]?.length ?? 0) +
        (proposers[i]?.length ?? 0) +
        // the newlines between title, details and proposer
        2,
      0,
    );
  const details = shortenAll(
    ranked.map((option) => option.details ?? ""),
    MAX_MESSAGE_TEXT - fixed,
  );

  const body: APIComponentInContainer[] = [textDisplay(head.join("\n"))];
  body.push(separator());
  if (ranked.length === 0) body.push(textDisplay(wording.empty));
  ranked.forEach((_option, i) => {
    const lines = [titles[i] ?? "", details[i] ?? "", proposers[i] ?? ""];
    body.push(textDisplay(lines.filter((line) => line !== "").join("\n")));
  });
  body.push(separator());
  body.push(textDisplay(foot));
  if (open) {
    body.push(
      actionRow(
        button({ custom_id: POLL_IDS.vote(poll.id), label: "Vote" }),
        ...wording.extraButtons(poll),
      ),
    );
  }
  return [container(body)];
}

/** The options in the order the select lists them: by date for a date poll. */
function ordered(
  options: readonly OptionView[],
  wording: PollWording,
): OptionView[] {
  return wording.order === "date" ? chronological(options) : [...options];
}

/** Date options by date, earliest first; others in the order they were added. */
export function chronological(options: readonly OptionView[]): OptionView[] {
  return [...options].sort(
    (a, b) =>
      (a.dateValue ?? "").localeCompare(b.dateValue ?? "") || a.id - b.id,
  );
}

function optionTitle(option: OptionView, poll: PollView): string {
  const won = option.id === poll.winnerOptionId;
  return `${won ? "🏆 " : ""}**${option.label}** · ${votes(option.votes)}${won ? " · winner" : ""}`;
}

function tieNote(poll: PollView): string {
  const n = poll.tiedOptionIds.length;
  const top = poll.options.find((o) => o.id === poll.winnerOptionId)?.votes;
  return `${String(n)} options tied with ${votes(top ?? 0)} each; the winner was drawn at random.`;
}

/**
 * Shortens each text so that together they take at most `budget`
 * characters, giving every text the same cap (the largest that fits) and
 * marking a cut with "…".
 */
export function shortenAll(texts: readonly string[], budget: number): string[] {
  const lengths = texts.map((t) => t.length);
  const total = (cap: number) =>
    lengths.reduce((sum, length) => sum + Math.min(length, cap), 0);
  let low = 0;
  let high = MAX_DETAILS_LENGTH;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (total(mid) <= budget) low = mid;
    else high = mid - 1;
  }
  return texts.map((text) => shorten(text, low));
}

/** Cuts `text` to at most `cap` characters, ending a cut with "…". */
export function shorten(text: string, cap: number): string {
  if (text.length <= cap) return text;
  if (cap <= 1) return "";
  // Cut on a code point boundary so no half of a surrogate pair is left.
  let cut = text.slice(0, cap - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function votes(n: number): string {
  return n === 1 ? "1 vote" : `${String(n)} votes`;
}

function voters(n: number): string {
  if (n === 0) return "No one has voted yet.";
  return n === 1 ? "1 member has voted." : `${String(n)} members have voted.`;
}

// Voting.

/** The ephemeral multi-select a member votes with. */
export function renderVoteSelect(
  poll: PollView,
  wording: PollWording,
  notice?: string,
  round: RoundView | null = null,
): APIMessageTopLevelComponent[] {
  return [
    container([
      textDisplay(
        notice ??
          `**${wording.title(round)}**\nPick every ${wording.noun} you would go to, then click away. Pick none to clear your votes.`,
      ),
      actionRow(
        stringSelect({
          custom_id: POLL_IDS.choose(poll.id),
          placeholder: `Pick ${wording.nouns}`,
          min_values: 0,
          max_values: poll.options.length,
          options: ordered(poll.options, wording).map((option) => ({
            label: option.label,
            value: String(option.id),
            ...(option.details === null
              ? {}
              : { description: shorten(option.details, 100) }),
            default: poll.viewerVotes.includes(option.id),
          })),
        }),
      ),
    ]),
  ];
}

function numericArg(interaction: {
  data: { custom_id: string };
}): number | null {
  const arg = parseCustomId(interaction.data.custom_id)?.arg;
  const id = Number(arg);
  return arg !== undefined && Number.isSafeInteger(id) ? id : null;
}

function userIdOf(
  interaction: APIMessageComponentInteraction | APIModalSubmitInteraction,
): string {
  return interaction.member?.user.id ?? interaction.user?.id ?? "";
}

/** The option values the select `id` on the interaction's message lists. */
function listedOptionIds(
  interaction: APIMessageComponentInteraction,
  id: string,
): number[] | null {
  const queue: unknown[] = [...(interaction.message.components ?? [])];
  while (queue.length > 0) {
    const component = queue.shift() as {
      custom_id?: string;
      type?: number;
      options?: { value: string }[];
      components?: unknown[];
      component?: unknown;
      accessory?: unknown;
    };
    if (
      component.type === ComponentType.StringSelect &&
      component.custom_id === id
    ) {
      return (component.options ?? []).map((o) => Number(o.value));
    }
    queue.push(...(component.components ?? []));
    if (component.component !== undefined) queue.push(component.component);
    if (component.accessory !== undefined) queue.push(component.accessory);
  }
  return null;
}

// Refresh.

const editQueues = new WeakMap<DurableObjectStorage, Promise<void>>();

/**
 * Runs `edit` after every poll message edit queued before it in this
 * object, so an older render never lands after a newer one (a refresh
 * started before a close finishes before the close's final edit).
 */
export function queuePollEdit<T>(
  storage: DurableObjectStorage,
  edit: () => Promise<T>,
): Promise<T> {
  const previous = editQueues.get(storage) ?? Promise.resolve();
  const next = previous.then(edit, edit);
  editQueues.set(
    storage,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/**
 * Marks the poll's public message for a refresh and schedules the refresh
 * job `REFRESH_DELAY_MS` from now, unless it is already scheduled earlier,
 * so a burst of changes causes one edit.
 */
export async function scheduleRefresh(
  storage: DurableObjectStorage,
  pollId: number,
  now: number,
): Promise<void> {
  const due = now + REFRESH_DELAY_MS;
  await storage.put(`${REFRESH_KEY_PREFIX}${String(pollId)}`, due);
  await schedule(storage, REFRESH_JOB, due);
}

/**
 * The refresh job: edits the message of every poll marked for a refresh
 * that is still open. A failed edit is logged and dropped. Marks added while
 * it runs schedule the job again, so they get a run of their own.
 */
async function refreshPollMessages(
  context: HandlerContext,
  wordings: PollWordings,
): Promise<void> {
  const { storage } = context;
  const marked = await storage.list<number>({ prefix: REFRESH_KEY_PREFIX });
  await storage.delete([...marked.keys()]);
  const store = new PollStore(storage);
  for (const key of marked.keys()) {
    const pollId = Number(key.slice(REFRESH_KEY_PREFIX.length));
    await queuePollEdit(storage, async () => {
      const poll = store.getPoll(pollId);
      const wording = poll && wordings[poll.kind];
      if (
        !poll ||
        !wording ||
        poll.status !== "open" ||
        poll.channelId === null ||
        poll.messageId === null
      ) {
        return;
      }
      try {
        await discordApi(context.env).editMessage(
          poll.channelId,
          poll.messageId,
          messageBody(
            renderPollMessage(poll, wording, store.getRound(poll.roundId)),
          ),
        );
      } catch (error) {
        console.error(
          `refreshing the message of poll ${String(pollId)} failed: ${errorText(error)}`,
        );
      }
    });
  }
}

// Handlers.

/** The Vote button: the ephemeral select, preselected with the member's votes. */
function openVoteSelect(wordings: PollWordings): ComponentHandler {
  return (interaction, context) => {
    const pollId = numericArg(interaction);
    const store = new PollStore(context.storage);
    const poll =
      pollId === null ? null : store.getPoll(pollId, userIdOf(interaction));
    const wording = poll && wordings[poll.kind];
    if (!poll || !wording) {
      return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
    }
    if (poll.status !== "open") {
      return { response: ephemeralNotice(VOTE_CLOSED_MESSAGE) };
    }
    if (poll.options.length === 0) {
      return { response: ephemeralNotice(wording.noOptions) };
    }
    return {
      response: ephemeralReply(
        renderVoteSelect(
          poll,
          wording,
          undefined,
          store.getRound(poll.roundId),
        ),
      ),
    };
  };
}

/**
 * The vote select: replaces the member's votes among the options the select
 * lists with the ones picked, keeping votes for options added since it was
 * shown, and confirms in place.
 */
function saveVotes(wordings: PollWordings): ComponentHandler {
  return async (interaction, context) => {
    const pollId = numericArg(interaction);
    if (
      pollId === null ||
      interaction.data.component_type !== ComponentType.StringSelect
    ) {
      return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
    }
    const userId = userIdOf(interaction);
    const store = new PollStore(context.storage);
    const before = store.getPoll(pollId, userId);
    const wording = before && wordings[before.kind];
    if (!before || !wording) {
      return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
    }
    const picked = interaction.data.values.map(Number);
    const listed = new Set(
      listedOptionIds(interaction, interaction.data.custom_id) ??
        before.options.map((o) => o.id),
    );
    const kept = before.viewerVotes.filter((id) => !listed.has(id));
    let poll: PollView;
    try {
      poll = store.setVotes(pollId, userId, [...kept, ...picked]);
    } catch (error) {
      if (isPollError(error, "poll_closed")) {
        return { response: update([textDisplay(VOTE_CLOSED_MESSAGE)]) };
      }
      if (isPollError(error)) {
        return { response: update([textDisplay(error.message)]) };
      }
      throw error;
    }
    await scheduleRefresh(context.storage, pollId, store.now());
    const chosen = poll.options
      .filter((o) => poll.viewerVotes.includes(o.id))
      .map((o) => `**${o.label}**`);
    const notice =
      chosen.length === 0
        ? "Your votes are cleared. Pick again any time while the vote is open."
        : `Your votes are saved: ${chosen.join(", ")}. Change them here any time while the vote is open.`;
    return {
      response: update(
        renderVoteSelect(poll, wording, notice, store.getRound(poll.roundId)),
      ),
    };
  };
}

/** A view of the panel asking the admin to confirm an action. */
export function renderConfirm(
  question: string,
  confirm: APIButtonComponentWithCustomId,
): APIMessageTopLevelComponent[] {
  return [
    container([
      textDisplay("## hikebot admin"),
      textDisplay(question),
      actionRow(
        confirm,
        button({
          custom_id: ADMIN_PANEL_IDS.back,
          label: "Back",
          style: ButtonStyle.Secondary,
        }),
      ),
    ]),
  ];
}

/** Close, first click: checks the poll can close and asks to confirm. */
function askClose(wordings: PollWordings): ComponentHandler {
  return adminOnly((interaction, context) => {
    const pollId = numericArg(interaction);
    const poll =
      pollId === null ? null : new PollStore(context.storage).getPoll(pollId);
    const wording = poll && wordings[poll.kind];
    if (!poll || !wording || poll.status !== "open") {
      return adminPanelUpdate(context, "That vote is no longer open.");
    }
    if (poll.options.length === 0) {
      return adminPanelUpdate(context, noOptionsToClose(wording));
    }
    return {
      response: update(
        renderConfirm(
          `**Close the ${wording.name} now?** The ${wording.noun} with the most votes wins; a tie is broken at random. Members can no longer vote, and the result is announced.`,
          button({
            custom_id: POLL_IDS.closeConfirm(poll.id),
            label: `Close ${wording.name}`,
            style: ButtonStyle.Danger,
          }),
        ),
      ),
    };
  });
}

function noOptionsToClose(wording: PollWording): string {
  return `The ${wording.name} has no ${wording.nouns} yet, so it cannot be closed. Wait for a proposal, or cancel the round.`;
}

/**
 * Closes the poll through the poll core and records its close work in the
 * same transaction (the result and what is left to do are stored before
 * the response), schedules the close-flow job as a backstop, then in the
 * follow-up runs the close flow and redraws the panel with the result and
 * a line per step that failed or had something to say.
 */
export async function closePoll(
  interaction: APIMessageComponentInteraction,
  context: HandlerContext,
  wordings: PollWordings,
  store: PollStore = new PollStore(context.storage),
): Promise<HandlerResult> {
  const { storage } = context;
  const pollId = numericArg(interaction);
  const before = pollId === null ? null : store.getPoll(pollId);
  const wording = before && wordings[before.kind];
  if (pollId === null || !before || !wording) {
    return adminPanelUpdate(context, "That vote is no longer open.");
  }
  try {
    storage.transactionSync(() => {
      store.closePoll(pollId, userIdOf(interaction));
      recordPendingClose(
        storage,
        pollId,
        interaction.guild_id ?? "",
        new GuildConfig(storage).get().timezone,
        wording.closeSteps.map((step) => step.name),
      );
    });
  } catch (error) {
    if (isPollError(error, "no_options")) {
      return adminPanelUpdate(context, noOptionsToClose(wording));
    }
    if (isPollError(error)) {
      return adminPanelUpdate(context, "That vote is no longer open.");
    }
    throw error;
  }
  await schedule(storage, CLOSE_FLOW_JOB, store.now() + CLOSE_FLOW_DELAY_MS);
  return {
    response: deferPanel(interaction),
    followUp: async () => {
      const run = await runCloseFlow(pollId, context, wordings);
      await finishPanel(context, interaction, run.notes.join("\n"));
    },
  };
}

/** What one run of a poll's close flow came to. */
export interface CloseFlowRun {
  /**
   * The panel's notes: the result, then one line per part of this run that
   * failed or had something to say.
   */
  notes: string[];
  /** True if it stopped at a part another run of this object is doing. */
  waiting: boolean;
}

/**
 * Runs what is left of the closed poll's close flow, as stored when it
 * closed, in order: the final edit of the poll message, the kind's
 * `closeSteps` (each may add lines to the announcement), then the
 * announcement. Each part is started in storage before it runs and removed
 * when it finished. It stops at a part another run is doing. A part cut
 * off half-way (by a restart of the object, or older than its claim) is
 * not run again, so nothing is created on Discord twice, except the final
 * edit, which is safe to repeat; a cut-off step or announcement shows on
 * the admin panel as not confirmed. Needs no interaction, so the follow-up
 * and the close-flow job both run it.
 */
export async function runCloseFlow(
  pollId: number,
  context: HandlerContext,
  wordings: PollWordings,
): Promise<CloseFlowRun> {
  const { storage } = context;
  const store = new PollStore(storage);
  const first = store.getPoll(pollId);
  const wording = first && wordings[first.kind];
  if (!first || !wording || first.status !== "closed") {
    dropPendingClose(storage, pollId);
    return { notes: [], waiting: false };
  }
  const notes = [resultNote(first, wording)];
  for (;;) {
    const record = pendingClose(storage, pollId);
    const part = record?.parts[0];
    if (record === null || part === undefined) {
      return { notes, waiting: false };
    }
    const now = store.now();
    const state = partState(storage, pollId, part, now).state;
    if (state === "running") return { notes, waiting: true };
    if (state === "cut-off" && part.name !== FINALIZE_PART) {
      console.error(
        `the close flow of poll ${String(pollId)} was cut off while it would ${part.name}; not doing it again`,
      );
      finishPart(storage, pollId, part.name);
      continue;
    }
    const poll = store.getPoll(pollId) ?? first;
    const closed: ClosedPoll = {
      poll,
      round: store.getRound(poll.roundId),
      guildId: record.guildId,
      timeZone: record.timeZone,
    };
    if (part.name === ANNOUNCE_PART) {
      const content = {
        guildId: record.guildId,
        timeZone: record.timeZone,
        extra: record.announce,
      };
      // Both claims in one synchronous step.
      const claimed =
        startPart(storage, pollId, part.name, now) &&
        claimAnnouncement(storage, pollId, content, now);
      if (claimed) await postAnnouncement(closed, wording, content, context);
      finishPart(storage, pollId, part.name);
      continue;
    }
    if (!startPart(storage, pollId, part.name, now)) {
      return { notes, waiting: true };
    }
    if (part.name === FINALIZE_PART) {
      const note = await finalizePollMessage(closed, wording, context);
      if (note !== null) notes.push(note);
      finishPart(storage, pollId, part.name);
      continue;
    }
    const step = wording.closeSteps.find((s) => s.name === part.name);
    try {
      const result: CloseStepResult = step
        ? await step.run(closed, context)
        : {};
      if (result.note !== undefined) notes.push(result.note);
      finishPart(storage, pollId, part.name, result.announce);
    } catch (error) {
      notes.push(`Could not ${part.name}: ${errorText(error)}.`);
      finishPart(storage, pollId, part.name);
    }
  }
}

/** The panel's first line after a close: the winner and its votes. */
function resultNote(poll: PollView, wording: PollWording): string {
  const winner = poll.options.find((o) => o.id === poll.winnerOptionId);
  return `The ${wording.name} is closed: **${winner?.label ?? "?"}** won with ${votes(winner?.votes ?? 0)}${poll.tieBroken ? ", drawn at random from a tie" : ""}.`;
}

/**
 * The close-flow job: runs what is left of every closed poll's close flow,
 * for a follow-up that was lost or cut off by a restart of the object.
 * While a part is still being done by a live run, it schedules itself
 * again; once every flow is done it schedules nothing.
 */
async function finishCloseFlows(
  context: HandlerContext,
  wordings: PollWordings,
): Promise<void> {
  const store = new PollStore(context.storage);
  let waiting = false;
  for (const record of pendingCloses(context.storage)) {
    const run = await runCloseFlow(record.pollId, context, wordings);
    waiting ||= run.waiting;
  }
  if (waiting) {
    await schedule(
      context.storage,
      CLOSE_FLOW_JOB,
      store.now() + CLOSE_FLOW_DELAY_MS,
    );
  }
}

/** What posting the announcement came to. */
type Posted = { ok: true; channelId: string } | { ok: false; reason: string };

/**
 * Posts the closed poll's announcement, made from `content`, in the
 * announcements channel and records its message id; on failure records
 * why, for the panel. The caller has claimed it with `claimAnnouncement`.
 */
async function postAnnouncement(
  { poll, round }: Pick<ClosedPoll, "poll" | "round">,
  wording: PollWording,
  content: AnnouncementContent,
  context: HandlerContext,
): Promise<Posted> {
  const retry = `click ${announceLabel(wording)}`;
  const channelId = new GuildConfig(context.storage).get().announceChannelId;
  if (channelId === null) {
    const reason = `No announcements channel is set, so the result was not announced. Pick one under Settings, then ${retry}.`;
    recordAnnouncementFailure(context.storage, poll.id, reason);
    return { ok: false, reason };
  }
  try {
    const message = await discordApi(context.env).createMessage(
      channelId,
      messageBody(
        renderAnnouncement(
          {
            poll,
            round,
            guildId: content.guildId,
            timeZone: content.timeZone,
          },
          wording,
          content.extra,
        ),
      ),
    );
    recordAnnouncementPosted(context.storage, poll.id, message.id);
    return { ok: true, channelId };
  } catch (error) {
    const reason = `Could not post the announcement in <#${channelId}>: ${errorText(error)}. Check that the bot can post there, then ${retry}.`;
    recordAnnouncementFailure(context.storage, poll.id, reason);
    return { ok: false, reason };
  }
}

/** The panel's button that posts a poll's announcement again. */
function announceLabel(wording: Pick<PollWording, "name">): string {
  return `Announce ${wording.name}`;
}

/**
 * Announce <vote>: posts the announcement of a poll of the last round again
 * after it failed or was cut off, made as the close flow made it. The claim
 * is taken before the answer, so a second click while the first is running
 * is told so, and a click after it was posted posts nothing.
 */
function retryAnnouncement(wordings: PollWordings): ComponentHandler {
  return adminOnly((interaction, context) => {
    const { storage } = context;
    const pollId = numericArg(interaction);
    const store = new PollStore(storage);
    const poll = pollId === null ? null : store.getPoll(pollId);
    const wording = poll && wordings[poll.kind];
    const content = poll && announcementContent(storage, poll.id);
    if (
      !poll ||
      !wording ||
      !content ||
      poll.roundId !== store.getLastRound()?.id
    ) {
      return adminPanelUpdate(
        context,
        "That vote is no longer in the last round, so its announcement is not posted from here.",
      );
    }
    const now = store.now();
    if (announcementStatus(storage, poll.id, now).state === "posted") {
      return adminPanelUpdate(
        context,
        `The ${wording.name}'s announcement is already posted.`,
      );
    }
    if (!claimAnnouncement(storage, poll.id, content, now)) {
      return adminPanelUpdate(
        context,
        `The ${wording.name}'s announcement is being posted.`,
      );
    }
    return {
      response: deferPanel(interaction),
      followUp: async () => {
        const posted = await postAnnouncement(
          { poll, round: store.getRound(poll.roundId) },
          wording,
          content,
          context,
        );
        await finishPanel(
          context,
          interaction,
          posted.ok
            ? `The ${wording.name}'s result is announced in <#${posted.channelId}>.`
            : posted.reason,
        );
      },
    };
  });
}

/** Edits the poll message to its final state; a note if that failed. */
async function finalizePollMessage(
  { poll, round }: ClosedPoll,
  wording: PollWording,
  context: HandlerContext,
): Promise<string | null> {
  if (poll.channelId === null || poll.messageId === null) {
    return "The poll message was never posted, so it was not updated.";
  }
  const { channelId, messageId } = poll;
  try {
    await queuePollEdit(context.storage, () =>
      discordApi(context.env).editMessage(
        channelId,
        messageId,
        messageBody(renderPollMessage(poll, wording, round)),
      ),
    );
    return null;
  } catch (error) {
    return `Could not update the poll message in <#${channelId}>: ${errorText(error)}.`;
  }
}

/**
 * The announcement of a closed poll's winner: the heading, the kind's own
 * lines, the winner and its votes, its details, the tie note, the link to
 * the poll message, then `extra` lines from the close steps.
 */
export function renderAnnouncement(
  { poll, round, guildId, timeZone }: ClosedPoll,
  wording: PollWording,
  extra: readonly string[] = [],
): APIMessageTopLevelComponent[] {
  const winner = poll.options.find((o) => o.id === poll.winnerOptionId);
  const lines = [
    `## ${wording.announcement}`,
    ...wording.announcementLines(poll, round, timeZone),
    `**${winner?.label ?? "?"}** won the ${wording.name} with ${votes(winner?.votes ?? 0)}.`,
  ];
  if (winner?.details) lines.push(winner.details);
  if (poll.tieBroken) lines.push(tieNote(poll));
  if (poll.channelId !== null && poll.messageId !== null) {
    lines.push(
      `[See the vote](https://discord.com/channels/${guildId}/${poll.channelId}/${poll.messageId})`,
    );
  }
  lines.push(...extra);
  return [container([textDisplay(lines.join("\n"))])];
}

/** Cancel round, first click: asks to confirm. */
const askCancel: ComponentHandler = adminOnly((interaction, context) => {
  const roundId = numericArg(interaction);
  const round =
    roundId === null ? null : new PollStore(context.storage).getRound(roundId);
  if (!round || round.status === "complete" || round.status === "cancelled") {
    return adminPanelUpdate(context, "That round has already ended.");
  }
  return {
    response: update(
      renderConfirm(
        "**Cancel this round?** Any open vote closes without a result and its votes are discarded. You can start a new round afterwards.",
        button({
          custom_id: POLL_IDS.cancelConfirm(round.id),
          label: "Cancel round",
          style: ButtonStyle.Danger,
        }),
      ),
    ),
  };
});

/**
 * Cancels the round through the poll core, then in the follow-up rewrites
 * the message of each poll that was open as cancelled, without buttons, and
 * redraws the panel.
 */
function cancelRound(wordings: PollWordings): ComponentHandler {
  return adminOnly((interaction, context) => {
    const roundId = numericArg(interaction);
    const store = new PollStore(context.storage);
    const before = roundId === null ? null : store.getRound(roundId);
    if (roundId === null || !before) {
      return adminPanelUpdate(context, "That round has already ended.");
    }
    const open = [before.locationPoll, before.datePoll].filter(
      (poll): poll is PollView => poll?.status === "open",
    );
    try {
      store.cancelRound(roundId, userIdOf(interaction));
    } catch (error) {
      if (isPollError(error)) {
        return adminPanelUpdate(context, "That round has already ended.");
      }
      throw error;
    }
    return {
      response: deferPanel(interaction),
      followUp: async () => {
        const notes = ["The round is cancelled."];
        for (const { id } of open) {
          const poll = store.getPoll(id);
          const wording = poll && wordings[poll.kind];
          if (!poll || !wording || !poll.channelId || !poll.messageId) continue;
          const { channelId, messageId } = poll;
          try {
            await queuePollEdit(context.storage, () =>
              discordApi(context.env).editMessage(
                channelId,
                messageId,
                messageBody(
                  renderPollMessage(poll, wording, store.getRound(roundId)),
                ),
              ),
            );
          } catch (error) {
            notes.push(
              `Could not mark the poll message in <#${channelId}> as cancelled: ${errorText(error)}.`,
            );
          }
        }
        await finishPanel(context, interaction, notes.join("\n"));
      },
    };
  });
}

// Shared helpers for panel follow-ups.

/**
 * The deferral for a panel action finished in a follow-up: an update of
 * the panel message the control was on, or, for a modal submitted without
 * one, an ephemeral "thinking…".
 */
export function deferPanel(
  interaction: APIMessageComponentInteraction | APIModalSubmitInteraction,
): APIInteractionResponse {
  return interaction.message === undefined
    ? deferredReply({ ephemeral: true })
    : deferredUpdate();
}

/** Replaces the deferred panel with the status view and `notice`. */
export async function finishPanel(
  context: HandlerContext,
  interaction: APIMessageComponentInteraction | APIModalSubmitInteraction,
  notice: string,
): Promise<void> {
  try {
    await discordApi(context.env).editOriginalInteractionResponse(
      interaction.application_id,
      interaction.token,
      adminPanelBody(context.storage, notice),
    );
  } catch (error) {
    console.error(
      `redrawing the admin panel for interaction ${interaction.id} failed: ${errorText(error)}`,
    );
  }
}

/** Why a Discord call failed, in words an admin can act on. */
export function errorText(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `Discord answered: ${error.discordMessage} (HTTP ${String(error.status)}${error.code === undefined ? "" : `, code ${String(error.code)}`})`;
  }
  return "Discord could not be reached";
}

/** Registers the shared poll controls for the given poll kinds. */
export function registerPollUi(router: Router, wordings: PollWordings): Router {
  router.component("hb:poll:vote", openVoteSelect(wordings));
  router.component("hb:poll:choose", saveVotes(wordings));
  router.component("hb:poll:close", askClose(wordings));
  router.component(
    "hb:poll:close-confirm",
    adminOnly((interaction: APIMessageComponentInteraction, context) =>
      closePoll(interaction, context, wordings),
    ),
  );
  router.component("hb:round:cancel", askCancel);
  router.component("hb:round:cancel-confirm", cancelRound(wordings));
  router.component("hb:poll:announce", retryAnnouncement(wordings));
  router.job(REFRESH_JOB, (context) => refreshPollMessages(context, wordings));
  router.job(CLOSE_FLOW_JOB, (context) => finishCloseFlows(context, wordings));
  return router;
}
