#!/usr/bin/env node
// Propagates the single-source wc-bindable protocol sources from /protocol
// into consuming packages as generated, do-not-edit copies:
//   packages/<pkg>/src/protocol/wcBindable.ts
//   packages/state/src/protocol/wcBindableReader.ts
//
// Each package's own types file re-exports from that copy, so the package stays
// independently buildable/publishable with zero runtime dependency (the types erase
// at compile time, and rollup-plugin-dts inlines them into the bundled .d.ts).
//
// Usage:
//   node scripts/sync-protocol-types.mjs          # write/refresh all copies
//   node scripts/sync-protocol-types.mjs --check   # CI: fail if any copy is stale/missing
//
// signals is intentionally excluded: it maintains its own structural-subset
// WcBindableDescriptor (design decision G2, guarded by bindNode.compat.test.ts).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const canonicalPath = join(repoRoot, "protocol", "wc-bindable.ts");
const canonicalReaderPath = join(repoRoot, "protocol", "wc-bindable-reader.ts");

// Packages that declare the strict wc-bindable manifest contract and must stay in sync.
const TARGET_PACKAGES = [
  // 34 async-IO node packages
  "broadcast", "camera", "clipboard", "debounce", "defined", "fetch",
  "geolocation", "intersection", "network", "notification", "permission", "resize",
  "speech", "sse", "storage", "timer", "upload", "wakelock", "websocket", "worker",
  // batch 1 (target-resolution) / batch 4 (minimal monitor)
  "screen-orientation", "fullscreen", "picture-in-picture", "pointer-lock",
  // batch 3 (thin one-shot command)
  "share", "eyedropper", "contacts", "credential",
  // batch 2 (gesture-gated permission)
  "idle", "tilt",
  // batch 5 (Generic Sensor family)
  "accelerometer", "gyroscope", "magnetometer", "ambient-light-sensor",
  // flagship packages that also expose the protocol
  "router", "server",
  // reactive engine / consumer
  "state",
];

const READER_TARGET_PACKAGES = ["state"];

const banner = (sourceName) =>
  "// ===========================================================================\n" +
  "// AUTO-GENERATED FILE - DO NOT EDIT.\n" +
  `// Generated from /protocol/${sourceName} by scripts/sync-protocol-types.mjs.\n` +
  "// Run `node scripts/sync-protocol-types.mjs` after editing the source.\n" +
  "// ===========================================================================\n\n";

// CRLF/LF mixed checkouts (e.g. core.autocrlf=true) are tolerated for comparison;
// writes are always LF.
const normalize = (s) => s.replace(/\r\n/g, "\n");

function expectedContent(sourcePath, sourceName) {
  return banner(sourceName) + normalize(readFileSync(sourcePath, "utf8"));
}

function destFor(pkg, fileName) {
  return join(repoRoot, "packages", pkg, "src", "protocol", fileName);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const typeContent = expectedContent(canonicalPath, "wc-bindable.ts");
  const readerContent = expectedContent(canonicalReaderPath, "wc-bindable-reader.ts")
    .replace('from "./wc-bindable.js"', 'from "./wcBindable.js"');
  const targets = [
    ...TARGET_PACKAGES.map((pkg) => ({ pkg, fileName: "wcBindable.ts", content: typeContent })),
    ...READER_TARGET_PACKAGES.map((pkg) => ({ pkg, fileName: "wcBindableReader.ts", content: readerContent })),
  ];
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
    console.log(`  synced  packages/${pkg}/src/protocol/${fileName}`);
  }

  if (checkOnly) {
    if (stale.length > 0) {
      console.error(
        `wc-bindable protocol types are out of date in: ${stale.join(", ")}\n` +
        "Run `node scripts/sync-protocol-types.mjs` and commit the result.",
      );
      process.exit(1);
    }
    console.log(`wc-bindable protocol sources are in sync (${targets.length} generated files).`);
    return;
  }

  console.log(`Done. ${targets.length} generated files checked.`);
}

main();
