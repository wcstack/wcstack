#!/usr/bin/env node
// Propagates the single-source toolchain configs (/config-templates/*) into each
// @wcstack/* package as a generated, do-not-edit copy:
//   packages/<pkg>/rollup.config.js
//   packages/<pkg>/eslint.config.js
//
// Packages are auto-discovered from packages/*/package.json (@wcstack/* scope),
// so new packages are covered without editing this script. A package whose build
// genuinely differs is registered in DEVIATIONS with its reason and keeps its own
// file untouched — a deviation stays a recorded decision, not silent drift.
//
// Usage:
//   node scripts/sync-package-configs.mjs          # write/refresh all copies
//   node scripts/sync-package-configs.mjs --check  # CI: fail if any copy drifted

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEVIATIONS = {
  "rollup.config.js": {
    lint: "thin CLI distribution wrapper with no src/ of its own; copies the vscode-wcs cli.cjs bundle (scripts/build.mjs), no rollup build",
    notification: "extra Service Worker bundle entry (src/sw.ts) alongside the standard three outputs",
    router: "imports @rollup/plugin-json (inlines package.json), package-specific build shape",
    server: "imports @rollup/plugin-json, package-specific build shape",
    state: "imports @rollup/plugin-json (inlines package.json), package-specific build shape",
    signals: "no src/auto bootstrap (design decision G2); lazy typescript plugin instantiation",
    typescript: "node CLI package (wcs-schema / wcs-tsc bins), no src/auto bootstrap; extra bin entries and node built-ins external",
    testing: "vitest/node test-helper library, no src/auto bootstrap; peers (@wcstack/state, @wcstack/server, happy-dom) and node built-ins external",
  },
  "eslint.config.js": {
    lint: "no src/ TypeScript to lint; `npm run lint` syntax-checks its two build/test scripts via node --check",
  },
};

function discoverPackages() {
  const pkgsDir = join(repoRoot, "packages");
  const result = [];
  for (const entry of readdirSync(pkgsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = join(pkgsDir, entry.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const name = JSON.parse(readFileSync(pkgJsonPath, "utf8")).name ?? "";
    if (name.startsWith("@wcstack/")) result.push(entry.name);
  }
  return result;
}

// CRLF/LF mixed checkouts are tolerated for comparison; writes are always LF.
const normalize = (s) => s.replace(/\r\n/g, "\n");

// --- Completeness guards ---------------------------------------------------
// Same two-guard scheme as sync-protocol-types.mjs / sync-io-core.mjs. The file
// list this script enforces comes from Object.keys(DEVIATIONS), not from reading
// /config-templates/ — so guard (1) is what makes "drop a new template in the
// dir, forget to register it" a hard failure instead of silent non-distribution.
// Both guards fail in write mode too.

function assertCanonicalDirComplete() {
  const unregistered = readdirSync(join(repoRoot, "config-templates"), { withFileTypes: true })
    .filter((e) => e.isFile() && !(e.name in DEVIATIONS))
    .map((e) => e.name);
  if (unregistered.length === 0) return;
  console.error(
    `Unregistered file(s) in /config-templates/: ${unregistered.join(", ")}\n` +
    "Every file in the canonical dir must be copy-distributed by this script.\n" +
    "Register each one in scripts/sync-package-configs.mjs (a DEVIATIONS key —\n" +
    "with an empty object when no package deviates), or move it out of\n" +
    "/config-templates/.",
  );
  process.exit(1);
}

const BANNER_PATTERN = /Generated from \/config-templates\/\S+ by scripts\/sync-package-configs\.mjs/;
const SCAN_EXCLUDED_DIRS = new Set(["dist", ".tsc-out", "node_modules", "coverage"]);
const SCAN_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);

function* scannableFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SCAN_EXCLUDED_DIRS.has(entry.name)) yield* scannableFiles(full);
    } else if (SCAN_EXTENSIONS.has(extname(entry.name))) {
      yield full;
    }
  }
}

function assertNoOrphanCopies(expectedDests) {
  const orphans = [];
  for (const file of scannableFiles(join(repoRoot, "packages"))) {
    if (!BANNER_PATTERN.test(readFileSync(file, "utf8").slice(0, 400))) continue;
    if (!expectedDests.has(file)) orphans.push(file.slice(repoRoot.length + 1).split(sep).join("/"));
  }
  if (orphans.length === 0) return;
  console.error(
    `Orphan generated copies (carry this script's banner but are not registered targets):\n  ${orphans.join("\n  ")}\n` +
    "A copy in a non-@wcstack package cannot be synced; a DEVIATIONS package keeps a\n" +
    "hand-written file and must not carry the banner. Fix the file or the registry in\n" +
    "scripts/sync-package-configs.mjs.",
  );
  process.exit(1);
}

function bannerFor(file) {
  return (
    "// ===========================================================================\n" +
    "// AUTO-GENERATED FILE - DO NOT EDIT.\n" +
    `// Generated from /config-templates/${file} by scripts/sync-package-configs.mjs.\n` +
    "// Run `node scripts/sync-package-configs.mjs` after editing the template.\n" +
    "// ===========================================================================\n\n"
  );
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const packages = discoverPackages();

  assertCanonicalDirComplete();
  assertNoOrphanCopies(new Set(
    Object.keys(DEVIATIONS).flatMap((file) =>
      packages.filter((pkg) => !(pkg in DEVIATIONS[file])).map((pkg) => join(repoRoot, "packages", pkg, file)),
    ),
  ));

  const stale = [];
  let checked = 0;

  for (const file of Object.keys(DEVIATIONS)) {
    const template = normalize(readFileSync(join(repoRoot, "config-templates", file), "utf8"));
    const expected = bannerFor(file) + template;
    for (const pkg of packages) {
      if (pkg in DEVIATIONS[file]) continue;
      checked++;
      const dest = join(repoRoot, "packages", pkg, file);
      const current = existsSync(dest) ? normalize(readFileSync(dest, "utf8")) : null;
      if (current === expected) continue;

      if (checkOnly) {
        stale.push(`packages/${pkg}/${file}`);
        continue;
      }
      writeFileSync(dest, expected);
      console.log(`  synced  packages/${pkg}/${file}`);
    }
  }

  if (checkOnly) {
    if (stale.length > 0) {
      console.error(
        `package configs are out of date:\n  ${stale.join("\n  ")}\n` +
        "Run `node scripts/sync-package-configs.mjs` and commit the result.",
      );
      process.exit(1);
    }
    console.log(`package configs are in sync (${checked} files, ${packages.length} packages).`);
    return;
  }

  console.log(`Done. ${checked} config files checked across ${packages.length} packages.`);
}

main();
