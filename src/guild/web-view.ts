/**
 * The web pages' one read of a guild: who may see it, whether they are an
 * admin, and everything a server's page shows, as plain data that crosses
 * the Durable Object RPC boundary. `GuildHike.webView` calls `readWebView`.
 *
 * The view is made of sections, each built by its own function from a
 * `WebViewSource`: the guild-wide ones here (`serverSection`,
 * `viewerSection`, `settingsSection`), the others beside the feature that
 * owns their data (`roundSection`, `plannedHikeSection`, `hikePlaceSection`,
 * `hikeForecastSection`, `scheduleSection`, `hikeLogSection`,
 * `calendarSection`, `adminSection`).
 * Nothing here writes to storage except the owner cache in the guild's
 * settings.
 */
import {
  DiscordApiError,
  discordApi,
  guildIconUrl,
  type DiscordApi,
} from "../discord/api";
import {
  calendarSection,
  type WebCalendarSection,
} from "../features/calendar-feed";
import {
  hikeForecastSection,
  type WebHikeForecast,
} from "../features/hike-forecast-section";
import {
  HIKES_PER_PAGE,
  hikeLogSection,
  type WebHikeLogSection,
} from "../features/hike-log";
import {
  hikePlaceSection,
  type WebHikePlace,
} from "../features/hike-place-section";
import {
  plannedHikeSection,
  type WebPlannedHike,
} from "../features/planned-hike-section";
import { roundSection, type WebRoundSection } from "../features/round-section";
import {
  scheduleSection,
  type WebSchedule,
} from "../features/schedule-section";
import { adminSection, type WebAdminSection } from "../features/web-admin";
import {
  saveSettingsGroup,
  settingsFormSection,
  type SettingRefusal,
  type SettingsDirectory,
  type SettingsFields,
  type WebSettingsForm,
} from "../features/settings-form";
import type { Notice } from "../features/settings";
import type { SettingGroupId } from "../features/settings-catalogue";
import { PollStore } from "../polls/store";
import { GuildConfig, type GuildSettings } from "./config";
import { decideAdmin, OWNER_CACHE_MS } from "./permissions";
import type { HandlerContext } from "./router";

/** How long a member's membership and roles are trusted, in ms. */
export const MEMBER_CACHE_MS = 60_000;

/** How long the roles and channels the settings page offers are kept, in ms. */
export const SETTINGS_DIRECTORY_CACHE_MS = 60_000;

/** The most hikes one page of the web view's log may hold. */
export const MAX_LOG_PAGE_SIZE = 50;

/** What a page asks for: the guild, the signed-in user, a page of the log. */
export interface WebViewRequest {
  guildId: string;
  userId: string;
  /** 1-based; defaults to 1. */
  page?: number;
  /** Defaults to `HIKES_PER_PAGE`; at most `MAX_LOG_PAGE_SIZE`. */
  pageSize?: number;
  /** True for the settings page: an admin's view then has `settingsForm`. */
  settingsForm?: boolean;
}

/**
 * The read's answer. Only `view` carries anything about the guild: a user
 * who is not a member, or one Discord could not be asked about, learns
 * nothing.
 */
export type WebViewResult =
  | { kind: "not_member" }
  | { kind: "unavailable" }
  | { kind: "view"; view: WebView };

export interface WebView {
  server: WebServerSection;
  viewer: WebViewerSection;
  settings: WebSettingsSection;
  round: WebRoundSection | null;
  plannedHike: WebPlannedHike | null;
  /** Where the planned hike is; null with no planned hike. */
  hikePlace: WebHikePlace | null;
  /** The planned hike's forecast or why it has none; null with no planned hike. */
  hikeForecast: WebHikeForecast | null;
  /** The weekly schedule; null while it is off. */
  schedule: WebSchedule | null;
  log: WebHikeLogSection;
  calendar: WebCalendarSection;
  /** The round controls an admin may use now; null for everyone else. */
  admin: WebAdminSection | null;
  /**
   * The settings page's forms: only in an admin's view, and only when the
   * read asked for them.
   */
  settingsForm: WebSettingsForm | null;
}

export interface WebServerSection {
  id: string;
  name: string;
  /** The icon on Discord's CDN, null when the server has none. */
  iconUrl: string | null;
}

export interface WebViewerSection {
  userId: string;
  isAdmin: boolean;
}

export interface WebChannel {
  id: string;
  /** Null when the guild no longer has the channel. */
  name: string | null;
}

/** The settings any member may see. */
export interface WebSettingsSection {
  timeZone: string;
  voteChannel: WebChannel | null;
  announceChannel: WebChannel | null;
  forumChannel: WebChannel | null;
}

/** What Discord said about the guild, as the cache keeps it. */
export interface GuildDirectory {
  name: string;
  iconHash: string | null;
  /** Channel names by id. */
  channels: Record<string, string>;
}

