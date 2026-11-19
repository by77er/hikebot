import {
  CADENCE_WINDOW_DAYS,
  MAX_PROPOSAL_DAYS_AHEAD,
  addDays,
  parseDateOption,
  todayIn,
  windowFrom,
} from "./dates";
import { PollError } from "./errors";
import { defaultRandom, pickWinner, type RandomSource } from "./tally";

export type RoundStatus =
  | "location_voting"
  | "location_decided"
  | "date_voting"
  | "complete"
  | "cancelled";
export type PollKind = "location" | "date";
export type PollStatus = "open" | "closed";

export const MAX_OPTIONS = 25;
export const MAX_LABEL_LENGTH = 80;
export const MAX_DETAILS_LENGTH = 300;
export const MIN_DATE_OPTIONS = 2;
/** How many completed hikes a location rests after it was the hike. */
export const COOLDOWN_HIKES = 2;

/**
 * Where a location option's place stands: `given` when the proposer (or an
 * admin's Set map pin) wrote coordinates, `pending` while the geocoder is
 * still to look it up, `found` or `not_found` by its answer, `failed` when
 * every attempt failed, `cleared` when an admin removed the pin.
 */
export type PlaceStatus =
  "pending" | "found" | "not_found" | "failed" | "given" | "cleared";

/** Most attempts at looking up one option's place. */
export const MAX_PLACE_ATTEMPTS = 3;

/** A point in decimal degrees. */
export interface PlacePoint {
  lat: number;
  lon: number;
}

/** A location option's place. */
export interface OptionPlace {
  status: PlaceStatus;
  /** Null until found or given, and after it was cleared. */
  point: PlacePoint | null;
  /** The geocoder's place name, shortened; null for given coordinates. */
  name: string | null;
  /** Lookups made so far. */
  attempts: number;
}

/** What a lookup of an option's place came to. */
export type PlaceLookup =
  | { kind: "found"; point: PlacePoint; name: string }
  | { kind: "not_found" }
  /** No answer; `retryAt` is when to try again, if attempts are left. */
  | { kind: "error"; retryAt: number };

/** A location option waiting for its place to be looked up. */
export interface PendingPlace {
  optionId: number;
  pollId: number;
  label: string;
  attempts: number;
}

export interface NewOption {
  label: string;
  details?: string | null;
  proposedBy: string;
  /**
   * For a location: its place, as written by the proposer or copied from an
   * earlier option. Defaults to `pending`, to be looked up.
   */
  place?: OptionPlace;
}

export interface OptionView {
  id: number;
  pollId: number;
  label: string;
  details: string | null;
  /** Normalized `YYYY-MM-DD[ HH:MM]` for date options, else null. */
  dateValue: string | null;
  proposedBy: string;
  createdAt: number;
  votes: number;
  /** For a location option, where it is; null for dates and older options. */
  place: OptionPlace | null;
}

export interface PollView {
  id: number;
  roundId: number;
  kind: PollKind;
  status: PollStatus;
  channelId: string | null;
  messageId: string | null;
  winnerOptionId: number | null;
  tieBroken: boolean;
  /** The options that shared the top count when a tie was broken. */
  tiedOptionIds: number[];
  openedBy: string;
  openedAt: number;
  closedBy: string | null;
  closedAt: number | null;
  options: OptionView[];
  /** Distinct users with at least one vote in this poll. */
  voterCount: number;
  /** The viewer's current votes (option ids); empty without a viewer. */
  viewerVotes: number[];
}

export interface RoundView {
  id: number;
  status: RoundStatus;
  locationOptionId: number | null;
  dateOptionId: number | null;
  threadId: string | null;
  /** The hike's Discord scheduled event, once created. */
  eventId: string | null;
  /** The hike-day announcement, once posted. */
  dayOf: { channelId: string; messageId: string } | null;
  startedBy: string;
  startedAt: number;
  endedBy: string | null;
  endedAt: number | null;
  locationPoll: PollView | null;
  datePoll: PollView | null;
}

/** Where a poll's Discord message is; null until it was posted. */
export interface MessageLocation {
  channelId: string | null;
  messageId: string | null;
}

/** A hike: a completed round with the location and date it decided. */
export interface HikeView {
  roundId: number;
  location: { label: string; details: string | null; proposedBy: string };
  /** `value` is the normalized `YYYY-MM-DD[ HH:MM]`; `label` as shown. */
  date: { value: string; label: string };
  threadId: string | null;
  eventId: string | null;
  /** When the date vote closed and the round completed. */
  completedAt: number;
  locationPoll: MessageLocation;
  datePoll: MessageLocation;
}

/** A location that was the hike of a recent complete round, so it rests. */
export interface RestingLocation {
  label: string;
  key: string;
  /** The hike's date as `parseDateOption` labels it, without the time. */
  hikedOn: string | null;
  /** Complete rounds still to go before it can be proposed again. */
  hikesLeft: number;
}

