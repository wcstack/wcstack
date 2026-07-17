// wcstack wc-bindable settable-surface conformance check.
//
// Invariant (state README "Binding Authority (#init= / #sync=)"): a wcBindable
// member that is settable — the class prototype chain defines a setter for it —
// MUST also be declared in `inputs`. A settable member declared only in
// `properties` is classified output-only under directional initial sync
// (default on since v1.21.0): state→element writes are permanently suppressed
// and the element's initial value overwrites the state seed. This exact drift
// shipped twice — router navigateUrl (fixed in v1.21.0) and DCC $bindables
// (createWcBindable, fixed post-v1.21.0).
//
// Unlike conformance-io-nodes.mjs (a regex source lint), this check IMPORTS
// each package's built bundle and inspects the *evaluated* declaration, so
// dynamically generated wcBindable surfaces are covered too — the reason the
// DCC drift escaped every grep-based sweep.
//
// It reads committed dist/ bundles. In CI it gates the checked-in artifacts;
// release.yml runs it again after the version-bump rebuild so freshly built
// bundles are re-gated right before npm publish.
//
// Known limitations:
// - Members implemented as instance data fields (no prototype accessor) are
//   invisible without instantiation; classes are never instantiated here.
//   Shell/Core members are prototype accessors by convention.
// - Only classes reachable from dist exports are covered. Declaration factories
//   that never surface a class through exports — DCC's createWcBindable in
//   @wcstack/state — are locked by that package's own unit tests instead
//   (dcc.wcBindable.test.ts: properties/inputs member sets must match).
// - A bundle that imports an external bare specifier (server externalizes
//   happy-dom) cannot be evaluated when node_modules is absent — the CI job
//   installs nothing. Such packages are reported as SKIPPED (external deps),
//   not failed; the release.yml re-run happens after per-package npm ci, where
//   they resolve and get fully checked. Any other import error stays fatal.
//
// Run:  node scripts/conformance-bindable-inputs.mjs
// Exit 1 on any non-allowlisted violation.

import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKGDIR = join(ROOT, "packages");

// Documented deviations: members that keep a setter but are deliberately
// output-only. Key: "<pkg>:<ClassName>.<member>". Every entry needs a reason
// traceable to a design doc or inline comment.
const OUTPUT_ONLY_WITH_SETTER = {
  // The setter is applyRoute's internal write path (stores + dispatches the
  // change event, never navigates); programmatic navigation goes through
  // navigateUrl. Deliberately output-only
  // (docs/architecture-hardening/10-defaulting-rollout-status.md §D).
  "router:Router.path": "setter is applyRoute's internal write path and never navigates; navigation goes through navigateUrl",
  // Core-level omission is deliberate: persistence happens only via save() /
  // remove(), and the Shell (manual mode) is the surface that stages a value
  // handed in via a `value` binding — the Shell declares `value` in inputs
  // (comment above StorageCore._setValue).
  "storage:StorageCore.value": "staging surface is the Shell, which declares value in inputs; Core setter is Shell plumbing",
};

// ---- minimal DOM shim (import-time only; classes are never instantiated) ----
class HTMLElementShim {}
if (typeof globalThis.HTMLElement === "undefined") globalThis.HTMLElement = HTMLElementShim;
if (typeof globalThis.customElements === "undefined") {
  globalThis.customElements = {
    define() {},
    get() { return undefined; },
    whenDefined() { return new Promise(() => {}); },
  };
}

function isBindableClass(value) {
  return typeof value === "function"
    && typeof value.wcBindable === "object"
    && value.wcBindable !== null
    && value.wcBindable.protocol === "wc-bindable";
}

// Nearest descriptor wins: a getter-only accessor on a nearer prototype shadows
// any setter further up the chain, so assignment through it fails anyway.
function nearestDescriptor(cls, name) {
  let proto = cls.prototype;
  while (
    proto
    && proto !== Object.prototype
    && proto !== EventTarget.prototype
    && proto !== globalThis.HTMLElement.prototype
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (descriptor) return descriptor;
    proto = Object.getPrototypeOf(proto);
  }
  return null;
}

// ---- run ----
const packages = readdirSync(PKGDIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(PKGDIR, name, "dist", "index.esm.js")));

