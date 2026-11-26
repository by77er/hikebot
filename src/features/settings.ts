/**
 * The guild's settings as an admin changes them, from the admin panel's
 * Settings view in Discord and from the settings page on the web: the
 * check that refuses a bad value, and the change that stores a good one and
 * does what follows from it (the weekly schedule is rescheduled, the
 * forecast is fetched again). The home area's lookup is in `home-area.ts`. Both surfaces call these functions, so they
 * refuse the same values in the same words and a change has the same
 * effects from either.
 *
 * What a check or change says is a `Notice`: text with the roles, channels,
 * bold and code in it marked, which the panel writes as Discord markdown
 * (`noticeMarkdown`) and a page as names.
 */
import {
  GuildConfig,
  MAX_DATE_VOTE_DAYS,
  MIN_DATE_VOTE_DAYS,
  type CadenceSettings,
  type GuildSettings,
} from "../guild/config";
import type { HandlerContext } from "../guild/router";
import { UNAVAILABLE_MESSAGE } from "../guild/router";
import { schedule } from "../guild/schedule";
import { WEEKDAY_NAMES, normalizeTimeZone } from "../polls/dates";
import { PollStore } from "../polls/store";
import { UNITS, type Units } from "../weather/forecast";
import { changeCadence, rescheduleCadence } from "./cadence-state";
import { CHANNEL_SETTINGS, type ChannelSetting } from "./settings-catalogue";
import { WEATHER_JOB } from "./weather-state";

/** A piece of a notice: text, or a role, a channel, bold or code. */
export type NoticePart =
  | string
  | { role: string }
  | { channel: string }
  | { strong: string }
  | { code: string };

/** What a check refuses or a change did, in the bot's words. */
export type Notice = NoticePart[];

/** A value a check let through, or its refusal. */
export type Checked<T> =
  { ok: true; value: T } | { ok: false; refusal: Notice };

/** The notice as Discord markdown: mentions, `**bold**` and `code`. */
export function noticeMarkdown(notice: Notice): string {
  return notice
    .map((part) => {
      if (typeof part === "string") return part;
      if ("role" in part) return `<@&${part.role}>`;
      if ("channel" in part) return `<#${part.channel}>`;
      if ("strong" in part) return `**${part.strong}**`;
      return `\`${part.code}\``;
    })
    .join("");
}

/** The answer to a forged or outdated value: the control is gone. */
export const UNAVAILABLE: Notice = [UNAVAILABLE_MESSAGE];

