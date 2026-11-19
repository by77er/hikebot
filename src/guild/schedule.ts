/**
 * The guild object's scheduled jobs. A Durable Object has one alarm; this
 * module shares it among named jobs. Each scheduled job is a key in the
 * object's storage holding when it is due, so jobs survive a restart, and the
 * alarm is kept at the earliest due time. Jobs are registered on the router
 * with `router.job(name, handler)` in `registerFeatures`.
 */
import type { HandlerContext, Router } from "./router";

const JOB_KEY_PREFIX = "job:";

/**
 * Records that `job` is due at `dueAt` (milliseconds since the epoch). If the
 * job is already scheduled, the earlier of the two times is kept. Moves the
 * object's alarm earlier when the job is due before it.
 */
export async function schedule(
  storage: DurableObjectStorage,
  job: string,
  dueAt: number,
): Promise<void> {
  const key = `${JOB_KEY_PREFIX}${job}`;
  const current = await storage.get<number>(key);
  const due = current === undefined ? dueAt : Math.min(current, dueAt);
  if (due !== current) await storage.put(key, due);
  const alarm = await storage.getAlarm();
  if (alarm === null || due < alarm) await storage.setAlarm(due);
}

/**
 * Drops `job` from the schedule, if it is scheduled, and keeps the alarm at
 * the earliest job still scheduled, or clears it when none is.
 */
export async function unschedule(
  storage: DurableObjectStorage,
  job: string,
): Promise<void> {
  await storage.delete(`${JOB_KEY_PREFIX}${job}`);
  const later = await scheduledJobs(storage);
  if (later.size > 0) await storage.setAlarm(Math.min(...later.values()));
  else await storage.deleteAlarm();
}

/** When each scheduled job is due, by job name. */
export async function scheduledJobs(
  storage: DurableObjectStorage,
): Promise<Map<string, number>> {
  const keys = await storage.list<number>({ prefix: JOB_KEY_PREFIX });
  return new Map(
    [...keys].map(([key, at]) => [key.slice(JOB_KEY_PREFIX.length), at]),
  );
}

/**
 * The alarm's body. Runs every job due by `now`, and at least the earliest
 * ones, since the alarm was set for them. Each runs at most once per alarm;
 * one scheduled again while it runs (by itself or by a request) waits for the
 * next alarm. A job without a handler, or one that throws, is logged with its
 * name; the other jobs still run and this never throws for them, so the
 * platform's alarm retry cannot run a job twice. Finally sets the alarm for
 * the earliest job still scheduled.
 */
export async function runDueJobs(
  router: Router,
  context: HandlerContext,
  now: number,
): Promise<void> {
  const { storage } = context;
  const scheduled = await scheduledJobs(storage);
  if (scheduled.size > 0) {
    const until = Math.max(now, Math.min(...scheduled.values()));
    const due = [...scheduled.keys()].filter(
      (job) => (scheduled.get(job) ?? Infinity) <= until,
    );
    await storage.delete(due.map((job) => `${JOB_KEY_PREFIX}${job}`));
    for (const job of due) {
      const handler = router.jobHandler(job);
      if (!handler) {
        console.error(`scheduled job ${job} has no handler; dropped it`);
        continue;
      }
      try {
        await handler(context);
      } catch (error) {
        console.error(
          `scheduled job ${job} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  const later = await scheduledJobs(storage);
  if (later.size > 0) await storage.setAlarm(Math.min(...later.values()));
}
