/**
 * Harness self-tests: the Worker under test gets the harness's key pair,
 * bot token, application id and DISCORD_API_BASE whatever `.dev.vars` or
 * `.env` the checkout holds and whatever DISCORD_* variables the caller has
 * set. `test/e2e/probe.test.ts` checks the same for the probe Worker.
 */
import { describe } from "vitest";
import {
  itGetsTheHarnessSecrets,
  useCheckoutWithOtherSecrets,
} from "./harness/local-secrets";
import { useE2E } from "./harness/worker";

describe.each([".dev.vars", ".env"])(
  "with other values in %s and the environment",
  (secretsFile) => {
    const root = useCheckoutWithOtherSecrets(secretsFile);
    itGetsTheHarnessSecrets(useE2E({ root }));
  },
);
