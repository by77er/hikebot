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

/** Takes the database back from 0006_places to 0005_round_day_of. */
function undoPlaces(storage: DurableObjectStorage): void {
  storage.sql.exec("DROP INDEX poll_options_place_pending");
  for (const column of [
    "place_lat",
    "place_lon",
    "place_name",
    "place_status",
    "place_attempts",
    "place_next_at",
  ]) {
    storage.sql.exec(`ALTER TABLE poll_options DROP COLUMN ${column}`);
  }
  for (const column of ["home_area", "home_name", "home_lat", "home_lon"]) {
    storage.sql.exec(`ALTER TABLE guild_settings DROP COLUMN ${column}`);
  }
  storage.sql.exec("DELETE FROM _migrations WHERE name = '0006_places'");
}

/** Takes the 0005_round_day_of columns back out of the rounds table. */
function dropDayOf(storage: DurableObjectStorage): void {
  storage.sql.exec("ALTER TABLE rounds DROP COLUMN day_of_channel_id");
  storage.sql.exec("ALTER TABLE rounds DROP COLUMN day_of_message_id");
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
          home_area: null,
          home_name: null,
          home_lat: null,
          home_lon: null,
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
      state.storage.sql.exec("ALTER TABLE rounds DROP COLUMN event_id");
      undoPlaces(state.storage);
      dropDayOf(state.storage);
      state.storage.sql.exec(
        "DELETE FROM _migrations WHERE name IN ('0003_guild_timezone', '0004_round_event', '0005_round_day_of')",
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

  it("add the event column to a database at 0003, keeping its completed round", async () => {
    const stub = stubFor("schema-round-event");
    await runInDurableObject(stub, (_instance, state) => {
      // Take the database back to 0003_guild_timezone, with a hike in it.
      state.storage.sql.exec("ALTER TABLE rounds DROP COLUMN event_id");
      undoPlaces(state.storage);
      dropDayOf(state.storage);
      state.storage.sql.exec(
        "DELETE FROM _migrations WHERE name IN ('0004_round_event', '0005_round_day_of')",
      );
      state.storage.sql.exec(
        `INSERT INTO rounds (status, thread_id, started_by, started_at, ended_by, ended_at)
         VALUES ('complete', '61', '21', 1, '21', 2)`,
      );
      expect(appliedNames(state.storage)).toEqual(
        shipped.slice(0, shipped.indexOf("0004_round_event")),
      );
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, (_instance, state) => {
      expect(appliedNames(state.storage)).toEqual(shipped);
      expect(
        state.storage.sql.exec("SELECT * FROM rounds").toArray(),
      ).toMatchObject([
        { status: "complete", thread_id: "61", ended_at: 2, event_id: null },
      ]);
      state.storage.sql.exec("UPDATE rounds SET event_id = '71'");
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ event_id: string }>("SELECT event_id FROM rounds")
          .one().event_id,
      ).toBe("71");
    });
  });

  it("add the hike-day columns to a database at 0004, keeping its completed round", async () => {
    const stub = stubFor("schema-round-day-of");
    await runInDurableObject(stub, (_instance, state) => {
      // Take the database back to 0004_round_event, with a hike in it.
      undoPlaces(state.storage);
      dropDayOf(state.storage);
      state.storage.sql.exec(
        "DELETE FROM _migrations WHERE name = '0005_round_day_of'",
      );
      state.storage.sql.exec(
        `INSERT INTO rounds (status, thread_id, event_id, started_by, started_at, ended_by, ended_at)
         VALUES ('complete', '61', '71', '21', 1, '21', 2)`,
      );
      expect(appliedNames(state.storage)).toEqual(
        shipped.slice(0, shipped.indexOf("0005_round_day_of")),
      );
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, (_instance, state) => {
      expect(appliedNames(state.storage)).toEqual(shipped);
      expect(
        state.storage.sql.exec("SELECT * FROM rounds").toArray(),
      ).toMatchObject([
        {
          status: "complete",
          event_id: "71",
          day_of_channel_id: null,
          day_of_message_id: null,
        },
      ]);
      state.storage.sql.exec(
        "UPDATE rounds SET day_of_channel_id = '31', day_of_message_id = '81'",
      );
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec("SELECT day_of_channel_id, day_of_message_id FROM rounds")
          .one(),
      ).toEqual({ day_of_channel_id: "31", day_of_message_id: "81" });
    });
  });

  it("add the place columns to a database at 0005, keeping its options and settings", async () => {
    const stub = stubFor("schema-places");
    await runInDurableObject(stub, (_instance, state) => {
      undoPlaces(state.storage);
      state.storage.sql.exec(
        `INSERT INTO rounds (status, started_by, started_at)
         VALUES ('location_voting', '21', 1)`,
      );
      state.storage.sql.exec(
        `INSERT INTO polls (round_id, kind, status, opened_by, opened_at)
         VALUES (1, 'location', 'open', '21', 1)`,
      );
      state.storage.sql.exec(
        `INSERT INTO poll_options (poll_id, label, label_key, proposed_by, created_at)
         VALUES (1, 'Ridge', 'ridge', '21', 1)`,
      );
      state.storage.sql.exec(
        "UPDATE guild_settings SET timezone = 'Europe/Berlin' WHERE id = 1",
      );
      expect(appliedNames(state.storage)).toEqual(
        shipped.slice(0, shipped.indexOf("0006_places")),
      );
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, (_instance, state) => {
      expect(appliedNames(state.storage)).toEqual(shipped);
      expect(
        state.storage.sql.exec("SELECT * FROM poll_options").toArray(),
      ).toMatchObject([
        {
          label: "Ridge",
          place_lat: null,
          place_lon: null,
          place_name: null,
          place_status: null,
          place_attempts: 0,
          place_next_at: null,
        },
      ]);
      expect(
        state.storage.sql.exec("SELECT * FROM guild_settings").toArray(),
      ).toMatchObject([
        { timezone: "Europe/Berlin", home_area: null, home_lat: null },
      ]);
      expect(() =>
        state.storage.sql.exec(
          "UPDATE poll_options SET place_status = 'lost' WHERE id = 1",
        ),
      ).toThrow();
      state.storage.sql.exec(
        `UPDATE poll_options SET place_status = 'found', place_lat = 47.5,
           place_lon = -121.7, place_name = 'Ridge, King County' WHERE id = 1`,
      );
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec("SELECT place_status, place_lat, place_name FROM poll_options")
          .one(),
      ).toEqual({
        place_status: "found",
        place_lat: 47.5,
        place_name: "Ridge, King County",
      });
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
