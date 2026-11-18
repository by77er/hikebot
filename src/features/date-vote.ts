/**
 * The date vote: once the location is decided, an admin starts it from the
 * panel (`startDateVote` in `round-actions.ts`) with the candidate dates,
 * prefilled with the Saturdays and Sundays of the next two weekends at the
 * default time. While it runs, members
 * propose more dates with **Propose a date**, from today to
 * `MAX_PROPOSAL_DAYS_AHEAD` days ahead in the guild's time zone. The shared
 * poll UI (`poll-ui.ts`) does the voting, refreshing and closing.
 */
import {
  ButtonStyle,
  TextInputStyle,
  type APIInteractionResponse,
  type APIModalSubmitInteraction,
} from "discord-api-types/v10";
import {
  button,
  customId,
  label,
  modal,
  parseCustomId,
  textInput,
  textInputValue,
} from "../discord/components";
import { ephemeralNotice } from "../discord/responses";
import { GuildConfig } from "../guild/config";
import { adminOnly } from "../guild/permissions";
import {
  UNAVAILABLE_MESSAGE,
  type ComponentHandler,
  type ModalHandler,
  type Router,
} from "../guild/router";
import {
  DEFAULT_HIKE_TIME,
  MAX_PROPOSAL_DAYS_AHEAD,
  addDays,
  defaultDateCandidates,
  parseDateOption,
  todayIn,
} from "../polls/dates";
import { isPollError, type PollError } from "../polls/errors";
import {
  MAX_OPTIONS,
  MIN_DATE_OPTIONS,
  PollStore,
  type RoundView,
} from "../polls/store";
import { POLL_CONTROL_IDS, adminPanelUpdate } from "./admin-panel";
import { planHikeDayStep } from "./hike-day";
import { createHikeEventStep } from "./hike-event";
import { createHikeThreadStep, whenLine } from "./hike-thread";
import {
  VOTE_CLOSED_MESSAGE,
  actorOf,
  answerPanel,
  roundContext,
  scheduleRefresh,
  type PollWording,
} from "./poll-ui";
import { dateVoteRefusal, startDateVote } from "./round-actions";

export const DATE_IDS = {
  start: POLL_CONTROL_IDS.startDateVote,
  dates: customId("date", "dates"),
  propose: (pollId: number) => customId("date", "propose", String(pollId)),
  day: customId("date", "day"),
} as const;

/** The longest candidate list the modal takes, in characters. */
export const MAX_DATES_INPUT = 1000;

/** Offending lines listed in one refusal; the rest are counted. */
const MAX_LISTED_LINES = 25;

const FORMAT_HELP = `Write one date per line as \`YYYY-MM-DD\` or \`YYYY-MM-DD HH:MM\` (24-hour), for example \`2026-12-05\` or \`2026-12-05 09:00\`; a date without a time starts at ${DEFAULT_HIKE_TIME}.`;

/** The decided location of a round, if it has one. */
export function decidedLocation(round: RoundView | null) {
  return (
    round?.locationPoll?.options.find(
      (option) => option.id === round.locationOptionId,
    ) ?? null
  );
}

export const DATE_POLL: PollWording = {
  kind: "date",
  title: (round) => {
    const location = decidedLocation(round);
    return location === null
      ? "When should we hike?"
      : `When should we hike ${location.label}?`;
  },
  instructions:
    "Vote for every date you could make; you can change your votes until the vote closes.",
  empty: "No dates.",
  noOptions: "There are no dates to vote for.",
  noun: "date",
  nouns: "dates",
  name: "date vote",
  showProposer: false,
  order: "date",
  extraButtons: (poll) => [
    button({
      custom_id: DATE_IDS.propose(poll.id),
      label: "Propose a date",
      style: ButtonStyle.Secondary,
    }),
  ],
  announcement: "Hike planned",
  announcementLines: (poll, round, timeZone) => {
    const location = decidedLocation(round);
    const date = poll.options.find((o) => o.id === poll.winnerOptionId);
    return [
      `**Where:** ${location?.label ?? "?"}`,
      ...(location?.details ? [location.details] : []),
      whenLine(date ?? null, timeZone),
    ];
  },
  closeSteps: [createHikeThreadStep, createHikeEventStep, planHikeDayStep],
};

