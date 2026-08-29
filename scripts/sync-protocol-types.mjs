#!/usr/bin/env node
// Propagates the single-source wc-bindable protocol sources from /protocol
// into consuming packages as generated, do-not-edit copies:
//   packages/<pkg>/src/protocol/wcBindable.ts
//   packages/state/src/protocol/wcBindableReader.ts
//   packages/<pkg>/src/protocol/transitionRunner.ts
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

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const canonicalPath = join(repoRoot, "protocol", "wc-bindable.ts");
const canonicalReaderPath = join(repoRoot, "protocol", "wc-bindable-reader.ts");
const canonicalUpgradePath = join(repoRoot, "protocol", "upgrade-properties.ts");
const canonicalUpgradeTestPath = join(repoRoot, "protocol", "upgrade-properties.test.ts");
const canonicalTransitionRunnerPath = join(repoRoot, "protocol", "transition-runner.ts");
const canonicalBinderPath = join(repoRoot, "protocol", "binder.ts");
const canonicalSsrSnapshotPath = join(repoRoot, "protocol", "ssr-snapshot.ts");

// Packages that declare the strict wc-bindable manifest contract and must stay in sync.
const TARGET_PACKAGES = [
  // 34 async-IO node packages
  "audio", "broadcast", "camera", "clipboard", "debounce", "defined", "fetch",
  "geolocation", "intersection", "midi", "network", "notification", "permission", "resize",
  "speech", "sse", "storage", "timer", "upload", "wakelock", "websocket", "worker",
  // batch 1 (target-resolution) / batch 4 (minimal monitor)
  "screen-orientation", "fullscreen", "picture-in-picture", "pointer-lock",
  // batch 3 (thin one-shot command)
  "share", "eyedropper", "contacts", "credential",
  // batch 2 (gesture-gated permission)
  "idle", "tilt",
  // batch 5 (Generic Sensor family)
  "accelerometer", "gyroscope", "magnetometer", "ambient-light-sensor",
  // frame-source primitive
  "raf",
  // flagship packages that also expose the protocol
  "router", "server",
  // view-transition policy node (docs/view-transition-design.md)
  "view-transition",
  // reactive engine / consumer
  "state",
];

const READER_TARGET_PACKAGES = ["state"];

// transition-runner protocol (docs/view-transition-design.md §4): the two packages
// that mutate the DOM on the page's behalf, plus the arbiter that installs itself.
const TRANSITION_RUNNER_TARGET_PACKAGES = ["router", "state", "view-transition"];

// binder protocol (docs/binder-protocol-design.md): the package that inserts DOM on
// the page's behalf, plus the one that owns bindings and installs itself.
const BINDER_TARGET_PACKAGES = ["router", "state"];

// ssr-snapshot protocol (docs/ssr-router-design.md §5): the SSR renderer that
// orchestrates the final snapshot pass, plus the state owner that provides it.
const SSR_SNAPSHOT_TARGET_PACKAGES = ["server", "state"];

// custom element の Shell を持つパッケージ（= connectedCallback で property upgrade が要る）。
// state / server は Shell が wcBindable.inputs を宣言しないため対象外。
const UPGRADE_TARGET_PACKAGES = TARGET_PACKAGES.filter((pkg) => pkg !== "state" && pkg !== "server");

// --- Completeness guards ---------------------------------------------------
// Two failure modes the stale-compare below cannot see:
//   (1) a new canonical file lands in /protocol/ without being registered here
//       — it would silently never be distributed;
//   (2) a copy carrying this script's banner exists outside the registered
//       targets (hand-copied into a new package, or left behind after
//       de-registration) — it would silently drift from its canonical.
// Both fail in write mode too: a sync run must never "succeed" while either
// class of drift exists.

const CANONICAL_SOURCES = new Set([
  "wc-bindable.ts",
  "wc-bindable-reader.ts",
  "upgrade-properties.ts",
  "upgrade-properties.test.ts",
  "transition-runner.ts",
  "binder.ts",
  "ssr-snapshot.ts",
]);

