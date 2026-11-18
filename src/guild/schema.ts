/**
 * A schema change for the GuildHike SQLite database. `name` identifies it in
 * the `_migrations` table, so never rename or reorder a migration once it has
 * shipped: append a new one instead.
 */
export interface Migration {
  name: string;
  sql: string;
}

/** Applied in order, each exactly once per guild. Append new migrations. */
export const migrations: readonly Migration[] = [
  {
    name: "0001_polls",
    sql: `
      CREATE TABLE rounds (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN
          ('location_voting', 'location_decided', 'date_voting', 'complete', 'cancelled')),
        location_option_id INTEGER,
        date_option_id INTEGER,
        thread_id TEXT,
        started_by TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_by TEXT,
        ended_at INTEGER
      );
      CREATE UNIQUE INDEX rounds_one_active ON rounds ((0))
        WHERE status NOT IN ('complete', 'cancelled');

      CREATE TABLE polls (
        id INTEGER PRIMARY KEY,
        round_id INTEGER NOT NULL REFERENCES rounds (id),
        kind TEXT NOT NULL CHECK (kind IN ('location', 'date')),
        status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
        channel_id TEXT,
        message_id TEXT,
        winner_option_id INTEGER,
        tie_broken INTEGER NOT NULL DEFAULT 0,
        tied_option_ids TEXT NOT NULL DEFAULT '[]',
        opened_by TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        closed_by TEXT,
        closed_at INTEGER,
        UNIQUE (round_id, kind)
      );

      CREATE TABLE poll_options (
        id INTEGER PRIMARY KEY,
        poll_id INTEGER NOT NULL REFERENCES polls (id),
        label TEXT NOT NULL,
        label_key TEXT NOT NULL,
        details TEXT,
        date_value TEXT,
        proposed_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (poll_id, label_key)
      );

      CREATE TABLE poll_votes (
        poll_id INTEGER NOT NULL REFERENCES polls (id),
        option_id INTEGER NOT NULL REFERENCES poll_options (id),
        user_id TEXT NOT NULL,
        voted_at INTEGER NOT NULL,
        PRIMARY KEY (poll_id, option_id, user_id)
      );
      CREATE INDEX poll_votes_by_user ON poll_votes (poll_id, user_id);
    `,
  },
  {
    // One row per guild database, so `GuildConfig` always finds it.
    name: "0002_guild_settings",
    sql: `
      CREATE TABLE guild_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        admin_role_id TEXT,
        vote_channel_id TEXT,
        announce_channel_id TEXT,
        forum_channel_id TEXT,
        owner_id TEXT,
        owner_fetched_at INTEGER
      );
      INSERT INTO guild_settings (id) VALUES (1);
    `,
  },
  {
    // An IANA time zone name; null means the default, America/Los_Angeles.
    name: "0003_guild_timezone",
    sql: "ALTER TABLE guild_settings ADD COLUMN timezone TEXT",
  },
];

/**
 * Applies every migration not yet recorded in `_migrations`, in list order,
 * each in its own transaction together with its record.
 */
export function applyMigrations(
  storage: DurableObjectStorage,
  list: readonly Migration[] = migrations,
): void {
  const sql = storage.sql;
  sql.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    )`,
  );
  const applied = new Set(
    sql
      .exec<{ name: string }>("SELECT name FROM _migrations")
      .toArray()
      .map((row) => row.name),
  );
  for (const migration of list) {
    if (applied.has(migration.name)) continue;
    storage.transactionSync(() => {
      sql.exec(migration.sql);
      sql.exec("INSERT INTO _migrations (name) VALUES (?)", migration.name);
    });
  }
}
