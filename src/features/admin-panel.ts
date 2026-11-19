import {
  ButtonStyle,
  ComponentType,
  SelectMenuDefaultValueType,
  type APIButtonComponentWithCustomId,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
  type APIModalSubmitInteraction,
  type RESTPatchAPIWebhookWithTokenMessageJSONBody,
} from "discord-api-types/v10";
import {
  actionRow,
  button,
  channelSelect,
  container,
  customId,
  ephemeralReply,
  label,
  messageBody,
  modal,
  roleSelect,
  separator,
  stringSelect,
  textDisplay,
  textInput,
  textInputValue,
  update,
} from "../discord/components";
import {
  GuildConfig,
  MAX_DATE_VOTE_DAYS,
  MIN_DATE_VOTE_DAYS,
  setupComplete,
  type GuildSettings,
} from "../guild/config";
import { ephemeralNotice } from "../discord/responses";
import { adminOnly } from "../guild/permissions";
import {
  CADENCE_WINDOW_DAYS,
  DEFAULT_HIKE_TIME,
  WEEKDAY_NAMES,
  clockIn,
} from "../polls/dates";
import {
  PollStore,
  type PollKind,
  type PollView,
  type RoundView,
} from "../polls/store";
import { rankOptions } from "../polls/tally";
import { formatPoint, osmLink } from "../geo/links";
import type {
  CommandHandler,
  ComponentHandler,
  HandlerContext,
  HandlerResult,
  ModalHandler,
  Router,
} from "../guild/router";
import { UNAVAILABLE_MESSAGE } from "../guild/router";
import { UNITS } from "../weather/forecast";
import {
  changeSchedule,
  checkAdminRole,
  checkChannel,
  checkDateVoteDays,
  checkScheduleOn,
  checkTimeOfDay,
  checkTimeZone,
  checkUnits,
  checkWeekday,
  dayCount,
  listing,
  missingSettings,
  noticeMarkdown,
  setAdminRole,
  setChannel,
  setTimeZone,
  setUnits,
  type Notice,
  type ScheduleChange,
} from "./settings";
import {
  CHANNEL_SETTINGS,
  UNIT_NAMES,
  type ChannelSetting,
} from "./settings-catalogue";
import {
  announcementStatus,
  type AnnouncementStatus,
} from "./announcement-state";
import {
  cadenceSnapshot,
  discordTime,
  nextCadenceAction,
  type CadenceAction,
} from "./cadence-state";
import {
  hikeDayHours,
  hikeDayStatus,
  type HikeDayStatus,
} from "./hike-day-state";
import { hikeEventStatus, type HikeEventStatus } from "./hike-event-state";
import { hikeThreadStatus, type HikeThreadStatus } from "./hike-thread-state";
import { mapPictureStatus, type MapPictureStatus } from "./map-picture-state";
import {
  voteMessageStatus,
  type VoteMessageStatus,
} from "./vote-message-state";

/** Everything the panel shows. Later features add their state here. */
export interface AdminPanelState {
  settings: GuildSettings;
  /** The active round (neither complete nor cancelled), if any. */
  round: RoundView | null;
  /** The last round, when no round is active and it was completed. */
  finished?: RoundView | null;
  /** Where the finished round's forum thread stands. */
  thread?: HikeThreadStatus | null;
  /** Where the finished round's scheduled event stands. */
  event?: HikeEventStatus | null;
  /** Where the finished round's map picture stands. */
  mapPicture?: MapPictureStatus | null;
  /**
   * Where the finished round's hike-day announcement stands and when it
   * goes out; null once its hike is over without one.
   */
  hikeDay?: { status: HikeDayStatus; at: number } | null;
  /**
   * The announcements of the shown round's closed polls (the active
   * round's, or the finished one's) that are not known to be posted.
   */
  announcements?: PollAnnouncement[];
  /** Where the active round's open poll's message stands. */
  voteMessage?: VoteMessageStatus | null;
  /** The time the panel is drawn at, for the clock in the guild's zone. */
  now?: number;
  /**
   * What the weekly schedule does next, while it is on; null when it does
   * nothing in the weeks it looks ahead.
   */
  nextScheduled?: CadenceAction | null;
}

/** Where a closed poll's announcement stands, for the panel. */
export interface PollAnnouncement {
  pollId: number;
  kind: PollKind;
  status: Exclude<AnnouncementStatus, { state: "none" | "posted" }>;
}

export const ADMIN_PANEL_IDS = {
  settings: customId("admin", "settings"),
  refresh: customId("admin", "refresh"),
  back: customId("admin", "back"),
  role: customId("admin", "role"),
  voteChannel: customId("admin", "vote-channel"),
  announceChannel: customId("admin", "announce-channel"),
  forumChannel: customId("admin", "forum-channel"),
  timezone: customId("admin", "timezone"),
  homeArea: customId("admin", "home-area"),
  cadence: customId("admin", "cadence"),
  cadenceDay: customId("admin", "cadence-day"),
  cadenceDays: customId("admin", "cadence-days"),
  cadenceTime: customId("admin", "cadence-time"),
  units: customId("admin", "units"),
} as const;

/** The fields of the panel's modals, read back from their submissions. */
export const ADMIN_PANEL_FIELDS = {
  timezone: customId("admin", "timezone-name"),
  homeArea: customId("admin", "home-area-name"),
  cadenceTime: customId("admin", "cadence-time-value"),
} as const;

