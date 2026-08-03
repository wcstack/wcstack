// npm Trusted Publishing (OIDC) registration helper.
//
// Registration cannot live in release.yml: npm accepts a trusted-publisher
// configuration only for a package that already exists on the registry, and
// `npm trust` is an authenticated write that prompts for a 2FA OTP. So it runs
// from a maintainer's machine, once per package — this script enumerates the
// same publish targets release.yml does (packages/*/package.json named
// @wcstack/* plus the unscoped `wcstack` entry package) so a newly added
// package cannot be silently left out.
//
// Run:
//   node scripts/npm-trust-setup.mjs           # print the npm trust commands
//   node scripts/npm-trust-setup.mjs --check   # report which packages are configured
//   node scripts/npm-trust-setup.mjs --run     # execute them (OTP prompts pass through)
//
// Requires npm >= 11.5.1 — `npm trust` does not exist in npm 10, which is what
// Node 22 bundles. Idempotent: re-registering a configured package is a no-op,
// and --check is read-only.
//
// A package that has never been published cannot be registered; publish its
// first version manually, then re-run. --check reports those separately.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKGDIR = join(ROOT, "packages");

// The trust relationship registered on npm: publishes are accepted only from
// this workflow file in this repository. `--file` takes the workflow's bare
// filename, not its .github/workflows path.
const REPO = "wcstack/wcstack";
const WORKFLOW = "release.yml";

const check = process.argv.includes("--check");
const run = process.argv.includes("--run");

// Publish targets, mirroring release.yml's `publish_list`.
function publishTargets() {
  const out = [];
  for (const d of readdirSync(PKGDIR)) {
    const pj = join(PKGDIR, d, "package.json");
    if (!existsSync(pj)) continue;
    let name;
    try {
      name = JSON.parse(readFileSync(pj, "utf8")).name;
    } catch {
      continue;
    }
    if (typeof name !== "string") continue;
    if (name.startsWith("@wcstack/") || name === "wcstack") out.push(name);
  }
  return out.sort();
}

// npm ships as npm.cmd on Windows, and Node refuses to spawn a .cmd without a
// shell (CVE-2024-27980) — without this the call fails silently, reporting an
// empty stdout rather than throwing. All arguments here are literal package
// names, so shell interpolation has nothing to bite on.
const WIN = process.platform === "win32";

// The npm binary to drive. Overridable so a machine on npm 10 can run a newer
// CLI without an in-place global upgrade (which on Windows means writing into
// the Node install directory):
//   WCS_NPM="npx npm@11" node scripts/npm-trust-setup.mjs --run
// Auth is read from the user's ~/.npmrc either way.
const CLI = (process.env.WCS_NPM ?? (WIN ? "npm.cmd" : "npm")).split(" ");

function npm(args, opts = {}) {
  return spawnSync(CLI[0], [...CLI.slice(1), ...args], {
    encoding: "utf8",
    shell: WIN,
    ...opts,
  });
}

function requireNpm11() {
  const { stdout } = npm(["--version"]);
  const version = (stdout ?? "").trim();
  const major = Number.parseInt(version, 10);
  if (!(major >= 11)) {
    console.error(
      `npm ${version || "(unknown)"} does not have \`npm trust\`. Either upgrade:\n` +
        "  npm install -g npm@11\n" +
        "or drive a newer CLI without upgrading:\n" +
        `  WCS_NPM="npx npm@11" node scripts/npm-trust-setup.mjs ${process.argv.slice(2).join(" ")}`,
    );
    process.exit(1);
  }
}

const targets = publishTargets();

if (check) {
  requireNpm11();
  const configured = [];
  const missing = [];
  const unpublished = [];
  for (const name of targets) {
    const { status, stdout, stderr } = npm(["trust", "list", name]);
    const output = `${stdout ?? ""}${stderr ?? ""}`;
    // `npm trust list` is an authenticated read. Without a login every package
    // comes back as an error, which would otherwise be reported as 45
    // unregistered packages — a report that looks like real data.
    if (/E401|ENEEDAUTH|must be logged in/i.test(output)) {
      console.error("not logged in to npm — run `npm login`, then re-run --check");
      process.exit(1);
    }
    if (status !== 0) {
      // A 404 means the package is not on the registry yet, which is a
      // different problem from "published but unregistered" — it needs a manual
      // first publish before it can be registered at all.
      (/E404|not found/i.test(output) ? unpublished : missing).push(name);
    } else if (/github/i.test(output)) {
      configured.push(name);
    } else {
      missing.push(name);
    }
  }
  for (const name of configured) console.log(`ok         ${name}`);
  for (const name of missing) console.log(`UNREGISTERED ${name}`);
  for (const name of unpublished) console.log(`UNPUBLISHED  ${name}`);
  console.log(
    `\n${configured.length}/${targets.length} configured` +
      (missing.length ? `, ${missing.length} unregistered` : "") +
      (unpublished.length ? `, ${unpublished.length} not yet on the registry` : ""),
  );
  // Non-zero while any target is still publishing on a token, so this doubles
  // as the go/no-go gate for dropping NODE_AUTH_TOKEN from release.yml.
  process.exit(missing.length + unpublished.length === 0 ? 0 : 1);
}

const argsFor = (name) => [
  "trust",
  "github",
  name,
  "--repo",
  REPO,
  "--file",
  WORKFLOW,
  "--allow-publish",
];

if (!run) {
  console.log(`# ${targets.length} publish targets — run with --run to execute\n`);
  for (const name of targets) console.log(`npm ${argsFor(name).join(" ")}`);
  process.exit(0);
}

requireNpm11();
let failed = 0;
for (const name of targets) {
  console.log(`\n=== ${name}`);
  // stdio inherited so the 2FA OTP prompt reaches the terminal. Each command is
  // its own registration, so a failure part-way is resumable: re-run and the
  // already-configured packages are no-ops.
  const { status } = npm(argsFor(name), { stdio: "inherit" });
  if (status !== 0) {
    failed += 1;
    console.error(`failed: ${name}`);
  }
}
if (failed) {
  console.error(`\n${failed}/${targets.length} failed — re-run to retry (configured ones are no-ops)`);
  process.exit(1);
}
console.log(`\nAll ${targets.length} packages registered.`);
