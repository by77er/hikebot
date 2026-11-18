import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["node_modules", ".wrangler", "worker-configuration.d.ts"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.js", "*.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["*.js", "*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // End-to-end tests drive the Worker only over HTTP; the probe Worker is
    // Worker code and builds on src/.
    files: ["test/e2e/**/*.ts"],
    ignores: ["test/e2e/probe/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/src", "**/src/**"],
              message:
                "End-to-end tests reach the Worker only through signed HTTP requests; build what you need in test/e2e/harness/ instead of importing from src/.",
            },
          ],
        },
      ],
    },
  },
);
