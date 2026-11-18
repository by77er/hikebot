import { defineConfig } from "vitest/config";

// The end-to-end suite: Node tests that run the Worker in local workerd and
// reach it only over HTTP. See "Testing" in docs/design.md.
export default defineConfig({
  test: {
    name: "e2e",
    environment: "node",
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      // Keep Wrangler off the network: no usage metrics, no update check.
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG: "none",
    },
  },
});
