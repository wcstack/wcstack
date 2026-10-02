// ensure-state-dist.mjs — make sure the @wcstack/state this package links to has its tooling build.
//
// vscode-wcs consumes `@wcstack/state/parser` and `@wcstack/state/manifest` (dist/parser.esm.js,
// dist/manifest.esm.js and their .d.ts) through the devDependency "@wcstack/state": "file:../state-next"
// — the 4.0 engine, which replaces packages/state at the 4.0 release
// (docs/state-engine-rewrite/v4-remaining.ja.md R1). Unlike packages/state, packages/state-next does
// not commit its dist, so a clean checkout has none and every import of the parser fails. This builds
// it once (installing its dependencies first when they are missing — the way @wcstack/lint and
// @wcstack/typescript build vscode-wcs).
//
// It also refuses a stale link: node_modules/@wcstack/state must resolve to the folder package.json
// names (`file:../state-next`). A checkout installed before the switch still links ../state, and the
// tests would silently run against the 3.x parser — run `npm ci` (or `npm install`) again.
//
// A dist that already exists is left alone, even if it is older than the src: rebuild it with
// `npm run build` in packages/state-next after changing the parser or the manifest.
//
// Who relies on it: `npm test` / `npm run build` here (Vitest's globalSetup, esbuild.config.js), and
// through them the builds of @wcstack/lint and @wcstack/typescript — including their ci.yml matrix
// jobs, which install nothing but their own package. ci.yml's wcs-validate job builds state-next
// explicitly first (so it always tests a fresh dist), and release.yml does not run while vscode-wcs
// depends on state-next.
//
// Concurrency: two processes that find the dist missing at the same time (two Vitest runs, or the lint
// and typescript builds side by side) would run two builds into the same folder. A lock directory
// (mkdir is atomic) serializes them: the second waits, then sees the dist the first one built. A lock
// left behind by a killed process is taken over after LOCK_STALE_MS.
//
// `node scripts/ensure-state-dist.mjs` runs it by hand.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const linked = join(pkgRoot, "node_modules", "@wcstack", "state");
/** What vscode-wcs imports from the engine (values and the types tsc reads). */
const REQUIRED = ["parser.esm.js", "parser.d.ts", "manifest.esm.js", "manifest.d.ts"];
const LOCK = join(pkgRoot, "node_modules", ".ensure-state-dist.lock");
const LOCK_STALE_MS = 15 * 60 * 1000;
const LOCK_WAIT_MS = 20 * 60 * 1000;

/** The folder the devDependency names (`file:../state-next` → packages/state-next), or null. */
function declaredStateRoot() {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  const spec = pkg.devDependencies?.["@wcstack/state"] ?? "";
  return spec.startsWith("file:") ? resolve(pkgRoot, spec.slice("file:".length)) : null;
}

const missingFiles = (stateRoot) => REQUIRED.filter((file) => !existsSync(join(stateRoot, "dist", file)));

/** Path equality; case-insensitive on Windows (drive letters and the file system are). */
const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock(fn) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let age = 0;
      try {
        age = Date.now() - statSync(LOCK).mtimeMs;
      } catch {
        continue; // released between the mkdir and the stat
      }
      if (age > LOCK_STALE_MS) {
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`[vscode-wcs] timed out waiting for ${LOCK} (another build of @wcstack/state?)`);
      sleep(500);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

export function ensureStateDist() {
  if (!existsSync(linked)) {
    throw new Error(`[vscode-wcs] node_modules/@wcstack/state is missing — run \`npm ci\` in ${pkgRoot} first.`);
  }
  // `realpathSync.native` on both sides: on Windows the JS realpath keeps the drive letter as given
  // (`c:\…` when started from a VS Code task or a lower-case cwd, since pkgRoot comes from
  // import.meta.url) but returns the link target as `C:\…`, so a plain comparison reads the right
  // link as a stale one. The native call canonicalizes both (`C:\…`).
  const stateRoot = realpathSync.native(linked);
  const declared = declaredStateRoot();
  if (declared !== null && existsSync(declared) && !samePath(realpathSync.native(declared), stateRoot)) {
    throw new Error(
      `[vscode-wcs] node_modules/@wcstack/state links ${stateRoot}, but package.json names ${declared} — run \`npm ci\` in ${pkgRoot} again.`,
    );
  }
  if (missingFiles(stateRoot).length === 0) return;
  withLock(() => {
    // another process may have built it while this one waited for the lock
    if (missingFiles(stateRoot).length === 0) return;
    const run = (command) => {
      console.log(`[vscode-wcs] ${command} (in ${stateRoot})`);
      execSync(command, { cwd: stateRoot, stdio: "inherit" });
    };
    if (!existsSync(join(stateRoot, "node_modules"))) run("npm ci");
    run("npm run build");
    const missing = missingFiles(stateRoot);
    if (missing.length > 0) {
      throw new Error(`[vscode-wcs] the @wcstack/state build did not produce ${missing.map((f) => `dist/${f}`).join(", ")}`);
    }
  });
}

/** Vitest globalSetup entry. */
export default function setup() {
  ensureStateDist();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureStateDist();
}
