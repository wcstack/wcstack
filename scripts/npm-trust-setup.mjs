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
//   node scripts/npm-trust-setup.mjs --verify  # report how each was actually published
//
// Both modes take optional package names to narrow the sweep; a pass that could
// not verify everything prints the exact command to resume on the remainder.
//
// Requires npm >= 11.5.1 — `npm trust` does not exist in npm 10, which is what
// Node 22 bundles. --check is read-only, and --run registers only what is still
// missing, so an interrupted run is resumed by re-running it.
//
// The OTP session npm opens is short, and every package costs one round trip,
// so CLI startup is not free at this list length: `npx npm@11` adds ~0.9s per
// call against ~0.2s for an installed copy. Worth doing once:
//   npm install npm@11 --prefix .npm-tools --no-save
//   WCS_NPM="node .npm-tools/node_modules/npm/bin/npm-cli.js" \
//     node scripts/npm-trust-setup.mjs --check
//
// A package that has never been published cannot be registered; it is reported
// separately and skipped until its first release goes out.

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
const verify = process.argv.includes("--verify");

// Optional package names narrow the sweep. `npm trust` reads and writes both
// need a live OTP session, and one window does not cover 45 packages — so a
// pass that ends with packages unverified prints the command to resume on just
// those, after another `npm login`. Stateless on purpose: caching "this one is
// configured" across runs would let a revoked publisher read as verified, and
// this report is the gate for dropping NODE_AUTH_TOKEN.
const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--")));

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
const LOCAL_NPM = WIN ? "npm.cmd" : "npm";
const CLI = (process.env.WCS_NPM ?? LOCAL_NPM).split(" ");

function spawnNpm(cli, args, opts = {}) {
  return spawnSync(cli[0], [...cli.slice(1), ...args], {
    encoding: "utf8",
    shell: WIN,
    ...opts,
  });
}

// `npm trust` — needs the overridable, version-gated CLI.
const npm = (args, opts) => spawnNpm(CLI, args, opts);
// Reads that any npm can do. Kept on the local binary so a `npx npm@11`
// override does not pay npx startup twice per package.
const localNpm = (args, opts) => spawnNpm([LOCAL_NPM], args, opts);

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

const allTargets = publishTargets();
const unknownNames = [...only].filter((n) => !allTargets.includes(n));
if (unknownNames.length) {
  console.error(`not a publish target: ${unknownNames.join(", ")}`);
  process.exit(1);
}
const targets = only.size ? allTargets.filter((n) => only.has(n)) : allTargets;

// How the latest published version was actually authenticated, read from the
// registry's publisher record. An OIDC publish is attributed to GitHub Actions
// and carries a trustedPublisher block; a token publish is attributed to the
// account that owns the token. This is the outcome, not the configuration —
// stronger evidence than "a trusted publisher is registered" — and `npm view`
// is unauthenticated, so it costs no OTP window.
if (verify) {
  const oidc = [];
  const token = [];
  const unknown = [];
  for (const name of targets) {
    const { status, stdout } = localNpm(["view", name, "_npmUser", "--json"]);
    const raw = (stdout ?? "").replace(/^﻿/, "").trim();
    let user;
    try {
      user = status === 0 && raw ? JSON.parse(raw) : null;
    } catch {
      user = null;
    }
    if (user && typeof user === "object" && user.trustedPublisher) oidc.push(name);
    else if (user) token.push([name, typeof user === "string" ? user : (user.name ?? "?")]);
    else unknown.push(name);
  }
  for (const name of oidc) console.log(`oidc         ${name}`);
  for (const [name, who] of token) console.log(`TOKEN        ${name} (published by ${who})`);
  for (const name of unknown) console.log(`UNKNOWN      ${name}`);
  console.log(
    `\n${oidc.length}/${targets.length} published via trusted publishing` +
      (token.length ? `, ${token.length} via token` : "") +
      (unknown.length ? `, ${unknown.length} unreadable` : ""),
  );
  process.exit(oidc.length === targets.length ? 0 : 1);
}

// Trusted publishing can only be configured for a package that already exists
// on the registry, so a package awaiting its first release is not a failure —
// it is simply not registrable yet, and saying so is the whole point of
// separating this from a real error. `npm view` is an unauthenticated read, so
// this classification holds even before `npm login`.
const isPublished = (name) => localNpm(["view", name, "version"]).status === 0;

// "configured" | "unregistered" | "unpublished" | "unknown" for one package.
//
// `npm trust list` is an authenticated read against a privileged endpoint, and
// it fails in ways that have nothing to do with whether a trust config exists:
// no login (E401), and — the one that actually bit — an expired OTP session
// (EOTP), which starts returning errors part-way through a 45-package sweep.
// A failed read must never be reported as "unregistered": acting on that report
// means re-registering packages that are already configured, which the registry
// rejects with a 409. So "unregistered" is only ever concluded from a
// successful read that came back without a publisher block.
// name → npm's error output, for every package whose trust config could not be
// read. Reported rather than summarised away: the distinction between "your
// session expired" and "this package does not exist" decides what to do next.
const unreadable = new Map();

