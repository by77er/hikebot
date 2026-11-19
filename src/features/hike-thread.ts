/**
 * The hike's forum thread: when the date vote closes, a close step creates a
 * thread in the configured forum channel with the hike's details, before the
 * announcement, which links it. If that fails the panel shows why and offers
 * **Create hike thread** (`hb:thread:create:<round id>`) until the last
 * completed round has its thread (`retryHikeThread` in `round-actions.ts`);
 * a retry never posts the announcement again and never creates a second
 * thread.
 */
import type {
  APIMessageComponentInteraction,
  APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { DiscordApiError, discordApi, eventUrl } from "../discord/api";
import {
  container,
  mediaGallery,
  messageBody,
  parseCustomId,
  separator,
  textDisplay,
} from "../discord/components";
import { GuildConfig } from "../guild/config";
import { adminOnly } from "../guild/permissions";
import type { ComponentHandler, HandlerContext, Router } from "../guild/router";
import { OSM_ATTRIBUTION, placeLine } from "../geo/links";
import { hikeStart } from "../polls/dates";
import {
  PollStore,
  type OptionView,
  type PollView,
  type RoundView,
} from "../polls/store";
import { POLL_CONTROL_IDS } from "./admin-panel";
import type { MapPinHook } from "./map-pin";
import { MAP_PICTURE_URL } from "./map-picture";
import {
  claimHikeThread,
  clearHikeThreadAttempt,
  recordHikeThreadFailure,
} from "./hike-thread-state";
import {
  actorName,
  actorOf,
  answerPanel,
  errorText,
  roundContext,
  shorten,
  type CloseStep,
} from "./poll-ui";
import { retryHikeThread } from "./round-actions";
import { noteShown, weatherTexts } from "./weather-state";

/** Discord's limit on a thread name. */
export const MAX_THREAD_NAME = 100;

const TITLE_SEPARATOR = " — ";

export const HIKE_THREAD_IDS = {
  create: POLL_CONTROL_IDS.createHikeThread,
} as const;

/**
 * The thread's title, `<location> — <date label>`, within Discord's 100
 * characters: an over-long location is shortened, the date is kept whole.
 */
export function threadTitle(location: string, date: string): string {
  const room = MAX_THREAD_NAME - TITLE_SEPARATOR.length - date.length;
  return `${shorten(location, room)}${TITLE_SEPARATOR}${date}`;
}

/**
 * `**When:** Sat, 5 Dec 2026 · 11:00 (<t:1796497200:R>)`: the date's label
 * and Discord's relative timestamp of its start in `timeZone`, which each
 * member sees in their own words ("in 3 days"). A date with no value shows
 * the label alone.
 */
export function whenLine(date: OptionView | null, timeZone: string): string {
  const start =
    date === null || date.dateValue === null
      ? NaN
      : hikeStart(date.dateValue, timeZone);
  const label = date?.label ?? "?";
  return Number.isNaN(start)
    ? `**When:** ${label}`
    : `**When:** ${label} (<t:${String(Math.floor(start / 1000))}:R>)`;
}

/** The winning option of a closed poll, if any. */
function winnerOf(poll: PollView | null) {
  return poll?.options.find((o) => o.id === poll.winnerOptionId) ?? null;
}

function votes(n: number): string {
  return n === 1 ? "1 vote" : `${String(n)} votes`;
}

function members(n: number): string {
  return n === 1 ? "1 member voted" : `${String(n)} members voted`;
}

/** One vote's result: winner, votes, voters, the tie and the link. */
function resultLine(
  name: string,
  poll: PollView | null,
  guildId: string,
): string {
  const winner = winnerOf(poll);
  if (poll === null || winner === null) return `**${name}:** no result.`;
  const parts = [
    `**${name}:** **${winner.label}** won with ${votes(winner.votes)}; ${members(poll.voterCount)}.`,
  ];
  if (poll.tieBroken) {
    parts.push(
      `The winner was drawn at random from ${String(poll.tiedOptionIds.length)} tied options.`,
    );
  }
  if (poll.channelId !== null && poll.messageId !== null) {
    parts.push(
      `[See the ${name.toLowerCase()}](https://discord.com/channels/${guildId}/${poll.channelId}/${poll.messageId})`,
    );
  }
  return parts.join(" ");
}

/**
 * The thread's first message: the location and its details, the map
 * picture (the message's `hike-map.png` attachment) while the round has
 * one, its place and map links when it has a pin, who proposed it (a mention that pings no
 * one), the date with its start in the guild's time zone as a relative
 * timestamp, the link to the hike's scheduled event once it exists, the
 * result of both votes with links to their messages, and OpenStreetMap's
 * attribution under a pin, with the `weather` block (`weatherTexts`) after
 * the head when there is one. Location labels (80), details (300) and
 * place names (80) are bounded, and the weather block holds nine rows, so
 * it stays within 40 components and 4000 characters. A proposer
 * whose id is `botId` (the application's own) is named hikebot.
 */
export function renderThreadMessage(
  round: RoundView,
  guildId: string,
  timeZone: string,
  botId?: string,
  weather: string | null = null,
): APIMessageTopLevelComponent[] {
  const location = winnerOf(round.locationPoll);
  const date = winnerOf(round.datePoll);
  const title = [`## ${location?.label ?? "?"}`];
  if (location?.details) title.push(location.details);
  const head: string[] = [];
  if (location?.place?.point) {
    head.push(placeLine(location.place.point, location.place.name));
  }
  if (location) {
    head.push(`Proposed by ${actorName(location.proposedBy, botId)}`);
  }
  head.push(whenLine(date, timeZone));
  if (round.eventId !== null) {
    head.push(`**Hike event:** ${eventUrl(guildId, round.eventId)}`);
  }
  const top =
    round.mapPictureKey === null
      ? [textDisplay([...title, ...head].join("\n"))]
      : [
          textDisplay(title.join("\n")),
          mediaGallery([
            {
              url: MAP_PICTURE_URL,
              description: `Map of the area round ${location?.label ?? "the hike"}, with a pin where it is`,
            },
          ]),
          textDisplay(head.join("\n")),
        ];
  return [
    container([
      ...top,
      ...(weather === null ? [] : [separator(), textDisplay(weather)]),
      separator(),
      textDisplay(
        [
          resultLine("Location vote", round.locationPoll, guildId),
          resultLine("Date vote", round.datePoll, guildId),
        ].join("\n"),
      ),
      ...(location?.place?.point ? [textDisplay(OSM_ATTRIBUTION)] : []),
    ]),
  ];
}

/** What creating the thread came to. */
export type Created =
  { ok: true; threadId: string } | { ok: false; reason: string };

/**
 * Creates the round's thread in the forum channel and stores its id on the
 * round; on failure records why, for the panel. The caller has claimed the
 * creation with `claimHikeThread`.
 */
export async function createHikeThread(
  round: RoundView,
  guildId: string,
  timeZone: string,
  context: HandlerContext,
): Promise<Created> {
  const store = new PollStore(context.storage);
  const forumId = new GuildConfig(context.storage).get().forumChannelId;
  if (forumId === null) {
    const reason =
      "No hike threads channel is set. Pick one under Settings, then click Create hike thread.";
    recordHikeThreadFailure(context.storage, round.id, reason);
    return { ok: false, reason };
  }
  const weather = weatherTexts(round, timeZone, store.now())?.thread ?? null;
  try {
    const thread = await discordApi(context.env).startForumThread(forumId, {
      name: threadTitle(
        winnerOf(round.locationPoll)?.label ?? "Hike",
        winnerOf(round.datePoll)?.label ?? "?",
      ),
      // Without the map picture, which is uploaded to the thread after.
      message: messageBody(
        renderThreadMessage(
          { ...round, mapPictureKey: null },
          guildId,
          timeZone,
          context.env.DISCORD_APPLICATION_ID,
          weather,
        ),
      ),
    });
    store.setRoundThread(round.id, thread.id);
    // The picture shown on the event so far is not on this thread yet.
    store.setRoundMapPicture(round.id, null);
    clearHikeThreadAttempt(context.storage, round.id);
    if (weather !== null) {
      noteShown(context.storage, round.id, guildId, "thread", weather);
    }
    return { ok: true, threadId: thread.id };
  } catch (error) {
    const reason = `Could not create the hike thread in <#${forumId}>: ${errorText(error)}. Check that it is still a forum channel and that the bot can create posts in it, then click Create hike thread.`;
    recordHikeThreadFailure(context.storage, round.id, reason);
    return { ok: false, reason };
  }
}

/**
 * The date vote's close step: creates the thread and hands the announcement
 * its link. On failure it adds nothing to the announcement, which is still
 * posted; the panel shows the reason with the retry button.
 */
export const createHikeThreadStep: CloseStep = {
  name: "create the hike thread",
  run: async ({ round, guildId, timeZone }, context) => {
    const store = new PollStore(context.storage);
    if (
      round === null ||
      !claimHikeThread(context.storage, round, store.now())
    ) {
      return {};
    }
    const created = await createHikeThread(round, guildId, timeZone, context);
    return created.ok
      ? { announce: [`**Hike thread:** <#${created.threadId}>`] }
      : {};
  },
};

/**
 * Create hike thread: creates the thread of the last round again with
 * `retryHikeThread`, which claims it before the answer.
 */
const createAgain: ComponentHandler = adminOnly(
  (interaction: APIMessageComponentInteraction, context) =>
    answerPanel(
      interaction,
      context,
      retryHikeThread(
        roundContext(interaction, context),
        actorOf(interaction),
        {
          roundId: Number(parseCustomId(interaction.data.custom_id)?.arg),
        },
      ),
    ),
);

/**
 * Discord's code for an operation on an archived thread, "such as editing
 * a message" (https://docs.discord.com/developers/topics/opcodes-and-status-codes).
 */
const ARCHIVED_THREAD = 50083;

/**
 * Edits the thread's first message so it shows `round` as it is now, with
 * its weather at the store's time, and records the weather it shows. An
 * archived thread takes no message edits: "Users cannot edit messages, add
 * reactions, use application commands, or join archived threads", and
 * "Editing a thread to set `archived` to `false` only requires the current
 * user has already been added to the thread", or for a locked one that the
 * user created it (https://docs.discord.com/developers/topics/threads).
 * So when Discord refuses the edit as archived, the bot, which created the
 * thread, unarchives it, edits the message and archives it again, leaving
 * it as it was. Archiving it again may be refused ("Otherwise, requires the
 * `MANAGE_THREADS` permission", https://docs.discord.com/developers/resources/channel),
 * which is logged: the edit stands. Throws Discord's error otherwise.
 */
export async function editThreadMessage(
  round: RoundView,
  guildId: string,
  timeZone: string,
  context: HandlerContext,
): Promise<void> {
  const threadId = round.threadId;
  if (threadId === null) return;
  const store = new PollStore(context.storage);
  const weather = weatherTexts(round, timeZone, store.now())?.thread ?? null;
  const api = discordApi(context.env);
  const body = messageBody(
    renderThreadMessage(
      round,
      guildId,
      timeZone,
      context.env.DISCORD_APPLICATION_ID,
      weather,
    ),
  );
  try {
    // A forum thread's first message has the thread's id.
    await api.editMessage(threadId, threadId, body);
  } catch (error) {
    if (!(error instanceof DiscordApiError && error.code === ARCHIVED_THREAD)) {
      throw error;
    }
    await api.editThread(threadId, { archived: false });
    try {
      await api.editMessage(threadId, threadId, body);
    } finally {
      try {
        await api.editThread(threadId, { archived: true });
      } catch (error) {
        // Archiving needs Manage Threads in some cases; the thread then
        // archives itself again after its inactivity period.
        console.error(
          `archiving the thread of round ${String(round.id)} again failed: ${errorText(error)}`,
        );
      }
    }
  }
  if (weather !== null) {
    noteShown(context.storage, round.id, guildId, "thread", weather);
  }
}

/**
 * After the map pin changed: edits the thread's first message, when the
 * thread exists, so it shows the new pin.
 */
export const updateThreadPin: MapPinHook = {
  name: "update the hike thread",
  run: async ({ round, guildId, timeZone }, context) => {
    await editThreadMessage(round, guildId, timeZone, context);
  },
};

/** Registers the Create hike thread button. */
export function registerHikeThread(router: Router): Router {
  router.component("hb:thread:create", createAgain);
  return router;
}
