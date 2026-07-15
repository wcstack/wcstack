#!/usr/bin/env node
// Propagates the single-source IO-core runtime helpers from /io-core into
// consuming packages as generated, do-not-edit copies:
//   packages/<pkg>/src/core/operationLane.ts       (from io-core/operation-lane.ts)
//   packages/<pkg>/src/core/platformCapability.ts  (from io-core/platform-capability.ts)
//
// These are framework-agnostic primitives (the request lane + the platform
// capability / error-taxonomy layer). Each consuming package bundles its own copy,
// so the package stays independently buildable/publishable with ZERO runtime
// dependency and self-contained CDN drops (rollup inlines the copy into each dist).
// This mirrors the wc-bindable copy-distribution done by sync-protocol-types.mjs.
//
// Node-specific capability registries / error codes are NOT part of the shared
// canonical: each node declares those in its own hand-written file (e.g.
// packages/fetch/src/core/fetchCapabilities.ts) and imports the generic layer here.
//
// Usage:
//   node scripts/sync-io-core.mjs          # write/refresh all copies
//   node scripts/sync-io-core.mjs --check   # CI: fail if any copy is stale/missing

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Canonical source (kebab) -> generated dest file name (camelCase) under src/core.
const FILES = [
  { source: "operation-lane.ts", dest: "operationLane.ts" },
  { source: "platform-capability.ts", dest: "platformCapability.ts" },
];

// Packages that bundle the IO-core primitives. Grows as the lane / capability
// rollout reaches more operation-shaped nodes (see decision: operation nodes only).
// Consumers other than the reference package (fetch) exclude the generated copies
// from coverage — they are byte-identical to fetch's, which tests them fully.
const TARGET_PACKAGES = ["fetch", "share", "contacts", "eyedropper", "credential", "upload"];

const banner = (sourceName) =>
  "// ===========================================================================\n" +
  "// AUTO-GENERATED FILE - DO NOT EDIT.\n" +
  `// Generated from /io-core/${sourceName} by scripts/sync-io-core.mjs.\n` +
  "// Run `node scripts/sync-io-core.mjs` after editing the source.\n" +
  "// ===========================================================================\n\n";

// CRLF/LF mixed checkouts (e.g. core.autocrlf=true) are tolerated for comparison;
// writes are always LF.
const normalize = (s) => s.replace(/\r\n/g, "\n");

function expectedContent(sourceName) {
  const sourcePath = join(repoRoot, "io-core", sourceName);
  return banner(sourceName) + normalize(readFileSync(sourcePath, "utf8"));
}

function destFor(pkg, fileName) {
  return join(repoRoot, "packages", pkg, "src", "core", fileName);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const contents = new Map(FILES.map((f) => [f.dest, expectedContent(f.source)]));
  const targets = TARGET_PACKAGES.flatMap((pkg) =>
    FILES.map((f) => ({ pkg, fileName: f.dest, content: contents.get(f.dest) })),
  );
  const stale = [];

  for (const { pkg, fileName, content } of targets) {
    const dest = destFor(pkg, fileName);
    const current = existsSync(dest) ? normalize(readFileSync(dest, "utf8")) : null;
    if (current === content) continue;

    if (checkOnly) {
      stale.push(`${pkg}/${fileName}`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    console.log(`  synced  packages/${pkg}/src/core/${fileName}`);
  }

  if (checkOnly) {
    if (stale.length > 0) {
      console.error(
        `IO-core sources are out of date in: ${stale.join(", ")}\n` +
        "Run `node scripts/sync-io-core.mjs` and commit the result.",
      );
      process.exit(1);
    }
    console.log(`IO-core sources are in sync (${targets.length} generated files).`);
    return;
  }

  console.log(`Done. ${targets.length} generated files written/checked.`);
}

main();