/** The panel's poll controls; their handlers live with the poll features. */
export const POLL_CONTROL_IDS = {
  startLocationVote: customId("location", "start"),
  startDateVote: customId("date", "start"),
  closePoll: (pollId: number) => customId("poll", "close", String(pollId)),
  cancelRound: (roundId: number) =>
    customId("round", "cancel", String(roundId)),
  createHikeThread: (roundId: number) =>
    customId("thread", "create", String(roundId)),
  createHikeEvent: (roundId: number) =>
    customId("event", "create", String(roundId)),
  postHikeDay: (roundId: number) =>
    customId("hike-day", "post", String(roundId)),
  announce: (pollId: number) => customId("poll", "announce", String(pollId)),
  postVoteMessage: (pollId: number) => customId("poll", "post", String(pollId)),
  setMapPin: (roundId: number) => customId("pin", "set", String(roundId)),
  showMapPicture: (roundId: number) => customId("map", "show", String(roundId)),
} as const;

/** How the panel names each kind of poll. */
export const POLL_NAMES: Record<PollKind, string> = {
  location: "location vote",
  date: "date vote",
};

const NOT_SET = "not set";

/** The custom_id of each channel setting's select. */
const CHANNEL_SELECT_IDS: Record<ChannelSetting["field"], string> = {
  voteChannelId: ADMIN_PANEL_IDS.voteChannel,
  announceChannelId: ADMIN_PANEL_IDS.announceChannel,
  forumChannelId: ADMIN_PANEL_IDS.forumChannel,
};

export function loadAdminPanelState(
  storage: DurableObjectStorage,
): AdminPanelState {
  const store = new PollStore(storage);
  const round = store.getActiveRound();
  const last = round === null ? store.getLastRound() : null;
  const finished = last?.status === "complete" ? last : null;
  const settings = new GuildConfig(storage).get();
  const now = store.now();
  const open = round === null ? null : openPoll(round);
  return {
    settings,
    round,
    finished,
    thread: finished === null ? null : hikeThreadStatus(storage, finished, now),
    event:
      finished === null
        ? null
        : hikeEventStatus(storage, finished, now, settings.timezone),
    mapPicture:
      finished === null ? null : mapPictureStatus(storage, finished, now),
    hikeDay:
      finished === null ? null : hikeDayState(storage, finished, now, settings),
    announcements: pollAnnouncements(storage, round ?? finished, now),
    voteMessage: open === null ? null : voteMessageStatus(storage, open, now),
    now,
    nextScheduled: settings.cadence.enabled
      ? nextCadenceAction(settings, cadenceSnapshot(store, settings), now)
      : null,
  };
}

/**
 * The finished round's hike-day announcement: posted, or else where it
 * stands while its hike is not over.
 */
function hikeDayState(
  storage: DurableObjectStorage,
  finished: RoundView,
  now: number,
  settings: GuildSettings,
): AdminPanelState["hikeDay"] {
  const status = hikeDayStatus(storage, finished, now);
  const { at, end } = hikeDayHours(finished, settings.timezone);
  if (status.state !== "posted" && !(end > now)) return null;
  return { status, at };
}

/** The announcements of the round's closed polls not known to be posted. */
function pollAnnouncements(
  storage: DurableObjectStorage,
  round: RoundView | null,
  now: number,
): PollAnnouncement[] {
  const polls = [round?.locationPoll, round?.datePoll].filter(
    (poll): poll is PollView =>
      poll !== null && poll !== undefined && poll.winnerOptionId !== null,
  );
  return polls.flatMap((poll) => {
    const status = announcementStatus(storage, poll.id, now);
    return status.state === "none" || status.state === "posted"
      ? []
      : [{ pollId: poll.id, kind: poll.kind, status }];
  });
}

/** A round control the panel offers, named by what it does. */
export type PanelActionKind =
  | "start-location-vote"
  | "create-hike-thread"
  | "create-hike-event"
  | "show-map-picture"
  | "post-hike-day"
  | "announce"
  | "set-map-pin"
  | "start-date-vote"
  | "post-vote-message"
  | "close-vote"
  | "cancel-round";

/**
 * One of the panel's round controls, as plain data, so the Discord panel
 * and the web page offer the same controls in the same states.
 */
export interface PanelAction {
  kind: PanelActionKind;
  /** The button's label: "Close location vote". */
  label: string;
  /** The poll or round it acts on; null for a start. */
  target: number | null;
  /** `primary` for the round's next step, `danger` for Cancel round. */
  style: "primary" | "secondary" | "danger";
  /** For a retry, the panel's line on what failed: "**Hike thread:** …". */
  note?: string;
}

const BUTTON_STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  danger: ButtonStyle.Danger,
} as const;

const PANEL_IDS: Record<PanelActionKind, (target: number) => string> = {
  "start-location-vote": () => POLL_CONTROL_IDS.startLocationVote,
  "create-hike-thread": POLL_CONTROL_IDS.createHikeThread,
  "create-hike-event": POLL_CONTROL_IDS.createHikeEvent,
  "show-map-picture": POLL_CONTROL_IDS.showMapPicture,
  "post-hike-day": POLL_CONTROL_IDS.postHikeDay,
  announce: POLL_CONTROL_IDS.announce,
  "set-map-pin": POLL_CONTROL_IDS.setMapPin,
  "start-date-vote": () => POLL_CONTROL_IDS.startDateVote,
  "post-vote-message": POLL_CONTROL_IDS.postVoteMessage,
  "close-vote": POLL_CONTROL_IDS.closePoll,
  "cancel-round": POLL_CONTROL_IDS.cancelRound,
};

