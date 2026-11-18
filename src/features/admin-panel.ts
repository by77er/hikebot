import {
  ButtonStyle,
  ChannelType,
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
  textDisplay,
  textInput,
  textInputValue,
  update,
} from "../discord/components";
import {
  GuildConfig,
  setupComplete,
  type GuildSettings,
  type SettingField,
} from "../guild/config";
import { ephemeralNotice } from "../discord/responses";
import { adminOnly } from "../guild/permissions";
import { DEFAULT_HIKE_TIME, clockIn, normalizeTimeZone } from "../polls/dates";
import {
  PollStore,
  type PollKind,
  type PollView,
  type RoundView,
} from "../polls/store";
import { rankOptions } from "../polls/tally";
import type {
  CommandHandler,
  ComponentHandler,
  HandlerContext,
  HandlerResult,
  ModalHandler,
  Router,
} from "../guild/router";
import { UNAVAILABLE_MESSAGE } from "../guild/router";
import {
  announcementStatus,
  type AnnouncementStatus,
} from "./announcement-state";
import { hikeEventStatus, type HikeEventStatus } from "./hike-event-state";
import { hikeThreadStatus, type HikeThreadStatus } from "./hike-thread-state";

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
  /**
   * The announcements of the shown round's closed polls (the active
   * round's, or the finished one's) that are not known to be posted.
   */
  announcements?: PollAnnouncement[];
  /** The time the panel is drawn at, for the clock in the guild's zone. */
  now?: number;
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
} as const;

/** The fields of the panel's modals, read back from their submissions. */
export const ADMIN_PANEL_FIELDS = {
  timezone: customId("admin", "timezone-name"),
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
  announce: (pollId: number) => customId("poll", "announce", String(pollId)),
} as const;

/** How the panel names each kind of poll. */
export const POLL_NAMES: Record<PollKind, string> = {
  location: "location vote",
  date: "date vote",
};

const NOT_SET = "not set";

/** The channel settings, the channel types each accepts and their names. */
const CHANNEL_SETTINGS = [
  {
    field: "voteChannelId",
    id: ADMIN_PANEL_IDS.voteChannel,
    name: "Voting channel",
    help: "Where the location and date polls are posted. Text channels only.",
    types: [ChannelType.GuildText],
  },
  {
    field: "announceChannelId",
    id: ADMIN_PANEL_IDS.announceChannel,
    name: "Announcements channel",
    help: "Where results are announced. Text or announcement channels.",
    types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
  },
  {
    field: "forumChannelId",
    id: ADMIN_PANEL_IDS.forumChannel,
    name: "Hike threads channel",
    help: "The forum that gets a thread for each hike. Forum channels only.",
    types: [ChannelType.GuildForum],
  },
] as const satisfies readonly {
  field: SettingField;
  id: string;
  name: string;
  help: string;
  types: readonly ChannelType[];
}[];

export function loadAdminPanelState(
  storage: DurableObjectStorage,
): AdminPanelState {
  const store = new PollStore(storage);
  const round = store.getActiveRound();
  const last = round === null ? store.getLastRound() : null;
  const finished = last?.status === "complete" ? last : null;
  const settings = new GuildConfig(storage).get();
  const now = store.now();
  return {
    settings,
    round,
    finished,
    thread: finished === null ? null : hikeThreadStatus(storage, finished, now),
    event:
      finished === null
        ? null
        : hikeEventStatus(storage, finished, now, settings.timezone),
    announcements: pollAnnouncements(storage, round ?? finished, now),
    now,
  };
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

/** Announce <vote> for each announcement that failed or was cut off. */
function announceButtons(
  state: AdminPanelState,
): APIButtonComponentWithCustomId[] {
  return (state.announcements ?? [])
    .filter(({ status }) => status.state !== "posting")
    .map(({ pollId, kind }) =>
      button({
        custom_id: POLL_CONTROL_IDS.announce(pollId),
        label: `Announce ${POLL_NAMES[kind]}`,
        style: ButtonStyle.Secondary,
      }),
    );
}

/**
 * The buttons the status view offers for the current state, in display
 * order. Poll controls (start or close a vote) go here, before Settings and
 * Refresh, each registered through `adminOnly`.
 */
export function actionButtons(
  state: AdminPanelState,
): APIButtonComponentWithCustomId[] {
  return [...pollButtons(state), ...settingsButtons(state)];
}

function pollButtons(state: AdminPanelState): APIButtonComponentWithCustomId[] {
  const { round } = state;
  if (round === null) {
    const { finished, thread, event } = state;
    return [
      ...(setupComplete(state.settings)
        ? [
            button({
              custom_id: POLL_CONTROL_IDS.startLocationVote,
              label: "Start location vote",
            }),
          ]
        : []),
      // Only while the last round is complete without a thread.
      ...(finished &&
      (thread?.state === "missing" ||
        thread?.state === "failed" ||
        thread?.state === "unconfirmed")
        ? [
            button({
              custom_id: POLL_CONTROL_IDS.createHikeThread(finished.id),
              label: "Create hike thread",
              style: ButtonStyle.Secondary,
            }),
          ]
        : []),
      // Only while the last round is complete without an event, and its
      // start is ahead.
      ...(finished &&
      (event?.state === "missing" ||
        event?.state === "failed" ||
        event?.state === "unconfirmed")
        ? [
            button({
              custom_id: POLL_CONTROL_IDS.createHikeEvent(finished.id),
              label: "Create hike event",
              style: ButtonStyle.Secondary,
            }),
          ]
        : []),
      ...announceButtons(state),
    ];
  }
  const open = openPoll(round);
  return [
    ...(round.status === "location_decided"
      ? [
          button({
            custom_id: POLL_CONTROL_IDS.startDateVote,
            label: "Start date vote",
          }),
        ]
      : []),
    ...(open === null
      ? []
      : [
          button({
            custom_id: POLL_CONTROL_IDS.closePoll(open.id),
            label: `Close ${POLL_NAMES[open.kind]}`,
          }),
        ]),
    ...announceButtons(state),
    button({
      custom_id: POLL_CONTROL_IDS.cancelRound(round.id),
      label: "Cancel round",
      style: ButtonStyle.Danger,
    }),
  ];
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
          ...threadLines(state.thread),
          ...eventLines(state.event),
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
    const name = POLL_NAMES[open.kind];
    lines.push(
      open.messageId === null || open.channelId === null
        ? `**The ${name} is open**, but its message has not been posted.`
        : `**The ${name} is open** in <#${open.channelId}>.`,
    );
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
      );
    }
  }
  lines.push(...announcementLines(state.announcements));
  return [separator(), textDisplay(lines.join("\n"))];
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

