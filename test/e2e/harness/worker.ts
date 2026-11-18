/**
 * Starts the Worker under test and the fake Discord API once per test file,
 * as `E2ERun` in `./start` describes.
 */
import { afterAll, afterEach, beforeAll } from "vitest";
import { E2ERun, type E2E, type E2EOptions } from "./start";

export {
  APPLICATION_ID,
  BOT_TOKEN,
  CLIENT_SECRET,
  PUBLIC_URL,
  SIGNING_SECRET,
  type E2E,
  type E2EOptions,
} from "./start";

/**
 * Registers hooks that start the Worker and the fake before the file's tests
 * and stop both after them, also when a test fails. After each test it fails
 * the test if the fake refused a request the test did not take with
 * `discord.takeRejections()`, and prints the Worker's logs if the test
 * failed. Use the returned object inside tests only.
 */
export function useE2E(options: E2EOptions = {}): E2E {
  let started: E2E | undefined;
  // Kept apart from `started` so afterAll stops whatever began, even when
  // the start failed or timed out half-way.
  let run: E2ERun | undefined;
  const get = (): E2E => {
    if (!started) throw new Error("the e2e Worker has not started");
    return started;
  };

  beforeAll(async () => {
    run = new E2ERun();
    started = await run.start(options);
  });

  afterEach(({ task }) => {
    if (!started) return;
    if (task.result?.state === "fail") started.harness.debug();
    const rejected = started.discord.takeRejections();
    if (rejected.length > 0) {
      throw new Error(
        `the fake Discord API refused requests from the Worker:\n${rejected
          .map(
            (r) =>
              `${r.method} ${r.route} -> ${String(r.status)} ${JSON.stringify(r.response)}`,
          )
          .join("\n")}`,
      );
    }
  });

  afterAll(async () => {
    const stopping = run;
    run = undefined;
    started = undefined;
    await stopping?.close();
  });

  return {
    get url() {
      return get().url;
    },
    get discord() {
      return get().discord;
    },
    get signer() {
      return get().signer;
    },
    get client() {
      return get().client;
    },
    get harness() {
      return get().harness;
    },
  };
}
