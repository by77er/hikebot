/**
 * The weekly schedule's state and its decisions, shared by the job that
 * acts on it (`cadence.ts`) and the admin panel, which shows what happens
 * next and reschedules the job when an admin changes a setting. Everything
 * here reads the round as it is stored: the job is driven by state, so an
 * admin's manual action between two runs is simply what the next run finds.
 */
import {
  GuildConfig,
  type CadenceSettings,
  type GuildSettings,
} from "../guild/config";
import { schedule, unschedule } from "../guild/schedule";
import {
  HIKE_DURATION_HOURS,
  cadenceDateVoteClose,
  cadenceWindow,
  hikeStart,
  nextCadenceInstant,
  nextDailyInstant,
  previousCadenceInstant,
} from "../polls/dates";
import type { PollStore, PollView, RoundView } from "../polls/store";

/** The job that opens and closes the votes on the schedule. */
export const CADENCE_JOB = "cadence:tick";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a location vote must have been open before the job closes it. */
export const LOCATION_VOTE_MIN_OPEN_MS = 6 * DAY_MS;

/**
 * A date vote nobody voted on is cancelled once its earliest candidate is
 * less than this far away.
 */
export const QUIET_DATE_VOTE_CANCEL_MS = DAY_MS;

const STATE_KEY = "cadence";

/** What the job keeps between runs, in the object's key-value storage. */
export interface CadenceState {
  /** The guild the object serves, recorded when an admin sets the schedule. */
  guildId: string | null;
  /** The last cadence instant handled (or skipped), in milliseconds. */
  lastInstant: number;
  /** The date vote whose "nobody has voted" notice was posted. */
  quietDatePollId: number | null;
}

export function readCadenceState(storage: DurableObjectStorage): CadenceState {
  return (
    storage.kv.get<CadenceState>(STATE_KEY) ?? {
      guildId: null,
      lastInstant: 0,
      quietDatePollId: null,
    }
  );
}

export function writeCadenceState(
  storage: DurableObjectStorage,
  state: CadenceState,
): void {
  storage.kv.put<CadenceState>(STATE_KEY, state);
}

/** What the guild holds that the schedule acts on, read at one time. */
export interface CadenceSnapshot {
  /** The active round, if any. */
  round: RoundView | null;
  /**
   * The active round's open date vote, if it was opened while the schedule
   * was on, so the schedule closes it; null for one opened before.
   */
  dateVote: PollView | null;
  /** When the newest planned hike ends, null when there is none. */
  hikeEnd: number | null;
}

export function cadenceSnapshot(
  store: PollStore,
  settings: GuildSettings,
): CadenceSnapshot {
  const [hike] = store.listHikes({ limit: 1, offset: 0 });
  const round = store.getActiveRound();
  const dateVote = openDateVote(round);
  return {
    round,
    dateVote:
      dateVote !== null && isScheduledDateVote(dateVote, settings)
        ? dateVote
        : null,
    hikeEnd:
      hike === undefined
        ? null
        : hikeStart(hike.date.value, settings.timezone) +
          HIKE_DURATION_HOURS * 3_600_000,
  };
}

/** The round's open date vote, if it has one. */
export function openDateVote(round: RoundView | null): PollView | null {
  const poll = round?.datePoll ?? null;
  return round?.status === "date_voting" && poll?.status === "open"
    ? poll
    : null;
}

/**
 * Whether the schedule closes the date vote `poll`: it opened while the
 * schedule was on. One opened before is the admins' to close.
 */
function isScheduledDateVote(poll: PollView, settings: GuildSettings): boolean {
  const since = settings.cadence.onSince;
  return settings.cadence.enabled && since !== null && poll.openedAt >= since;
}

/** When the date vote `poll` is due to close on the guild's schedule. */
export function plannedDateVoteClose(
  poll: PollView,
  settings: GuildSettings,
): number {
  return cadenceDateVoteClose(
    poll.openedAt,
    settings.cadence.time,
    settings.cadence.dateVoteDays,
    settings.timezone,
  );
}

/**
 * When the job next tries to close the date vote `poll` after `now`: its
 * planned close, or, once that has passed (nobody voted), the cadence time
 * on each following day.
 */
export function nextDateVoteAttempt(
  poll: PollView,
  settings: GuildSettings,
  now: number,
): number {
  const planned = plannedDateVoteClose(poll, settings);
  return planned > now
    ? planned
    : nextDailyInstant(settings.cadence.time, settings.timezone, now);
}

