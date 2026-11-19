/**
 * The web settings page's side of the guild's settings: the admin-only
 * section of the web view that fills the page's forms (every setting's
 * value, and the roles and channels to pick from, as Discord names them),
 * and the save of one group of settings posted from the page. A save
 * checks every field with the checks the admin panel uses, changes nothing
 * if one is refused, and otherwise makes each change with the panel's own
 * functions (`settings.ts`), so it has the same effects.
 */
import { ChannelType } from "discord-api-types/v10";
import type { HandlerContext } from "../guild/router";
import type { WebViewSource } from "../guild/web-view";
import type { CadenceSettings, GuildSettings } from "../guild/config";
import { clockIn } from "../polls/dates";
import type { Units } from "../weather/forecast";
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
  clearHomeArea,
  homeAreaText,
  MAX_HOME_AREA,
  missingSettings,
  setAdminRole,
  setChannel,
  setTimeZone,
  setUnits,
  timeZoneNames,
  UNAVAILABLE,
  type Notice,
  type ScheduleChange,
} from "./settings";
import { lookUpHomeArea } from "./home-area";
import {
  CHANNEL_SETTINGS,
  type ChannelSetting,
  type SettingGroupId,
  type SettingKey,
} from "./settings-catalogue";

/** The guild's roles and channels as Discord listed them, for the form. */
export interface SettingsDirectory {
  roles: { id: string; name: string; position: number }[];
  channels: {
    id: string;
    name: string;
    type: ChannelType;
    parentId: string | null;
    position: number;
  }[];
}

/** A role to pick, by name. */
export interface WebRoleChoice {
  id: string;
  name: string;
}

/** A channel to pick, by name, with the category it is in. */
export interface WebChannelChoice {
  id: string;
  name: string;
  /** The category's name, null for a channel in none. */
  category: string | null;
}

/** Everything the settings page's forms show, for an admin only. */
export interface WebSettingsForm {
  values: {
    adminRoleId: string | null;
    voteChannelId: string | null;
    announceChannelId: string | null;
    forumChannelId: string | null;
    timezone: string;
    homeArea: { text: string; name: string } | null;
    units: Units;
    cadence: Omit<CadenceSettings, "onSince">;
  };
  /** The roles an admin role can be, highest first, without @everyone. */
  roles: WebRoleChoice[];
  /**
   * For each channel setting, the channels of the types it takes, in
   * Discord's order: those in no category first, then by category.
   */
  channels: Record<ChannelSetting["field"], WebChannelChoice[]>;
  /** Every IANA time zone, sorted. */
  timeZones: string[];
  /** The time now in the server's time zone: `Wed 11:42`. */
  localTime: string;
  /** The instant `localTime` is, in milliseconds since the epoch. */
  now: number;
  /** The most characters a home area takes. */
  maxHomeArea: number;
  /**
   * The channels setup still needs, as the panel names them ("voting
   * channel"); empty once setup is complete.
   */
  missingChannels: string[];
}

/**
 * The form's section of the view: null unless the read asked for it and the
 * viewer is an admin (the source then carries the directory).
 */
export function settingsFormSection(
  source: WebViewSource,
): WebSettingsForm | null {
  const directory = source.settingsDirectory;
  if (directory === undefined || directory === null || !source.isAdmin) {
    return null;
  }
  const { settings } = source;
  return {
    values: {
      adminRoleId: settings.adminRoleId,
      voteChannelId: settings.voteChannelId,
      announceChannelId: settings.announceChannelId,
      forumChannelId: settings.forumChannelId,
      timezone: settings.timezone,
      homeArea:
        settings.homeArea === null
          ? null
          : { text: settings.homeArea.text, name: settings.homeArea.name },
      units: settings.units,
      cadence: {
        enabled: settings.cadence.enabled,
        weekday: settings.cadence.weekday,
        time: settings.cadence.time,
        dateVoteDays: settings.cadence.dateVoteDays,
      },
    },
    roles: roleChoices(directory, source.guildId),
    channels: {
      voteChannelId: channelChoices(directory, CHANNEL_SETTINGS[0]),
      announceChannelId: channelChoices(directory, CHANNEL_SETTINGS[1]),
      forumChannelId: channelChoices(directory, CHANNEL_SETTINGS[2]),
    },
    timeZones: timeZoneNames(),
    localTime: clockIn(settings.timezone, source.now),
    now: source.now,
    maxHomeArea: MAX_HOME_AREA,
    missingChannels: missingSettings(settings),
  };
}

