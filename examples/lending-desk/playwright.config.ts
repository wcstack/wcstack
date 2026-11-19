// Browser tests against the development setup (Vite) and the production build (dist/ + a plain static server).
// Test ports: tests/e2e/ports.ts (static 8505, API 8506, Vite 8507). One worker: every test resets the one
// in-memory API. `WCS_LOCAL=1 npm run test:e2e` builds and serves the repository's packages/*/dist instead.
import { defineConfig, devices } from "@playwright/test";
import { API, DEV, PROD } from "./tests/e2e/ports.ts";

const node = JSON.stringify(process.execPath);
const all = process.env.E2E_ALL === "1";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: [["list"]],
  use: {
    headless: true,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
  },
  webServer: [
    { command: `${node} server/main.ts`, port: API, env: { API_PORT: String(API) }, reuseExistingServer: false, stdout: "ignore" },
    { command: `${node} node_modules/vite/bin/vite.js`, port: DEV, env: { API_PORT: String(API), DEV_PORT: String(DEV) }, reuseExistingServer: false },
    {
      command: `${node} node_modules/vite/bin/vite.js build --logLevel warn && ${node} server/static.ts`,
      port: PROD, env: { API_PORT: String(API), STATIC_PORT: String(PROD) }, reuseExistingServer: false, timeout: 120_000,
    },
  ],
  projects: [
    { name: "dev-chromium", use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${DEV}`, locale: "ja-JP", timezoneId: "Asia/Tokyo" } },
    { name: "prod-chromium", use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PROD}`, locale: "ja-JP", timezoneId: "Asia/Tokyo" } },
    { name: "prod-firefox", use: { ...devices["Desktop Firefox"], baseURL: `http://127.0.0.1:${PROD}`, locale: "ja-JP", timezoneId: "Asia/Tokyo" } },
    { name: "prod-webkit", use: { ...devices["Desktop Safari"], baseURL: `http://127.0.0.1:${PROD}`, locale: "ja-JP", timezoneId: "Asia/Tokyo" } },
    ...(all ? [
      { name: "dev-firefox", use: { ...devices["Desktop Firefox"], baseURL: `http://127.0.0.1:${DEV}`, locale: "ja-JP", timezoneId: "Asia/Tokyo" } },
      { name: "dev-webkit", use: { ...devices["Desktop Safari"], baseURL: `http://127.0.0.1:${DEV}`, locale: "ja-JP", timezoneId: "Asia/Tokyo" } },
    ] : []),
  ],
});
