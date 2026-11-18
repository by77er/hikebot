import { DEFAULT_TIMEZONE } from "../polls/dates";

/**
 * The guild's settings, one row in the `guild_settings` table of its
 * GuildHike database. Every value but `timezone` is null until it is set.
 */
export interface GuildSettings {
  /** Members with this role may use the admin panel, besides the owner. */
  adminRoleId: string | null;
  /** Where the location and date polls are posted. */
  voteChannelId: string | null;
  /** Where results are announced. */
  announceChannelId: string | null;
  /** The forum channel that gets a thread per hike. */
  forumChannelId: string | null;
  /** The guild owner's user id, as `getGuild` last returned it. */
  ownerId: string | null;
  /** When `ownerId` was fetched, in milliseconds since the epoch. */
  ownerFetchedAt: number | null;
  /**
   * The IANA time zone hikes are planned in: the one an admin set, or
   * `DEFAULT_TIMEZONE` until then.
   */
  timezone: string;
  /**
   * The area hikes are usually in, as an admin typed it ("Seattle,
   * Washington"), with the place and point the geocoder found for it;
   * lookups of locations prefer matches near the point. Null until set.
   */
  homeArea: HomeArea | null;
}

/** The guild's home area and where the geocoder found it. */
export interface HomeArea {
  /** What the admin typed. */
  text: string;
  /** The place name the geocoder returned. */
  name: string;
  lat: number;
  lon: number;
}

/** The settings an admin picks in the panel. */
export type SettingField =
  "adminRoleId" | "voteChannelId" | "announceChannelId" | "forumChannelId";

const COLUMNS: Record<SettingField, string> = {
  adminRoleId: "admin_role_id",
  voteChannelId: "vote_channel_id",
  announceChannelId: "announce_channel_id",
  forumChannelId: "forum_channel_id",
};

interface Row extends Record<string, SqlStorageValue> {
  admin_role_id: string | null;
  vote_channel_id: string | null;
  announce_channel_id: string | null;
  forum_channel_id: string | null;
  owner_id: string | null;
  owner_fetched_at: number | null;
  timezone: string | null;
  home_area: string | null;
  home_name: string | null;
  home_lat: number | null;
  home_lon: number | null;
}

/**
 * True when the voting, announcements and forum channels are all set: the
 * admin role is optional, since the owner can always use the panel.
 */
export function setupComplete(settings: GuildSettings): boolean {
  return (
    settings.voteChannelId !== null &&
    settings.announceChannelId !== null &&
    settings.forumChannelId !== null
  );
}

/** Reads and writes the guild's settings in its Durable Object storage. */
export class GuildConfig {
  constructor(private readonly storage: DurableObjectStorage) {}

  get(): GuildSettings {
    const row = this.storage.sql
      .exec<Row>(
        `SELECT admin_role_id, vote_channel_id, announce_channel_id,
           forum_channel_id, owner_id, owner_fetched_at, timezone,
           home_area, home_name, home_lat, home_lon
         FROM guild_settings WHERE id = 1`,
      )
      .one();
    return {
      adminRoleId: row.admin_role_id,
      voteChannelId: row.vote_channel_id,
      announceChannelId: row.announce_channel_id,
      forumChannelId: row.forum_channel_id,
      ownerId: row.owner_id,
      ownerFetchedAt: row.owner_fetched_at,
      timezone: row.timezone ?? DEFAULT_TIMEZONE,
      homeArea:
        row.home_area === null || row.home_lat === null || row.home_lon === null
          ? null
          : {
              text: row.home_area,
              name: row.home_name ?? row.home_area,
              lat: row.home_lat,
              lon: row.home_lon,
            },
    };
  }

  /**
   * Sets the home area to what the geocoder found for it, or clears it with
   * null. Returns the settings after the change.
   */
  setHomeArea(area: HomeArea | null): GuildSettings {
    this.storage.sql.exec(
      `UPDATE guild_settings
       SET home_area = ?, home_name = ?, home_lat = ?, home_lon = ?
       WHERE id = 1`,
      area?.text ?? null,
      area?.name ?? null,
      area?.lat ?? null,
      area?.lon ?? null,
    );
    return this.get();
  }

  /** Sets one setting; null clears it. Returns the settings after the change. */
  set(field: SettingField, value: string | null): GuildSettings {
    this.storage.sql.exec(
      `UPDATE guild_settings SET ${COLUMNS[field]} = ? WHERE id = 1`,
      value,
    );
    return this.get();
  }

  /**
   * Sets the time zone, an IANA name the caller has checked with
   * `normalizeTimeZone`. Returns the settings after the change.
   */
  setTimezone(timezone: string): GuildSettings {
    this.storage.sql.exec(
      "UPDATE guild_settings SET timezone = ? WHERE id = 1",
      timezone,
    );
    return this.get();
  }

  /** Caches the guild owner's id and when it was fetched. */
  setOwner(ownerId: string, fetchedAt: number): GuildSettings {
    this.storage.sql.exec(
      "UPDATE guild_settings SET owner_id = ?, owner_fetched_at = ? WHERE id = 1",
      ownerId,
      fetchedAt,
    );
    return this.get();
  }
}
