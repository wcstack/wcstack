#!/usr/bin/env node
// Align internal @wcstack/* dependency ranges with the unified release version.
//
// Usage: node scripts/align-internal-dep-ranges.mjs <target-version> <pkg-dir>...
//
// `npm version` (release.yml's bump step) rewrites only each package's own
// "version" field. Registry-range @wcstack/* entries in dependencies /
// peerDependencies keep their old ranges, and across a major that ships a
// mismatched pair to consumers (e.g. server 2.0.0 declaring "@wcstack/state":
// "^1.9.1" pairs installs with state 1.x). This script rewrites every such
// entry: a runtime dependency to the exact <target-version> (server renders with
// the state of its own version), a peer to ^<target-version> — or, for a
// prerelease target (4.0.0-rc.1), both to the exact version, so an rc's packages
// install only with the same rc (`internalRange` in scripts/compute-next-version.mjs
// says why). `file:`
// specifiers (local dev links) are left alone — they never reach the registry.
//
// Prints each package dir it changed, one per line (consumed by release.yml
// to know which lockfiles need the post-publish sync). Exits non-zero only on
// real errors, not on "nothing to rewrite".

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { internalRange, parseVersion } from "./compute-next-version.mjs";

const [target, ...pkgDirs] = process.argv.slice(2);
let validTarget = false;
try {
  parseVersion(target);
  validTarget = true;
} catch {
  // reported below
}
if (!validTarget || pkgDirs.length === 0) {
  console.error("Usage: node scripts/align-internal-dep-ranges.mjs <target-version> <pkg-dir>...");
  process.exit(1);
}

for (const dir of pkgDirs) {
  const manifestPath = join(dir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  let changed = false;
  for (const section of ["dependencies", "peerDependencies"]) {
    const next = internalRange(target, section);
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      if (name.startsWith("@wcstack/") && !range.startsWith("file:")) {
        if (range !== next) {
          manifest[section][name] = next;
          changed = true;
        }
      }
    }
  }
  if (changed) {
    // npm's own package.json serialization: 2-space indent, trailing newline.
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(dir);
  }
}
