// build-schema-core.mjs — bring the validator core bundle into dist/.
//
// The self-check of generated manifests (envelope + JSON-Schema subset) and the
// "generated schema really resolves in the validator" tests use the validator
// core whose single source of truth is packages/vscode-wcs. Like @wcstack/lint
// (docs/wcs-validate-npm-cli-proposal.md), this package does not copy that
// logic: it
//   1. installs vscode-wcs' dependencies if missing (npm ci)
//   2. builds vscode-wcs (esbuild emits the self-contained dist/schema-core.cjs)
//   3. copies dist/schema-core.cjs next to this package's own bundles
// schema-core.cjs requires neither typescript nor vscode, so the runtime
// dependency count of this package stays at zero.

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const vscodeWcs = join(pkgRoot, "..", "vscode-wcs");

const run = (command, cwd) => {
  console.log(`[typescript build] ${command} (in ${cwd})`);
  execSync(command, { cwd, stdio: "inherit" });
};

if (!existsSync(join(vscodeWcs, "node_modules"))) {
  run("npm ci", vscodeWcs);
}
run("npm run build", vscodeWcs);

const dist = join(pkgRoot, "dist");
mkdirSync(dist, { recursive: true });
// schema-core.cjs: validator core for wcs-schema's self-check and e2e tests.
// tsc-core.cjs: the Volar language plugin wcs-tsc hands to @volar/typescript's runTsc.
for (const name of ["schema-core.cjs", "tsc-core.cjs"]) {
  const source = join(vscodeWcs, "dist", name);
  if (!existsSync(source)) {
    console.error(`[typescript build] expected build output not found: ${source}`);
    process.exit(1);
  }
  copyFileSync(source, join(dist, name));
  console.log(`[typescript build] dist/${name} ready`);
}
