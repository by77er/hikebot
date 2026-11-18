/**
 * The weekly schedule (the cadence): with it on, the `cadence:tick` job
 * opens and closes the votes by itself on the guild's weekday and time. Each
 * run reads the settings and the round as stored, schedules its own next
 * run first, then takes at most one step (`cadenceStep` in
 * `cadence-state.ts`) through the same round actions the panel uses, with
 * the application's id as the actor, so messages name hikebot. The admin
 * panel's Schedule settings turn it on and off (`admin-panel.ts`).
 */
import { discordApi } from "../discord/api";
import { container, messageBody, textDisplay } from "../discord/components";
import { GuildConfig, type GuildSettings } from "../guild/config";
import type { HandlerContext, JobHandler, Router } from "../guild/router";
import { nextCadenceInstant } from "../polls/dates";
import { PollStore, type PollView, type RoundView } from "../polls/store";
import {
  CADENCE_JOB,
  cadenceSnapshot,
  cadenceStep,
  discordTime,
  previousInstant,
  readCadenceState,
  replaceCadenceRun,
  scheduleCadence,
  writeCadenceState,
  type CadenceStep,
} from "./cadence-state";
import { decidedLocation } from "./date-vote";
import {
  cancelRound,
  closeVote,
  startDateVote,
  startLocationVote,
  type ActionOutcome,
  type RoundContext,
} from "./round-actions";

/**
 * The job: schedules the next run, then takes the step the guild's state
 * calls for, then sets the next run again from the state the step left. A
 * step that throws leaves the first next run scheduled.
 */
export const cadenceTick: JobHandler = async (context) => {
  const { storage } = context;
  const store = new PollStore(storage);
  const settings = new GuildConfig(storage).get();
  if (!settings.cadence.enabled) return;
  const now = store.now();
  await scheduleCadence(storage, store, settings, now);
  const state = readCadenceState(storage);
  if (state.guildId === null) {
    console.error("cadence: no guild id recorded; turn the schedule on again");
    return;
  }
  const instant = previousInstant(settings, now);
  const onInstant = instant > state.lastInstant;
  if (onInstant) writeCadenceState(storage, { ...state, lastInstant: instant });
  const step = cadenceStep(
    settings,
    cadenceSnapshot(store, settings),
    now,
    onInstant,
  );
  const round: RoundContext = { ...context, guildId: state.guildId, store };
  await takeStep(step, round, settings, now);
  // The step changed the round: run next for the round as it is now.
  await replaceCadenceRun(storage, store, settings, now);
};

/** Does `step` through the round actions, as the application. */
async function takeStep(
  step: CadenceStep,
  context: RoundContext,
  settings: GuildSettings,
  now: number,
): Promise<void> {
  const app = context.env.DISCORD_APPLICATION_ID;
  switch (step.kind) {
    case "none":
      return;
    case "close-date-vote":
      await run(
        "close the date vote",
        await closeVote(context, app, { pollId: step.poll.id }),
      );
      return;
    case "hold-date-vote":
      await holdDateVote(context, step.poll, settings);
      return;
    case "cancel-quiet-round":
      await cancelQuietRound(context, step.round, settings, now);
      return;
    case "close-location-vote":
      await run(
        "close the location vote",
        await closeVote(context, app, { pollId: step.poll.id }),
      );
      await run("open the date vote", startDateVote(context, app));
      return;
    case "hold-location-vote":
      await announce(context, holdLocationNotice(step.poll, settings, now));
      return;
    case "start-date-vote":
      await run("open the date vote", startDateVote(context, app));
      return;
    case "start-location-vote":
      await run(
        "open a location vote",
        startLocationVote(context, app, { labels: [] }),
      );
      return;
  }
}

/** Runs a done action's work and logs its notes; logs a refusal. */
async function run(
  what: string,
  outcome: ActionOutcome<string, object>,
): Promise<void> {
  if (!outcome.ok) {
    console.error(`cadence: could not ${what}: ${outcome.message}`);
    return;
  }
  for (const note of await outcome.work()) console.log(`cadence: ${note}`);
}

/**
 * Posts one notice that the date vote stays open, the first time it is
 * held; later holds post nothing.
 */
async function holdDateVote(
  context: RoundContext,
  poll: PollView,
  settings: GuildSettings,
): Promise<void> {
  const state = readCadenceState(context.storage);
  if (state.quietDatePollId === poll.id) return;
  writeCadenceState(context.storage, { ...state, quietDatePollId: poll.id });
  await announce(
    context,
    [
      "**The date vote stays open.**",
      `Nobody has voted on a date yet, so hikebot did not close it. Vote in ${channelOf(poll, settings)}: hikebot closes it at ${settings.cadence.time} (${settings.timezone}) on the first day someone has voted, and cancels the round if nobody has voted by the day before the earliest date.`,
    ].join("\n"),
  );
}

/** Cancels the round nobody voted a date for, and says so. */
async function cancelQuietRound(
  context: RoundContext,
  round: RoundView,
  settings: GuildSettings,
  now: number,
): Promise<void> {
  const app = context.env.DISCORD_APPLICATION_ID;
  const cancelled = cancelRound(context, app, { roundId: round.id });
  await run("cancel the round", cancelled);
  if (!cancelled.ok) return;
  const where = decidedLocation(round)?.label;
  const next = nextCadenceInstant(settings.cadence, settings.timezone, now);
  await announce(
    context,
    [
      "**This round is cancelled.**",
      `Nobody voted on a date${where === undefined ? "" : ` for **${where}**`}, so hikebot cancelled the round. A new location vote opens ${discordTime(next)}.`,
    ].join("\n"),
  );
}

function holdLocationNotice(
  poll: PollView,
  settings: GuildSettings,
  now: number,
): string {
  const why =
    poll.options.length === 0
      ? "Nobody has proposed a location yet"
      : "Nobody has voted yet";
  const next = nextCadenceInstant(settings.cadence, settings.timezone, now);
  return [
    "**The location vote stays open another week.**",
    `${why}, so hikebot did not close it. Propose a location or vote in ${channelOf(poll, settings)}; hikebot tries again ${discordTime(next)}.`,
  ].join("\n");
}

function channelOf(poll: PollView, settings: GuildSettings): string {
  const channelId = poll.channelId ?? settings.voteChannelId;
  return channelId === null ? "the voting channel" : `<#${channelId}>`;
}

/** Posts `text` in the announcements channel, if one is set. */
async function announce(context: HandlerContext, text: string): Promise<void> {
  const channelId = new GuildConfig(context.storage).get().announceChannelId;
  if (channelId === null) {
    console.error("cadence: no announcements channel is set for a notice");
    return;
  }
  await discordApi(context.env).createMessage(
    channelId,
    messageBody([container([textDisplay(text)])]),
  );
}

/** Registers the schedule's job. */
export function registerCadence(router: Router): Router {
  router.job(CADENCE_JOB, cadenceTick);
  return router;
}
