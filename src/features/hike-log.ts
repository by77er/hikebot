import {
  ButtonStyle,
  type APIComponentInContainer,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
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
import type { CommandHandler, ComponentHandler, Router } from "../guild/router";
import { PollStore, type HikeView } from "../polls/store";
import { shorten } from "./poll-ui";

/** Hikes on one page of the log. */
export const HIKES_PER_PAGE = 10;

/**
 * The longest a hike's details are shown in the log. With ten hikes at the
 * longest label and details, the page stays well within Discord's 4000
 * characters.
 */
export const LOG_DETAILS_CAP = 200;

export const NO_HIKES_MESSAGE =
  "No hikes yet. The first one appears here when a date vote closes.";

export const HIKE_LOG_IDS = {
  page: (page: number) => customId("log", "page", String(page)),
} as const;

/** One page of the log, as `loadHikeLog` reads it. */
export interface HikeLogPage {
  hikes: HikeView[];
  /** 1-based, within `1..pages`. */
  page: number;
  pages: number;
  total: number;
}

/**
 * Reads page `page` (1-based) of the log. A page past the end gives the
 * last page; a page before the first, or not a number, gives the first.
 */
export function loadHikeLog(
  storage: DurableObjectStorage,
  page: number,
): HikeLogPage {
  const store = new PollStore(storage);
  const total = store.countHikes();
  const pages = Math.max(1, Math.ceil(total / HIKES_PER_PAGE));
  const wanted = Number.isInteger(page) ? page : 1;
  const shown = Math.min(Math.max(wanted, 1), pages);
  return {
    hikes: store.listHikes({
      limit: HIKES_PER_PAGE,
      offset: (shown - 1) * HIKES_PER_PAGE,
    }),
    page: shown,
    pages,
    total,
  };
}

/**
 * The log message: the heading and count, then one entry per hike, newest
 * first (date, location, shortened details, thread), and while there is
 * more than one page, Newer and Older buttons.
 */
export function renderHikeLog(log: HikeLogPage): APIMessageTopLevelComponent[] {
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
  for (const hike of log.hikes) body.push(textDisplay(hikeEntry(hike)));
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

function hikeEntry(hike: HikeView): string {
  const lines = [`${hike.date.label} · **${hike.location.label}**`];
  if (hike.location.details !== null) {
    lines.push(shorten(hike.location.details, LOG_DETAILS_CAP));
  }
  if (hike.threadId !== null) lines.push(`Thread: <#${hike.threadId}>`);
  return lines.join("\n");
}

/** `/hike log`: the first page of the log, to any member, ephemeral. */
export const showHikeLog: CommandHandler = (_interaction, context) => ({
  response: ephemeralReply(renderHikeLog(loadHikeLog(context.storage, 1))),
});

/** Newer and Older: redraws the log message at the page in the custom_id. */
const turnPage: ComponentHandler = (interaction, context) => {
  const page = Number(parseCustomId(interaction.data.custom_id)?.arg);
  return {
    response: update(renderHikeLog(loadHikeLog(context.storage, page))),
  };
};

export function registerHikeLog(router: Router): void {
  router.component("hb:log:page", turnPage);
}
