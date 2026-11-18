import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  migrations,
  type Migration,
} from "../../src/guild/schema";

const sample: Migration[] = [
  {
    name: "0001_create_notes",
    sql: "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
  },
  {
    name: "0002_seed_note",
    sql: "INSERT INTO notes (body) VALUES ('first')",
  },
];

function stubFor(name: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(name));
}

const shipped = migrations.map((migration) => migration.name);

function appliedNames(storage: DurableObjectStorage): string[] {
  return storage.sql
    .exec<{ name: string }>("SELECT name FROM _migrations ORDER BY id")
    .toArray()
    .map((row) => row.name);
}

describe("migrations", () => {
  it("are applied by the constructor and tracked in _migrations", async () => {
    const names = await runInDurableObject(
      stubFor("schema-constructor"),
      (_instance, state) => appliedNames(state.storage),
    );
    expect(names).toEqual(migrations.map((migration) => migration.name));
  });

  it("are applied once each, in order, and not again after a restart", async () => {
    const stub = stubFor("schema-sample");
    const notes = (storage: DurableObjectStorage) =>
      storage.sql
        .exec<{ body: string }>("SELECT body FROM notes")
        .toArray()
        .map((row) => row.body);

    await runInDurableObject(stub, (_instance, state) => {
      applyMigrations(state.storage, sample);
      applyMigrations(state.storage, sample);
      expect(appliedNames(state.storage)).toEqual([
        ...shipped,
        "0001_create_notes",
        "0002_seed_note",
      ]);
      expect(notes(state.storage)).toEqual(["first"]);
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, (_instance, state) => {
      applyMigrations(state.storage, sample);
      expect(appliedNames(state.storage)).toEqual([
        ...shipped,
        "0001_create_notes",
        "0002_seed_note",
      ]);
      expect(notes(state.storage)).toEqual(["first"]);
    });
  });

  it("applies only the migrations appended since the last run", async () => {
    const stub = stubFor("schema-append");
    const extra: Migration = {
      name: "0003_seed_second",
      sql: "INSERT INTO notes (body) VALUES ('second')",
    };
    await runInDurableObject(stub, (_instance, state) => {
      applyMigrations(state.storage, sample);
    });
    await evictDurableObject(stub);
    const bodies = await runInDurableObject(stub, (_instance, state) => {
      applyMigrations(state.storage, [...sample, extra]);
      return state.storage.sql
        .exec<{ body: string }>("SELECT body FROM notes ORDER BY id")
        .toArray()
        .map((row) => row.body);
    });
    expect(bodies).toEqual(["first", "second"]);
  });

  it("rolls back a migration that fails, leaving it unrecorded", async () => {
    const broken: Migration = {
      name: "0003_broken",
      sql: "INSERT INTO missing_table (x) VALUES (1)",
    };
    await runInDurableObject(stubFor("schema-broken"), (_instance, state) => {
      expect(() => {
        applyMigrations(state.storage, [...sample, broken]);
      }).toThrow();
      expect(appliedNames(state.storage)).toEqual([
        ...shipped,
        "0001_create_notes",
        "0002_seed_note",
      ]);
    });
  });

  it("create the poll tables on a fresh object and keep them across restarts", async () => {
    const stub = stubFor("schema-polls");
    const tables = (storage: DurableObjectStorage) =>
      storage.sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name IN
             ('rounds', 'polls', 'poll_options', 'poll_votes')
           ORDER BY name`,
        )
        .toArray()
        .map((row) => row.name);
    const roundCount = (storage: DurableObjectStorage) =>
      storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM rounds").one()
        .n;

    await runInDurableObject(stub, (_instance, state) => {
      expect(tables(state.storage)).toEqual([
        "poll_options",
        "poll_votes",
        "polls",
        "rounds",
      ]);
      state.storage.sql.exec(
        `INSERT INTO rounds (status, started_by, started_at)
         VALUES ('location_voting', 'u1', 1)`,
      );
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, (_instance, state) => {
      expect(appliedNames(state.storage)).toEqual(shipped);
      expect(roundCount(state.storage)).toBe(1);
    });
  });

  it("create the guild_settings row with every setting null and keep it across restarts", async () => {
    const stub = stubFor("schema-guild-settings");
    const rows = (storage: DurableObjectStorage) =>
      storage.sql.exec("SELECT * FROM guild_settings").toArray();

    await runInDurableObject(stub, (_instance, state) => {
      expect(rows(state.storage)).toEqual([
        {
          id: 1,
          admin_role_id: null,
          vote_channel_id: null,
          announce_channel_id: null,
          forum_channel_id: null,
          owner_id: null,
          owner_fetched_at: null,
          timezone: null,
        },
      ]);
      state.storage.sql.exec(
        "UPDATE guild_settings SET vote_channel_id = '12' WHERE id = 1",
      );
      expect(() =>
        state.storage.sql.exec("INSERT INTO guild_settings (id) VALUES (2)"),
      ).toThrow();
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, (_instance, state) => {
      expect(appliedNames(state.storage)).toEqual(shipped);
      expect(rows(state.storage)).toMatchObject([{ vote_channel_id: "12" }]);
    });
  });

  it("add the timezone column to a database at 0002, keeping its settings", async () => {
    const stub = stubFor("schema-timezone");
    await runInDurableObject(stub, (_instance, state) => {
      // Take the database back to 0002_guild_settings, with settings in it.
      state.storage.sql.exec("ALTER TABLE guild_settings DROP COLUMN timezone");
      state.storage.sql.exec(
        "DELETE FROM _migrations WHERE name = '0003_guild_timezone'",
      );
      state.storage.sql.exec(
        "UPDATE guild_settings SET vote_channel_id = '12', owner_id = '21' WHERE id = 1",
      );
      expect(appliedNames(state.storage)).toEqual(
        shipped.slice(0, shipped.indexOf("0003_guild_timezone")),
      );
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, (_instance, state) => {
      expect(appliedNames(state.storage)).toEqual(shipped);
      expect(
        state.storage.sql.exec("SELECT * FROM guild_settings").toArray(),
      ).toMatchObject([
        { vote_channel_id: "12", owner_id: "21", timezone: null },
      ]);
      state.storage.sql.exec(
        "UPDATE guild_settings SET timezone = 'Europe/Berlin' WHERE id = 1",
      );
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ timezone: string }>("SELECT timezone FROM guild_settings")
          .one().timezone,
      ).toBe("Europe/Berlin");
    });
  });

  it("allow only one active round", async () => {
    await runInDurableObject(
      stubFor("schema-one-active"),
      (_instance, state) => {
        const insert = (status: string) => {
          state.storage.sql.exec(
            `INSERT INTO rounds (status, started_by, started_at)
           VALUES (?, 'u1', 1)`,
            status,
          );
        };
        insert("cancelled");
        insert("complete");
        insert("location_voting");
        insert("cancelled");
        expect(() => {
          insert("date_voting");
        }).toThrow();
      },
    );
  });
});