/** Everything the section builders read from. */
export interface WebViewSource {
  env: Env;
  guildId: string;
  viewerId: string;
  isAdmin: boolean;
  settings: GuildSettings;
  directory: GuildDirectory;
  store: PollStore;
  storage: DurableObjectStorage;
  /** The store's clock, read once for the whole view. */
  now: number;
  log: { page: number; pageSize: number };
  /**
   * The roles and channels to pick from, when the read asked for them; left
   * out, or null, otherwise.
   */
  settingsDirectory?: SettingsDirectory | null;
}

/** Builds the view, one section per function. */
export async function buildWebView(source: WebViewSource): Promise<WebView> {
  return {
    server: serverSection(source),
    viewer: viewerSection(source),
    settings: settingsSection(source),
    round: roundSection(source),
    plannedHike: plannedHikeSection(source),
    hikePlace: hikePlaceSection(source),
    hikeForecast: hikeForecastSection(source),
    schedule: scheduleSection(source),
    log: hikeLogSection(source),
    calendar: await calendarSection(source),
    admin: adminSection(source),
    settingsForm: settingsFormSection(source),
  };
}

export function serverSection(source: WebViewSource): WebServerSection {
  const { iconHash, name } = source.directory;
  return {
    id: source.guildId,
    name,
    iconUrl: iconHash === null ? null : guildIconUrl(source.guildId, iconHash),
  };
}

export function viewerSection(source: WebViewSource): WebViewerSection {
  return { userId: source.viewerId, isAdmin: source.isAdmin };
}

export function settingsSection(source: WebViewSource): WebSettingsSection {
  const channel = (id: string | null): WebChannel | null =>
    id === null ? null : { id, name: source.directory.channels[id] ?? null };
  return {
    timeZone: source.settings.timezone,
    voteChannel: channel(source.settings.voteChannelId),
    announceChannel: channel(source.settings.announceChannelId),
    forumChannel: channel(source.settings.forumChannelId),
  };
}

interface MemberEntry {
  fetchedAt: number;
  /** The member's role ids, or null when Discord said they are not one. */
  roleIds: string[] | null;
}

/**
 * What the web read remembers between calls, in the guild object's memory
 * only, so a restart of the object forgets it all: each user's membership
 * and roles for `MEMBER_CACHE_MS`, and the guild's name, icon and channel
 * names for `OWNER_CACHE_MS`.
 */
export class WebViewCache {
  private readonly members = new Map<string, MemberEntry>();
  private directory: { fetchedAt: number; value: GuildDirectory } | null = null;
  private settings: { fetchedAt: number; value: SettingsDirectory } | null =
    null;

  /**
   * The user's role ids, null when they are not a member (Discord answered
   * 404), or "error" when Discord could not be asked. Errors are not cached.
   * With `ask`, Discord is asked even when the cache holds a fresh answer,
   * and the answer replaces it.
   */
  async member(
    api: DiscordApi,
    guildId: string,
    userId: string,
    now: number,
    { ask = false }: { ask?: boolean } = {},
  ): Promise<string[] | null | "error"> {
    const cached = this.members.get(userId);
    if (
      !ask &&
      cached !== undefined &&
      fresh(cached.fetchedAt, now, MEMBER_CACHE_MS)
    ) {
      return cached.roleIds;
    }
    let roleIds: string[] | null;
    try {
      roleIds = (await api.getGuildMember(guildId, userId)).roles;
    } catch (error) {
      if (!(error instanceof DiscordApiError && error.status === 404)) {
        logFailure(guildId, error);
        return "error";
      }
      roleIds = null;
    }
    for (const [id, entry] of this.members) {
      if (!fresh(entry.fetchedAt, now, MEMBER_CACHE_MS))
        this.members.delete(id);
    }
    this.members.set(userId, { fetchedAt: now, roleIds });
    return roleIds;
  }

  /**
   * The guild's name, icon and channel names, or null when Discord could
   * not be asked. A fetch also refreshes the owner cached in the guild's
   * settings, which `decideAdmin` reads.
   */
  async guild(
    api: DiscordApi,
    storage: DurableObjectStorage,
    guildId: string,
    now: number,
  ): Promise<GuildDirectory | null> {
    if (
      this.directory !== null &&
      fresh(this.directory.fetchedAt, now, OWNER_CACHE_MS)
    ) {
      return this.directory.value;
    }
    try {
      const [guild, channels] = await Promise.all([
        api.getGuild(guildId),
        api.getGuildChannels(guildId),
      ]);
      new GuildConfig(storage).setOwner(guild.owner_id, now);
      const value: GuildDirectory = {
        name: guild.name,
        iconHash: guild.icon,
        channels: Object.fromEntries(
          channels.map((channel) => [channel.id, channel.name]),
        ),
      };
      this.directory = { fetchedAt: now, value };
      return value;
    } catch (error) {
      logFailure(guildId, error);
      return null;
    }
  }

