/**
 * Starts the Worker under test in local workerd with Wrangler's
 * `createTestHarness`, next to a fake Discord API, once per test file. Each
 * start gets fresh in-memory Durable Object storage, a newly generated
 * signing key pair, a dummy bot token and application id, and
 * DISCORD_API_BASE pointing at the fake.
 */
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll } from "vitest";
import {
  createTestHarness,
  unstable_readConfig,
  type TestHarness,
  type TestHarnessOptions,
} from "wrangler";
import { FakeDiscord } from "./fake-discord";
import { createSigner, InteractionClient, type Signer } from "./interactions";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CONFIG_PATH = "wrangler.jsonc";
const PROBE_ENTRY = fileURLToPath(new URL("../probe/worker.ts", import.meta.url));

type InlineConfig = Extract<
  TestHarnessOptions["workers"][number],
  { config: unknown }
>["config"];

export const BOT_TOKEN = "e2e-bot-token";
export const APPLICATION_ID = "100000000000000001";

export interface E2E {
  /** Where the Worker listens; send interactions to `${url}interactions`. */
  url: URL;
  discord: FakeDiscord;
  signer: Signer;
  /** Sends signed interactions and checks the Worker's answers. */
  client: InteractionClient;
  harness: TestHarness;
}

export interface E2EOptions {
  /**
   * Run the Worker with the e2e probe feature (`test/e2e/probe/`) added to
   * its handlers, for harness self-tests that need the bot to call Discord.
   * Feature scenarios leave this off and test the real bundle.
   */
  probe?: boolean;
}

/**
 * Registers hooks that start the Worker and the fake before the file's tests
 * and stop both after them, also when a test fails. After each test it fails
 * the test if the fake refused a request the test did not take with
 * `discord.takeRejections()`, and prints the Worker's logs if the test
 * failed. Use the returned object inside tests only.
 */
export function useE2E(options: E2EOptions = {}): E2E {
  let started: E2E | undefined;
  const get = (): E2E => {
    if (!started) throw new Error("the e2e Worker has not started");
    return started;
  };

  beforeAll(async () => {
    const discord = new FakeDiscord({
      botToken: BOT_TOKEN,
      applicationId: APPLICATION_ID,
    });
    await discord.listen();
    const signer = await createSigner();
    const secrets = {
      DISCORD_PUBLIC_KEY: signer.publicKeyHex,
      DISCORD_APPLICATION_ID: APPLICATION_ID,
      DISCORD_BOT_TOKEN: BOT_TOKEN,
    };
    const vars = { DISCORD_API_BASE: discord.apiBase };
    const harness = createTestHarness({
      root: ROOT,
      workers: [
        options.probe
          ? { config: probeConfig({ ...vars, ...secrets }) }
          : { configPath: CONFIG_PATH, vars, secrets },
      ],
    });
    try {
      const { url } = await harness.listen();
      started = {
        url,
        discord,
        signer,
        harness,
        client: new InteractionClient({
          url,
          signer,
          discord,
          applicationId: APPLICATION_ID,
        }),
      };
    } catch (error) {
      await harness.close();
      await discord.close();
      throw error;
    }
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
    if (!started) return;
    const { harness, discord } = started;
    started = undefined;
    try {
      await harness.close();
    } finally {
      await discord.close();
    }
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

/**
 * The repository's Worker config with the probe entry point as `main`.
 * Secrets go in as vars because an inline config takes no secrets.
 */
function probeConfig(vars: Record<string, string>): InlineConfig {
  const config = unstable_readConfig({ config: `${ROOT}/${CONFIG_PATH}` });
  return {
    name: config.name,
    main: PROBE_ENTRY,
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags,
    durable_objects: config.durable_objects,
    migrations: config.migrations,
    vars: { ...config.vars, ...vars },
  };
}
