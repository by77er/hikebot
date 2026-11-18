/**
 * The hike's forum thread: when the date vote closes, a close step creates a
 * thread in the configured forum channel with the hike's details, before the
 * announcement, which links it. If that fails the panel shows why and offers
 * **Create hike thread** (`hb:thread:create:<round id>`) until the last
 * completed round has its thread; a retry never posts the announcement
 * again and never creates a second thread.
 */
import type {
  APIMessageComponentInteraction,
  APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { discordApi } from "../discord/api";
import {
  container,
  messageBody,
  parseCustomId,
  separator,
  textDisplay,
} from "../discord/components";
import { GuildConfig } from "../guild/config";
import { adminOnly } from "../guild/permissions";
import type { ComponentHandler, HandlerContext, Router } from "../guild/router";
import { hikeStart } from "../polls/dates";
import {
  PollStore,
  type OptionView,
  type PollView,
  type RoundView,
} from "../polls/store";
import { POLL_CONTROL_IDS, adminPanelUpdate } from "./admin-panel";
import {
  claimHikeThread,
  clearHikeThreadAttempt,
  hikeThreadStatus,
  recordHikeThreadFailure,
} from "./hike-thread-state";
import {
  deferPanel,
  errorText,
  finishPanel,
  shorten,
  type CloseStep,
} from "./poll-ui";

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
 * The thread's first message: the location and its details, who proposed
 * it (a mention that pings no one), the date with its start in the guild's
 * time zone as a relative timestamp, and the result of both votes
 * with links to their messages. Location labels (80) and details (300) are
 * bounded, so it stays far within 40 components and 4000 characters.
 */
export function renderThreadMessage(
  round: RoundView,
  guildId: string,
  timeZone: string,
): APIMessageTopLevelComponent[] {
  const location = winnerOf(round.locationPoll);
  const date = winnerOf(round.datePoll);
  const head = [`## ${location?.label ?? "?"}`];
  if (location?.details) head.push(location.details);
  if (location) head.push(`Proposed by <@${location.proposedBy}>`);
  head.push(whenLine(date, timeZone));
  return [
    container([
      textDisplay(head.join("\n")),
      separator(),
      textDisplay(
        [
          resultLine("Location vote", round.locationPoll, guildId),
          resultLine("Date vote", round.datePoll, guildId),
        ].join("\n"),
      ),
    ]),
  ];
}

/** What creating the thread came to. */
type Created = { ok: true; threadId: string } | { ok: false; reason: string };

/**
 * Creates the round's thread in the forum channel and stores its id on the
 * round; on failure records why, for the panel. The caller has claimed the
 * creation with `claimHikeThread`.
 */
async function createHikeThread(
  round: RoundView,
  guildId: string,
  context: HandlerContext,
): Promise<Created> {
  const store = new PollStore(context.storage);
  const { forumChannelId: forumId, timezone } = new GuildConfig(
    context.storage,
  ).get();
  if (forumId === null) {
    const reason =
      "No hike threads channel is set. Pick one under Settings, then click Create hike thread.";
    recordHikeThreadFailure(context.storage, round.id, reason);
    return { ok: false, reason };
  }
  try {
    const thread = await discordApi(context.env).startForumThread(forumId, {
      name: threadTitle(
        winnerOf(round.locationPoll)?.label ?? "Hike",
        winnerOf(round.datePoll)?.label ?? "?",
      ),
      message: messageBody(renderThreadMessage(round, guildId, timezone)),
    });
    store.setRoundThread(round.id, thread.id);
    clearHikeThreadAttempt(context.storage, round.id);
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
  run: async ({ round, guildId }, context) => {
    const store = new PollStore(context.storage);
    if (
      round === null ||
      !claimHikeThread(context.storage, round, store.now())
    ) {
      return {};
    }
    const created = await createHikeThread(round, guildId, context);
    return created.ok
      ? { announce: [`**Hike thread:** <#${created.threadId}>`] }
      : {};
  },
};

/**
 * Create hike thread: retries the thread of the last round while it is
 * complete without one. The claim is taken before the answer, so a second
 * click while the first is running is told so and creates nothing.
 */
const retryHikeThread: ComponentHandler = adminOnly(
  (interaction: APIMessageComponentInteraction, context) => {
    const arg = parseCustomId(interaction.data.custom_id)?.arg;
    const store = new PollStore(context.storage);
    const round = store.getLastRound();
    if (
      round === null ||
      String(round.id) !== arg ||
      round.status !== "complete"
    ) {
      return adminPanelUpdate(
        context,
        "That hike is no longer the last one, so its thread is not created from here.",
      );
    }
    const status = hikeThreadStatus(context.storage, round, store.now());
    if (status.state === "created") {
      return adminPanelUpdate(
        context,
        `The hike thread already exists: <#${status.threadId}>.`,
      );
    }
    if (!claimHikeThread(context.storage, round, store.now())) {
      return adminPanelUpdate(context, "The hike thread is being created.");
    }
    return {
      response: deferPanel(interaction),
      followUp: async () => {
        const created = await createHikeThread(
          round,
          interaction.guild_id ?? "",
          context,
        );
        await finishPanel(
          context,
          interaction,
          created.ok
            ? `The hike thread is open: <#${created.threadId}>.`
            : created.reason,
        );
      },
    };
  },
);

/** Registers the Create hike thread button. */
export function registerHikeThread(router: Router): Router {
  router.component("hb:thread:create", retryHikeThread);
  return router;
}
