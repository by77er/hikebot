/**
 * The hike's Discord scheduled event: when the date vote closes, a close
 * step after the thread's creates an EXTERNAL event for the hike, so
 * members can click Interested and get Discord's reminder, links it from
 * the thread's first message and hands the announcement its link. If
 * Discord refuses, the panel shows why and offers **Create hike event**
 * (`hb:event:create:<round id>`, `retryHikeEvent` in `round-actions.ts`)
 * until the last completed round has its event; a retry never posts the
 * announcement again and never creates a second event. A hike whose start
 * has passed gets no event.
 */
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  type APIMessageComponentInteraction,
  type RESTPostAPIGuildScheduledEventJSONBody,
} from "discord-api-types/v10";
import { DiscordApiError, discordApi, eventUrl } from "../discord/api";
import { parseCustomId } from "../discord/components";
import { adminOnly } from "../guild/permissions";
import type { ComponentHandler, HandlerContext, Router } from "../guild/router";
import type { Point } from "../geo/coordinates";
import { googleLink, osmLink } from "../geo/links";
import { HIKE_DURATION_HOURS } from "../polls/dates";
import { PollStore, type RoundView } from "../polls/store";
import { POLL_CONTROL_IDS } from "./admin-panel";
import {
  claimHikeEvent,
  clearHikeEventAttempt,
  recordHikeEventFailure,
  roundStart,
} from "./hike-event-state";
import { editThreadMessage } from "./hike-thread";
import type { MapPinHook } from "./map-pin";
import {
  actorOf,
  answerPanel,
  errorText,
  roundContext,
  shorten,
  type CloseStep,
} from "./poll-ui";
import { retryHikeEvent } from "./round-actions";
import { noteShown, weatherTexts } from "./weather-state";

/** Discord's limits on a scheduled event's name, description and location. */
export const MAX_EVENT_NAME = 100;
export const MAX_EVENT_DESCRIPTION = 1000;
export const MAX_EVENT_LOCATION = 100;

const HOUR_MS = 60 * 60 * 1000;

/** Discord's error codes the panel explains in its own words. */
const MISSING_PERMISSIONS = 50013;
const MAX_SCHEDULED_EVENTS = 30038;

export const HIKE_EVENT_IDS = {
  create: POLL_CONTROL_IDS.createHikeEvent,
} as const;

export const START_PASSED_MESSAGE =
  "The hike's start time has passed, so no event was created.";

/** The request for a round's event, or why none is made. */
export type HikeEventRequest =
  | { ok: true; body: RESTPostAPIGuildScheduledEventJSONBody }
  | { ok: false; why: "past" | "undecided" };

/** Where the event's location is, for its description. */
export interface EventPlace {
  point: Point;
  name: string | null;
}

/**
 * The place part of the description: the place name, both map links as
 * plain URLs and OpenStreetMap's attribution.
 */
function placeText({ point, name }: EventPlace): string {
  return [
    ...(name ? [`📍 ${name}`] : []),
    `OpenStreetMap: ${osmLink(point)}`,
    `Google Maps: ${googleLink(point)}`,
    "© OpenStreetMap contributors",
  ].join("\n");
}

/**
 * The event's description: the location's details, where it is on the map
 * when it has a pin, the compact `weather` (`weatherTexts`) when there is
 * one, then the link to the hike thread when there is one, within
 * Discord's 1000 characters; the details are shortened, the map links,
 * the weather and the thread link kept whole. Empty when there is none of
 * them.
 */
export function eventDescription(
  details: string | null,
  threadLink: string | null,
  place: EventPlace | null = null,
  weather: string | null = null,
): string {
  const link = threadLink === null ? "" : `Hike thread: ${threadLink}`;
  const where = place === null ? "" : placeText(place);
  const kept = [where, weather ?? "", link].filter((part) => part !== "");
  const room =
    MAX_EVENT_DESCRIPTION -
    kept.reduce((sum, part) => sum + part.length + 2, 0);
  return [shorten(details ?? "", room), ...kept]
    .filter((part) => part !== "")
    .join("\n\n");
}

