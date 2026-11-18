/**
 * Starts the Worker under test in local workerd with Wrangler's
 * `createTestHarness`, next to a fake Discord API, once per test file. Each
 * start gets fresh in-memory Durable Object storage, a newly generated
 * signing key pair, a dummy bot token, application id, OAuth client secret
 * and SIGNING_SECRET, PUBLIC_URL set to an example origin, and
 * DISCORD_API_BASE pointing at the fake. These go in as the harness's
 * `vars` and `secrets`, which override whatever `.dev.vars`, `.env` files or
 * the environment hold, so the suite runs the same in any checkout.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
const PROBE_ENTRY = fileURLToPath(
  new URL("../probe/worker.ts", import.meta.url),
);

type WorkerInput = Extract<
  TestHarnessOptions["workers"][number],
  { configPath: unknown }
>;

export const BOT_TOKEN = "e2e-bot-token";
export const APPLICATION_ID = "100000000000000001";
export const CLIENT_SECRET = "e2e-client-secret";
export const SIGNING_SECRET = "e2e-signing-secret-of-at-least-32-characters";
export const PUBLIC_URL = "https://hikebot.example";

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
  /**
   * Returns the directory whose `wrangler.jsonc` the Worker starts from,
   * called when the Worker starts. Defaults to the repository root. For
   * harness self-tests that need a checkout with other local files.
   */
  root?: () => string;
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
  // Kept apart from `started` so afterAll stops whatever began, even when
  // the start failed or timed out half-way.
  let running: {
    harness?: TestHarness;
    discord?: FakeDiscord;
    probeDir?: string;
  } = {};
  const get = (): E2E => {
    if (!started) throw new Error("the e2e Worker has not started");
    return started;
  };

  beforeAll(async () => {
    const discord = new FakeDiscord({
      botToken: BOT_TOKEN,
      applicationId: APPLICATION_ID,
    });
    running.discord = discord;
    await discord.listen();
    const signer = createSigner();
    const secrets = {
      DISCORD_PUBLIC_KEY: signer.publicKeyHex,
      DISCORD_APPLICATION_ID: APPLICATION_ID,
      DISCORD_BOT_TOKEN: BOT_TOKEN,
      DISCORD_CLIENT_SECRET: CLIENT_SECRET,
      SIGNING_SECRET,
    };
    const vars = { DISCORD_API_BASE: discord.apiBase, PUBLIC_URL };
    const root = options.root?.() ?? ROOT;
    let configPath = join(root, CONFIG_PATH);
    if (options.probe) {
      running.probeDir = await mkdtemp(join(tmpdir(), "hikebot-e2e-probe-"));
      configPath = await writeProbeConfig(configPath, running.probeDir);
    }
    const worker: WorkerInput = { configPath, vars, secrets };
    const harness = createTestHarness({ root, workers: [worker] });
    running.harness = harness;
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
    const { harness, discord, probeDir } = running;
    running = {};
    started = undefined;
    try {
      await harness?.close();
    } finally {
      await discord?.close();
      if (probeDir) await rm(probeDir, { recursive: true, force: true });
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

/** The parts of the repository's Worker config the probe keeps. */
interface ProbeSource {
  name?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  durable_objects: object;
  migrations: object[];
  assets?: { directory?: string; binding?: string };
  vars: Record<string, string>;
  secrets?: object;
}

/**
 * Writes the Worker config at `configPath` with the probe entry point as
 * `main` to `dir`, and returns the new file's path. The static assets
 * directory is made absolute, so the probe serves the checkout's `public/`. The probe runs from a
 * file rather than an inline config because only a file-based worker takes
 * the harness's `secrets`; an inline config's vars lose to `.dev.vars`.
 */
async function writeProbeConfig(
  configPath: string,
  dir: string,
): Promise<string> {
  // Wrangler's own reader, so the probe gets the same bindings and
  // migrations as the real Worker. Its return type comes from a package
  // Wrangler does not ship, so it is narrowed here.
  const config = unstable_readConfig({
    config: configPath,
  }) as unknown as ProbeSource;
  const probeConfig = {
    name: config.name,
    main: PROBE_ENTRY,
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags,
    durable_objects: config.durable_objects,
    migrations: config.migrations,
    assets: config.assets && {
      ...config.assets,
      directory: resolve(dirname(configPath), config.assets.directory ?? "."),
    },
    vars: config.vars,
    secrets: config.secrets,
  };
  const path = join(dir, "wrangler.json");
  await writeFile(path, JSON.stringify(probeConfig, null, 2));
  return path;
}
