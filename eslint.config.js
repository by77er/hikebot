import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "node_modules",
      ".wrangler",
      "worker-configuration.d.ts",
      "types/lib-dom",
      // MapLibre GL JS, copied unchanged from its npm package.
      "public/assets/maps/maplibre",
    ],
  },
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
    // Scripts the pages load: plain JavaScript modules run by the browser.
    files: ["public/**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.browser, sourceType: "module" },
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
