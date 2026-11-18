import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { unstable_readConfig } from "wrangler";

// The vars as wrangler.jsonc sets them, without .dev.vars or .env values.
// The return type comes from a package Wrangler does not ship.
const { vars } = unstable_readConfig({ config: "./wrangler.jsonc" }) as {
  vars: Record<string, string>;
};

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              // These override what .dev.vars, .env files and the environment
              // hold, so the unit tests run the same in every checkout. The
              // secrets are dummies; tests that need a real key pair pass
              // their own DISCORD_PUBLIC_KEY to the Worker.
              bindings: {
                DISCORD_API_BASE: vars.DISCORD_API_BASE,
                DISCORD_PUBLIC_KEY: "00".repeat(32),
                DISCORD_APPLICATION_ID: "000000000000000000",
                DISCORD_BOT_TOKEN: "test-token",
                DISCORD_CLIENT_SECRET: "test-client-secret",
                SIGNING_SECRET: "test-signing-secret-of-at-least-32-chars",
                PUBLIC_URL: "https://hikebot.example",
              },
            },
          }),
        ],
        test: {
          name: "unit",
          include: ["test/**/*.test.{ts,tsx}"],
          exclude: ["test/e2e/**"],
          deps: {
            // discord-api-types is CommonJS; pre-bundle it so its enums load
            // in the Workers runtime, as Wrangler's bundler does for deploys.
            optimizer: {
              ssr: { enabled: true, include: ["discord-api-types/v10"] },
            },
          },
        },
      },
      "./vitest.e2e.config.ts",
    ],
  },
});
