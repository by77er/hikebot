import {
  ButtonStyle,
  type APIComponentInContainer,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { calendarAddress } from "../calendar/address";
import {
  actionRow,
  button,
  container,
  customId,
  ephemeralReply,
  parseCustomId,
  separator,
  textDisplay,
  update,
} from "../discord/components";
import { channelUrl, eventUrl } from "../discord/api";
import type { CommandHandler, ComponentHandler, Router } from "../guild/router";
import type { WebViewSource } from "../guild/web-view";
import { PollStore, type HikeView } from "../polls/store";
import { shorten } from "./poll-ui";

/** Hikes on one page of the log. */
export const HIKES_PER_PAGE = 10;

/**
 * The longest a hike's details are shown in the log. With ten hikes at the
 * longest label and details, each with a thread and an event, the page
 * stays within Discord's 4000 characters.
 */
export const LOG_DETAILS_CAP = 140;

export const NO_HIKES_MESSAGE =
  "No hikes yet. The first one appears here when a date vote closes.";

export const HIKE_LOG_IDS = {
  page: (page: number) => customId("log", "page", String(page)),
} as const;

/** The sentence under the calendar address. */
export const CALENDAR_HINT =
  "Calendar apps can subscribe to this address to show every hike; anyone who has it can see them.";

/** One page of the log, as `loadHikeLog` reads it. */
export interface HikeLogPage {
  hikes: HikeView[];
  /** 1-based, within `1..pages`. */
  page: number;
  pages: number;
  total: number;
}

/**
 * Reads page `page` (1-based) of the log, `pageSize` hikes a page. A page
 * past the end gives the last page; a page before the first, or not a
 * number, gives the first.
 */
export function loadHikeLog(
  storage: DurableObjectStorage,
  page: number,
  pageSize = HIKES_PER_PAGE,
): HikeLogPage {
  const store = new PollStore(storage);
  const total = store.countHikes();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const wanted = Number.isInteger(page) ? page : 1;
  const shown = Math.min(Math.max(wanted, 1), pages);
  return {
    hikes: store.listHikes({
      limit: pageSize,
      offset: (shown - 1) * pageSize,
    }),
    page: shown,
    pages,
    total,
  };
}

/**
 * The log message: the heading and count, then one entry per hike, newest
 * first (date, location, shortened details, thread and the link to the
 * event in `guildId`), the guild's calendar address `calendar`, and while
 * there is more than one page, Newer and Older buttons.
 */
export function renderHikeLog(
  log: HikeLogPage,
  guildId: string,
  calendar: string,
): APIMessageTopLevelComponent[] {
  const count = log.total === 1 ? "1 hike" : `${String(log.total)} hikes`;
  const head = [
    "## Hike log",
    log.pages > 1
      ? `${count} · page ${String(log.page)} of ${String(log.pages)}`
      : count,
  ];
  const body: APIComponentInContainer[] = [textDisplay(head.join("\n"))];
  body.push(separator());
  if (log.hikes.length === 0) body.push(textDisplay(NO_HIKES_MESSAGE));
  for (const hike of log.hikes) {
    body.push(textDisplay(hikeEntry(hike, guildId)));
  }
  body.push(separator());
  body.push(textDisplay(`Calendar: ${calendar}\n${CALENDAR_HINT}`));
  if (log.pages > 1) {
    body.push(separator());
    body.push(
      actionRow(
        button({
          custom_id: HIKE_LOG_IDS.page(log.page - 1),
          label: "Newer",
          style: ButtonStyle.Secondary,
          disabled: log.page <= 1,
        }),
        button({
          custom_id: HIKE_LOG_IDS.page(log.page + 1),
          label: "Older",
          style: ButtonStyle.Secondary,
          disabled: log.page >= log.pages,
        }),
      ),
    );
  }
  return [container(body)];
}

function hikeEntry(hike: HikeView, guildId: string): string {
  const lines = [`${hike.date.label} · **${hike.location.label}**`];
  if (hike.location.details !== null) {
    lines.push(shorten(hike.location.details, LOG_DETAILS_CAP));
  }
  const links = [
    ...(hike.threadId === null ? [] : [`Thread: <#${hike.threadId}>`]),
    ...(hike.eventId === null
      ? []
      : [`[Event](${eventUrl(guildId, hike.eventId)})`]),
  ];
  if (links.length > 0) lines.push(links.join(" · "));
  return lines.join("\n");
}

/** `/hike log`: the first page of the log, to any member, ephemeral. */
export const showHikeLog: CommandHandler = async (interaction, context) => {
  const guildId = interaction.guild_id ?? "";
  return {
    response: ephemeralReply(
      renderHikeLog(
        loadHikeLog(context.storage, 1),
        guildId,
        await calendarAddress(context.env, guildId),
      ),
    ),
  };
};

/** Newer and Older: redraws the log message at the page in the custom_id. */
const turnPage: ComponentHandler = async (interaction, context) => {
  const page = Number(parseCustomId(interaction.data.custom_id)?.arg);
  const guildId = interaction.guild_id ?? "";
  return {
    response: update(
      renderHikeLog(
        loadHikeLog(context.storage, page),
        guildId,
        await calendarAddress(context.env, guildId),
      ),
    ),
  };
};

/** One hike in the web view's log. */
export interface WebHikeLogEntry {
  roundId: number;
  location: { label: string; details: string | null; proposedBy: string };
  /** `value` is `YYYY-MM-DD HH:MM`; `label` as the bot shows it. */
  date: { value: string; label: string };
  threadUrl: string | null;
  eventUrl: string | null;
  /** When the date vote closed, in milliseconds since the epoch. */
  completedAt: number;
}

/** The web view's page of the log, read as `loadHikeLog` reads it. */
export interface WebHikeLogSection {
  entries: WebHikeLogEntry[];
  /** 1-based, within `1..pages`. */
  page: number;
  pageSize: number;
  pages: number;
  total: number;
}

/** The log page the web view asked for, newest hike first. */
export function hikeLogSection(source: WebViewSource): WebHikeLogSection {
  const { page, pageSize } = source.log;
  const log = loadHikeLog(source.storage, page, pageSize);
  return {
    entries: log.hikes.map((hike) => ({
      roundId: hike.roundId,
      location: { ...hike.location },
      date: { ...hike.date },
      threadUrl:
        hike.threadId === null
          ? null
          : channelUrl(source.guildId, hike.threadId),
      eventUrl:
        hike.eventId === null ? null : eventUrl(source.guildId, hike.eventId),
      completedAt: hike.completedAt,
    })),
    page: log.page,
    pageSize,
    pages: log.pages,
    total: log.total,
  };
}

export function registerHikeLog(router: Router): void {
  router.component("hb:log:page", turnPage);
}