/**
 * The description of `round`'s event, from its decided location and its
 * `weather`.
 */
export function hikeEventDescription(
  round: RoundView,
  guildId: string,
  weather: string | null = null,
): string {
  const location = round.locationPoll?.options.find(
    (option) => option.id === round.locationOptionId,
  );
  const place = location?.place;
  return eventDescription(
    location?.details ?? null,
    round.threadId === null
      ? null
      : `https://discord.com/channels/${guildId}/${round.threadId}`,
    place?.point ? { point: place.point, name: place.name } : null,
    weather,
  );
}

/**
 * The EXTERNAL scheduled event for `round`: named and located at the
 * decided location, starting at the winning date in `timeZone` and ending
 * `HIKE_DURATION_HOURS` later, described by the location's details, its
 * map links, its weather at `now` and the thread's link. None when the
 * start is not after `now`, or when the round has no decided location and
 * date.
 */
export function hikeEventRequest(
  round: RoundView,
  guildId: string,
  timeZone: string,
  now: number,
): HikeEventRequest {
  const location = round.locationPoll?.options.find(
    (option) => option.id === round.locationOptionId,
  );
  const start = roundStart(round, timeZone);
  if (location === undefined || Number.isNaN(start)) {
    return { ok: false, why: "undecided" };
  }
  if (start <= now) return { ok: false, why: "past" };
  const description = hikeEventDescription(
    round,
    guildId,
    weatherTexts(round, timeZone, now)?.event ?? null,
  );
  return {
    ok: true,
    body: {
      name: shorten(location.label, MAX_EVENT_NAME),
      privacy_level: GuildScheduledEventPrivacyLevel.GuildOnly,
      scheduled_start_time: new Date(start).toISOString(),
      scheduled_end_time: new Date(
        start + HIKE_DURATION_HOURS * HOUR_MS,
      ).toISOString(),
      entity_type: GuildScheduledEventEntityType.External,
      entity_metadata: {
        location: shorten(location.label, MAX_EVENT_LOCATION),
      },
      ...(description === "" ? {} : { description }),
    },
  };
}

/** Why Discord refused the event, and what the admin can do about it. */
function failureReason(error: unknown): string {
  const refused = `Could not create the hike event: ${errorText(error)}.`;
  if (error instanceof DiscordApiError && error.code === MISSING_PERMISSIONS) {
    return `${refused} Give the bot the Create Events permission in the server's settings, then click Create hike event.`;
  }
  if (error instanceof DiscordApiError && error.code === MAX_SCHEDULED_EVENTS) {
    return `${refused} The server already has 100 scheduled events, the most Discord allows. End or delete one, then click Create hike event.`;
  }
  return `${refused} Click Create hike event to try again.`;
}

/** What creating the event came to. */
export type Created =
  { ok: true; eventId: string } | { ok: false; reason: string };

/**
 * Edits the thread's first message so it links the event. A failure is
 * logged and changes nothing else: the event and the round stand.
 */
async function linkEventInThread(
  round: RoundView,
  guildId: string,
  timeZone: string,
  context: HandlerContext,
): Promise<void> {
  try {
    await editThreadMessage(round, guildId, timeZone, context);
  } catch (error) {
    console.error(
      `linking the event in the thread of round ${String(round.id)} failed: ${errorText(error)}`,
    );
  }
}

/**
 * Creates the event of round `roundId`, read again so it has the thread
 * made just before, stores its id on the round and links it from the
 * thread; on failure records why, for the panel. The caller has claimed the
 * creation with `claimHikeEvent`.
 */
