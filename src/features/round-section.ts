/**
 * The active round's section of the web view (`src/guild/web-view.ts`):
 * which step it is at, the location it decided, and its open vote with the
 * tallies and the viewer's own votes, in the order the poll message lists
 * the options.
 */
import { channelUrl } from "../discord/api";
import type { WebViewSource } from "../guild/web-view";
import type { PlacePoint, PollKind, PollView } from "../polls/store";
import { rankOptions } from "../polls/tally";
import { DATE_POLL, decidedLocation } from "./date-vote";
import { LOCATION_POLL } from "./location-vote";
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
  /**
   * Where a location option is, once its place is found or given, for the
   * map; null for a date, and for a location without a place.
   */
  point: PlacePoint | null;
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
      poll === null || poll.status !== "open"
        ? null
        : openVote(poll, source.guildId),
  };
}

function openVote(poll: PollView, guildId: string): WebOpenVote {
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
      point:
        option.place?.point == null
          ? null
          : { lat: option.place.point.lat, lon: option.place.point.lon },
    })),
    voterCount: poll.voterCount,
    // Votes close only when an admin closes them.
    closesAt: null,
    messageUrl:
      poll.channelId === null || poll.messageId === null
        ? null
        : channelUrl(guildId, poll.channelId, poll.messageId),
  };
}