/** A location proposed in any round, merged by `label_key`. */
export interface PastLocation {
  /** The newest option with this key; its label and details are the latest. */
  optionId: number;
  label: string;
  key: string;
  details: string | null;
  /** Whether the viewer proposed it in any round. */
  proposedByViewer: boolean;
  /** When anyone last proposed it. */
  lastProposedAt: number;
  /** How many complete rounds it was the hike of. */
  timesHiked: number;
  /** Complete rounds still to go before it can be proposed again; 0 when free. */
  cooldownHikesLeft: number;
  /** Whether it is an option of the poll the read was for. */
  onPoll: boolean;
  /** The newest option's place, to copy when it is suggested again. */
  place: OptionPlace | null;
}

export interface PollStoreOptions {
  /** Milliseconds since the epoch. Defaults to `Date.now`. */
  now?: () => number;
  /** Defaults to `crypto.getRandomValues`. */
  random?: RandomSource;
}

type RoundRow = {
  id: number;
  status: RoundStatus;
  location_option_id: number | null;
  date_option_id: number | null;
  thread_id: string | null;
  event_id: string | null;
  day_of_channel_id: string | null;
  day_of_message_id: string | null;
  started_by: string;
  started_at: number;
  ended_by: string | null;
  ended_at: number | null;
};

type PollRow = {
  id: number;
  round_id: number;
  kind: PollKind;
  status: PollStatus;
  channel_id: string | null;
  message_id: string | null;
  winner_option_id: number | null;
  tie_broken: number;
  tied_option_ids: string;
  opened_by: string;
  opened_at: number;
  closed_by: string | null;
  closed_at: number | null;
};

type OptionRow = {
  id: number;
  poll_id: number;
  label: string;
  details: string | null;
  date_value: string | null;
  proposed_by: string;
  created_at: number;
  votes: number;
} & PlaceColumns;

type PlaceColumns = {
  place_lat: number | null;
  place_lon: number | null;
  place_name: string | null;
  place_status: PlaceStatus | null;
  place_attempts: number;
};

type HikeRow = {
  id: number;
  thread_id: string | null;
  event_id: string | null;
  ended_at: number;
  location_label: string;
  location_details: string | null;
  location_proposed_by: string;
  date_value: string;
  date_label: string;
  location_channel_id: string | null;
  location_message_id: string | null;
  date_channel_id: string | null;
  date_message_id: string | null;
};

const ACTIVE = "status NOT IN ('complete', 'cancelled')";

/** Completed rounds joined to their decided options and those options' polls. */
const HIKES = `FROM rounds r
  JOIN poll_options lo ON lo.id = r.location_option_id
  JOIN polls lp ON lp.id = lo.poll_id
  JOIN poll_options dt ON dt.id = r.date_option_id
  JOIN polls dp ON dp.id = dt.poll_id
  WHERE r.status = 'complete'`;

/**
 * Pending location options worth looking up: those of an open poll, and
 * decided locations (a lookup may still be running when the vote closes).
 */
const PENDING_PLACES = `JOIN polls p ON p.id = o.poll_id
  WHERE o.place_status = 'pending'
    AND (p.status = 'open'
      OR EXISTS (SELECT 1 FROM rounds r WHERE r.location_option_id = o.id))`;