/** Announce <vote> for each announcement that failed or was cut off. */
function announceActions(state: AdminPanelState): PanelAction[] {
  return (state.announcements ?? [])
    .filter(({ status }) => status.state !== "posting")
    .map((announcement) => ({
      kind: "announce",
      label: `Announce ${POLL_NAMES[announcement.kind]}`,
      target: announcement.pollId,
      style: "secondary",
      note: announcementLines([announcement])[0],
    }));
}

/**
 * The buttons the status view offers for the current state, in display
 * order. Poll controls (start or close a vote) go here, before Settings and
 * Refresh, each registered through `adminOnly`.
 */
export function actionButtons(
  state: AdminPanelState,
): APIButtonComponentWithCustomId[] {
  return [
    ...panelActions(state).map((action) =>
      button({
        custom_id: PANEL_IDS[action.kind](action.target ?? 0),
        label: action.label,
        style: BUTTON_STYLES[action.style],
      }),
    ),
    ...settingsButtons(state),
  ];
}

/**
 * The round controls the panel offers in `state`, in display order, before
 * Settings and Refresh. The web page offers the same ones.
 */
export function panelActions(state: AdminPanelState): PanelAction[] {
  const { round } = state;
  if (round === null) {
    const { finished, thread, event } = state;
    return [
      ...(setupComplete(state.settings)
        ? [
            {
              kind: "start-location-vote",
              label: "Start location vote",
              target: null,
              style: "primary",
            } as const,
          ]
        : []),
      // Only while the last round is complete without a thread.
      ...(finished &&
      (thread?.state === "missing" ||
        thread?.state === "failed" ||
        thread?.state === "unconfirmed")
        ? [
            {
              kind: "create-hike-thread",
              label: "Create hike thread",
              target: finished.id,
              style: "secondary",
              note: threadLines(thread)[0],
            } as const,
          ]
        : []),
      // Only while the last round is complete without an event, and its
      // start is ahead.
      ...(finished &&
      (event?.state === "missing" ||
        event?.state === "failed" ||
        event?.state === "unconfirmed")
        ? [
            {
              kind: "create-hike-event",
              label: "Create hike event",
              target: finished.id,
              style: "secondary",
              note: eventLines(event)[0],
            } as const,
          ]
        : []),
      // Only while the map picture failed, was cut off or was never shown
      // for the pin; never when there is nothing to draw.
      ...(finished &&
      (state.mapPicture?.state === "missing" ||
        state.mapPicture?.state === "failed" ||
        state.mapPicture?.state === "unconfirmed")
        ? [
            {
              kind: "show-map-picture",
              label: "Show map picture",
              target: finished.id,
              style: "secondary",
              note: mapPictureLines(state.mapPicture)[0],
            } as const,
          ]
        : []),
      // Only while the hike-day announcement failed or was cut off, and
      // its hike is not over.
      ...(finished &&
      (state.hikeDay?.status.state === "failed" ||
        state.hikeDay?.status.state === "unconfirmed")
        ? [
            {
              kind: "post-hike-day",
              label: "Post hike-day announcement",
              target: finished.id,
              style: "secondary",
              note: hikeDayLines(state)[0],
            } as const,
          ]
        : []),
      ...announceActions(state),
      ...(finished ? [pinAction(finished)] : []),
    ];
  }
  const open = openPoll(round);
  const unposted =
    state.voteMessage?.state === "missing" ||
    state.voteMessage?.state === "failed" ||
    state.voteMessage?.state === "unconfirmed";
  return [
    ...(round.status === "location_decided"
      ? [
          {
            kind: "start-date-vote",
            label: "Start date vote",
            target: null,
            style: "primary",
          } as const,
        ]
      : []),
    // Only while the open poll has no message and none is being posted.
    ...(open !== null && unposted
      ? [
          {
            kind: "post-vote-message",
            label: "Post vote message",
            target: open.id,
            style: "secondary",
            note: openLine(open, state.voteMessage),
          } as const,
        ]
      : []),
    ...(open === null
      ? []
      : [
          {
            kind: "close-vote",
            label: `Close ${POLL_NAMES[open.kind]}`,
            target: open.id,
            style: "primary",
          } as const,
        ]),
    ...announceActions(state),
    ...(round.locationOptionId === null ? [] : [pinAction(round)]),
    {
      kind: "cancel-round",
      label: "Cancel round",
      target: round.id,
      style: "danger",
    },
  ];
}

/** Set map pin, for the round's decided location. */
function pinAction(round: RoundView): PanelAction {
  return {
    kind: "set-map-pin",
    label: "Set map pin",
    target: round.id,
    style: "secondary",
  };
}

function settingsButtons(
  state: AdminPanelState,
): APIButtonComponentWithCustomId[] {
  return [
    button({
      custom_id: ADMIN_PANEL_IDS.settings,
      label: "Settings",
      // Until setup is complete, Settings is the next step.
      style: setupComplete(state.settings)
        ? ButtonStyle.Secondary
        : ButtonStyle.Primary,
    }),
    button({
      custom_id: ADMIN_PANEL_IDS.refresh,
      label: "Refresh",
      style: ButtonStyle.Secondary,
    }),
  ];
}

