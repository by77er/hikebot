/**
 * Starts the Worker under test in local workerd with Wrangler's
 * `createTestHarness`, next to a fake Discord API and a fake Nominatim
 * geocoder (`./fake-nominatim.ts`). Each start gets fresh
 * in-memory Durable Object storage, a `MAPS` bucket holding the sample map
 * archive and its manifest (`./maps.ts`) unless `maps` is false, a newly
 * generated signing key pair, a
 * dummy bot token, application id, OAuth client secret and SIGNING_SECRET,
 * PUBLIC_URL set to an example origin, DISCORD_API_BASE and
 * DISCORD_OAUTH_AUTHORIZE_URL pointing at the fake Discord API, which
 * accepts `${PUBLIC_URL}/auth/callback` as the application's OAuth2 redirect
 * URI, and NOMINATIM_BASE at the fake geocoder.
 * These go in as the harness's `vars` and `secrets`, which override
 * whatever `.dev.vars`, `.env` files or the environment hold, so the Worker
 * runs the same in any checkout. `useE2E` in `./worker` starts one per test
 * file; the screenshot script in `test/screenshots/` starts one of its own.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTestHarness,
  unstable_readConfig,
  type TestHarness,
  type TestHarnessOptions,
} from "wrangler";
import { FakeDiscord } from "./fake-discord";
import { FakeNominatim } from "./fake-nominatim";
import { createSigner, InteractionClient, type Signer } from "./interactions";
import { seedMaps, type MapsBucket } from "./maps";

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
  /** The fake Nominatim the Worker looks place names up with. */
  geocoder: FakeNominatim;
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
  /**
   * Put the sample map archive and its manifest into the `MAPS` bucket.
   * Defaults to true; false starts the Worker as production is before the
   * first map data build.
   */
  maps?: boolean;
}

/**
 * One run of the fake Discord API, the fake geocoder and the Worker. `close` stops whatever
 * `start` began, also when the start failed or is still under way.
 */
export class E2ERun {
  private harness?: TestHarness;
  private discord?: FakeDiscord;
  private geocoder?: FakeNominatim;
  private probeDir?: string;

  async start(options: E2EOptions = {}): Promise<E2E> {
    const discord = new FakeDiscord({
      botToken: BOT_TOKEN,
      applicationId: APPLICATION_ID,
      clientSecret: CLIENT_SECRET,
      redirectUris: [`${PUBLIC_URL}/auth/callback`],
    });
    this.discord = discord;
    await discord.listen();
    const geocoder = new FakeNominatim();
    this.geocoder = geocoder;
    await geocoder.listen();
    const signer = createSigner();
    const secrets = {
      DISCORD_PUBLIC_KEY: signer.publicKeyHex,
      DISCORD_APPLICATION_ID: APPLICATION_ID,
      DISCORD_BOT_TOKEN: BOT_TOKEN,
      DISCORD_CLIENT_SECRET: CLIENT_SECRET,
      SIGNING_SECRET,
    };
    const vars = {
      DISCORD_API_BASE: discord.apiBase,
      DISCORD_OAUTH_AUTHORIZE_URL: discord.authorizeUrl,
      NOMINATIM_BASE: geocoder.base,
      PUBLIC_URL,
    };
    const root = options.root?.() ?? ROOT;
    let configPath = join(root, CONFIG_PATH);
    if (options.probe) {
      this.probeDir = await mkdtemp(join(tmpdir(), "hikebot-e2e-probe-"));
      configPath = await writeProbeConfig(configPath, this.probeDir);
    }
    const worker: WorkerInput = { configPath, vars, secrets };
    const harness = createTestHarness({ root, workers: [worker] });
    this.harness = harness;
    const { url } = await harness.listen();
    const env = await harness.getWorker<{ MAPS?: MapsBucket }>().getEnv();
    if (env.MAPS && options.maps !== false) await seedMaps(env.MAPS);
    return {
      url,
      discord,
      geocoder,
      signer,
      harness,
      client: new InteractionClient({
        url,
        signer,
        discord,
        applicationId: APPLICATION_ID,
      }),
    };
  }

  async close(): Promise<void> {
    const { harness, discord, geocoder, probeDir } = this;
    this.harness = undefined;
    this.discord = undefined;
    this.geocoder = undefined;
    this.probeDir = undefined;
    try {
      await harness?.close();
    } finally {
      try {
        await discord?.close();
      } finally {
        try {
          await geocoder?.close();
        } finally {
          if (probeDir) await rm(probeDir, { recursive: true, force: true });
        }
      }
    }
  }
}

/** The parts of the repository's Worker config the probe keeps. */
interface ProbeSource {
  name?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  durable_objects: object;
  migrations: object[];
  assets?: { directory?: string; binding?: string };
  r2_buckets?: object[];
  rules?: object[];
  vars: Record<string, string>;
  secrets?: object;
}

/**
 * Writes the Worker config at `configPath` with the probe entry point as
 * `main` to `dir`, and returns the new file's path. The static assets
 * directory is made absolute, so the probe serves the checkout's `public/`.
 * The probe runs from a file rather than an inline config because only a
 * file-based worker takes the harness's `secrets`; an inline config's vars
 * lose to `.dev.vars`.
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
    r2_buckets: config.r2_buckets,
    // Module rules, such as the map fonts imported as data.
    rules: config.rules,
    vars: config.vars,
    secrets: config.secrets,
  };
  const path = join(dir, "wrangler.json");
  await writeFile(path, JSON.stringify(probeConfig, null, 2));
  return path;
}
