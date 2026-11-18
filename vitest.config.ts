import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Dummy secrets. Tests that need a real key pair pass their own
        // DISCORD_PUBLIC_KEY to the Worker.
        bindings: {
          DISCORD_PUBLIC_KEY: "00".repeat(32),
          DISCORD_APPLICATION_ID: "000000000000000000",
          DISCORD_BOT_TOKEN: "test-token",
        },
      },
    }),
  ],
  test: {
    deps: {
      // discord-api-types is CommonJS; pre-bundle it so its enums load in
      // the Workers runtime, as Wrangler's bundler does for deploys.
      optimizer: { ssr: { enabled: true, include: ["discord-api-types/v10"] } },
    },
  },
});
