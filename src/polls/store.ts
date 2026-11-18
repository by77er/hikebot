import { parseDateOption } from "./dates";
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

export interface NewOption {
  label: string;
  details?: string | null;
  proposedBy: string;
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
  startedBy: string;
  startedAt: number;
  endedBy: string | null;
  endedAt: number | null;
  locationPoll: PollView | null;
  datePoll: PollView | null;
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
};

const ACTIVE = "status NOT IN ('complete', 'cancelled')";

/** Case-insensitive, whitespace-collapsed key that makes labels unique. */
export function labelKey(label: string): string {
  return label.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

interface ValidOption {
  label: string;
  key: string;
  details: string | null;
  dateValue: string | null;
  proposedBy: string;
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
  };
}

/**
 * Rounds, polls, options and votes in a GuildHike's SQLite storage. Every
 * operation that writes more than one row runs in one `transactionSync`, so
 * a failure leaves nothing behind.
 */
export class PollStore {
  private readonly sql: SqlStorage;
  private readonly now: () => number;
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
      const id = this.insertOption(pollId, valid, this.now());
      const view = this.optionRows(pollId).find((row) => row.id === id);
      if (!view) throw new Error("addOption: inserted option not found");
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
    return this.insertId(
      `INSERT INTO poll_options
         (poll_id, label, label_key, details, date_value, proposed_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      pollId,
      option.label,
      option.key,
      option.details,
      option.dateValue,
      option.proposedBy,
      at,
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
         FROM poll_options o WHERE o.poll_id = ? ORDER BY o.id`,
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
      startedBy: row.started_by,
      startedAt: row.started_at,
      endedBy: row.ended_by,
      endedAt: row.ended_at,
      locationPoll: view("location"),
      datePoll: view("date"),
    };
  }
}
