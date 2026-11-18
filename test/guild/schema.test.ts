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
        "0001_create_notes",
        "0002_seed_note",
      ]);
      expect(notes(state.storage)).toEqual(["first"]);
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, (_instance, state) => {
      applyMigrations(state.storage, sample);
      expect(appliedNames(state.storage)).toEqual([
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
        "0001_create_notes",
        "0002_seed_note",
      ]);
    });
  });
});