/** `a`, `a and b`, `a, b and c`. */
export function listing(items: string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/** The settings setup still needs, named as the panel shows them. */
export function missingSettings(settings: GuildSettings): string[] {
  return CHANNEL_SETTINGS.filter(
    (channel) => settings[channel.field] === null,
  ).map((channel) => channel.name.toLowerCase());
}

/** Typed text to quote: shortened and without backticks. */
export function quotedInput(text: string): string {
  const plain = text.replaceAll("`", "'");
  return plain.length <= 40 ? plain : `${plain.slice(0, 39)}…`;
}

// The admin role.

/** Refuses the `@everyone` role, whose id is the guild's. */
export function checkAdminRole(
  guildId: string,
  roleId: string | null,
): Notice | null {
  return roleId !== null && roleId === guildId
    ? ["The @everyone role cannot be the admin role. Pick another role."]
    : null;
}

/** Stores the admin role, or clears it with null. */
export function setAdminRole(
  storage: DurableObjectStorage,
  roleId: string | null,
): Notice {
  new GuildConfig(storage).set("adminRoleId", roleId);
  return roleId === null
    ? ["Admin role cleared: only the server owner can use the panel."]
    : ["Admin role set to ", { role: roleId }, "."];
}

// The channels.

/**
 * Refuses a channel Discord did not describe (`picked` undefined) or of a
 * type the setting does not take.
 */
export function checkChannel(
  channel: ChannelSetting,
  picked: { type: number } | undefined,
): Notice | null {
  const allowed: readonly number[] = channel.types;
  return picked === undefined || !allowed.includes(picked.type)
    ? [
        `That channel cannot be the ${channel.name.toLowerCase()}. ${channel.help}`,
      ]
    : null;
}

/** Stores the channel for `channel`, or clears it with null. */
export function setChannel(
  storage: DurableObjectStorage,
  channel: ChannelSetting,
  channelId: string | null,
): Notice {
  new GuildConfig(storage).set(channel.field, channelId);
  return channelId === null
    ? [`${channel.name} cleared.`]
    : [`${channel.name} set to `, { channel: channelId }, "."];
}

// The time zone.

/**
 * The zone `typed` names, in its canonical spelling, or the refusal quoting
 * what was typed, the zone still in force and three examples.
 */
export function checkTimeZone(
  typed: string,
  settings: GuildSettings,
): Checked<string> {
  const zone = normalizeTimeZone(typed);
  if (zone !== null) return { ok: true, value: zone };
  const trimmed = typed.trim();
  return {
    ok: false,
    refusal: [
      ...(trimmed === ""
        ? ["No time zone was entered"]
        : [{ code: quotedInput(trimmed) }, " is not a time zone"]),
      `, so it is still ${settings.timezone}. Enter an IANA name such as `,
      { code: "America/Los_Angeles" },
      ", ",
      { code: "Europe/Berlin" },
      " or ",
      { code: "Asia/Kolkata" },
      ", or PT, MT, CT, ET or UTC.",
    ],
  };
}

/** Stores the time zone and reschedules the weekly schedule in it. */
export async function setTimeZone(
  context: HandlerContext,
  guildId: string,
  zone: string,
): Promise<Notice> {
  const changed = new GuildConfig(context.storage).setTimezone(zone);
  await rescheduleCadence(
    context.storage,
    new PollStore(context.storage),
    changed,
    guildId,
  );
  return [`Time zone set to ${zone}.`];
}

/**
 * Every IANA zone the runtime knows, in its current spelling, sorted: the
 * choices of the web page's time zone select.
 */
export function timeZoneNames(): string[] {
  const names = new Set<string>();
  for (const name of Intl.supportedValuesOf("timeZone")) {
    names.add(normalizeTimeZone(name) ?? name);
  }
  return [...names].sort();
}

// The units.

/** The units `picked` names, or null. */
export function checkUnits(picked: string | undefined): Units | null {
  return UNITS.find((units) => units === picked) ?? null;
}

/** Stores the units and runs the weather job at once, to fetch in them. */
export async function setUnits(
  storage: DurableObjectStorage,
  units: Units,
): Promise<Notice> {
  new GuildConfig(storage).setUnits(units);
  await schedule(storage, WEATHER_JOB, new PollStore(storage).now());
  return [`Units set to ${units}.`];
}

// The home area.

/** The longest home area an admin may type. */
export const MAX_HOME_AREA = 100;

/** Typed text as a home area: trimmed, its spaces collapsed. */
export function homeAreaText(typed: string): string {
  return typed.trim().replace(/\s+/g, " ");
}

/** Clears the home area. */
export function clearHomeArea(storage: DurableObjectStorage): Notice {
  new GuildConfig(storage).setHomeArea(null);
  return ["Home area cleared: locations are looked up worldwide."];
}

/** What is said when the text typed is the home area already. */
export function sameHomeArea(text: string): Notice {
  return ["The home area is already ", { strong: text }, "."];
}

// The schedule.

/** A change to the schedule: the fields an admin sets. */
export type ScheduleChange = Partial<Omit<CadenceSettings, "onSince">>;

/** `9:00` or `09:00` as `09:00`; null for anything else. */
export function parseTimeOfDay(text: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The schedule's time typed as `HH:MM`, or the refusal saying what works. */
export function checkTimeOfDay(
  typed: string,
  settings: GuildSettings,
): Checked<string> {
  const time = parseTimeOfDay(typed);
  return time === null
    ? {
        ok: false,
        refusal: [
          { code: quotedInput(typed.trim()) },
          ` is not a time, so the schedule's time is still ${settings.cadence.time}. Enter it as HH:MM, 24-hour, for example 09:00 or 18:30.`,
        ],
      }
    : { ok: true, value: time };
}

/** A weekday, 0 (Sunday) to 6, from a select's value; null otherwise. */
export function checkWeekday(value: string | undefined): number | null {
  return wholeNumberIn(value, 0, WEEKDAY_NAMES.length - 1);
}

/** A date vote length in days, from a select's value; null otherwise. */
export function checkDateVoteDays(value: string | undefined): number | null {
  return wholeNumberIn(value, MIN_DATE_VOTE_DAYS, MAX_DATE_VOTE_DAYS);
}

function wholeNumberIn(
  value: string | undefined,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value.trim() === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max
    ? number
    : null;
}

/**
 * Refuses turning the schedule on, naming the channels it needs, until the
 * voting, announcements and hike threads channels are set.
 */
export function checkScheduleOn(settings: GuildSettings): Notice | null {
  const missing = missingSettings(settings);
  return missing.length === 0
    ? null
    : [
        `The schedule needs the ${listing(missing)}. Set them above, then turn it on.`,
      ];
}

/** `1 day`, `2 days`. */
export function dayCount(n: number): string {
  return n === 1 ? "1 day" : `${String(n)} days`;
}

/**
 * Stores the schedule change and reschedules the job from it. Returns a
 * notice for each field the change gives, in the order weekday, date vote
 * length, time, on or off.
 */
export async function changeSchedule(
  context: HandlerContext,
  guildId: string,
  change: ScheduleChange,
): Promise<Notice[]> {
  const settings = await changeCadence(
    context.storage,
    new PollStore(context.storage),
    change,
    guildId,
  );
  const notices: Notice[] = [];
  if (change.weekday !== undefined) {
    notices.push([
      `The schedule's day is ${WEEKDAY_NAMES[change.weekday] ?? "?"}.`,
    ]);
  }
  if (change.dateVoteDays !== undefined) {
    notices.push([
      `On the schedule, the date vote stays open ${dayCount(change.dateVoteDays)}.`,
    ]);
  }
  if (change.time !== undefined) {
    notices.push([
      `The schedule's time is ${change.time} (${settings.timezone}).`,
    ]);
  }
  if (change.enabled !== undefined) {
    notices.push(
      change.enabled
        ? ["The schedule is on."]
        : [
            "The schedule is off. Open votes stay open until an admin closes them.",
          ],
    );
  }
  return notices;
}