/** The roles, highest first as Discord lists them, without @everyone. */
export function roleChoices(
  directory: SettingsDirectory,
  guildId: string,
): WebRoleChoice[] {
  return directory.roles
    .filter((role) => role.id !== guildId)
    .sort((a, b) => b.position - a.position)
    .map(({ id, name }) => ({ id, name }));
}

/**
 * The channels `setting` takes, as Discord's channel list shows them:
 * those in no category first, then each category in its order, each
 * channel in its order within.
 */
export function channelChoices(
  directory: SettingsDirectory,
  setting: ChannelSetting,
): WebChannelChoice[] {
  const allowed: readonly ChannelType[] = setting.types;
  const categories = new Map(
    directory.channels
      .filter((channel) => channel.type === ChannelType.GuildCategory)
      .map((category) => [category.id, category]),
  );
  const rank = (channel: SettingsDirectory["channels"][number]) => {
    const category =
      channel.parentId === null ? undefined : categories.get(channel.parentId);
    return [category === undefined ? -1 : category.position, channel.position];
  };
  return directory.channels
    .filter((channel) => allowed.includes(channel.type))
    .sort((a, b) => {
      const [ca = 0, pa = 0] = rank(a);
      const [cb = 0, pb = 0] = rank(b);
      return ca - cb || pa - pb || a.name.localeCompare(b.name);
    })
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      category:
        channel.parentId === null
          ? null
          : (categories.get(channel.parentId)?.name ?? null),
    }));
}

/** A field the save refused, and why, in the panel's words. */
export interface SettingRefusal {
  key: SettingKey;
  refusal: Notice;
}

/** What saving a group did: saved with what it says, or refused. */
export type SettingsSave =
  | { kind: "saved"; notices: Notice[] }
  | { kind: "refused"; errors: SettingRefusal[] };

/** The form's fields as posted: name to value, one value each. */
export type SettingsFields = Record<string, string>;

/**
 * Saves group `group` from the posted `fields`. Every field is checked as
 * the panel checks it; a field equal to the stored value is left alone. If
 * any field is refused nothing changes; otherwise each change is made with
 * the panel's function, and the save says what each did (nothing when
 * no field changed).
 */
export async function saveSettingsGroup(
  context: HandlerContext,
  guildId: string,
  settings: GuildSettings,
  directory: SettingsDirectory,
  group: SettingGroupId,
  fields: SettingsFields,
): Promise<SettingsSave> {
  return GROUP_SAVES[group]({ context, guildId, settings, directory }, fields);
}

interface SaveInput {
  context: HandlerContext;
  guildId: string;
  settings: GuildSettings;
  directory: SettingsDirectory;
}

type GroupSave = (
  input: SaveInput,
  fields: SettingsFields,
) => Promise<SettingsSave> | SettingsSave;

/** A posted id, null for the empty choice ("none"). */
function pickedId(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === "" ? null : value;
}

function refused(key: SettingKey, refusal: Notice): SettingsSave {
  return { kind: "refused", errors: [{ key, refusal }] };
}

const saveAdminRoleGroup: GroupSave = (
  { context, guildId, settings, directory },
  fields,
) => {
  const roleId = pickedId(fields.adminRoleId);
  if (roleId === undefined) return refused("adminRoleId", UNAVAILABLE);
  if (roleId === settings.adminRoleId) return { kind: "saved", notices: [] };
  const refusal = checkAdminRole(guildId, roleId);
  if (refusal !== null) return refused("adminRoleId", refusal);
  if (roleId !== null && !directory.roles.some((role) => role.id === roleId)) {
    return refused("adminRoleId", UNAVAILABLE);
  }
  return {
    kind: "saved",
    notices: [setAdminRole(context.storage, roleId)],
  };
};

