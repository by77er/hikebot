/**
 * The list of the guild's settings an admin changes, in the groups both
 * surfaces show them in: the admin panel's Settings view in Discord and the
 * settings page on the web. Plain data only (names, one-sentence
 * explanations, the channel types a channel setting takes), so a page can
 * read it; the checks and changes are in `settings.ts`.
 */
import { ChannelType } from "discord-api-types/v10";
import {
  MAX_DATE_VOTE_DAYS,
  MIN_DATE_VOTE_DAYS,
  type GuildSettings,
  type SettingField,
} from "../guild/config";
import type { Units } from "../weather/forecast";

/** The channel settings, the channel types each accepts and their names. */
export const CHANNEL_SETTINGS = [
  {
    field: "voteChannelId",
    name: "Voting channel",
    help: "Where the location and date polls are posted. Text channels only.",
    types: [ChannelType.GuildText],
  },
  {
    field: "announceChannelId",
    name: "Announcements channel",
    help: "Where results are announced. Text or announcement channels.",
    types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
  },
  {
    field: "forumChannelId",
    name: "Hike threads channel",
    help: "The forum that gets a thread for each hike. Forum channels only.",
    types: [ChannelType.GuildForum],
  },
] as const satisfies readonly {
  field: Exclude<SettingField, "adminRoleId">;
  name: string;
  help: string;
  types: readonly ChannelType[];
}[];

export type ChannelSetting = (typeof CHANNEL_SETTINGS)[number];

/** The lengths the date vote can have on the schedule, in days. */
export const DATE_VOTE_DAY_CHOICES: readonly number[] = Array.from(
  { length: MAX_DATE_VOTE_DAYS - MIN_DATE_VOTE_DAYS + 1 },
  (_, i) => MIN_DATE_VOTE_DAYS + i,
);

/** How the settings name each unit system. */
export const UNIT_NAMES: Record<Units, string> = {
  imperial: "Imperial: °F, mph, inches, feet",
  metric: "Metric: °C, km/h, millimetres, metres",
};

/** A setting's place in the form: the settings key it changes. */
export type SettingKey =
  | Exclude<keyof GuildSettings, "cadence" | "ownerId" | "ownerFetchedAt">
  | `cadence.${Exclude<keyof GuildSettings["cadence"], "onSince">}`;

/**
 * The settings no admin sets, each with why: the bot keeps them itself.
 * Every other key of `GuildSettings` (and of its `cadence`) is in a group.
 */
export const INTERNAL_SETTINGS: Record<string, string> = {
  ownerId: "the owner's id, cached from Discord for the admin rule",
  ownerFetchedAt: "when the owner's id was cached",
  "cadence.onSince":
    "when the schedule was last turned on, set by turning it on",
};

/** One setting as the settings page shows it. */
export interface SettingEntry {
  key: SettingKey;
  name: string;
  /** One sentence saying what it does. */
  help: string;
}

/** A group of settings, saved together by one form on the web. */
export interface SettingGroup {
  id:
    | "admin-role"
    | "channels"
    | "time-zone"
    | "home-area"
    | "units"
    | "schedule";
  name: string;
  settings: SettingEntry[];
}

/**
 * The groups, in the order of the panel's Settings view: the admin role,
 * the three channels, the time zone, the home area, the units, then the
 * schedule.
 */
export const SETTING_GROUPS: readonly SettingGroup[] = [
  {
    id: "admin-role",
    name: "Admin role",
    settings: [
      {
        key: "adminRoleId",
        name: "Admin role",
        help: "Members with this role can use the admin panel, besides the server owner. Clear it to leave the panel to the owner alone.",
      },
    ],
  },
  {
    id: "channels",
    name: "Channels",
    settings: CHANNEL_SETTINGS.map((channel) => ({
      key: channel.field,
      name: channel.name,
      help: channel.help,
    })),
  },
  {
    id: "time-zone",
    name: "Time zone",
    settings: [
      {
        key: "timezone",
        name: "Time zone",
        help: "Dates are planned in this time zone; a date typed without a time starts at 11:00.",
      },
    ],
  },
  {
    id: "home-area",
    name: "Home area",
    settings: [
      {
        key: "homeArea",
        name: "Home area",
        help: "Proposed locations are looked up on OpenStreetMap; matches near the home area come first.",
      },
    ],
  },
  {
    id: "units",
    name: "Units",
    settings: [
      {
        key: "units",
        name: "Units",
        help: "The units of the hike's weather forecast.",
      },
    ],
  },
  {
    id: "schedule",
    name: "Schedule",
    settings: [
      {
        key: "cadence.enabled",
        name: "Schedule",
        help: "When it is on, hikebot opens and closes the votes by itself on the weekday and time below; admins can still do each step by hand.",
      },
      {
        key: "cadence.weekday",
        name: "Weekday",
        help: "The day the votes open and close.",
      },
      {
        key: "cadence.time",
        name: "Time of day",
        help: "The time they do, in the server's time zone.",
      },
      {
        key: "cadence.dateVoteDays",
        name: "Date vote length",
        help: "How many days after it opens the date vote closes.",
      },
    ],
  },
];

export type SettingGroupId = SettingGroup["id"];

/** Whether `value` names a group, as a posted form says it. */
export function isSettingGroupId(value: unknown): value is SettingGroupId {
  return SETTING_GROUPS.some((group) => group.id === value);
}
