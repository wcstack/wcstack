// Records __tests__/golden/current-3.3.0.json from the current engine's dist.
// Build packages/state first if its dist is not the version you want to compare against.
import { spawnSync } from "node:child_process";

const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "__tests__/golden.record.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, WCS_GOLDEN: "1" },
});
process.exit(r.status ?? 1);