/** The candidate dates an admin typed, or why they are refused. */
export type ParsedDates =
  { ok: true; dates: string[] } | { ok: false; error: string };

/**
 * Reads the "Candidate dates" field: one date per line, blank lines
 * dropped and repeated dates collapsed, each without a time given
 * `DEFAULT_HIKE_TIME`. Refuses lines that do not parse, dates on a calendar
 * day before today in `timeZone` at `now`, and fewer than 2 or more than 25
 * distinct dates, listing every offending line and the accepted formats.
 */
export function parseCandidateDates(
  text: string,
  now: number,
  timeZone: string,
): ParsedDates {
  const today = todayIn(timeZone, now);
  const problems: string[] = [];
  const dates: string[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "") continue;
    const where = `Line ${String(i + 1)}: \`${quoted(line)}\``;
    const parsed = parseDateOption(line);
    if (parsed === null) {
      problems.push(`${where} is not a date.`);
    } else if (parsed.value.slice(0, 10) < today) {
      problems.push(
        `${where} (${parsed.label}) is in the past: today is ${today} in ${timeZone}.`,
      );
    } else if (!dates.includes(parsed.value)) {
      dates.push(parsed.value);
    }
  }
  const listed = problems.slice(0, MAX_LISTED_LINES);
  if (problems.length > listed.length) {
    listed.push(
      `…and ${String(problems.length - listed.length)} more lines like these.`,
    );
  }
  if (problems.length === 0 && dates.length < MIN_DATE_OPTIONS) {
    listed.push(
      `You listed ${countOf(dates.length)}; a date vote needs ${String(MIN_DATE_OPTIONS)} to ${String(MAX_OPTIONS)} different dates.`,
    );
  }
  if (dates.length > MAX_OPTIONS) {
    listed.push(
      `You listed ${countOf(dates.length)}; a date vote holds at most ${String(MAX_OPTIONS)}. Remove some.`,
    );
  }
  if (listed.length === 0) return { ok: true, dates };
  return {
    ok: false,
    error: ["**The date vote was not started.**", ...listed, FORMAT_HELP].join(
      "\n",
    ),
  };
}

function countOf(n: number): string {
  if (n === 0) return "no dates";
  return n === 1 ? "1 date" : `${String(n)} different dates`;
}

/** A line as typed, shortened and without backticks, to quote it. */
function quoted(line: string): string {
  const plain = line.replaceAll("`", "'");
  return plain.length <= 40 ? plain : `${plain.slice(0, 39)}…`;
}

/**
 * The Start date vote modal, its field prefilled with the default
 * candidates for `today` (`YYYY-MM-DD`), one per line.
 */
export function startModal(today: string): APIInteractionResponse {
  return modal(DATE_IDS.start, "Start date vote", [
    label(
      "Candidate dates (one per line)",
      textInput({
        custom_id: DATE_IDS.dates,
        style: TextInputStyle.Paragraph,
        required: true,
        max_length: MAX_DATES_INPUT,
        placeholder: `2026-12-05 (starts at ${DEFAULT_HIKE_TIME}) or 2026-12-05 09:00`,
        value: defaultDateCandidates(today).join("\n"),
      }),
      `${String(MIN_DATE_OPTIONS)} to ${String(MAX_OPTIONS)} dates, as YYYY-MM-DD or YYYY-MM-DD HH:MM (24-hour); the time defaults to ${DEFAULT_HIKE_TIME}.`,
    ),
  ]);
}

/**
 * Start date vote: opens the modal for the candidate dates, prefilled with
 * the next two weekends after today in the guild's time zone, the dates
 * `startDateVote` starts on when none are given.
 */
const openStartModal: ComponentHandler = adminOnly(
  (_interaction, context, settings) => {
    const refusal = dateVoteRefusal(context);
    if (refusal !== null) return adminPanelUpdate(context, refusal.message);
    const now = new PollStore(context.storage).now();
    return { response: startModal(todayIn(settings.timezone, now)) };
  },
);

/**
 * The start modal: opens the date poll with `startDateVote` on the typed
 * lines, then in the follow-up posts the poll message and redraws the
 * panel. A refusal is answered ephemerally.
 */