// npm asks for the one-time password by opening a browser flow, and it only
// offers that flow when it is attached to a terminal. Reads here run with piped
// stdio so their output can be classified, which makes them non-interactive:
// they fail with EOTP instead of prompting. So the first EOTP hands one call
// back to the terminal, the user completes the OTP there, and the short session
// that opens covers the rest of the sweep.
let primed = false;
function primeSession(name) {
  if (primed) return false;
  primed = true;
  console.error(
    "\nnpm needs a one-time password for trust operations and can only ask for it\n" +
      "on a terminal. Complete it once below; the session it opens covers the rest\n" +
      "of this run.\n",
  );
  return npm(["trust", "list", name], { stdio: "inherit" }).status === 0;
}

function readTrust(name) {
  const { status, stdout, stderr } = npm(["trust", "list", name]);
  return { status, output: `${stdout ?? ""}${stderr ?? ""}` };
}

function classify(name) {
  if (!isPublished(name)) return "unpublished";
  let { status, output } = readTrust(name);
  if (status !== 0 && /EOTP/i.test(output) && primeSession(name)) {
    ({ status, output } = readTrust(name));
  }
  if (status !== 0) {
    unreadable.set(name, output.trim());
    return "unknown";
  }
  return /type:\s*github/i.test(output) ? "configured" : "unregistered";
}

function reportUnreadable() {
  if (unreadable.size === 0) return;
  console.error(`\n${unreadable.size} package(s) could not be read:`);
  for (const [name, error] of unreadable) {
    const line = error.split("\n").find((l) => /npm error/i.test(l)) ?? error.split("\n")[0] ?? "";
    console.error(`  ${name}: ${line.trim()}`);
  }
  if ([...unreadable.values()].some((e) => /EOTP/i.test(e))) {
    console.error(
      "\nThe one-time password could not be completed. npm opens it as a browser\n" +
        "flow and only offers it on a terminal, so run this directly in a shell —\n" +
        "not through a wrapper that captures output. Then resume on just these:",
    );
  } else if ([...unreadable.values()].some((e) => /E401|ENEEDAUTH/i.test(e))) {
    console.error("\nNot logged in — run `npm login`, then resume on just these:");
  } else {
    console.error("\nResume on just these:");
  }
  const mode = run ? "--run" : "--check";
  console.error(`\n  node scripts/npm-trust-setup.mjs ${mode} ${[...unreadable.keys()].join(" ")}\n`);
}

if (check) {
  requireNpm11();
  const by = { configured: [], unregistered: [], unpublished: [], unknown: [] };
  for (const name of targets) by[classify(name)].push(name);
  for (const name of by.configured) console.log(`ok           ${name}`);
  for (const name of by.unregistered) console.log(`UNREGISTERED ${name}`);
  for (const name of by.unpublished) console.log(`UNPUBLISHED  ${name}`);
  for (const name of by.unknown) console.log(`UNKNOWN      ${name}`);
  console.log(
    `\n${by.configured.length}/${targets.length} configured` +
      (by.unregistered.length ? `, ${by.unregistered.length} unregistered` : "") +
      (by.unpublished.length ? `, ${by.unpublished.length} awaiting a first release` : "") +
      (by.unknown.length ? `, ${by.unknown.length} unreadable` : ""),
  );
  reportUnreadable();
  // Non-zero unless every target is known-configured, so this doubles as the
  // go/no-go gate for dropping NODE_AUTH_TOKEN from release.yml. An unreadable
  // package holds the gate shut — it is not evidence of anything.
  process.exit(targets.length === by.configured.length ? 0 : 1);
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

// Classify first, then register only what needs it. Registration prompts for a
// 2FA OTP per package and an OTP is valid for ~30s, so a run over 45 packages
// is expected to be interrupted part-way — re-running must not walk the whole
// list again asking for an OTP on packages that are already done. Packages
// awaiting a first release are skipped rather than attempted: the registration
// would come back as a bare E404, which reads like a broken script instead of
// "this package has not been released yet".
const pending = [];
const unpublished = [];
let alreadyConfigured = 0;
for (const name of targets) {
  const state = classify(name);
  if (state === "configured") alreadyConfigured += 1;
  else if (state === "unpublished") unpublished.push(name);
  else if (state === "unregistered") pending.push(name);
  // "unknown" is deliberately not registered: a package whose config could not
  // be read may already be configured, and re-registering it is the 409.
}
console.log(
  `${alreadyConfigured}/${targets.length} already configured` +
    (pending.length ? ` — registering ${pending.length}` : "") +
    (unpublished.length ? `, skipping ${unpublished.length} awaiting a first release` : "") +
    (unreadable.size ? `, skipping ${unreadable.size} unreadable` : ""),
);

let failed = 0;
for (const name of pending) {
  console.log(`\n=== ${name}`);
  // stdio inherited so the 2FA OTP prompt reaches the terminal.
  const { status } = npm(argsFor(name), { stdio: "inherit" });
  if (status !== 0) {
    failed += 1;
    console.error(`failed: ${name}`);
  }
}
if (unpublished.length) {
  console.error(
    `\n${unpublished.length} package(s) awaiting a first release — publish, then re-run:\n` +
      unpublished.map((n) => `  ${n}`).join("\n"),
  );
}
reportUnreadable();
if (failed) {
  console.error(`\n${failed}/${pending.length} registration(s) failed — re-run to retry the rest`);
}
const done = alreadyConfigured + pending.length - failed;
console.log(`\n${done}/${targets.length} packages known registered.`);
// Non-zero while anything is unregistered or unverified, so this agrees with
// the --check gate instead of reporting a clean run that leaves packages on
// tokens.
process.exit(done === targets.length ? 0 : 1);
