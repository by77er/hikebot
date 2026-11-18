import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  SelectMenuDefaultValueType,
  type APIButtonComponentWithCustomId,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import {
  actionRow,
  button,
  channelSelect,
  container,
  customId,
  ephemeralReply,
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
  return { settings: new GuildConfig(storage).get() };
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
          : "Setup is not complete: set the voting, announcements and hike threads channels under Settings.",
      ),
      ...rows,
    ]),
  ];
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
