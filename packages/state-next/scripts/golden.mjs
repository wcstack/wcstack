// Records __tests__/golden/current-3.3.0.json from a 3.x dist (__tests__/golden.record.test.ts).
// The golden is frozen since the 4.0 swap: packages/state/dist is 4.0, and the test refuses a 4.0
// dist. To record anyway, point WCS_GOLDEN_DIST at a 3.x dist (`WCS_GOLDEN_DIST=<dir> npm run golden`).
import { spawnSync } from "node:child_process";

const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "__tests__/golden.record.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, WCS_GOLDEN: "1" },
});
process.exit(r.status ?? 1);
