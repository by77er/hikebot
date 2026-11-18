/**
 * The date vote: once the location is decided, an admin starts it from the
 * panel with the candidate dates, and the shared poll UI (`poll-ui.ts`)
 * does the voting, refreshing and closing. Members cannot propose dates.
 */
import {
  TextInputStyle,
  type APIModalSubmitInteraction,
} from "discord-api-types/v10";
import { discordApi } from "../discord/api";
import {
  customId,
  label,
  messageBody,
  modal,
  textInput,
  textInputValue,
} from "../discord/components";
import { ephemeralNotice } from "../discord/responses";
import { setupComplete } from "../guild/config";
import { adminOnly } from "../guild/permissions";
import type { ComponentHandler, ModalHandler, Router } from "../guild/router";
import { DEFAULT_HIKE_TIME, parseDateOption, todayIn } from "../polls/dates";
import { isPollError } from "../polls/errors";
import {
  MAX_OPTIONS,
  MIN_DATE_OPTIONS,
  PollStore,
  type PollView,
  type RoundView,
} from "../polls/store";
import {
  POLL_CONTROL_IDS,
  adminPanelUpdate,
  listing,
  missingSettings,
} from "./admin-panel";
import { createHikeThreadStep, whenLine } from "./hike-thread";
import {
  deferPanel,
  errorText,
  finishPanel,
  renderPollMessage,
  type PollWording,
} from "./poll-ui";

export const DATE_IDS = {
  start: POLL_CONTROL_IDS.startDateVote,
  dates: customId("date", "dates"),
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
  extraButtons: () => [],
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
  closeSteps: [createHikeThreadStep],
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

function setupMissing(missing: string[]): string {
  return `Set the ${listing(missing)} under Settings before starting a vote.`;
}

const NOT_DECIDED = "The date vote starts once the location is decided.";

/** Start date vote: opens the modal for the candidate dates. */
const openStartModal: ComponentHandler = adminOnly(
  (_interaction, context, settings) => {
    if (!setupComplete(settings)) {
      return adminPanelUpdate(context, setupMissing(missingSettings(settings)));
    }
    if (
      new PollStore(context.storage).getActiveRound()?.status !==
      "location_decided"
    ) {
      return adminPanelUpdate(context, NOT_DECIDED);
    }
    return {
      response: modal(DATE_IDS.start, "Start date vote", [
        label(
          "Candidate dates (one per line)",
          textInput({
            custom_id: DATE_IDS.dates,
            style: TextInputStyle.Paragraph,
            required: true,
            max_length: MAX_DATES_INPUT,
            placeholder: `2026-12-05 (starts at ${DEFAULT_HIKE_TIME}) or 2026-12-05 09:00`,
          }),
          `${String(MIN_DATE_OPTIONS)} to ${String(MAX_OPTIONS)} dates, as YYYY-MM-DD or YYYY-MM-DD HH:MM (24-hour); the time defaults to ${DEFAULT_HIKE_TIME}.`,
        ),
      ]),
    };
  },
);

/**
 * The start modal: checks the dates, opens the date poll, then in the
 * follow-up posts the poll message in the voting channel and records it.
 * If Discord refuses the post, the poll is withdrawn, so the round is back
 * at `location_decided`, and the panel says which channel and why.
 */
const startDateVote: ModalHandler = adminOnly(
  (interaction: APIModalSubmitInteraction, context, settings) => {
    const store = new PollStore(context.storage);
    const parsed = parseCandidateDates(
      textInputValue(interaction.data, DATE_IDS.dates) ?? "",
      store.now(),
      settings.timezone,
    );
    if (!parsed.ok) return { response: ephemeralNotice(parsed.error) };
    const channelId = settings.voteChannelId;
    if (!setupComplete(settings) || channelId === null) {
      return {
        response: ephemeralNotice(setupMissing(missingSettings(settings))),
      };
    }
    const round = store.getActiveRound();
    if (round?.status !== "location_decided") {
      return { response: ephemeralNotice(NOT_DECIDED) };
    }
    const userId = interaction.member?.user.id ?? "";
    let poll: PollView;
    try {
      poll = store.startDatePoll(round.id, userId, parsed.dates);
    } catch (error) {
      if (isPollError(error)) {
        return { response: ephemeralNotice(error.message) };
      }
      throw error;
    }
    const started = poll;
    return {
      response: deferPanel(interaction),
      followUp: async () => {
        let notice: string;
        try {
          const message = await discordApi(context.env).createMessage(
            channelId,
            messageBody(
              renderPollMessage(
                started,
                DATE_POLL,
                store.getRound(started.roundId),
              ),
            ),
          );
          store.setPollMessage(started.id, channelId, message.id);
          notice = `The date vote is open in <#${channelId}>.`;
        } catch (error) {
          try {
            store.withdrawDatePoll(started.id);
          } catch (withdrawError) {
            // Cancelled in the meantime: there is nothing to take back.
            if (!isPollError(withdrawError)) throw withdrawError;
          }
          notice = `Could not post the date vote in <#${channelId}>: ${errorText(error)}. The date vote was not started; check the bot's permissions in that channel and try again.`;
        }
        await finishPanel(context, interaction, notice);
      },
    };
  },
);

/** Registers the date vote's start controls. */
export function registerDateVote(router: Router): Router {
  router.component(DATE_IDS.start, openStartModal);
  router.modal(DATE_IDS.start, startDateVote);
  return router;
}