/** The status view: the settings, whether setup is complete, the actions. */
export function renderAdminPanel(
  state: AdminPanelState,
  notice?: string,
): APIMessageTopLevelComponent[] {
  const { settings } = state;
  const lines = [
    `**Admin role:** ${settings.adminRoleId === null ? `${NOT_SET} (only the server owner can use this panel)` : `<@&${settings.adminRoleId}>`}`,
    ...CHANNEL_SETTINGS.map(
      (channel) =>
        `**${channel.name}:** ${channelMention(settings[channel.field])}`,
    ),
    timezoneLine(state),
    ...scheduleLines(state),
  ];
  const buttons = actionButtons(state);
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(actionRow(...buttons.slice(i, i + 5)));
  }
  return [
    container([
      textDisplay("## hikebot admin"),
      ...(notice === undefined ? [] : [textDisplay(notice)]),
      textDisplay(lines.join("\n")),
      separator(),
      textDisplay(
        setupComplete(settings)
          ? "Setup is complete."
          : `Setup is not complete: set the ${listing(missingSettings(settings))} under Settings.`,
      ),
      ...roundSection(state),
      ...rows,
    ]),
  ];
}

/** The round's open poll, if it has one. */
function openPoll(round: RoundView): PollView | null {
  return (
    [round.locationPoll, round.datePoll].find(
      (poll): poll is PollView => poll?.status === "open",
    ) ?? null
  );
}

/** What the round is doing: the open vote's tallies, or the decided location. */
function roundSection(state: AdminPanelState) {
  const { round, finished } = state;
  if (round === null) {
    const lines = finished
      ? [
          `**Last hike:** ${hikeSummary(finished)}`,
          pinLine(finished),
          ...threadLines(state.thread),
          ...eventLines(state.event),
          ...mapPictureLines(state.mapPicture),
          ...hikeDayLines(state),
          ...announcementLines(state.announcements),
        ]
      : [];
    if (setupComplete(state.settings)) {
      lines.push("No hike is being planned. Start a location vote.");
    }
    return lines.length === 0
      ? []
      : [separator(), textDisplay(lines.join("\n"))];
  }
  const lines: string[] = [];
  const open = openPoll(round);
  if (open !== null) {
    lines.push(openLine(open, state.voteMessage));
    if (open.options.length === 0) {
      lines.push("No options yet.");
    } else {
      lines.push(
        ...rankOptions(open.options).map(
          (option, i) =>
            `${String(i + 1)}. ${option.label}: ${votes(option.votes)}`,
        ),
      );
    }
    lines.push(voters(open.voterCount));
  }
  const decided = round.locationPoll;
  if (round.status !== "location_voting" && decided !== null) {
    const winner = decided.options.find(
      (option) => option.id === round.locationOptionId,
    );
    if (winner !== undefined) {
      lines.unshift(
        `**Location decided:** ${winner.label} (${votes(winner.votes)})${decided.tieBroken ? ", drawn at random from a tie" : ""}.`,
        pinLine(round),
      );
    }
  }
  lines.push(...announcementLines(state.announcements));
  return [separator(), textDisplay(lines.join("\n"))];
}

/** The open poll's first line: where its message is, or where that stands. */
function openLine(
  open: PollView,
  message: VoteMessageStatus | null | undefined,
): string {
  const name = POLL_NAMES[open.kind];
  const head = `**The ${name} is open**`;
  if (open.messageId !== null && open.channelId !== null) {
    return `${head} in <#${open.channelId}>.`;
  }
  switch (message?.state) {
    case "posting":
      return `${head}; its message is being posted.`;
    case "failed":
      return `${head}, but its message has not been posted. ${message.reason}`;
    case "unconfirmed":
      return `${head}, but its message is not confirmed: posting it was cut off, so it may or may not have been posted. Check the voting channel, and click Post vote message only if it is missing.`;
    case "missing":
      return `${head}, but its message has not been posted. Click Post vote message to post it.`;
    default:
      return `${head}, but its message has not been posted.`;
  }
}

/** Where each announcement not known to be posted stands. */
function announcementLines(
  announcements: readonly PollAnnouncement[] | undefined,
): string[] {
  return (announcements ?? []).map(({ kind, status }) => {
    const name = POLL_NAMES[kind];
    const head = `**${name.charAt(0).toUpperCase()}${name.slice(1)} announcement:**`;
    switch (status.state) {
      case "posting":
        return `${head} being posted.`;
      case "failed":
        return `${head} not posted. ${status.reason}`;
      case "unconfirmed":
        return `${head} not confirmed: posting it was cut off, so it may or may not have been posted. Check the announcements channel, and click Announce ${name} only if it is missing.`;
    }
  });
}

/**
 * Where the round's decided location is pinned: the place (or the
 * coordinates) with a map link, or why there is no pin.
 */
export function pinLine(round: RoundView): string {
  const place = round.locationPoll?.options.find(
    (option) => option.id === round.locationOptionId,
  )?.place;
  if (place?.point) {
    return `**Map pin:** ${place.name ?? formatPoint(place.point)} · [map](${osmLink(place.point, true)})`;
  }
  return place?.status === "pending"
    ? "**Map pin:** being looked up on OpenStreetMap."
    : "**Map pin:** none. Click Set map pin to add one.";
}

