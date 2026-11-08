import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a disposable instance with AI_BACKEND=mock (docker/compose.e2e.yml).
 * From the PC: `ssh -N -L 8131:127.0.0.1:8131 nuc` and then `pnpm --filter @nutria/web e2e`.
 * The suite is serial: the first sign-up becomes admin, later steps build on it.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8131",
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
