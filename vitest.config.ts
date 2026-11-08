import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/worker/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "apps/web/e2e/**"],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
