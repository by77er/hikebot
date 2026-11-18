/**
 * The hike-day announcement: on the morning of a planned hike, the
 * `hike:day-of` job posts one message in the announcements channel that
 * points to everything about it: where and when, the location's details,
 * the hike thread, the Discord event and the calendar address. The date
 * vote's close step plans it and schedules the job; the job posts each
 * announcement that is due and schedules itself for the next one. It is
 * posted at most once per round: a cut-off or failed post shows on the
 * admin panel with **Post hike-day announcement**
 * (`hb:hike-day:post:<round id>`, `retryHikeDay` in `round-actions.ts`).
 */
import type {
  APIMessageComponentInteraction,
  APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { calendarAddress } from "../calendar/address";
import { discordApi, eventUrl } from "../discord/api";
import {
  container,
  messageBody,
  parseCustomId,
  textDisplay,
} from "../discord/components";
import { GuildConfig } from "../guild/config";
import { adminOnly } from "../guild/permissions";
import type {
  ComponentHandler,
  HandlerContext,
  JobHandler,
  Router,
} from "../guild/router";
import { schedule } from "../guild/schedule";
import { DEFAULT_HIKE_TIME, hikeStart } from "../polls/dates";
import { PollStore, type OptionView, type RoundView } from "../polls/store";
import { POLL_CONTROL_IDS } from "./admin-panel";
import {
  claimHikeDay,
  clearHikeDay,
  hikeDayHours,
  hikeDayRecords,
  planHikeDay,
  recordHikeDayFailure,
} from "./hike-day-state";
import {
  actorOf,
  answerPanel,
  errorText,
  roundContext,
  type CloseStep,
} from "./poll-ui";
import { retryHikeDay } from "./round-actions";

/** The job that posts the hike-day announcements that are due. */
export const HIKE_DAY_JOB = "hike:day-of";

/**
 * How long after the close a hike decided on its own day, past the
 * announcement time, is announced: long enough for the close flow's own
 * announcement to go first.
 */
export const HIKE_DAY_AFTER_CLOSE_MS = 5_000;

export const HIKE_DAY_IDS = {
  post: POLL_CONTROL_IDS.postHikeDay,
} as const;

/** Everything a section of the announcement can draw on. */
export interface HikeDay {
  guildId: string;
  /** The server's time zone, which the start is written in. */
  timeZone: string;
  location: OptionView;
  date: OptionView;
  /** The start, in milliseconds since the epoch. */
  start: number;
  threadId: string | null;
  eventId: string | null;
  /** The guild's calendar feed address. */
  calendar: string;
}

/** One part of the announcement: its lines, none to leave it out. */
export type HikeDaySection = (day: HikeDay) => string[];

/**
 * The announcement's sections, in order. A new section (map links, the
 * forecast) is one more function here.
 */
export const HIKE_DAY_SECTIONS: readonly HikeDaySection[] = [
  ({ location }) => [`## Hike today: ${location.label}`],
  ({ date, start, timeZone }) => {
    const at = String(Math.floor(start / 1000));
    const time = date.dateValue?.slice(11) || DEFAULT_HIKE_TIME;
    return [
      `**Starts:** ${time} (${timeZone}), <t:${at}:t> in your time zone, <t:${at}:R>`,
    ];
  },
  ({ location }) => (location.details ? [location.details] : []),
  ({ threadId }) =>
    threadId === null ? [] : [`**Hike thread:** <#${threadId}>`],
  ({ guildId, eventId }) =>
    eventId === null
      ? []
      : [`**Discord event:** ${eventUrl(guildId, eventId)}`],
  ({ calendar }) => [`**Calendar:** ${calendar}`],
  ({ threadId }) =>
    threadId === null
      ? []
      : [`Coming? Say so in <#${threadId}>, so the group knows who to expect.`],
];

/** The announcement, made of `sections` in order. */
export function renderHikeDay(
  day: HikeDay,
  sections: readonly HikeDaySection[] = HIKE_DAY_SECTIONS,
): APIMessageTopLevelComponent[] {
  return [
    container([
      textDisplay(sections.flatMap((section) => section(day)).join("\n")),
    ]),
  ];
}

/** The round's decided location or date, if any. */
function decided(
  round: RoundView,
  kind: "locationPoll" | "datePoll",
): OptionView | null {
  const id =
    kind === "locationPoll" ? round.locationOptionId : round.dateOptionId;
  return round[kind]?.options.find((option) => option.id === id) ?? null;
}

/**
 * What the announcement of `round` draws on, or null when the round has no
 * decided location and date.
 */
export function hikeDayOf(
  round: RoundView,
  guildId: string,
  timeZone: string,
  calendar: string,
): HikeDay | null {
  const location = decided(round, "locationPoll");
  const date = decided(round, "datePoll");
  const start =
    date?.dateValue == null ? NaN : hikeStart(date.dateValue, timeZone);
  if (location === null || date === null || Number.isNaN(start)) return null;
  return {
    guildId,
    timeZone,
    location,
    date,
    start,
    threadId: round.threadId,
    eventId: round.eventId,
    calendar,
  };
}

/** What posting the announcement came to. */
export type Posted =
  { ok: true; channelId: string } | { ok: false; reason: string };

const RETRY = "click Post hike-day announcement";

/**
 * Posts the announcement of round `roundId`, read again so it has the
 * latest thread and event, in the announcements channel and records where
 * on the round; on failure records why, for the panel. The caller has
 * claimed it with `claimHikeDay`.
 */
export async function postHikeDay(
  roundId: number,
  guildId: string,
  context: HandlerContext,
): Promise<Posted> {
  const store = new PollStore(context.storage);
  const settings = new GuildConfig(context.storage).get();
  const round = store.getRound(roundId);
  const fail = (reason: string): Posted => {
    recordHikeDayFailure(context.storage, roundId, guildId, reason);
    return { ok: false, reason };
  };
  const channelId = settings.announceChannelId;
  if (channelId === null) {
    return fail(
      `No announcements channel is set, so the hike-day announcement was not posted. Pick one under Settings, then ${RETRY}.`,
    );
  }
  const day =
    round &&
    hikeDayOf(
      round,
      guildId,
      settings.timezone,
      await calendarAddress(context.env, guildId),
    );
  if (!day) {
    return fail(
      "The hike has no decided location and date, so there is nothing to announce.",
    );
  }
  try {
    const message = await discordApi(context.env).createMessage(
      channelId,
      messageBody(renderHikeDay(day)),
    );
    store.setRoundDayOf(roundId, channelId, message.id);
    clearHikeDay(context.storage, roundId);
    return { ok: true, channelId };
  } catch (error) {
    return fail(
      `Could not post the hike-day announcement in <#${channelId}>: ${errorText(error)}. Check that the bot can post there, then ${RETRY}.`,
    );
  }
}

/**
 * The `hike:day-of` job: for every planned announcement, by the server's
 * time zone now, forgets it when its round is no longer a completed hike,
 * was announced or its hike is over; posts it once its time has come,
 * after claiming it; and leaves one that was tried before (being posted,
 * cut off or failed) to the panel. Then schedules itself for the earliest
 * announcement still ahead.
 */
export const postDueHikeDays: JobHandler = async (context) => {
  const { storage } = context;
  const store = new PollStore(storage);
  const timeZone = new GuildConfig(storage).get().timezone;
  let next = Infinity;
  for (const [roundId, record] of hikeDayRecords(storage)) {
    const now = store.now();
    const round = store.getRound(roundId);
    const hours = round && hikeDayHours(round, timeZone);
    if (
      !round ||
      !hours ||
      round.status !== "complete" ||
      round.dayOf !== null ||
      !(hours.end > now)
    ) {
      clearHikeDay(storage, roundId);
      continue;
    }
    if (record.postingSince !== undefined || record.error !== undefined) {
      continue;
    }
    if (hours.at > now) {
      next = Math.min(next, hours.at);
      continue;
    }
    if (claimHikeDay(storage, round, record.guildId, now)) {
      await postHikeDay(roundId, record.guildId, context);
    }
  }
  if (next !== Infinity) await schedule(storage, HIKE_DAY_JOB, next);
};

/**
 * The date vote's close step: plans the hike's announcement and schedules
 * the job for its time, or a few seconds after the close when that time
 * has passed. A hike that has started gets none.
 */
export const planHikeDayStep: CloseStep = {
  name: "plan the hike-day announcement",
  run: async ({ round, guildId, timeZone }, context) => {
    const store = new PollStore(context.storage);
    const current = round === null ? null : store.getRound(round.id);
    const hours = current && hikeDayHours(current, timeZone);
    const now = store.now();
    if (!current || !hours || !(hours.start > now)) return {};
    planHikeDay(context.storage, current.id, guildId);
    await schedule(
      context.storage,
      HIKE_DAY_JOB,
      Math.max(hours.at, now + HIKE_DAY_AFTER_CLOSE_MS),
    );
    return {};
  },
};

/**
 * Post hike-day announcement: posts the last round's announcement again
 * with `retryHikeDay`, which claims it before the answer.
 */
const postAgain: ComponentHandler = adminOnly(
  (interaction: APIMessageComponentInteraction, context) =>
    answerPanel(
      interaction,
      context,
      retryHikeDay(roundContext(interaction, context), actorOf(interaction), {
        roundId: Number(parseCustomId(interaction.data.custom_id)?.arg),
      }),
    ),
);

/** Registers the job and the Post hike-day announcement button. */
export function registerHikeDay(router: Router): Router {
  router.job(HIKE_DAY_JOB, postDueHikeDays);
  router.component("hb:hike-day:post", postAgain);
  return router;
}
