/**
 * The guild's settings, one row in the `guild_settings` table of its
 * GuildHike database. Every value is null until it is set.
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
           forum_channel_id, owner_id, owner_fetched_at
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
    };
  }

  /** Sets one setting; null clears it. Returns the settings after the change. */
  set(field: SettingField, value: string | null): GuildSettings {
    this.storage.sql.exec(
      `UPDATE guild_settings SET ${COLUMNS[field]} = ? WHERE id = 1`,
      value,
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