/** The last cadence instant at or before `now`. */
export function previousInstant(settings: GuildSettings, now: number): number {
  return previousCadenceInstant(settings.cadence, settings.timezone, now);
}

/**
 * The days members may propose for the date vote `poll` when the schedule
 * closes it (`cadenceWindow` after its planned close); null while the
 * schedule is off or for a vote opened before it was turned on.
 */
export function cadenceDateWindow(
  poll: PollView,
  settings: GuildSettings,
): { first: string; last: string } | null {
  if (!isScheduledDateVote(poll, settings)) return null;
  return cadenceWindow(plannedDateVoteClose(poll, settings), settings.timezone);
}

/** When the job runs next after `now`, while the schedule is on. */
export function nextCadenceRun(
  settings: GuildSettings,
  snapshot: CadenceSnapshot,
  now: number,
): number {
  const instant = nextCadenceInstant(settings.cadence, settings.timezone, now);
  const poll = snapshot.dateVote;
  return poll === null
    ? instant
    : Math.min(instant, nextDateVoteAttempt(poll, settings, now));
}

/** The one step the job takes in a run. */
export type CadenceStep =
  | { kind: "close-date-vote"; poll: PollView }
  | { kind: "hold-date-vote"; poll: PollView }
  | { kind: "cancel-quiet-round"; round: RoundView }
  | { kind: "close-location-vote"; poll: PollView }
  | { kind: "hold-location-vote"; poll: PollView }
  | { kind: "start-date-vote"; round: RoundView }
  | { kind: "start-location-vote" }
  | { kind: "none" };

/**
 * The step the job takes at `now`, `onInstant` when a cadence instant not
 * yet handled has come. A date vote opened while the schedule was on and
 * past its planned close is handled on any run (one opened before is left
 * to the admins): closed when anyone voted, cancelled with its round when nobody
 * did and its earliest candidate is less than a day away, held otherwise.
 * On a cadence instant: a location vote open for at least
 * `LOCATION_VOTE_MIN_OPEN_MS` is closed, or held when it has no options or
 * no votes; a decided location gets its date vote; with no active round
 * and no planned hike still ahead, a location vote starts.
 */
export function cadenceStep(
  settings: GuildSettings,
  snapshot: CadenceSnapshot,
  now: number,
  onInstant: boolean,
): CadenceStep {
  const { round, dateVote } = snapshot;
  if (round !== null && dateVote !== null) {
    if (plannedDateVoteClose(dateVote, settings) > now) return { kind: "none" };
    if (dateVote.voterCount > 0) {
      return { kind: "close-date-vote", poll: dateVote };
    }
    const earliest = Math.min(
      ...dateVote.options.map((option) =>
        hikeStart(option.dateValue ?? "", settings.timezone),
      ),
    );
    return earliest - now < QUIET_DATE_VOTE_CANCEL_MS
      ? { kind: "cancel-quiet-round", round }
      : { kind: "hold-date-vote", poll: dateVote };
  }
  if (!onInstant) return { kind: "none" };
  if (round === null) {
    return snapshot.hikeEnd !== null && snapshot.hikeEnd > now
      ? { kind: "none" }
      : { kind: "start-location-vote" };
  }
  if (round.status === "location_decided") {
    return { kind: "start-date-vote", round };
  }
  const poll = round.locationPoll;
  if (round.status !== "location_voting" || poll?.status !== "open") {
    return { kind: "none" };
  }
  if (now - poll.openedAt < LOCATION_VOTE_MIN_OPEN_MS) return { kind: "none" };
  return poll.options.length === 0 || poll.voterCount === 0
    ? { kind: "hold-location-vote", poll }
    : { kind: "close-location-vote", poll };
}

/** What the schedule does next, for the panel. */
export interface CadenceAction {
  at: number;
  /** What happens, as a sentence without its time: `Opens the date vote`. */
  what: string;
}

const WHAT: Record<Exclude<CadenceStep["kind"], "none">, string> = {
  "close-date-vote": "Closes the date vote",
  "hold-date-vote": "Closes the date vote if anyone has voted",
  "cancel-quiet-round":
    "Closes the date vote if anyone has voted, or cancels the round",
  "close-location-vote": "Closes the location vote and opens the date vote",
  "hold-location-vote":
    "Closes the location vote and opens the date vote, if anyone has voted",
  "start-date-vote": "Opens the date vote",
  "start-location-vote": "Opens a location vote",
};

