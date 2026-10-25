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
  projects: [
    // The headless shell has no getUserMedia: the field report's spec runs in full Chromium with a fake
    // camera and microphone (examples/state-field-report, docs/seam-apps.md).
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /state-field-report\.spec\.ts/ },
    {
      name: "chromium-media",
      testMatch: /state-field-report\.spec\.ts/,
      // one worker for the file: a fake camera encoding in many browsers at once starves the encoder
      // (a short take comes out as a header-only WebM)
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], channel: "chromium", launchOptions: { args: ["--use-fake-device-for-media-stream"] } },
    },
    // The production form differs between browsers where the CSP / SRI guides once said "Chromium only": import map
    // integrity and Trusted Types. prod-booking's checks tagged @browsers run in Firefox too (examples/prod-booking).
    {
      name: "firefox",
      testMatch: /prod-booking\.spec\.ts/,
      grep: /@browsers/,
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  webServer: {
    command: "node serve.mjs",
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