function assertCanonicalDirComplete() {
  const unregistered = readdirSync(join(repoRoot, "protocol"), { withFileTypes: true })
    .filter((e) => e.isFile() && !CANONICAL_SOURCES.has(e.name))
    .map((e) => e.name);
  if (unregistered.length === 0) return;
  console.error(
    `Unregistered file(s) in /protocol/: ${unregistered.join(", ")}\n` +
    "Every file in the canonical dir must be copy-distributed by this script.\n" +
    "Register each one in scripts/sync-protocol-types.mjs (a canonical*Path constant,\n" +
    "CANONICAL_SOURCES, a *_TARGET_PACKAGES list and a targets entry in main()),\n" +
    "or move it out of /protocol/.",
  );
  process.exit(1);
}

// The banner names its canonical source, so a copy is identified by matching the
// full banner line — loose mentions of the script name in comments do not match.
const BANNER_PATTERN = /Generated from \/protocol\/\S+ by scripts\/sync-protocol-types\.mjs/;
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
    "Add the package to the matching *_TARGET_PACKAGES list in scripts/sync-protocol-types.mjs,\n" +
    "or delete the copy.",
  );
  process.exit(1);
}

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

function destFor(pkg, fileName, dir = ["src", "protocol"]) {
  return join(repoRoot, "packages", pkg, ...dir, fileName);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const typeContent = expectedContent(canonicalPath, "wc-bindable.ts");
  const readerContent = expectedContent(canonicalReaderPath, "wc-bindable-reader.ts")
    .replace('from "./wc-bindable.js"', 'from "./wcBindable.js"');
  const upgradeContent = expectedContent(canonicalUpgradePath, "upgrade-properties.ts")
    .replace('from "./wc-bindable.js"', 'from "./wcBindable.js"');
  const upgradeTestContent = expectedContent(canonicalUpgradeTestPath, "upgrade-properties.test.ts")
    .replace('from "./upgrade-properties.js"', 'from "../src/protocol/upgradeProperties.js"');
  const transitionRunnerContent = expectedContent(canonicalTransitionRunnerPath, "transition-runner.ts");
  const binderContent = expectedContent(canonicalBinderPath, "binder.ts");
  const ssrSnapshotContent = expectedContent(canonicalSsrSnapshotPath, "ssr-snapshot.ts");
  const targets = [
    ...TARGET_PACKAGES.map((pkg) => ({ pkg, fileName: "wcBindable.ts", content: typeContent })),
    ...READER_TARGET_PACKAGES.map((pkg) => ({ pkg, fileName: "wcBindableReader.ts", content: readerContent })),
    ...UPGRADE_TARGET_PACKAGES.map((pkg) => ({ pkg, fileName: "upgradeProperties.ts", content: upgradeContent })),
    ...UPGRADE_TARGET_PACKAGES.map((pkg) => ({
      pkg,
      fileName: "protocol.upgradeProperties.test.ts",
      content: upgradeTestContent,
      dir: ["__tests__"],
    })),
    ...TRANSITION_RUNNER_TARGET_PACKAGES.map((pkg) => ({
      pkg,
      fileName: "transitionRunner.ts",
      content: transitionRunnerContent,
    })),
    ...BINDER_TARGET_PACKAGES.map((pkg) => ({
      pkg,
      fileName: "binder.ts",
      content: binderContent,
    })),
    ...SSR_SNAPSHOT_TARGET_PACKAGES.map((pkg) => ({
      pkg,
      fileName: "ssrSnapshot.ts",
      content: ssrSnapshotContent,
    })),
  ];

  assertCanonicalDirComplete();
  assertNoOrphanCopies(new Set(targets.map(({ pkg, fileName, dir }) => destFor(pkg, fileName, dir))));

  const stale = [];

  for (const { pkg, fileName, content, dir } of targets) {
    const dest = destFor(pkg, fileName, dir);
    const current = existsSync(dest) ? normalize(readFileSync(dest, "utf8")) : null;
    if (current === content) continue;

    if (checkOnly) {
      stale.push(`${pkg}/${fileName}`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    console.log(`  synced  ${dest.slice(repoRoot.length + 1).split(sep).join("/")}`);
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
