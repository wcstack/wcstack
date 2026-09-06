// build-deps.mjs — make sure the sibling packages this package links to
// (devDependencies `file:../state`, `file:../router`, `file:../server`) expose
// their current source, not a stale committed dist.
//
// `mount()` reuses server's `waitForReady`, its tests drive state and router.
// In the CI matrix this package's job installs its own dependencies only, and
// the `file:` links point at packages/*/dist as committed — which lags behind
// src between releases (the #183 shape: green on a stale dist, red at release).
// Building the three from source here, the way @wcstack/lint and
// @wcstack/typescript build vscode-wcs, keeps "fresh siblings × testing" gated
// on every run.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const run = (command, cwd) => {
  console.log(`[testing build] ${command} (in ${cwd})`);
  execSync(command, { cwd, stdio: "inherit" });
};

for (const name of ["state", "router", "server"]) {
  const dir = join(pkgRoot, "..", name);
  if (!existsSync(join(dir, "node_modules"))) {
    run("npm ci", dir);
  }
  run("npm run build", dir);
  if (!existsSync(join(dir, "dist", "index.esm.js"))) {
    console.error(`[testing build] expected build output not found: packages/${name}/dist/index.esm.js`);
    process.exit(1);
  }
}
console.log("[testing build] @wcstack/state, @wcstack/router and @wcstack/server dists are fresh");