/** Where the last hike's forum thread stands, for its summary. */
function threadLines(thread: HikeThreadStatus | null | undefined): string[] {
  switch (thread?.state) {
    case "created":
      return [`**Hike thread:** <#${thread.threadId}>`];
    case "creating":
      return ["**Hike thread:** being created."];
    case "failed":
      return [`**Hike thread:** not created. ${thread.reason}`];
    case "unconfirmed":
      return [
        "**Hike thread:** not confirmed: creating it was cut off, so it may or may not exist. Check the hike threads channel, and click Create hike thread only if it is missing.",
      ];
    case "missing":
      return [
        "**Hike thread:** not created. Click Create hike thread to create it.",
      ];
    default:
      return [];
  }
}

/** Where the last hike's scheduled event stands, for its summary. */
function eventLines(event: HikeEventStatus | null | undefined): string[] {
  switch (event?.state) {
    case "created":
      return ["**Hike event:** created."];
    case "creating":
      return ["**Hike event:** being created."];
    case "past":
      return [
        "**Hike event:** The hike's start time has passed, so no event was created.",
      ];
    case "failed":
      return [`**Hike event:** not created. ${event.reason}`];
    case "unconfirmed":
      return [
        "**Hike event:** not confirmed: creating it was cut off, so it may or may not exist. Check the server's events, and click Create hike event only if it is missing.",
      ];
    case "missing":
      return [
        "**Hike event:** not created. Click Create hike event to create it.",
      ];
    default:
      return [];
  }
}

/**
 * Where the last hike's map picture stands, for its summary; nothing when
 * there is nothing to draw.
 */
function mapPictureLines(
  picture: MapPictureStatus | null | undefined,
): string[] {
  switch (picture?.state) {
    case "shown":
      return ["**Map picture:** on the hike thread and event."];
    case "showing":
      return ["**Map picture:** being drawn."];
    case "failed":
      return [`**Map picture:** not shown. ${picture.reason}`];
    case "unconfirmed":
      return [
        "**Map picture:** not confirmed: showing it was cut off, so the hike thread and event may or may not show it. Click Show map picture to show it again.",
      ];
    case "missing":
      return ["**Map picture:** not shown. Click Show map picture to draw it."];
    default:
      return [];
  }
}

/** Where the last hike's hike-day announcement stands, for its summary. */
function hikeDayLines({ hikeDay, settings }: AdminPanelState): string[] {
  const head = "**Hike-day announcement:**";
  switch (hikeDay?.status.state) {
    case "posted":
      return [`${head} posted in <#${hikeDay.status.channelId}>.`];
    case "planned": {
      const when = `<t:${String(Math.floor(hikeDay.at / 1000))}:f>`;
      return [
        settings.announceChannelId === null
          ? `${head} due ${when}, but no announcements channel is set, so it will not be posted. Pick one under Settings.`
          : `${head} ${when} in <#${settings.announceChannelId}>.`,
      ];
    }
    case "posting":
      return [`${head} being posted.`];
    case "failed":
      return [`${head} not posted. ${hikeDay.status.reason}`];
    case "unconfirmed":
      return [
        `${head} not confirmed: posting it was cut off, so it may or may not have been posted. Check the announcements channel, and click Post hike-day announcement only if it is missing.`,
      ];
    default:
      return [];
  }
}

/** A completed round's location and date: "Ridge Trail on Sat, 5 Dec 2026". */
export function hikeSummary(round: RoundView): string {
  const location = round.locationPoll?.options.find(
    (option) => option.id === round.locationOptionId,
  );
  const date = round.datePoll?.options.find(
    (option) => option.id === round.dateOptionId,
  );
  return `**${location?.label ?? "?"}** on **${date?.label ?? "?"}**.`;
}

function votes(n: number): string {
  return n === 1 ? "1 vote" : `${String(n)} votes`;
}

function voters(n: number): string {
  if (n === 0) return "No one has voted yet.";
  return n === 1 ? "1 member has voted." : `${String(n)} members have voted.`;
}

/**
 * The status view as a message body, for a follow-up job that replaces a
 * deferred panel update with `editOriginalInteractionResponse`.
 */
export function adminPanelBody(
  storage: DurableObjectStorage,
  notice?: string,
): RESTPatchAPIWebhookWithTokenMessageJSONBody {
  return messageBody(renderAdminPanel(loadAdminPanelState(storage), notice));
}

/**
 * `**Time zone:** America/Los_Angeles · now Wed 11:42`, the clock left out
 * when the state has no time.
 */
function timezoneLine({ settings, now }: AdminPanelState): string {
  const zone = settings.timezone;
  return `**Time zone:** ${zone}${now === undefined ? "" : ` · now ${clockIn(zone, now)}`}`;
}

/**
 * `**Home area:** Seattle, Washington (found as Seattle, King County,
 * Washington)`, or `not set` with what that means.
 */
export function homeAreaLine(settings: GuildSettings): string {
  const area = settings.homeArea;
  if (area === null) {
    return `**Home area:** ${NOT_SET} (locations are looked up worldwide)`;
  }
  return area.name === area.text
    ? `**Home area:** ${area.text}`
    : `**Home area:** ${area.text} (found as ${area.name})`;
}

