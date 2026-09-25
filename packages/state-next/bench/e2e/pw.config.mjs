// The repository's e2e specs (e2e/tests) against a chosen state bundle: STATE=next answers
// every request for /packages/state/dist/auto.min.js with state-next's (proxy.mjs).
// Run from e2e/ (where @playwright/test is installed), after building both packages:
//   STATE=current npx playwright test --config ../packages/state-next/bench/e2e/pw.config.mjs --reporter=json > current.json
//   STATE=next    npx playwright test --config ../packages/state-next/bench/e2e/pw.config.mjs --reporter=json > next.json
//   node ../packages/state-next/bench/e2e/compare.mjs current.json next.json
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const E2E = resolve(import.meta.dirname, "../../../../e2e");
const PORT = Number(process.env.PORT || 4400);
export default {
  testDir: `${E2E}/tests`,
  // failure artifacts go outside the repository
  outputDir: join(tmpdir(), "state-next-e2e-results"),
  fullyParallel: true,
  workers: 4,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: "chromium", headless: true },
  webServer: {
    command: `node "${resolve(import.meta.dirname, "proxy.mjs").replace(/\\/g, "/")}"`,
    url: `http://127.0.0.1:${PORT}/packages/state/package.json`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), E2E_DIR: E2E, STATE: process.env.STATE ?? "next" },
  },
};