/** Case-insensitive, whitespace-collapsed key that makes labels unique. */
export function labelKey(label: string): string {
  return label.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Why a resting location is refused: "**Eagle Peak** was the hike on Sat, 5
 * Dec 2026. It can be suggested again after 2 more hikes."
 */
export function cooldownMessage(resting: RestingLocation): string {
  const when = resting.hikedOn === null ? "" : ` on ${resting.hikedOn}`;
  const left =
    resting.hikesLeft === 1
      ? "1 more hike"
      : `${String(resting.hikesLeft)} more hikes`;
  return `**${resting.label}** was the hike${when}. It can be suggested again after ${left}.`;
}

interface ValidOption {
  label: string;
  key: string;
  details: string | null;
  dateValue: string | null;
  proposedBy: string;
  place: OptionPlace | null;
}

/** A place still to be looked up. */
export const PENDING_PLACE: OptionPlace = {
  status: "pending",
  point: null,
  name: null,
  attempts: 0,
};

function placeOf(row: PlaceColumns): OptionPlace | null {
  if (row.place_status === null) return null;
  return {
    status: row.place_status,
    point:
      row.place_lat === null || row.place_lon === null
        ? null
        : { lat: row.place_lat, lon: row.place_lon },
    name: row.place_name,
    attempts: row.place_attempts,
  };
}

function validateDetails(details: string | null | undefined): string | null {
  const trimmed = details?.trim() ?? "";
  if (trimmed.length > MAX_DETAILS_LENGTH) {
    throw new PollError(
      "invalid_details",
      `Details must be at most ${String(MAX_DETAILS_LENGTH)} characters.`,
    );
  }
  return trimmed === "" ? null : trimmed;
}

function validateLocation(option: NewOption): ValidOption {
  const label = option.label.trim();
  if (label.length < 1 || label.length > MAX_LABEL_LENGTH) {
    throw new PollError(
      "invalid_label",
      `A label must be 1 to ${String(MAX_LABEL_LENGTH)} characters.`,
    );
  }
  return {
    label,
    key: labelKey(label),
    details: validateDetails(option.details),
    dateValue: null,
    proposedBy: option.proposedBy,
    place: option.place ?? PENDING_PLACE,
  };
}

function validateDate(
  line: string,
  proposedBy: string,
  details: string | null = null,
): ValidOption {
  const parsed = parseDateOption(line);
  if (!parsed) {
    throw new PollError(
      "invalid_date",
      `Not a date: "${line.trim()}". Use YYYY-MM-DD or YYYY-MM-DD HH:MM.`,
    );
  }
  return {
    label: parsed.label,
    key: labelKey(parsed.value),
    details,
    dateValue: parsed.value,
    proposedBy,
    place: null,
  };
}

function refuseResting(
  option: ValidOption,
  resting: readonly RestingLocation[],
): void {
  const found = resting.find((r) => r.key === option.key);
  if (found)
    throw new PollError("location_on_cooldown", cooldownMessage(found));
}

/**
 * Which days a member may propose, from `first` to `last`, ending a
 * refusal; with a `window`, those are the round's (`CADENCE_WINDOW_DAYS`
 * after the date vote closes), and they may all have passed.
 */
function proposeDays(first: string, last: string, window: boolean): string {
  if (!window) return `Propose a day from ${first} to ${last}.`;
  return first <= last
    ? `Propose a day from ${first} to ${last}: the ${String(CADENCE_WINDOW_DAYS)} days after the date vote closes.`
    : `This round's dates, up to ${last}, have passed.`;
}

/**
 * Rounds, polls, options and votes in a GuildHike's SQLite storage. Every
 * operation that writes more than one row runs in one `transactionSync`, so
 * a failure leaves nothing behind.
 */
export class PollStore {
  private readonly sql: SqlStorage;
  /** The store's clock, for callers that schedule work relative to it. */
  readonly now: () => number;
  private readonly random: RandomSource;

  constructor(
    private readonly storage: DurableObjectStorage,
    options: PollStoreOptions = {},
  ) {
    this.sql = storage.sql;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? defaultRandom;
  }

  /** Starts a round with an open location poll holding `initialLocations`. */
  startRound(
    userId: string,
    initialLocations: readonly NewOption[] = [],
  ): RoundView {
    const valid = initialLocations.map(validateLocation);
    if (valid.length > MAX_OPTIONS) {
      throw new PollError(
        "too_many_options",
        `A poll has at most ${String(MAX_OPTIONS)} options.`,
      );
    }
    return this.storage.transactionSync(() => {
      if (this.activeRoundRow()) {
        throw new PollError("round_active", "A hike round is already active.");
      }
      const resting = this.restingLocations();
      for (const option of valid) refuseResting(option, resting);
      const at = this.now();
      const roundId = this.insertId(
        `INSERT INTO rounds (status, started_by, started_at)
         VALUES ('location_voting', ?, ?) RETURNING id`,
        userId,
        at,
      );
      const pollId = this.insertPoll(roundId, "location", userId, at);
      for (const option of valid) this.insertOption(pollId, option, at);
      return this.roundView(this.roundRow(roundId), null);
    });
  }

  /**
   * Adds an option to an open poll. On a date poll the label is parsed with
   * `parseDateOption` and stored as its display label.
   */
  addOption(pollId: number, option: NewOption): OptionView {
    return this.storage.transactionSync(() => {
      const poll = this.openPollRow(pollId);
      const valid =
        poll.kind === "date"
          ? validateDate(
              option.label,
              option.proposedBy,
              validateDetails(option.details),
            )
          : validateLocation(option);
      if (this.optionCount(pollId) >= MAX_OPTIONS) {
        throw new PollError(
          "too_many_options",
          `A poll has at most ${String(MAX_OPTIONS)} options.`,
        );
      }
      if (poll.kind === "location") {
        refuseResting(valid, this.restingLocations());
      }
      const id = this.insertOption(pollId, valid, this.now());
      const view = this.optionRows(pollId).find((row) => row.id === id);
      if (!view) throw new Error("addOption: inserted option not found");
      return view;
    });
  }

  /**
   * Adds a member's date to an open date poll, with `userId` as proposer.
   * `line` is `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`; its day must lie between
   * today and `MAX_PROPOSAL_DAYS_AHEAD` days after today in `timeZone`,
   * both included, judged at `this.now()`; with a `window` (`YYYY-MM-DD`
   * days, both included), inside it instead, and never before today.
   * Refuses a date and time already on the poll and a full poll; votes
   * already cast are kept.
   */
  proposeDate(
    pollId: number,
    userId: string,
    line: string,
    timeZone: string,
    window?: { first: string; last: string },
  ): OptionView {
    return this.storage.transactionSync(() => {
      const poll = this.openPollRow(pollId);
      if (poll.kind !== "date") {
        throw new PollError("invalid_state", "This poll does not take dates.");
      }
      const valid = validateDate(line, userId);
      const day = (valid.dateValue ?? "").slice(0, 10);
      const today = todayIn(timeZone, this.now());
      const { first, last } =
        window === undefined
          ? { first: today, last: addDays(today, MAX_PROPOSAL_DAYS_AHEAD) }
          : windowFrom(window, today);
      if (day < today) {
        throw new PollError(
          "date_in_past",
          `${valid.label} is in the past: today is ${today} in ${timeZone}. ${proposeDays(first, last, window !== undefined)}`,
        );
      }
      if (window !== undefined) {
        if (day < first || day > last) {
          throw new PollError(
            "date_outside_window",
            `${valid.label} is outside this round's dates. ${proposeDays(first, last, true)}`,
          );
        }
      } else if (day > last) {
        throw new PollError(
          "date_too_far",
          `${valid.label} is more than ${String(MAX_PROPOSAL_DAYS_AHEAD)} days away. Propose a day from ${today} to ${last}, or ask an admin to plan further ahead.`,
        );
      }
      if (this.optionCount(pollId) >= MAX_OPTIONS) {
        throw new PollError(
          "too_many_options",
          `A poll has at most ${String(MAX_OPTIONS)} options.`,
        );
      }
      const id = this.insertOption(pollId, valid, this.now());
      const view = this.optionRows(pollId).find((row) => row.id === id);
      if (!view) throw new Error("proposeDate: inserted option not found");
      return view;
    });
  }

  /** Replaces `userId`'s votes in the poll with exactly `optionIds`. */
  setVotes(
    pollId: number,
    userId: string,
    optionIds: readonly number[],
  ): PollView {
    return this.storage.transactionSync(() => {
      const poll = this.openPollRow(pollId);
      const known = new Set(this.optionRows(pollId).map((row) => row.id));
      const wanted = [...new Set(optionIds)];
      for (const id of wanted) {
        if (!known.has(id)) {
          throw new PollError(
            "unknown_option",
            "That option is not in this poll.",
          );
        }
      }
      this.sql.exec(
        "DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?",
        pollId,
        userId,
      );
      const at = this.now();
      for (const id of wanted) {
        this.sql.exec(
          `INSERT INTO poll_votes (poll_id, option_id, user_id, voted_at)
           VALUES (?, ?, ?, ?)`,
          pollId,
          id,
          userId,
          at,
        );
      }
      return this.pollView(poll, userId);
    });
  }

  getPoll(pollId: number, viewerId: string | null = null): PollView | null {
    const row = this.pollRow(pollId);
    return row ? this.pollView(row, viewerId) : null;
  }

  getRound(roundId: number, viewerId: string | null = null): RoundView | null {
    const row = this.roundRowOrNull(roundId);
    return row ? this.roundView(row, viewerId) : null;
  }

  /** The round that is neither complete nor cancelled, if any. */
  getActiveRound(viewerId: string | null = null): RoundView | null {
    const row = this.activeRoundRow();
    return row ? this.roundView(row, viewerId) : null;
  }

  /** The most recently started round, whatever its status. */
  getLastRound(viewerId: string | null = null): RoundView | null {
    const row = this.sql
      .exec<RoundRow>("SELECT * FROM rounds ORDER BY id DESC LIMIT 1")
      .toArray()[0];
    return row ? this.roundView(row, viewerId) : null;
  }

  /** The option `optionId` of any poll, or null if there is none. */
  getOption(optionId: number): OptionView | null {
    const row = this.sql
      .exec<{ poll_id: number }>(
        "SELECT poll_id FROM poll_options WHERE id = ?",
        optionId,
      )
      .toArray()[0];
    if (!row) return null;
    return this.optionRows(row.poll_id).find((o) => o.id === optionId) ?? null;
  }

  /**
   * The locations of the `COOLDOWN_HIKES` most recent complete rounds, the
   * newest first. Cancelled rounds do not count, so a location rests until
   * that many more rounds have completed.
   */
  restingLocations(): RestingLocation[] {
    const rows = this.sql
      .exec<{ label: string; label_key: string; date_value: string | null }>(
        `SELECT o.label, o.label_key, d.date_value
         FROM rounds r
         JOIN poll_options o ON o.id = r.location_option_id
         LEFT JOIN poll_options d ON d.id = r.date_option_id
         WHERE r.status = 'complete'
         ORDER BY r.ended_at DESC, r.id DESC LIMIT ?`,
        COOLDOWN_HIKES,
      )
      .toArray();
    const resting: RestingLocation[] = [];
    rows.forEach((row, i) => {
      if (resting.some((r) => r.key === row.label_key)) return;
      resting.push({
        label: row.label,
        key: row.label_key,
        hikedOn:
          row.date_value === null
            ? null
            : (parseDateOption(row.date_value.slice(0, 10))?.label ?? null),
        hikesLeft: COOLDOWN_HIKES - i,
      });
    });
    return resting;
  }

  /**
   * Every location proposed in a location poll of any round, one entry per
   * `label_key` with its newest label and details: the viewer's own first,
   * then everyone else's, each most recently proposed first.
   */
  listPastLocations(viewerId: string, pollId: number): PastLocation[] {
    const rows = this.sql
      .exec<
        {
          id: number;
          poll_id: number;
          label: string;
          label_key: string;
          details: string | null;
          proposed_by: string;
          created_at: number;
        } & PlaceColumns
      >(
        `SELECT o.id, o.poll_id, o.label, o.label_key, o.details,
           o.proposed_by, o.created_at, o.place_lat, o.place_lon,
           o.place_name, o.place_status, o.place_attempts
         FROM poll_options o JOIN polls p ON p.id = o.poll_id
         WHERE p.kind = 'location' ORDER BY o.created_at, o.id`,
      )
      .toArray();
    const hiked = new Map<string, number>();
    for (const { label_key } of this.sql
      .exec<{ label_key: string }>(
        `SELECT o.label_key FROM rounds r
         JOIN poll_options o ON o.id = r.location_option_id
         WHERE r.status = 'complete'`,
      )
      .toArray()) {
      hiked.set(label_key, (hiked.get(label_key) ?? 0) + 1);
    }
    const resting = new Map(
      this.restingLocations().map((r) => [r.key, r.hikesLeft]),
    );
    const byKey = new Map<string, PastLocation>();
    for (const row of rows) {
      const before = byKey.get(row.label_key);
      byKey.set(row.label_key, {
        optionId: row.id,
        label: row.label,
        key: row.label_key,
        details: row.details,
        proposedByViewer:
          (before?.proposedByViewer ?? false) || row.proposed_by === viewerId,
        lastProposedAt: row.created_at,
        timesHiked: hiked.get(row.label_key) ?? 0,
        cooldownHikesLeft: resting.get(row.label_key) ?? 0,
        onPoll: (before?.onPoll ?? false) || row.poll_id === pollId,
        place: placeOf(row),
      });
    }
    return [...byKey.values()].sort(
      (a, b) =>
        Number(b.proposedByViewer) - Number(a.proposedByViewer) ||
        b.lastProposedAt - a.lastProposedAt ||
        b.optionId - a.optionId,
    );
  }

  /**
   * The hikes (completed rounds), newest date first: by the decided date's
   * `date_value`, then by round id, both descending. Skips `offset` hikes
   * and returns at most `limit`; both are non-negative integers.
   */
  listHikes(page: { limit: number; offset: number }): HikeView[] {
    return this.sql
      .exec<HikeRow>(
        `SELECT r.id, r.thread_id, r.event_id, r.ended_at,
           lo.label AS location_label, lo.details AS location_details,
           lo.proposed_by AS location_proposed_by,
           dt.date_value, dt.label AS date_label,
           lp.channel_id AS location_channel_id,
           lp.message_id AS location_message_id,
           dp.channel_id AS date_channel_id, dp.message_id AS date_message_id
         ${HIKES}
         ORDER BY dt.date_value DESC, r.id DESC LIMIT ? OFFSET ?`,
        Math.max(0, Math.trunc(page.limit)),
        Math.max(0, Math.trunc(page.offset)),
      )
      .toArray()
      .map((row) => ({
        roundId: row.id,
        location: {
          label: row.location_label,
          details: row.location_details,
          proposedBy: row.location_proposed_by,
        },
        date: { value: row.date_value, label: row.date_label },
        threadId: row.thread_id,
        eventId: row.event_id,
        completedAt: row.ended_at,
        locationPoll: {
          channelId: row.location_channel_id,
          messageId: row.location_message_id,
        },
        datePoll: {
          channelId: row.date_channel_id,
          messageId: row.date_message_id,
        },
      }));
  }

  /** How many hikes `listHikes` can return in all. */
  countHikes(): number {
    return this.sql.exec<{ n: number }>(`SELECT count(*) AS n ${HIKES}`).one()
      .n;
  }

  /**
   * Closes an open poll, picks its winner (ties drawn uniformly at random)
   * and advances the round: location -> `location_decided`, date ->
   * `complete`.
   */
  closePoll(pollId: number, userId: string): PollView {
    return this.storage.transactionSync(() => {
      const poll = this.openPollRow(pollId);
      const options = this.optionRows(pollId);
      if (options.length === 0) {
        throw new PollError("no_options", "This poll has no options.");
      }
      const round = this.roundRow(poll.round_id);
      const expected =
        poll.kind === "location" ? "location_voting" : "date_voting";
      if (round.status !== expected) {
        throw new PollError("invalid_state", "This round is not voting now.");
      }
      const result = pickWinner(
        options.map((row) => ({ optionId: row.id, votes: row.votes })),
        this.random,
      );
      const at = this.now();
      this.sql.exec(
        `UPDATE polls SET status = 'closed', winner_option_id = ?,
           tie_broken = ?, tied_option_ids = ?, closed_by = ?, closed_at = ?
         WHERE id = ?`,
        result.winnerOptionId,
        result.tieBroken ? 1 : 0,
        JSON.stringify(result.tieBroken ? result.topOptionIds : []),
        userId,
        at,
        pollId,
      );
      if (poll.kind === "location") {
        this.sql.exec(
          `UPDATE rounds SET status = 'location_decided', location_option_id = ?
           WHERE id = ?`,
          result.winnerOptionId,
          round.id,
        );
      } else {
        this.sql.exec(
          `UPDATE rounds SET status = 'complete', date_option_id = ?,
             ended_by = ?, ended_at = ?
           WHERE id = ?`,
          result.winnerOptionId,
          userId,
          at,
          round.id,
        );
      }
      return this.pollView(this.requirePollRow(pollId), null);
    });
  }

  /** Opens the round's date poll; `dates` are `parseDateOption` lines. */
  startDatePoll(
    roundId: number,
    userId: string,
    dates: readonly string[],
  ): PollView {
    const valid = dates.map((line) => validateDate(line, userId));
    const seen = new Set<string>();
    for (const option of valid) {
      if (seen.has(option.key)) {
        throw new PollError(
          "duplicate_option",
          `${option.label} is listed twice.`,
        );
      }
      seen.add(option.key);
    }
    if (valid.length < MIN_DATE_OPTIONS) {
      throw new PollError(
        "too_few_options",
        `A date poll needs at least ${String(MIN_DATE_OPTIONS)} dates.`,
      );
    }
    if (valid.length > MAX_OPTIONS) {
      throw new PollError(
        "too_many_options",
        `A poll has at most ${String(MAX_OPTIONS)} options.`,
      );
    }
    valid.sort((a, b) => ((a.dateValue ?? "") < (b.dateValue ?? "") ? -1 : 1));
    return this.storage.transactionSync(() => {
      const round = this.roundRow(roundId);
      if (round.status !== "location_decided") {
        throw new PollError(
          "invalid_state",
          "The date vote starts once the location is decided.",
        );
      }
      const at = this.now();
      const pollId = this.insertPoll(roundId, "date", userId, at);
      for (const option of valid) this.insertOption(pollId, option, at);
      this.sql.exec(
        "UPDATE rounds SET status = 'date_voting' WHERE id = ?",
        roundId,
      );
      return this.pollView(this.requirePollRow(pollId), null);
    });
  }

  /**
   * Takes back a date poll whose message could not be posted: deletes the
   * open poll with its options and votes and returns the round to
   * `location_decided`, so the admin can start the date vote again.
   */
  withdrawDatePoll(pollId: number): RoundView {
    return this.storage.transactionSync(() => {
      const poll = this.openPollRow(pollId);
      const round = this.roundRow(poll.round_id);
      if (poll.kind !== "date" || round.status !== "date_voting") {
        throw new PollError(
          "invalid_state",
          "Only an open date vote can be withdrawn.",
        );
      }
      this.sql.exec("DELETE FROM poll_votes WHERE poll_id = ?", pollId);
      this.sql.exec("DELETE FROM poll_options WHERE poll_id = ?", pollId);
      this.sql.exec("DELETE FROM polls WHERE id = ?", pollId);
      this.sql.exec(
        "UPDATE rounds SET status = 'location_decided' WHERE id = ?",
        round.id,
      );
      return this.roundView(this.roundRow(round.id), null);
    });
  }

  /**
   * Takes back a round whose location poll message could not be posted:
   * closes the poll without a winner and cancels the round, as `cancelRound`
   * does, but only while the round is `location_voting` with this poll
   * open, so a round another admin cancelled or decided meanwhile is left
   * as it is.
   */
  withdrawLocationRound(pollId: number, userId: string): RoundView {
    return this.storage.transactionSync(() => {
      const poll = this.openPollRow(pollId);
      const round = this.roundRow(poll.round_id);
      if (poll.kind !== "location" || round.status !== "location_voting") {
        throw new PollError(
          "invalid_state",
          "Only a round whose location vote is open can be withdrawn.",
        );
      }
      const at = this.now();
      this.sql.exec(
        `UPDATE polls SET status = 'closed', closed_by = ?, closed_at = ?
         WHERE id = ?`,
        userId,
        at,
        pollId,
      );
      this.sql.exec(
        `UPDATE rounds SET status = 'cancelled', ended_by = ?, ended_at = ?
         WHERE id = ?`,
        userId,
        at,
        round.id,
      );
      return this.roundView(this.roundRow(round.id), null);
    });
  }

  /** Closes any open poll without a winner and cancels the round. */
  cancelRound(roundId: number, userId: string): RoundView {
    return this.storage.transactionSync(() => {
      const round = this.roundRow(roundId);
      if (round.status === "complete" || round.status === "cancelled") {
        throw new PollError("invalid_state", "This round has already ended.");
      }
      const at = this.now();
      this.sql.exec(
        `UPDATE polls SET status = 'closed', closed_by = ?, closed_at = ?
         WHERE round_id = ? AND status = 'open'`,
        userId,
        at,
        roundId,
      );
      this.sql.exec(
        `UPDATE rounds SET status = 'cancelled', ended_by = ?, ended_at = ?
         WHERE id = ?`,
        userId,
        at,
        roundId,
      );
      return this.roundView(this.roundRow(roundId), null);
    });
  }

  setPollMessage(pollId: number, channelId: string, messageId: string): void {
    this.requirePollRow(pollId);
    this.sql.exec(
      "UPDATE polls SET channel_id = ?, message_id = ? WHERE id = ?",
      channelId,
      messageId,
      pollId,
    );
  }

  setRoundThread(roundId: number, threadId: string): void {
    this.roundRow(roundId);
    this.sql.exec(
      "UPDATE rounds SET thread_id = ? WHERE id = ?",
      threadId,
      roundId,
    );
  }

  setRoundEvent(roundId: number, eventId: string): void {
    this.roundRow(roundId);
    this.sql.exec(
      "UPDATE rounds SET event_id = ? WHERE id = ?",
      eventId,
      roundId,
    );
  }

  /** Records where the round's hike-day announcement was posted. */
  setRoundDayOf(roundId: number, channelId: string, messageId: string): void {
    this.roundRow(roundId);
    this.sql.exec(
      "UPDATE rounds SET day_of_channel_id = ?, day_of_message_id = ? WHERE id = ?",
      channelId,
      messageId,
      roundId,
    );
  }

  /**
   * The location option whose place lookup is due by `now`, the longest
   * due first: one of an open poll, or the decided location of a round.
   * Null when none is due.
   */
  nextPendingPlace(now: number): PendingPlace | null {
    const row = this.sql
      .exec<{
        id: number;
        poll_id: number;
        label: string;
        place_attempts: number;
      }>(
        `SELECT o.id, o.poll_id, o.label, o.place_attempts
         FROM poll_options o ${PENDING_PLACES} AND o.place_next_at <= ?
         ORDER BY o.place_next_at, o.id LIMIT 1`,
        now,
      )
      .toArray()[0];
    return row
      ? {
          optionId: row.id,
          pollId: row.poll_id,
          label: row.label,
          attempts: row.place_attempts,
        }
      : null;
  }

  /** When the next place lookup is due, or null when none is waiting. */
  nextPlaceLookupAt(): number | null {
    return this.sql
      .exec<{ at: number | null }>(
        `SELECT min(o.place_next_at) AS at FROM poll_options o ${PENDING_PLACES}`,
      )
      .one().at;
  }

  /**
   * Records a lookup of the option's place made at `this.now()`, if it is
   * still pending (an admin may have set the pin meanwhile): found or not
   * found ends it; an error tries again at `retryAt` until
   * `MAX_PLACE_ATTEMPTS` lookups were made, then marks it `failed`.
   * Returns the place as stored, or null when the option is gone.
   */
  recordPlaceLookup(optionId: number, lookup: PlaceLookup): OptionPlace | null {
    return this.storage.transactionSync(() => {
      const before = this.placeRow(optionId);
      if (before === undefined) return null;
      if (before.place_status !== "pending") return placeOf(before);
      const attempts = before.place_attempts + 1;
      if (lookup.kind === "found") {
        this.writePlace(optionId, {
          status: "found",
          point: lookup.point,
          name: lookup.name,
          attempts,
        });
      } else if (lookup.kind === "not_found") {
        this.writePlace(optionId, {
          status: "not_found",
          point: null,
          name: null,
          attempts,
        });
      } else if (attempts >= MAX_PLACE_ATTEMPTS) {
        this.writePlace(optionId, {
          status: "failed",
          point: null,
          name: null,
          attempts,
        });
      } else {
        this.writePlace(
          optionId,
          { status: "pending", point: null, name: null, attempts },
          lookup.retryAt,
        );
      }
      return placeOf(this.placeRow(optionId) ?? before);
    });
  }

  /**
   * Sets a location option's pin to `point`, as written by an admin
   * (`given`), or clears it with null (`cleared`), ending any pending
   * lookup. Returns the option as stored.
   */
  setOptionPin(optionId: number, point: PlacePoint | null): OptionView {
    const before = this.getOption(optionId);
    if (before === null || this.pollRow(before.pollId)?.kind !== "location") {
      throw new PollError("unknown_option", "That location does not exist.");
    }
    this.writePlace(optionId, {
      status: point === null ? "cleared" : "given",
      point,
      name: null,
      attempts: before.place?.attempts ?? 0,
    });
    return this.getOption(optionId) ?? before;
  }

  private placeRow(optionId: number): PlaceColumns | undefined {
    return this.sql
      .exec<PlaceColumns>(
        `SELECT place_lat, place_lon, place_name, place_status, place_attempts
         FROM poll_options WHERE id = ?`,
        optionId,
      )
      .toArray()[0];
  }

  private writePlace(
    optionId: number,
    place: OptionPlace,
    nextAt: number | null = null,
  ): void {
    this.sql.exec(
      `UPDATE poll_options SET place_lat = ?, place_lon = ?, place_name = ?,
         place_status = ?, place_attempts = ?, place_next_at = ?
       WHERE id = ?`,
      place.point?.lat ?? null,
      place.point?.lon ?? null,
      place.name,
      place.status,
      place.attempts,
      nextAt,
      optionId,
    );
  }

  private insertId(query: string, ...bindings: unknown[]): number {
    return this.sql.exec<{ id: number }>(query, ...bindings).one().id;
  }

  private insertPoll(
    roundId: number,
    kind: PollKind,
    userId: string,
    at: number,
  ): number {
    return this.insertId(
      `INSERT INTO polls (round_id, kind, status, opened_by, opened_at)
       VALUES (?, ?, 'open', ?, ?) RETURNING id`,
      roundId,
      kind,
      userId,
      at,
    );
  }

  private insertOption(pollId: number, option: ValidOption, at: number) {
    const duplicate = this.sql
      .exec(
        "SELECT 1 FROM poll_options WHERE poll_id = ? AND label_key = ?",
        pollId,
        option.key,
      )
      .toArray();
    if (duplicate.length > 0) {
      throw new PollError(
        "duplicate_option",
        `"${option.label}" is already an option.`,
      );
    }
    const { place } = option;
    return this.insertId(
      `INSERT INTO poll_options
         (poll_id, label, label_key, details, date_value, proposed_by, created_at,
          place_lat, place_lon, place_name, place_status, place_attempts,
          place_next_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      pollId,
      option.label,
      option.key,
      option.details,
      option.dateValue,
      option.proposedBy,
      at,
      place?.point?.lat ?? null,
      place?.point?.lon ?? null,
      place?.name ?? null,
      place?.status ?? null,
      place?.attempts ?? 0,
      place?.status === "pending" ? at : null,
    );
  }

  private optionCount(pollId: number): number {
    return this.sql
      .exec<{ n: number }>(
        "SELECT count(*) AS n FROM poll_options WHERE poll_id = ?",
        pollId,
      )
      .one().n;
  }

  private activeRoundRow(): RoundRow | undefined {
    return this.sql
      .exec<RoundRow>(`SELECT * FROM rounds WHERE ${ACTIVE}`)
      .toArray()[0];
  }

  private roundRowOrNull(roundId: number): RoundRow | undefined {
    return this.sql
      .exec<RoundRow>("SELECT * FROM rounds WHERE id = ?", roundId)
      .toArray()[0];
  }

  private roundRow(roundId: number): RoundRow {
    const row = this.roundRowOrNull(roundId);
    if (!row) throw new PollError("round_not_found", "No such round.");
    return row;
  }

  private pollRow(pollId: number): PollRow | undefined {
    return this.sql
      .exec<PollRow>("SELECT * FROM polls WHERE id = ?", pollId)
      .toArray()[0];
  }

  private requirePollRow(pollId: number): PollRow {
    const row = this.pollRow(pollId);
    if (!row) throw new PollError("poll_not_found", "No such poll.");
    return row;
  }

  private openPollRow(pollId: number): PollRow {
    const row = this.requirePollRow(pollId);
    if (row.status !== "open") {
      throw new PollError("poll_closed", "This poll is closed.");
    }
    return row;
  }

  private optionRows(pollId: number): OptionView[] {
    return this.sql
      .exec<OptionRow>(
        `SELECT o.*, (SELECT count(*) FROM poll_votes v WHERE v.option_id = o.id)
           AS votes
         FROM poll_options o WHERE o.poll_id = ?
         ORDER BY o.date_value, o.id`,
        pollId,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        pollId: row.poll_id,
        label: row.label,
        details: row.details,
        dateValue: row.date_value,
        proposedBy: row.proposed_by,
        createdAt: row.created_at,
        votes: row.votes,
        place: placeOf(row),
      }));
  }

  private pollView(row: PollRow, viewerId: string | null): PollView {
    const voterCount = this.sql
      .exec<{ n: number }>(
        "SELECT count(DISTINCT user_id) AS n FROM poll_votes WHERE poll_id = ?",
        row.id,
      )
      .one().n;
    const viewerVotes =
      viewerId === null
        ? []
        : this.sql
            .exec<{ option_id: number }>(
              `SELECT option_id FROM poll_votes
               WHERE poll_id = ? AND user_id = ? ORDER BY option_id`,
              row.id,
              viewerId,
            )
            .toArray()
            .map((vote) => vote.option_id);
    return {
      id: row.id,
      roundId: row.round_id,
      kind: row.kind,
      status: row.status,
      channelId: row.channel_id,
      messageId: row.message_id,
      winnerOptionId: row.winner_option_id,
      tieBroken: row.tie_broken === 1,
      tiedOptionIds: JSON.parse(row.tied_option_ids) as number[],
      openedBy: row.opened_by,
      openedAt: row.opened_at,
      closedBy: row.closed_by,
      closedAt: row.closed_at,
      options: this.optionRows(row.id),
      voterCount,
      viewerVotes,
    };
  }

  private roundView(row: RoundRow, viewerId: string | null): RoundView {
    const polls = this.sql
      .exec<PollRow>("SELECT * FROM polls WHERE round_id = ?", row.id)
      .toArray();
    const view = (kind: PollKind) => {
      const poll = polls.find((p) => p.kind === kind);
      return poll ? this.pollView(poll, viewerId) : null;
    };
    return {
      id: row.id,
      status: row.status,
      locationOptionId: row.location_option_id,
      dateOptionId: row.date_option_id,
      threadId: row.thread_id,
      eventId: row.event_id,
      dayOf:
        row.day_of_channel_id === null || row.day_of_message_id === null
          ? null
          : {
              channelId: row.day_of_channel_id,
              messageId: row.day_of_message_id,
            },
      startedBy: row.started_by,
      startedAt: row.started_at,
      endedBy: row.ended_by,
      endedAt: row.ended_at,
      locationPoll: view("location"),
      datePoll: view("date"),
    };
  }
}