const submitStart: ModalHandler = adminOnly(
  (interaction: APIModalSubmitInteraction, context) =>
    answerPanel(
      interaction,
      context,
      startDateVote(roundContext(interaction, context), actorOf(interaction), {
        dates: (textInputValue(interaction.data, DATE_IDS.dates) ?? "").split(
          /\r?\n/,
        ),
      }),
      (message) => ({ response: ephemeralNotice(message) }),
    ),
);

const FULL = `This vote already has ${String(MAX_OPTIONS)} dates, the most it can hold. Vote for one of them instead.`;

/**
 * The Propose a date modal for the poll; its help text names the last day
 * a member may propose, `MAX_PROPOSAL_DAYS_AHEAD` days after `today`.
 */
export function proposeModal(
  pollId: number,
  today: string,
): APIInteractionResponse {
  const last = addDays(today, MAX_PROPOSAL_DAYS_AHEAD);
  return modal(DATE_IDS.propose(pollId), "Propose a date", [
    label(
      "Date",
      textInput({
        custom_id: DATE_IDS.day,
        required: true,
        max_length: 16,
        placeholder: `${today} or ${today} 09:00`,
      }),
      `${today} to ${last}, as YYYY-MM-DD or YYYY-MM-DD HH:MM; the time defaults to ${DEFAULT_HIKE_TIME}.`,
    ),
  ]);
}

function pollIdArg(customIdValue: string): number | null {
  const id = Number(parseCustomId(customIdValue)?.arg);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Propose a date: the modal, unless the poll is closed or full. */
const openPropose: ComponentHandler = (interaction, context) => {
  const pollId = pollIdArg(interaction.data.custom_id);
  const store = new PollStore(context.storage);
  const poll = pollId === null ? null : store.getPoll(pollId);
  if (!poll || poll.kind !== "date") {
    return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
  }
  if (poll.status !== "open") {
    return { response: ephemeralNotice(VOTE_CLOSED_MESSAGE) };
  }
  if (poll.options.length >= MAX_OPTIONS) {
    return { response: ephemeralNotice(FULL) };
  }
  const timeZone = new GuildConfig(context.storage).get().timezone;
  return {
    response: proposeModal(poll.id, todayIn(timeZone, store.now())),
  };
};

/** The answer to a refused proposal of the date typed as `typed`. */
function proposalRefusal(error: PollError, typed: string): string {
  switch (error.code) {
    case "poll_closed":
      return VOTE_CLOSED_MESSAGE;
    case "poll_not_found":
    case "invalid_state":
      return UNAVAILABLE_MESSAGE;
    case "invalid_date":
      return `\`${quoted(typed)}\` is not a date. Write it as \`YYYY-MM-DD\` or \`YYYY-MM-DD HH:MM\` (24-hour), for example \`2026-12-05\` or \`2026-12-05 09:00\`.`;
    case "duplicate_option":
      return `**${parseDateOption(typed)?.label ?? typed}** is already on the vote. Vote for it instead, or propose another time that day.`;
    case "too_many_options":
      return FULL;
    default:
      return error.message;
  }
}

/**
 * The Propose a date modal: adds the date with the member as proposer,
 * answers ephemerally and refreshes the poll message.
 */
const saveDateProposal: ModalHandler = async (interaction, context) => {
  const pollId = pollIdArg(interaction.data.custom_id);
  if (pollId === null) {
    return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
  }
  const store = new PollStore(context.storage);
  const typed = (textInputValue(interaction.data, DATE_IDS.day) ?? "").trim();
  try {
    const option = store.proposeDate(
      pollId,
      interaction.member?.user.id ?? interaction.user?.id ?? "",
      typed,
      new GuildConfig(context.storage).get().timezone,
    );
    await scheduleRefresh(context.storage, pollId, store.now());
    return {
      response: ephemeralNotice(
        `Added **${option.label}** to the date vote. Use **Vote** to vote for it.`,
      ),
    };
  } catch (error) {
    if (isPollError(error)) {
      return { response: ephemeralNotice(proposalRefusal(error, typed)) };
    }
    throw error;
  }
};

/** Registers the date vote's start and propose controls. */
export function registerDateVote(router: Router): Router {
  router.component(DATE_IDS.start, openStartModal);
  router.modal(DATE_IDS.start, submitStart);
  router.component("hb:date:propose", openPropose);
  router.modal("hb:date:propose", saveDateProposal);
  return router;
}