const saveChannelsGroup: GroupSave = (
  { context, settings, directory },
  fields,
) => {
  const changes: { channel: ChannelSetting; id: string | null }[] = [];
  const errors: SettingRefusal[] = [];
  for (const channel of CHANNEL_SETTINGS) {
    const id = pickedId(fields[channel.field]);
    if (id === undefined) {
      errors.push({ key: channel.field, refusal: UNAVAILABLE });
      continue;
    }
    if (id === settings[channel.field]) continue;
    if (id !== null) {
      const found = directory.channels.find((c) => c.id === id);
      const refusal = checkChannel(channel, found);
      if (refusal !== null) {
        errors.push({ key: channel.field, refusal });
        continue;
      }
    }
    changes.push({ channel, id });
  }
  if (errors.length > 0) return { kind: "refused", errors };
  return {
    kind: "saved",
    notices: changes.map(({ channel, id }) =>
      setChannel(context.storage, channel, id),
    ),
  };
};

const saveTimeZoneGroup: GroupSave = async (
  { context, guildId, settings },
  fields,
) => {
  const zone = checkTimeZone(fields.timezone ?? "", settings);
  if (!zone.ok) return refused("timezone", zone.refusal);
  if (zone.value === settings.timezone) return { kind: "saved", notices: [] };
  return {
    kind: "saved",
    notices: [await setTimeZone(context, guildId, zone.value)],
  };
};

const saveHomeAreaGroup: GroupSave = async ({ context, settings }, fields) => {
  const typed = fields.homeArea;
  if (typed === undefined) return refused("homeArea", UNAVAILABLE);
  const text = homeAreaText(typed).slice(0, MAX_HOME_AREA);
  if (text === "") {
    return settings.homeArea === null
      ? { kind: "saved", notices: [] }
      : { kind: "saved", notices: [clearHomeArea(context.storage)] };
  }
  if (settings.homeArea?.text === text) return { kind: "saved", notices: [] };
  const result = await lookUpHomeArea(context, text);
  return result.ok
    ? { kind: "saved", notices: [result.value] }
    : refused("homeArea", result.refusal);
};

const saveUnitsGroup: GroupSave = async ({ context, settings }, fields) => {
  const units = checkUnits(fields.units);
  if (units === null) return refused("units", UNAVAILABLE);
  if (units === settings.units) return { kind: "saved", notices: [] };
  return { kind: "saved", notices: [await setUnits(context.storage, units)] };
};

const saveScheduleGroup: GroupSave = async (
  { context, guildId, settings },
  fields,
) => {
  const { cadence } = settings;
  const errors: SettingRefusal[] = [];
  const change: ScheduleChange = {};

  const weekday = checkWeekday(fields["cadence.weekday"]);
  if (weekday === null) {
    errors.push({ key: "cadence.weekday", refusal: UNAVAILABLE });
  } else if (weekday !== cadence.weekday) {
    change.weekday = weekday;
  }

  const days = checkDateVoteDays(fields["cadence.dateVoteDays"]);
  if (days === null) {
    errors.push({ key: "cadence.dateVoteDays", refusal: UNAVAILABLE });
  } else if (days !== cadence.dateVoteDays) {
    change.dateVoteDays = days;
  }

  const time = checkTimeOfDay(fields["cadence.time"] ?? "", settings);
  if (!time.ok) {
    errors.push({ key: "cadence.time", refusal: time.refusal });
  } else if (time.value !== cadence.time) {
    change.time = time.value;
  }

  const enabled = fields["cadence.enabled"];
  if (enabled !== "on" && enabled !== "off") {
    errors.push({ key: "cadence.enabled", refusal: UNAVAILABLE });
  } else if ((enabled === "on") !== cadence.enabled) {
    const refusal = enabled === "on" ? checkScheduleOn(settings) : null;
    if (refusal === null) change.enabled = enabled === "on";
    else errors.push({ key: "cadence.enabled", refusal });
  }

  if (errors.length > 0) return { kind: "refused", errors };
  if (Object.keys(change).length === 0) return { kind: "saved", notices: [] };
  return {
    kind: "saved",
    notices: await changeSchedule(context, guildId, change),
  };
};

const GROUP_SAVES: Record<SettingGroupId, GroupSave> = {
  "admin-role": saveAdminRoleGroup,
  channels: saveChannelsGroup,
  "time-zone": saveTimeZoneGroup,
  "home-area": saveHomeAreaGroup,
  units: saveUnitsGroup,
  schedule: saveScheduleGroup,
};