/** The settings setup still needs, named as the panel shows them. */
export function missingSettings(settings: GuildSettings): string[] {
  return CHANNEL_SETTINGS.filter(
    (channel) => settings[channel.field] === null,
  ).map((channel) => channel.name.toLowerCase());
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
 * The settings view: one select per setting, each showing its value, and
 * the time zone with its Set time zone button.
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
              custom_id: channel.id,
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
  if (roleId !== null && roleId === interaction.guild_id) {
    return settingsUpdate(
      context,
      "The @everyone role cannot be the admin role. Pick another role.",
    );
  }
  new GuildConfig(context.storage).set("adminRoleId", roleId);
  return settingsUpdate(
    context,
    roleId === null
      ? "Admin role cleared: only the server owner can use the panel."
      : `Admin role set to <@&${roleId}>.`,
  );
});

/**
 * Saves the channel picked for `channel`, or clears it, after checking that
 * the channel is in the interaction's `resolved` channels with a type the
 * setting takes.
 */
function saveChannel(
  channel: (typeof CHANNEL_SETTINGS)[number],
): ComponentHandler {
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
      const allowed: readonly ChannelType[] = channel.types;
      if (resolved === undefined || !allowed.includes(resolved.type)) {
        return settingsUpdate(
          context,
          `That channel cannot be the ${channel.name.toLowerCase()}. ${channel.help}`,
        );
      }
    }
    new GuildConfig(context.storage).set(channel.field, channelId);
    return settingsUpdate(
      context,
      channelId === null
        ? `${channel.name} cleared.`
        : `${channel.name} set to <#${channelId}>.`,
    );
  });
}

/** The longest time zone name the modal takes. */
const MAX_TIMEZONE_INPUT = 64;

const TIMEZONE_EXAMPLES =
  "`America/Los_Angeles`, `Europe/Berlin` or `Asia/Kolkata`";

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
  (interaction: APIModalSubmitInteraction, context, settings) => {
    const typed =
      textInputValue(interaction.data, ADMIN_PANEL_FIELDS.timezone) ?? "";
    const zone = normalizeTimeZone(typed);
    if (zone === null) {
      const what =
        typed.trim() === ""
          ? "No time zone was entered"
          : `\`${quotedInput(typed.trim())}\` is not a time zone`;
      return {
        response: ephemeralNotice(
          `${what}, so it is still ${settings.timezone}. Enter an IANA name such as ${TIMEZONE_EXAMPLES}, or PT, MT, CT, ET or UTC.`,
        ),
      };
    }
    new GuildConfig(context.storage).setTimezone(zone);
    const components = renderAdminSettings(
      loadAdminPanelState(context.storage),
      `Time zone set to ${zone}.`,
    );
    return {
      response:
        interaction.message === undefined
          ? ephemeralReply(components)
          : update(components),
    };
  },
);

/** Typed text to quote: shortened and without backticks. */
function quotedInput(text: string): string {
  const plain = text.replaceAll("`", "'");
  return plain.length <= 40 ? plain : `${plain.slice(0, 39)}…`;
}

function settingsUpdate(
  context: HandlerContext,
  notice: string,
): HandlerResult {
  return {
    response: update(
      renderAdminSettings(loadAdminPanelState(context.storage), notice),
    ),
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

/** `a`, `a and b`, `a, b and c`. */
export function listing(items: string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
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
    router.component(channel.id, saveChannel(channel));
  }
  router.component(ADMIN_PANEL_IDS.timezone, openTimezoneModal);
  router.modal(ADMIN_PANEL_IDS.timezone, saveTimezone);
  return router;
}