/**
 * `**Schedule:** on · Wednesdays at 09:00 (America/Los_Angeles)`, then
 * what it does next with a Discord timestamp; `**Schedule:** off`.
 */
function scheduleLines({
  settings,
  round,
  nextScheduled,
}: AdminPanelState): string[] {
  const { cadence } = settings;
  if (!cadence.enabled) return ["**Schedule:** off"];
  const next =
    nextScheduled === null || nextScheduled === undefined
      ? round?.status === "date_voting"
        ? "**Next:** nothing until an admin closes the date vote, which was started before the schedule was turned on."
        : "**Next:** nothing in the coming weeks."
      : `**Next:** ${nextScheduled.what} ${discordTime(nextScheduled.at)} (${discordTime(nextScheduled.at, "R")}).`;
  return [
    `**Schedule:** on · ${WEEKDAY_NAMES[cadence.weekday] ?? "?"}s at ${cadence.time} (${settings.timezone}) · date vote ${dayCount(cadence.dateVoteDays)}`,
    next,
  ];
}

/** The Schedule part of the settings view: what it does and its controls. */
function scheduleSettings(state: AdminPanelState) {
  const { cadence } = state.settings;
  return [
    textDisplay(
      [
        "**Schedule**",
        `When it is on, hikebot runs the rounds by itself on the weekday and time below: it opens a location vote, closes it a week later and opens the date vote for the ${String(CADENCE_WINDOW_DAYS)} days after that vote closes, closes the date vote after the days below, and opens the next location vote on the first schedule day after the hike. Admins can still do each step by hand.`,
        ...scheduleLines(state),
      ].join("\n"),
    ),
    actionRow(
      stringSelect({
        custom_id: ADMIN_PANEL_IDS.cadenceDay,
        placeholder: "Pick the weekday",
        options: WEEKDAY_NAMES.map((name, day) => ({
          label: name,
          value: String(day),
          default: day === cadence.weekday,
        })),
      }),
    ),
    actionRow(
      stringSelect({
        custom_id: ADMIN_PANEL_IDS.cadenceDays,
        placeholder: "Pick how long the date vote stays open",
        options: Array.from(
          { length: MAX_DATE_VOTE_DAYS - MIN_DATE_VOTE_DAYS + 1 },
          (_, i) => MIN_DATE_VOTE_DAYS + i,
        ).map((days) => ({
          label: `Date vote open ${dayCount(days)}`,
          value: String(days),
          default: days === cadence.dateVoteDays,
        })),
      }),
    ),
    actionRow(
      button({
        custom_id: ADMIN_PANEL_IDS.cadence,
        label: cadence.enabled ? "Turn schedule off" : "Turn schedule on",
        style: cadence.enabled ? ButtonStyle.Danger : ButtonStyle.Primary,
      }),
      button({
        custom_id: ADMIN_PANEL_IDS.cadenceTime,
        label: "Set schedule time",
        style: ButtonStyle.Secondary,
      }),
    ),
  ];
}

/**
 * The settings view: one select per setting, each showing its value, the
 * time zone with its Set time zone button, the home area with its Set
 * home area button, and the schedule's controls.
 */
export function renderAdminSettings(
  state: AdminPanelState,
  notice?: string,
): APIMessageTopLevelComponent[] {
  const { settings } = state;
  return [
    container([
      textDisplay("## hikebot settings"),
      ...(notice === undefined ? [] : [textDisplay(notice)]),
      textDisplay(
        "**Admin role**\nMembers with this role can use the admin panel, besides the server owner. Clear it to leave the panel to the owner alone.",
      ),
      actionRow(
        roleSelect({
          custom_id: ADMIN_PANEL_IDS.role,
          placeholder: "Pick the admin role",
          min_values: 0,
          max_values: 1,
          ...(settings.adminRoleId === null
            ? {}
            : {
                default_values: [
                  {
                    id: settings.adminRoleId,
                    type: SelectMenuDefaultValueType.Role,
                  },
                ],
              }),
        }),
      ),
      ...CHANNEL_SETTINGS.flatMap((channel) => {
        const current = settings[channel.field];
        return [
          textDisplay(`**${channel.name}**\n${channel.help}`),
          actionRow(
            channelSelect({
              custom_id: CHANNEL_SELECT_IDS[channel.field],
              placeholder: `Pick the ${channel.name.toLowerCase()}`,
              channel_types: [...channel.types],
              min_values: 0,
              max_values: 1,
              ...(current === null
                ? {}
                : {
                    default_values: [
                      { id: current, type: SelectMenuDefaultValueType.Channel },
                    ],
                  }),
            }),
          ),
        ];
      }),
      textDisplay(
        `${timezoneLine(state)}\nDates are planned in this time zone; a date typed without a time starts at ${DEFAULT_HIKE_TIME}.`,
      ),
      actionRow(
        button({
          custom_id: ADMIN_PANEL_IDS.timezone,
          label: "Set time zone",
          style: ButtonStyle.Secondary,
        }),
      ),
      textDisplay(
        `${homeAreaLine(settings)}\nProposed locations are looked up on OpenStreetMap; matches near the home area come first.`,
      ),
      actionRow(
        button({
          custom_id: ADMIN_PANEL_IDS.homeArea,
          label: "Set home area",
          style: ButtonStyle.Secondary,
        }),
      ),
      textDisplay(
        `**Units:** ${settings.units}\nThe units of the hike's weather forecast.`,
      ),
      actionRow(
        stringSelect({
          custom_id: ADMIN_PANEL_IDS.units,
          placeholder: "Pick the units",
          options: UNITS.map((units) => ({
            label: UNIT_NAMES[units],
            value: units,
            default: units === settings.units,
          })),
        }),
      ),
      separator(),
      ...scheduleSettings(state),
    ]),
    actionRow(
      button({
        custom_id: ADMIN_PANEL_IDS.back,
        label: "Back",
        style: ButtonStyle.Secondary,
      }),
    ),
  ];
}

