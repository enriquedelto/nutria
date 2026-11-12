// Lint for the worker and the shared packages (the web app has its own config with Next's rules).
// Syntax-only (no type information): those packages compile with TypeScript 7, which has no JS API.
import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default defineConfig([
  globalIgnores(["apps/web/**", "**/node_modules/**", "**/dist/**", "packages/db/migrations/**", "**/*.d.ts"]),
  {
    files: ["apps/worker/**/*.ts", "packages/*/src/**/*.ts", "packages/*/test/**/*.ts", "scripts/**/*.{ts,mjs}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
]);
