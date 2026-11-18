/**
 * For harness self-tests that check the Worker under test gets the harness's
 * key pair, bot token, application id and DISCORD_API_BASE whatever local
 * secrets files the checkout holds and whatever DISCORD_* variables the
 * caller has set. The Worker runs from a temporary copy of the checkout with
 * its own `.dev.vars` or `.env`, so the developer's files are never touched.
 */
import {
  cpSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { APPLICATION_ID, BOT_TOKEN, type E2E } from "./worker";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Values no harness start uses, so a leak of any of them is visible. */
export const OTHER_SECRETS = {
  DISCORD_PUBLIC_KEY: "ff".repeat(32),
  DISCORD_APPLICATION_ID: "1",
  DISCORD_BOT_TOKEN: "x",
  DISCORD_API_BASE: "https://other-discord.invalid/api/v10",
};

type DiscordEnv = Record<keyof typeof OTHER_SECRETS, string>;

/**
 * Registers hooks that make a checkout in a temporary directory, with the
 * repository's `wrangler.jsonc`, links to its `src/`, `public/` and
 * `node_modules/`, and `secretsFile` holding OTHER_SECRETS, and that set the
 * same values in the environment. Returns the directory, for
 * `useE2E({ root })`; call it before `useE2E`, so its hooks run first.
 */
export function useCheckoutWithOtherSecrets(secretsFile: string): () => string {
  let dir: string | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "hikebot-e2e-checkout-"));
    cpSync(join(ROOT, "wrangler.jsonc"), join(dir, "wrangler.jsonc"));
    symlinkSync(join(ROOT, "src"), join(dir, "src"));
    symlinkSync(join(ROOT, "public"), join(dir, "public"));
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
    writeFileSync(
      join(dir, secretsFile),
      Object.entries(OTHER_SECRETS)
        .map(([name, value]) => `${name}=${value}\n`)
        .join(""),
    );
    for (const [name, value] of Object.entries(OTHER_SECRETS)) {
      vi.stubEnv(name, value);
    }
    // Makes Wrangler add the environment to the secrets it loads.
    vi.stubEnv("CLOUDFLARE_INCLUDE_PROCESS_ENV", "true");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  return () => {
    if (!dir) throw new Error("the temporary checkout has not been made");
    return dir;
  };
}

/**
 * Registers tests that the Worker `e2e` runs has the harness's secrets and
 * DISCORD_API_BASE, and accepts an interaction signed with its key.
 */
export function itGetsTheHarnessSecrets(e2e: E2E): void {
  it("binds the harness's secrets and DISCORD_API_BASE", async () => {
    const env = await e2e.harness.getWorker<DiscordEnv>().getEnv();
    expect({
      DISCORD_PUBLIC_KEY: env.DISCORD_PUBLIC_KEY,
      DISCORD_APPLICATION_ID: env.DISCORD_APPLICATION_ID,
      DISCORD_BOT_TOKEN: env.DISCORD_BOT_TOKEN,
      DISCORD_API_BASE: env.DISCORD_API_BASE,
    }).toEqual({
      DISCORD_PUBLIC_KEY: e2e.signer.publicKeyHex,
      DISCORD_APPLICATION_ID: APPLICATION_ID,
      DISCORD_BOT_TOKEN: BOT_TOKEN,
      DISCORD_API_BASE: e2e.discord.apiBase,
    });
  });

  it("accepts an interaction signed with the harness's key", async () => {
    expect(await e2e.client.send(e2e.client.ping())).toEqual({ type: 1 });
  });
}