export async function createHikeEvent(
  roundId: number,
  guildId: string,
  timeZone: string,
  context: HandlerContext,
): Promise<Created> {
  const store = new PollStore(context.storage);
  const round = store.getRound(roundId);
  const now = store.now();
  const request = round && hikeEventRequest(round, guildId, timeZone, now);
  if (round === null || request === null || !request.ok) {
    if (request?.ok === false && request.why === "past") {
      // The start passed since the claim; the panel says so by itself.
      clearHikeEventAttempt(context.storage, roundId);
      return { ok: false, reason: START_PASSED_MESSAGE };
    }
    const reason =
      "The hike has no decided location and date, so no event was created.";
    recordHikeEventFailure(context.storage, roundId, reason);
    return { ok: false, reason };
  }
  let eventId: string;
  try {
    eventId = (
      await discordApi(context.env).createGuildScheduledEvent(
        guildId,
        request.body,
      )
    ).id;
  } catch (error) {
    const reason = failureReason(error);
    recordHikeEventFailure(context.storage, roundId, reason);
    return { ok: false, reason };
  }
  store.setRoundEvent(roundId, eventId);
  clearHikeEventAttempt(context.storage, roundId);
  const weather = weatherTexts(round, timeZone, now)?.event;
  if (weather !== undefined) {
    noteShown(context.storage, roundId, guildId, "event", weather);
  }
  await linkEventInThread({ ...round, eventId }, guildId, timeZone, context);
  return { ok: true, eventId };
}

/**
 * The date vote's close step: creates the event and hands the announcement
 * its link. A hike whose start has passed is skipped without asking
 * Discord. On failure it adds nothing to the announcement, which is still
 * posted; the panel shows the reason with the retry button.
 */
export const createHikeEventStep: CloseStep = {
  name: "create the hike event",
  run: async ({ round, guildId, timeZone }, context) => {
    const store = new PollStore(context.storage);
    const current = round === null ? null : store.getRound(round.id);
    if (
      current === null ||
      !claimHikeEvent(context.storage, current, store.now(), timeZone)
    ) {
      return {};
    }
    const created = await createHikeEvent(
      current.id,
      guildId,
      timeZone,
      context,
    );
    return created.ok
      ? { announce: [`**Hike event:** ${eventUrl(guildId, created.eventId)}`] }
      : {};
  },
};

/**
 * Create hike event: creates the event of the last round again with
 * `retryHikeEvent`, which claims it before the answer.
 */
const createAgain: ComponentHandler = adminOnly(
  (interaction: APIMessageComponentInteraction, context) =>
    answerPanel(
      interaction,
      context,
      retryHikeEvent(roundContext(interaction, context), actorOf(interaction), {
        roundId: Number(parseCustomId(interaction.data.custom_id)?.arg),
      }),
    ),
);

/**
 * Edits the event's description so it shows `round` as it is now, with its
 * weather at the store's time, and records the weather it shows. Throws
 * Discord's error.
 */
export async function editEventDescription(
  round: RoundView,
  guildId: string,
  timeZone: string,
  context: HandlerContext,
): Promise<void> {
  if (round.eventId === null) return;
  const store = new PollStore(context.storage);
  const weather = weatherTexts(round, timeZone, store.now())?.event ?? null;
  const description = hikeEventDescription(round, guildId, weather);
  await discordApi(context.env).editGuildScheduledEvent(
    guildId,
    round.eventId,
    { description: description === "" ? null : description },
  );
  if (weather !== null) {
    noteShown(context.storage, round.id, guildId, "event", weather);
  }
}

/**
 * After the map pin changed: edits the event's description, when the event
 * exists, so it shows the new pin.
 */
export const updateEventPin: MapPinHook = {
  name: "update the hike event",
  run: async ({ round, guildId, timeZone }, context) => {
    await editEventDescription(round, guildId, timeZone, context);
  },
};

/** Registers the Create hike event button. */
export function registerHikeEvent(router: Router): Router {
  router.component("hb:event:create", createAgain);
  return router;
}
