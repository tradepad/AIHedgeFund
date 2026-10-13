import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite. Starts the API, outbox relay, orchestrator and pipeline
 * workers against a fresh throwaway PostgreSQL database (development fixtures
 * only), then a production build of the web app pointed at that API.
 * Requires local PostgreSQL and Redis (see docs/troubleshooting.md).
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? "4400");
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? "3100");
const WEB_URL = `http://localhost:${WEB_PORT}`;
const chromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
  },
  webServer: [
    {
      command: "pnpm --filter @arf/integration-tests e2e:stack",
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      env: { E2E_API_PORT: String(API_PORT), E2E_WEB_URL: WEB_URL },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
    },
    {
      command: `pnpm exec next build && pnpm exec next start --port ${WEB_PORT}`,
      url: `${WEB_URL}/login`,
      env: { ARF_API_URL: `http://127.0.0.1:${API_PORT}`, ARF_AUTH_MODE: "dev", NEXT_TELEMETRY_DISABLED: "1" },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