// A missing *external* dependency (bare specifier, e.g. server's happy-dom) is
// an environment gap, not a conformance finding: skip with a note so the
// no-install CI job stays green, and rely on the release.yml re-run (after
// npm ci) for full coverage. Unresolvable relative/internal specifiers mean a
// broken bundle and stay fatal.
function externalMissingDependency(error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") return null;
  const match = /Cannot find package '([^']+)'/.exec(String(error.message));
  if (!match) return null;
  const specifier = match[1];
  const bare = !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("file:");
  return bare ? specifier : null;
}

let classesChecked = 0;
let membersChecked = 0;
const violations = [];
const deviations = [];
const importFailures = [];
const externalSkips = [];
const rows = [];

for (const pkg of packages) {
  const bundle = join(PKGDIR, pkg, "dist", "index.esm.js");
  let moduleExports;
  try {
    moduleExports = await import(pathToFileURL(bundle).href);
  } catch (error) {
    const missing = externalMissingDependency(error);
    if (missing) {
      externalSkips.push({ pkg, missing });
      rows.push({ pkg, classes: 0, flagged: [`◌ skipped (external dep: ${missing})`] });
    } else {
      importFailures.push({ pkg, message: String(error?.message ?? error) });
    }
    continue;
  }

  const classes = new Set(Object.values(moduleExports).filter(isBindableClass));
  const flagged = [];
  for (const cls of classes) {
    classesChecked++;
    const declaration = cls.wcBindable;
    const inputNames = new Set((declaration.inputs ?? []).map((input) => input.name));
    for (const property of declaration.properties ?? []) {
      const name = property.name;
      membersChecked++;
      if (inputNames.has(name)) continue;
      const descriptor = nearestDescriptor(cls, name);
      if (!descriptor || typeof descriptor.set !== "function") continue;
      const key = `${pkg}:${cls.name}.${name}`;
      const reason = OUTPUT_ONLY_WITH_SETTER[key];
      if (reason) {
        deviations.push({ key, reason });
        flagged.push(`◇ ${cls.name}.${name}`);
      } else {
        violations.push({ key, pkg, cls: cls.name, name });
        flagged.push(`✗ ${cls.name}.${name}`);
      }
    }
  }
  rows.push({ pkg, classes: classes.size, flagged });
}

// ---- print ----
console.log("\n=== wc-bindable settable-surface conformance (settable ⇒ declared in inputs) ===");
console.log("(runtime check over dist bundles · ✗ violation · ◇ documented output-only deviation · ◌ skipped, external dep absent)\n");
for (const row of rows) {
  const detail = row.flagged.length ? `  ${row.flagged.join("  ")}` : "";
  console.log(`${row.pkg.padEnd(22)} ${String(row.classes).padStart(2)} bindable class(es)${detail}`);
}

if (externalSkips.length) {
  console.log("\n--- Skipped: external dependency not installed (checked in release.yml after npm ci) ---");
  for (const skip of externalSkips) console.log(`  ◌ ${skip.pkg}: requires '${skip.missing}'`);
}

if (importFailures.length) {
  console.log("\n--- Import failures (bundle could not be evaluated — fix the shim or the bundle) ---");
  for (const failure of importFailures) console.log(`  ✗ ${failure.pkg}: ${failure.message}`);
}

if (violations.length) {
  console.log("\n--- Violations ---");
  for (const violation of violations) {
    console.log(`  ✗ ${violation.key} — settable (prototype setter) but declared only in properties;`);
    console.log(`     state→element writes are permanently suppressed under directional initial sync.`);
    console.log(`     Fix: declare { name: "${violation.name}" } in inputs, or allowlist with a documented reason.`);
  }
}

if (deviations.length) {
  console.log("\n--- Documented deviations (◇) ---");
  for (const deviation of deviations) console.log(`  ◇ ${deviation.key} — ${deviation.reason}`);
}

console.log("\n" + "-".repeat(72));
console.log(`Packages: ${packages.length}  |  Classes: ${classesChecked}  |  properties-only members checked: ${membersChecked}  |  violations: ${violations.length}  |  deviations: ${deviations.length}  |  external skips: ${externalSkips.length}  |  import failures: ${importFailures.length}`);
if (violations.length > 0 || importFailures.length > 0) process.exitCode = 1;
