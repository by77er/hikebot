import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The end-to-end suite: Node tests that run the Worker in local workerd and
// reach it only over HTTP. See "Testing" in docs/design.md.
export default defineConfig({
  test: {
    name: "e2e",
    environment: "node",
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      // Keep Wrangler off the network: no usage metrics, no update check.
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG: "none",
      // Wrangler writes a metrics device id to its config directory even
      // with metrics off. Unless ~/.wrangler exists, that directory is under
      // XDG_CONFIG_HOME; keep it in the checkout's ignored .wrangler/ so the
      // suite needs no writable home directory.
      XDG_CONFIG_HOME: fileURLToPath(
        new URL("./.wrangler/e2e-config", import.meta.url),
      ),
    },
  },
});