  /**
   * The guild's roles and channels for the settings page, kept for
   * `SETTINGS_DIRECTORY_CACHE_MS`, or null when Discord could not be asked.
   */
  async settingsDirectory(
    api: DiscordApi,
    guildId: string,
    now: number,
  ): Promise<SettingsDirectory | null> {
    if (
      this.settings !== null &&
      fresh(this.settings.fetchedAt, now, SETTINGS_DIRECTORY_CACHE_MS)
    ) {
      return this.settings.value;
    }
    try {
      const [roles, channels] = await Promise.all([
        api.getGuildRoles(guildId),
        api.getGuildChannels(guildId),
      ]);
      const value: SettingsDirectory = {
        roles: roles.map(({ id, name, position }) => ({ id, name, position })),
        channels: channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          parentId: "parent_id" in channel ? (channel.parent_id ?? null) : null,
          position:
            "position" in channel && typeof channel.position === "number"
              ? channel.position
              : 0,
        })),
      };
      this.settings = { fetchedAt: now, value };
      return value;
    } catch (error) {
      logFailure(guildId, error);
      return null;
    }
  }
}

function fresh(fetchedAt: number, now: number, maxAge: number): boolean {
  return now - fetchedAt < maxAge && now >= fetchedAt;
}

function logFailure(guildId: string, error: unknown): void {
  console.error(
    `web view of guild ${guildId}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * The web read: checks with Discord, through `cache`, that the user is a
 * member, decides whether they are an admin with `decideAdmin`, and builds
 * the view. Writes nothing but the caches. `api` and `now` default to the
 * guild's Discord client and the store's clock.
 */
export async function readWebView(
  context: HandlerContext,
  cache: WebViewCache,
  request: WebViewRequest,
  options: { api?: DiscordApi; now?: number } = {},
): Promise<WebViewResult> {
  const { guildId, userId } = request;
  const store = new PollStore(context.storage);
  const now = options.now ?? store.now();
  const api = options.api ?? discordApi(context.env);

  const roleIds = await cache.member(api, guildId, userId, now);
  if (roleIds === "error") return { kind: "unavailable" };
  if (roleIds === null) return { kind: "not_member" };
  const directory = await cache.guild(api, context.storage, guildId, now);
  if (directory === null) return { kind: "unavailable" };
  const decision = await decideAdmin(
    context.storage,
    api,
    { guildId, userId, roleIds },
    now,
  );
  if (!decision.ok) {
    logFailure(guildId, decision.error);
    return { kind: "unavailable" };
  }
  let settingsDirectory: SettingsDirectory | null = null;
  if (request.settingsForm === true && decision.isAdmin) {
    settingsDirectory = await cache.settingsDirectory(api, guildId, now);
    if (settingsDirectory === null) return { kind: "unavailable" };
  }

  const view = await buildWebView({
    env: context.env,
    guildId,
    viewerId: userId,
    isAdmin: decision.isAdmin,
    settings: decision.settings,
    directory,
    store,
    storage: context.storage,
    now,
    log: logPage(request),
    settingsDirectory,
  });
  return { kind: "view", view };
}

/** A save of one group of settings from the settings page. */
export interface WebSettingsRequest {
  guildId: string;
  userId: string;
  group: SettingGroupId;
  fields: SettingsFields;
}

/**
 * What the save did. Like the read, only an admin's answer says anything
 * about the guild: `forbidden` for a member who is not an admin.
 */
export type WebSettingsResult =
  | { kind: "not_member" }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "saved"; notices: Notice[] }
  | { kind: "refused"; errors: SettingRefusal[] };

/**
 * The settings page's save: asks Discord again, past the cache, whether the
 * user is a member and with which roles, decides with `decideAdmin` whether
 * they are an admin at this moment, then saves the group with
 * `saveSettingsGroup`, against the roles and channels the page offered.
 */
export async function saveWebSettings(
  context: HandlerContext,
  cache: WebViewCache,
  request: WebSettingsRequest,
  options: { api?: DiscordApi; now?: number } = {},
): Promise<WebSettingsResult> {
  const { guildId, userId } = request;
  const store = new PollStore(context.storage);
  const now = options.now ?? store.now();
  const api = options.api ?? discordApi(context.env);

  const roleIds = await cache.member(api, guildId, userId, now, {
    ask: true,
  });
  if (roleIds === "error") return { kind: "unavailable" };
  if (roleIds === null) return { kind: "not_member" };
  const decision = await decideAdmin(
    context.storage,
    api,
    { guildId, userId, roleIds },
    now,
  );
  if (!decision.ok) {
    logFailure(guildId, decision.error);
    return { kind: "unavailable" };
  }
  if (!decision.isAdmin) return { kind: "forbidden" };
  const directory = await cache.settingsDirectory(api, guildId, now);
  if (directory === null) return { kind: "unavailable" };
  return saveSettingsGroup(
    context,
    guildId,
    decision.settings,
    directory,
    request.group,
    request.fields,
  );
}

function logPage(request: WebViewRequest): { page: number; pageSize: number } {
  const size = request.pageSize ?? HIKES_PER_PAGE;
  return {
    page: request.page ?? 1,
    pageSize:
      Number.isInteger(size) && size >= 1 && size <= MAX_LOG_PAGE_SIZE
        ? size
        : HIKES_PER_PAGE,
  };
}
