/**
 * Starts the Worker under test, the fake Discord API, the fake geocoder and
 * the fake forecast API once per test file, as `E2ERun` in `./start`
 * describes.
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
 * Registers hooks that start the Worker and the fakes before the file's tests
 * and stop them after them, also when a test fails. After each test it fails
 * the test if the fake Discord API, the fake geocoder or the fake forecast
 * API refused a request the test did not take with
 * `discord.takeRejections()`, `geocoder.takeRejections()` or
 * `weather.takeRejections()`, and prints the Worker's logs if the test
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
    // Take all three records before failing, so none leaks into the next
    // test.
    const rejected = started.discord.takeRejections();
    const refused = started.geocoder.takeRejections();
    const declined = started.weather.takeRejections();
    const failures: string[] = [];
    if (rejected.length > 0) {
      failures.push(
        `the fake Discord API refused requests from the Worker:\n${rejected
          .map(
            (r) =>
              `${r.method} ${r.route} -> ${String(r.status)} ${JSON.stringify(r.response)}`,
          )
          .join("\n")}`,
      );
    }
    if (refused.length > 0) {
      failures.push(
        `the fake Nominatim refused requests from the Worker:\n${refused
          .map(
            (r) =>
              `${r.method} ${r.path} ${JSON.stringify(r.query)} (User-Agent ${JSON.stringify(r.userAgent)}) -> ${String(r.status)} ${JSON.stringify(r.response)}`,
          )
          .join("\n")}`,
      );
    }
    if (declined.length > 0) {
      failures.push(
        `the fake Open-Meteo refused requests from the Worker:\n${declined
          .map(
            (r) =>
              `${r.method} ${r.path} ${JSON.stringify(r.query)} (User-Agent ${JSON.stringify(r.userAgent)}) -> ${String(r.status)} ${JSON.stringify(r.response)}`,
          )
          .join("\n")}`,
      );
    }
    if (failures.length > 0) throw new Error(failures.join("\n"));
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
    get geocoder() {
      return get().geocoder;
    },
    get weather() {
      return get().weather;
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
    outbound: (after) => get().outbound(after),
    outboundMark: () => get().outboundMark(),
  };
}
