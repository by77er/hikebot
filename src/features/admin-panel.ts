import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  SelectMenuDefaultValueType,
  type APIButtonComponentWithCustomId,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
  type RESTPatchAPIWebhookWithTokenMessageJSONBody,
} from "discord-api-types/v10";
import {
  actionRow,
  button,
  channelSelect,
  container,
  customId,
  ephemeralReply,
  messageBody,
  roleSelect,
  separator,
  textDisplay,
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
  Router,
} from "../guild/router";
import { UNAVAILABLE_MESSAGE } from "../guild/router";

/** Everything the panel shows. Later features add their state here. */
export interface AdminPanelState {
  settings: GuildSettings;
  /** The active round (neither complete nor cancelled), if any. */
  round: RoundView | null;
}

export const ADMIN_PANEL_IDS = {
  settings: customId("admin", "settings"),
  refresh: customId("admin", "refresh"),
  back: customId("admin", "back"),
  role: customId("admin", "role"),
  voteChannel: customId("admin", "vote-channel"),
  announceChannel: customId("admin", "announce-channel"),
  forumChannel: customId("admin", "forum-channel"),
} as const;

/** The panel's poll controls; their handlers live with the poll features. */
export const POLL_CONTROL_IDS = {
  startLocationVote: customId("location", "start"),
  closePoll: (pollId: number) => customId("poll", "close", String(pollId)),
  cancelRound: (roundId: number) =>
    customId("round", "cancel", String(roundId)),
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
  return {
    settings: new GuildConfig(storage).get(),
    round: new PollStore(storage).getActiveRound(),
  };
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
    return setupComplete(state.settings)
      ? [
          button({
            custom_id: POLL_CONTROL_IDS.startLocationVote,
            label: "Start location vote",
          }),
        ]
      : [];
  }
  const open = openPoll(round);
  return [
    ...(open === null
      ? []
      : [
          button({
            custom_id: POLL_CONTROL_IDS.closePoll(open.id),
            label: `Close ${POLL_NAMES[open.kind]}`,
          }),
        ]),
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
  const { round } = state;
  if (round === null) {
    return setupComplete(state.settings)
      ? [
          separator(),
          textDisplay("No hike is being planned. Start a location vote."),
        ]
      : [];
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
  return [separator(), textDisplay(lines.join("\n"))];
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

/** The settings view: one select per setting, each showing its value. */
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
function listing(items: string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

function channelMention(id: string | null): string {
  return id === null ? NOT_SET : `<#${id}>`;
}

/** Registers the panel's buttons and selects. */
export function registerAdminPanel(router: Router): Router {
  router.component(ADMIN_PANEL_IDS.settings, showSettings);
  router.component(ADMIN_PANEL_IDS.refresh, showStatus);
  router.component(ADMIN_PANEL_IDS.back, showStatus);
  router.component(ADMIN_PANEL_IDS.role, saveAdminRole);
  for (const channel of CHANNEL_SETTINGS) {
    router.component(channel.id, saveChannel(channel));
  }
  return router;
}