/**
 * Re-renders the status view in place of the panel message the interaction
 * came from. Features call this after their own panel actions.
 */
export function adminPanelUpdate(
  context: HandlerContext,
  notice?: string,
): HandlerResult {
  return {
    response: update(
      renderAdminPanel(loadAdminPanelState(context.storage), notice),
    ),
  };
}

/** `/hike admin`: opens the panel's status view as an ephemeral reply. */
export const openAdminPanel: CommandHandler = adminOnly((_i, context) => ({
  response: ephemeralReply(
    renderAdminPanel(loadAdminPanelState(context.storage)),
  ),
}));

const showStatus: ComponentHandler = adminOnly((_i, context) =>
  adminPanelUpdate(context),
);

const showSettings: ComponentHandler = adminOnly((_i, context) => ({
  response: update(renderAdminSettings(loadAdminPanelState(context.storage))),
}));

const saveAdminRole: ComponentHandler = adminOnly((interaction, context) => {
  const roleId = selected(interaction, ComponentType.RoleSelect);
  if (roleId === undefined)
    return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
  const refusal = checkAdminRole(interaction.guild_id ?? "", roleId);
  if (refusal !== null) return settingsUpdate(context, refusal);
  return settingsUpdate(context, setAdminRole(context.storage, roleId));
});

/**
 * Saves the channel picked for `channel`, or clears it, after checking that
 * the channel is in the interaction's `resolved` channels with a type the
 * setting takes.
 */
function saveChannel(channel: ChannelSetting): ComponentHandler {
  return adminOnly((interaction, context) => {
    const channelId = selected(interaction, ComponentType.ChannelSelect);
    if (channelId === undefined) {
      return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
    }
    if (channelId !== null) {
      const resolved =
        interaction.data.component_type === ComponentType.ChannelSelect
          ? interaction.data.resolved.channels[channelId]
          : undefined;
      const refusal = checkChannel(channel, resolved);
      if (refusal !== null) return settingsUpdate(context, refusal);
    }
    return settingsUpdate(
      context,
      setChannel(context.storage, channel, channelId),
    );
  });
}

/**
 * Saves the units picked for the forecast and runs the weather job at
 * once, so the forecast is fetched again in them.
 */
const saveUnits: ComponentHandler = adminOnly(async (interaction, context) => {
  const units = checkUnits(
    interaction.data.component_type === ComponentType.StringSelect
      ? interaction.data.values[0]
      : undefined,
  );
  if (units === null) {
    return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
  }
  return settingsUpdate(context, await setUnits(context.storage, units));
});

/** The longest time zone name the modal takes. */
const MAX_TIMEZONE_INPUT = 64;

/** Set time zone: opens the modal, prefilled with the current zone. */
const openTimezoneModal: ComponentHandler = adminOnly(
  (_interaction, _context, settings) => ({
    response: modal(ADMIN_PANEL_IDS.timezone, "Set time zone", [
      label(
        "Time zone",
        textInput({
          custom_id: ADMIN_PANEL_FIELDS.timezone,
          required: true,
          max_length: MAX_TIMEZONE_INPUT,
          value: settings.timezone,
          placeholder: "America/Los_Angeles",
        }),
        "An IANA name such as Europe/Berlin, or PT, MT, CT, ET or UTC.",
      ),
    ]),
  }),
);

/**
 * The time zone modal: stores the zone in its canonical spelling and
 * redraws the settings view, or changes nothing and tells the admin what
 * was typed and what would work.
 */
const saveTimezone: ModalHandler = adminOnly(
  async (interaction: APIModalSubmitInteraction, context, settings) => {
    const zone = checkTimeZone(
      textInputValue(interaction.data, ADMIN_PANEL_FIELDS.timezone) ?? "",
      settings,
    );
    if (!zone.ok) {
      return { response: ephemeralNotice(noticeMarkdown(zone.refusal)) };
    }
    const notice = await setTimeZone(
      context,
      interaction.guild_id ?? "",
      zone.value,
    );
    return settingsAnswer(interaction, context, notice);
  },
);

/**
 * Turn schedule on / off. Turning it on is refused, naming what is missing,
 * until the voting, announcements and hike threads channels are set; it
 * then acts from the next cadence instant on. Turning it off stops the job
 * and leaves any open vote as it is.
 */
const toggleCadence: ComponentHandler = adminOnly(
  async (interaction, context, settings) => {
    const turnOn = !settings.cadence.enabled;
    const refusal = turnOn ? checkScheduleOn(settings) : null;
    if (refusal !== null) return settingsUpdate(context, refusal);
    const [notice] = await changeCadence(interaction, context, {
      enabled: turnOn,
    });
    return settingsUpdate(context, notice ?? []);
  },
);

