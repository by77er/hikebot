/**
 * The active round's section of the web view (`src/guild/web-view.ts`):
 * which step it is at, the location it decided, and its open vote with the
 * tallies and the viewer's own votes, in the order the poll message lists
 * the options, and what a member may propose to it, as the Propose buttons
 * offer it in Discord.
 */
import { channelUrl } from "../discord/api";
import type { WebViewSource } from "../guild/web-view";
import { DEFAULT_HIKE_TIME } from "../polls/dates";
import {
  MAX_OPTIONS,
  proposeDays,
  type PollKind,
  type PollView,
} from "../polls/store";
import { rankOptions } from "../polls/tally";
import {
  DATE_POLL,
  FULL,
  decidedLocation,
  pollProposalDays,
} from "./date-vote";
import {
  LOCATION_POLL,
  TOO_MANY,
  restingLine,
  suggestable,
} from "./location-vote";
import { chronological, type PollWording } from "./poll-ui";

/** Where the active round stands. */
export type RoundStep =
  "location_vote_open" | "location_decided" | "date_vote_open";

export interface WebVoteOption {
  optionId: number;
  label: string;
  details: string | null;
  /** `YYYY-MM-DD HH:MM` for a date option, null for a location. */
  dateValue: string | null;
  /** The user id of the member who proposed it. */
  proposedBy: string;
  votes: number;
  viewerVoted: boolean;
}

export interface WebOpenVote {
  pollId: number;
  kind: PollKind;
  /** In the poll message's order: locations by votes, dates by date. */
  options: WebVoteOption[];
  /** Members who voted for at least one option. */
  voterCount: number;
  /**
   * When the vote closes by itself, in milliseconds since the epoch; null
   * while it closes only when an admin closes it.
   */
  closesAt: number | null;
  /** The poll's message in Discord, null until it is posted. */
  messageUrl: string | null;
  /** The bot's line under the poll's heading: "Vote for every location…". */
  instructions: string;
  /** What a member may add to the vote. */
  propose: WebLocationProposal | WebDateProposal;
}

/** Propose a location, as the button offers it in Discord. */
export interface WebLocationProposal {
  kind: "location";
  /** The bot's sentence when the vote is full, null while there is room. */
  refusal: string | null;
  /**
   * Past locations the viewer may suggest again, as the bot's "Suggest one
   * again" select lists them: neither on the vote nor resting, the
   * viewer's own first, at most 25.
   */
  again: { optionId: number; label: string; details: string | null }[];
  /**
   * The bot's line naming the resting locations, in Discord markdown:
   * "Resting: **Eagle Peak** (2 more hikes)". Null when none rests.
   */
  resting: string | null;
}

/** Propose a date, as the button offers it in Discord. */
export interface WebDateProposal {
  kind: "date";
  /**
   * The bot's sentence when no date can be added: the vote is full, or
   * the round's days have passed. Null while a member may add one.
   */
  refusal: string | null;
  /** The first and last day a member may propose, `YYYY-MM-DD`. */
  first: string;
  last: string;
  /** The time a date without one starts at, `HH:MM`. */
  defaultTime: string;
}

export interface WebRoundSection {
  roundId: number;
  step: RoundStep;
  /** The location the round decided, from `location_decided` on. */
  location: { label: string; details: string | null } | null;
  /** The open vote, while the step is a vote. */
  vote: WebOpenVote | null;
}

const WORDINGS: Record<PollKind, PollWording> = {
  location: LOCATION_POLL,
  date: DATE_POLL,
};

const STEPS = {
  location_voting: "location_vote_open",
  location_decided: "location_decided",
  date_voting: "date_vote_open",
} as const;

/** The active round, or null when the guild has none. */
export function roundSection(source: WebViewSource): WebRoundSection | null {
  const round = source.store.getActiveRound(source.viewerId);
  if (round === null || !(round.status in STEPS)) return null;
  const step = STEPS[round.status as keyof typeof STEPS];
  const poll =
    step === "location_vote_open"
      ? round.locationPoll
      : step === "date_vote_open"
        ? round.datePoll
        : null;
  const location = decidedLocation(round);
  return {
    roundId: round.id,
    step,
    location:
      location === null
        ? null
        : { label: location.label, details: location.details },
    vote:
      poll === null || poll.status !== "open" ? null : openVote(poll, source),
  };
}

function openVote(poll: PollView, source: WebViewSource): WebOpenVote {
  const options =
    WORDINGS[poll.kind].order === "date"
      ? chronological(poll.options)
      : rankOptions(poll.options);
  return {
    pollId: poll.id,
    kind: poll.kind,
    options: options.map((option) => ({
      optionId: option.id,
      label: option.label,
      details: option.details,
      dateValue: option.dateValue,
      proposedBy: option.proposedBy,
      votes: option.votes,
      viewerVoted: poll.viewerVotes.includes(option.id),
    })),
    voterCount: poll.voterCount,
    // Votes close only when an admin closes them.
    closesAt: null,
    messageUrl:
      poll.channelId === null || poll.messageId === null
        ? null
        : channelUrl(source.guildId, poll.channelId, poll.messageId),
    instructions: WORDINGS[poll.kind].instructions,
    propose:
      poll.kind === "location"
        ? locationProposal(poll, source)
        : dateProposal(poll, source),
  };
}

function locationProposal(
  poll: PollView,
  source: WebViewSource,
): WebLocationProposal {
  const past = source.store.listPastLocations(source.viewerId, poll.id);
  return {
    kind: "location",
    refusal: poll.options.length >= MAX_OPTIONS ? TOO_MANY : null,
    again: suggestable(past).map((p) => ({
      optionId: p.optionId,
      label: p.label,
      details: p.details,
    })),
    resting: restingLine(past),
  };
}

function dateProposal(poll: PollView, source: WebViewSource): WebDateProposal {
  const { first, last } = pollProposalDays(source.storage, poll, source.now);
  const refusal =
    poll.options.length >= MAX_OPTIONS
      ? FULL
      : first > last
        ? proposeDays(first, last, true)
        : null;
  return {
    kind: "date",
    refusal,
    first,
    last,
    defaultTime: DEFAULT_HIKE_TIME,
  };
}
