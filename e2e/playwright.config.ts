import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT || 4173);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  // CI runners are slow to first paint; the debounce/fetch chains need headroom.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node serve.mjs",
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