/** How many cadence instants ahead the panel looks for the next action. */
const LOOKAHEAD_WEEKS = 8;

/**
 * The next thing the schedule does after `now` with the guild as it is,
 * found by asking `cadenceStep` at each coming run; null when it does
 * nothing in the next `LOOKAHEAD_WEEKS` weeks.
 */
export function nextCadenceAction(
  settings: GuildSettings,
  snapshot: CadenceSnapshot,
  now: number,
): CadenceAction | null {
  const poll = snapshot.dateVote;
  if (poll !== null) {
    const at = nextDateVoteAttempt(poll, settings, now);
    const step = cadenceStep(settings, snapshot, at, false);
    return {
      at,
      what: step.kind === "none" ? WHAT["close-date-vote"] : WHAT[step.kind],
    };
  }
  let at = now;
  for (let i = 0; i < LOOKAHEAD_WEEKS; i++) {
    at = nextCadenceInstant(settings.cadence, settings.timezone, at);
    const step = cadenceStep(settings, snapshot, at, true);
    if (step.kind !== "none") return { at, what: WHAT[step.kind] };
  }
  return null;
}

/**
 * Marks every cadence instant up to `now` as handled, so a schedule just
 * turned on or moved acts from its next instant on, not on one that has
 * just passed. Records the guild's id for the job.
 */
export function markCadenceStart(
  storage: DurableObjectStorage,
  cadence: CadenceSettings,
  timeZone: string,
  guildId: string,
  now: number,
): void {
  const state = readCadenceState(storage);
  writeCadenceState(storage, {
    ...state,
    guildId,
    lastInstant: Math.max(
      state.lastInstant,
      previousCadenceInstant(cadence, timeZone, now),
    ),
  });
}

/**
 * Schedules the job's next run after `now` for the guild as it is stored,
 * keeping an earlier run already scheduled. Does nothing while the schedule
 * is off.
 */
export async function scheduleCadence(
  storage: DurableObjectStorage,
  store: PollStore,
  settings: GuildSettings,
  now: number,
): Promise<void> {
  if (!settings.cadence.enabled) return;
  await schedule(
    storage,
    CADENCE_JOB,
    nextCadenceRun(settings, cadenceSnapshot(store, settings), now),
  );
}

/**
 * Sets the job's next run after `now` for the guild as it is stored,
 * replacing any run already scheduled, while the schedule is on.
 */
export async function replaceCadenceRun(
  storage: DurableObjectStorage,
  store: PollStore,
  settings: GuildSettings,
  now: number,
): Promise<void> {
  await unschedule(storage, CADENCE_JOB);
  await scheduleCadence(storage, store, settings, now);
}

/**
 * Stores an admin's change to the schedule, `change`, which the caller has
 * checked, and reschedules the job from it. Turning the schedule on records
 * the store's time as `onSince`; turning it off clears it.
 */
export async function changeCadence(
  storage: DurableObjectStorage,
  store: PollStore,
  change: Partial<Omit<CadenceSettings, "onSince">>,
  guildId: string,
): Promise<GuildSettings> {
  const config = new GuildConfig(storage);
  const turnedOn = change.enabled === true && !config.get().cadence.enabled;
  const settings = config.setCadence({
    ...change,
    ...(turnedOn ? { onSince: store.now() } : {}),
    ...(change.enabled === false ? { onSince: null } : {}),
  });
  await rescheduleCadence(storage, store, settings, guildId);
  return settings;
}

/**
 * After a schedule setting or the time zone changed: drops the job's run,
 * and, while the schedule is on, marks the instants up to now as handled
 * and schedules the next run from the new settings.
 */
export async function rescheduleCadence(
  storage: DurableObjectStorage,
  store: PollStore,
  settings: GuildSettings,
  guildId: string,
): Promise<void> {
  await unschedule(storage, CADENCE_JOB);
  if (!settings.cadence.enabled) return;
  const now = store.now();
  markCadenceStart(storage, settings.cadence, settings.timezone, guildId, now);
  await scheduleCadence(storage, store, settings, now);
}

/** A Discord timestamp of `at`: `<t:1796497200:F>`, shown in each reader's zone. */
export function discordTime(at: number, style: "F" | "R" = "F"): string {
  return `<t:${String(Math.floor(at / 1000))}:${style}>`;
}
