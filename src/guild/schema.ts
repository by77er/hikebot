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
export const migrations: readonly Migration[] = [];

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