/** The weekday select: moves the schedule to the picked day. */
const saveCadenceDay: ComponentHandler = adminOnly(
  async (interaction, context) => {
    const day = checkWeekday(picked(interaction));
    if (day === null) return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
    const [notice] = await changeCadence(interaction, context, {
      weekday: day,
    });
    return settingsUpdate(context, notice ?? []);
  },
);

/** The date vote length select. */
const saveCadenceDays: ComponentHandler = adminOnly(
  async (interaction, context) => {
    const days = checkDateVoteDays(picked(interaction));
    if (days === null) {
      return { response: ephemeralNotice(UNAVAILABLE_MESSAGE) };
    }
    const [notice] = await changeCadence(interaction, context, {
      dateVoteDays: days,
    });
    return settingsUpdate(context, notice ?? []);
  },
);

/** Set schedule time: opens the modal, prefilled with the current time. */
const openCadenceTimeModal: ComponentHandler = adminOnly(
  (_interaction, _context, settings) => ({
    response: modal(ADMIN_PANEL_IDS.cadenceTime, "Set schedule time", [
      label(
        "Time of day",
        textInput({
          custom_id: ADMIN_PANEL_FIELDS.cadenceTime,
          required: true,
          max_length: 5,
          value: settings.cadence.time,
          placeholder: "09:00",
        }),
        `HH:MM, 24-hour, in ${settings.timezone}.`,
      ),
    ]),
  }),
);

/** The schedule time modal: stores a valid `HH:MM`, or says what works. */
const saveCadenceTime: ModalHandler = adminOnly(
  async (interaction: APIModalSubmitInteraction, context, settings) => {
    const time = checkTimeOfDay(
      textInputValue(interaction.data, ADMIN_PANEL_FIELDS.cadenceTime) ?? "",
      settings,
    );
    if (!time.ok) {
      return { response: ephemeralNotice(noticeMarkdown(time.refusal)) };
    }
    const [notice] = await changeCadence(interaction, context, {
      time: time.value,
    });
    return settingsAnswer(interaction, context, notice ?? []);
  },
);

/** Stores the schedule change and reschedules the job from it. */
function changeCadence(
  interaction: APIMessageComponentInteraction | APIModalSubmitInteraction,
  context: HandlerContext,
  change: ScheduleChange,
): Promise<Notice[]> {
  return changeSchedule(context, interaction.guild_id ?? "", change);
}

/** The one value picked in a string select. */
function picked(
  interaction: APIMessageComponentInteraction,
): string | undefined {
  return interaction.data.component_type === ComponentType.StringSelect
    ? interaction.data.values[0]
    : undefined;
}

/** Redraws the settings view with `notice` above it. */
function settingsUpdate(
  context: HandlerContext,
  notice: Notice,
): HandlerResult {
  return {
    response: update(
      renderAdminSettings(
        loadAdminPanelState(context.storage),
        noticeMarkdown(notice),
      ),
    ),
  };
}

/**
 * A modal's answer: the settings view with `notice`, in place of the panel
 * message the modal came from, or as a new ephemeral reply without one.
 */
export function settingsAnswer(
  interaction: APIModalSubmitInteraction,
  context: HandlerContext,
  notice: Notice,
): HandlerResult {
  const components = renderAdminSettings(
    loadAdminPanelState(context.storage),
    noticeMarkdown(notice),
  );
  return {
    response:
      interaction.message === undefined
        ? ephemeralReply(components)
        : update(components),
  };
}

/**
 * The one value picked in a role or channel select, null if it was cleared,
 * or undefined if the interaction did not come from a select of `type`.
 */
function selected(
  interaction: APIMessageComponentInteraction,
  type: ComponentType.RoleSelect | ComponentType.ChannelSelect,
): string | null | undefined {
  if (interaction.data.component_type !== type) return undefined;
  return interaction.data.values[0] ?? null;
}

function channelMention(id: string | null): string {
  return id === null ? NOT_SET : `<#${id}>`;
}

/** Registers the panel's buttons, selects and the time zone modal. */
export function registerAdminPanel(router: Router): Router {
  router.component(ADMIN_PANEL_IDS.settings, showSettings);
  router.component(ADMIN_PANEL_IDS.refresh, showStatus);
  router.component(ADMIN_PANEL_IDS.back, showStatus);
  router.component(ADMIN_PANEL_IDS.role, saveAdminRole);
  for (const channel of CHANNEL_SETTINGS) {
    router.component(CHANNEL_SELECT_IDS[channel.field], saveChannel(channel));
  }
  router.component(ADMIN_PANEL_IDS.timezone, openTimezoneModal);
  router.modal(ADMIN_PANEL_IDS.timezone, saveTimezone);
  router.component(ADMIN_PANEL_IDS.cadence, toggleCadence);
  router.component(ADMIN_PANEL_IDS.cadenceDay, saveCadenceDay);
  router.component(ADMIN_PANEL_IDS.cadenceDays, saveCadenceDays);
  router.component(ADMIN_PANEL_IDS.cadenceTime, openCadenceTimeModal);
  router.modal(ADMIN_PANEL_IDS.cadenceTime, saveCadenceTime);
  router.component(ADMIN_PANEL_IDS.units, saveUnits);
  return router;
}
