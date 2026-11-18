import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GuildHike } from "../../src/guild/guild-hike";
import type { JobHandler } from "../../src/guild/router";
import { schedule, scheduledJobs } from "../../src/guild/schedule";

/** Far enough ahead that the alarm only runs a job because it is the earliest. */
const T = 2_000_000_000_000;

afterEach(() => {
  vi.restoreAllMocks();
});

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

/** Registers jobs on the guild's live router, as `registerFeatures` would. */
async function registerJobs(
  guildId: string,
  jobs: Record<string, JobHandler>,
): Promise<void> {
  await runInDurableObject(stub(guildId), (instance: GuildHike) => {
    for (const [name, handler] of Object.entries(jobs)) {
      instance.router.job(name, handler);
    }
  });
}

/** Two test jobs that record their runs in `runs`. */
function recorders(runs: string[]): Record<string, JobHandler> {
  return {
    "test:first": () => {
      runs.push("first");
      return Promise.resolve();
    },
    "test:second": () => {
      runs.push("second");
      return Promise.resolve();
    },
  };
}

function scheduleIn(guildId: string, job: string, dueAt: number) {
  return runInDurableObject(stub(guildId), (_i, state) =>
    schedule(state.storage, job, dueAt),
  );
}

function stateOf(guildId: string) {
  return runInDurableObject(stub(guildId), async (_i, state) => ({
    alarm: await state.storage.getAlarm(),
    jobs: Object.fromEntries(await scheduledJobs(state.storage)),
  }));
}

describe("scheduled jobs", () => {
  it("keep their due times across a restart of the object", async () => {
    const guild = "schedule-restart";
    await scheduleIn(guild, "test:first", T);
    await scheduleIn(guild, "test:second", T + 60_000);
    await evictDurableObject(stub(guild));
    expect(await stateOf(guild)).toEqual({
      alarm: T,
      jobs: { "test:first": T, "test:second": T + 60_000 },
    });
  });

  it("each run at their own time", async () => {
    const guild = "schedule-two-times";
    const runs: string[] = [];
    await registerJobs(guild, recorders(runs));
    await scheduleIn(guild, "test:second", T + 60_000);
    await scheduleIn(guild, "test:first", T);

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(runs).toEqual(["first"]);
    expect(await stateOf(guild)).toEqual({
      alarm: T + 60_000,
      jobs: { "test:second": T + 60_000 },
    });

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(runs).toEqual(["first", "second"]);
    expect(await stateOf(guild)).toEqual({ alarm: null, jobs: {} });
    expect(await runDurableObjectAlarm(stub(guild))).toBe(false);
  });

  it("run together when all are due by the clock", async () => {
    const guild = "schedule-all-due";
    const runs: string[] = [];
    await registerJobs(guild, recorders(runs));
    await scheduleIn(guild, "test:first", 1_000);
    await scheduleIn(guild, "test:second", 2_000);

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(runs.sort()).toEqual(["first", "second"]);
    expect(await runDurableObjectAlarm(stub(guild))).toBe(false);
  });

  it("move the alarm earlier, and keep a job's earlier time when it is scheduled again later", async () => {
    const guild = "schedule-earlier";
    await scheduleIn(guild, "test:first", T + 60_000);
    expect((await stateOf(guild)).alarm).toBe(T + 60_000);

    await scheduleIn(guild, "test:second", T);
    expect((await stateOf(guild)).alarm).toBe(T);

    await scheduleIn(guild, "test:second", T + 120_000);
    expect(await stateOf(guild)).toEqual({
      alarm: T,
      jobs: { "test:first": T + 60_000, "test:second": T },
    });
  });

  it("scheduled by a job while the alarm runs get an alarm, and run once per alarm", async () => {
    const guild = "schedule-by-a-job";
    const runs: string[] = [];
    await registerJobs(guild, {
      "test:first": async ({ storage }) => {
        runs.push("first");
        await schedule(storage, "test:first", T);
        await schedule(storage, "test:second", T + 60_000);
      },
    });
    await scheduleIn(guild, "test:first", T);

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(runs).toEqual(["first"]);
    expect(await stateOf(guild)).toEqual({
      alarm: T,
      jobs: { "test:first": T, "test:second": T + 60_000 },
    });
  });

  it("scheduled by a request while the alarm runs get an alarm", async () => {
    const guild = "schedule-by-a-request";
    const runs: string[] = [];
    let started = () => undefined as void;
    const running = new Promise<void>((resolve) => (started = resolve));
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await registerJobs(guild, {
      "test:first": async () => {
        started();
        await held;
        runs.push("first");
      },
    });
    await scheduleIn(guild, "test:first", T);

    const alarm = runDurableObjectAlarm(stub(guild));
    await running;
    await scheduleIn(guild, "test:second", T + 60_000);
    release();
    expect(await alarm).toBe(true);

    expect(runs).toEqual(["first"]);
    expect(await stateOf(guild)).toEqual({
      alarm: T + 60_000,
      jobs: { "test:second": T + 60_000 },
    });
  });

  it("log a job that throws by its name and still run the others", async () => {
    const guild = "schedule-throws";
    const runs: string[] = [];
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await registerJobs(guild, {
      ...recorders(runs),
      "test:first": () => Promise.reject(new Error("trail washed out")),
    });
    await scheduleIn(guild, "test:first", T);
    await scheduleIn(guild, "test:second", T);

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(runs).toEqual(["second"]);
    expect(errors).toHaveBeenCalledWith(
      "scheduled job test:first failed: trail washed out",
    );
    expect(await stateOf(guild)).toEqual({ alarm: null, jobs: {} });
  });

  it("log and drop a due job nobody registered, and still run the others", async () => {
    const guild = "schedule-unregistered";
    const runs: string[] = [];
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await registerJobs(guild, recorders(runs));
    await scheduleIn(guild, "test:nobody", T);
    await scheduleIn(guild, "test:second", T);

    expect(await runDurableObjectAlarm(stub(guild))).toBe(true);
    expect(runs).toEqual(["second"]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(
      "scheduled job test:nobody has no handler; dropped it",
    );
    expect(await stateOf(guild)).toEqual({ alarm: null, jobs: {} });
    expect(await runDurableObjectAlarm(stub(guild))).toBe(false);
  });
});
