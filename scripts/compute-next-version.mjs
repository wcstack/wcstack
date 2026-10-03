#!/usr/bin/env node
// Plans a release: computes the unified target version from the packages'
// current versions and the requested bump, and refuses the combinations that
// would publish the wrong thing (release.yml's "Plan the release" step).
//
// Usage:
//   node scripts/compute-next-version.mjs --bump <type> --branch <name> \
//     [--ref-type branch] [--state-manifest packages/state/dist/wcs-manifest.json] \
//     [--tags <file, one tag per line; default: git tag --list "v*">] \
//     <current-version>...
//
// Bump types:
//   patch / minor / major   X.Y.Z → the next stable version (refused on a prerelease)
//   premajor-rc             X.Y.Z → (X+1).0.0-rc.1
//   prerelease-rc           X.Y.Z-rc.N → X.Y.Z-rc.(N+1)
//   release                 X.Y.Z-rc.N → X.Y.Z (the final release of an rc line)
//
// Guards (each one an `::error::` line on stderr and exit 1):
//   - the ref is a branch;
//   - (a) packages/state is the 4.0 engine (`behaviorOptions` in its
//     dist/wcs-manifest.json) and the target's major is below 4 — and, the
//     other way round, the 3.x engine with a target of 4 or more;
//   - a new major reaches npm `latest` only through `release`, at the end of an
//     rc series (so `major` never succeeds: start the series with premajor-rc);
//   - (b) a final (stable) release runs from main only — it goes to npm's
//     `latest` dist-tag and its commit is pushed to the branch the run is on;
//   - (c) a prerelease runs only from research/state-engine or a release/*
//     branch — never from main, which carries stable versions only, so its next
//     patch is computed from a stable version and an rc of main's code is never
//     published;
//   - no prerelease-rc once v<X.Y.Z> is tagged (no rc after the final release);
//   - no target that is tagged already.
//
// Prints GitHub step output lines on stdout:
//   current=<highest current version>
//   version=<target version>
//   prerelease=true|false
//   dist_tag=next|latest
//   previous_tag=<the tag the release notes start from, or empty>
//
// The functions are exported for scripts/compute-next-version.test.mjs and for
// scripts/align-internal-dep-ranges.mjs (internalRange).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const BUMPS = Object.freeze(["patch", "minor", "major", "premajor-rc", "prerelease-rc", "release"]);
export const MAIN = "main";
/** Where a prerelease may run: an exact branch name, or a prefix ending in "/". */
export const PRERELEASE_BRANCHES = Object.freeze(["research/state-engine", "release/"]);

// X.Y.Z with an optional prerelease (semver §9); no build metadata — npm
// ignores it for precedence, and this repository never publishes it.
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

export function parseVersion(version) {
  const m = VERSION_RE.exec(String(version));
  if (m === null) throw new Error(`not a version: "${version}"`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] === undefined ? [] : m[4].split("."),
  };
}

export function isPrerelease(version) {
  return parseVersion(version).prerelease.length > 0;
}

const isNumeric = (id) => /^\d+$/.test(id);

/** Semver precedence: < 0 when a is lower, 0 when equal, > 0 when higher. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (const k of ["major", "minor", "patch"]) {
    if (x[k] !== y[k]) return x[k] - y[k];
  }
  // a version without a prerelease ranks above the same X.Y.Z with one
  if (x.prerelease.length === 0 || y.prerelease.length === 0) {
    return y.prerelease.length - x.prerelease.length;
  }
  for (let i = 0; i < Math.max(x.prerelease.length, y.prerelease.length); i++) {
    const p = x.prerelease[i];
    const q = y.prerelease[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (isNumeric(p) && isNumeric(q)) return Number(p) - Number(q);
    if (isNumeric(p)) return -1;
    if (isNumeric(q)) return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export function maxVersion(versions) {
  if (versions.length === 0) throw new Error("no current versions given");
  return versions.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max));
}

/** The N of an `X.Y.Z-rc.N` version, or null. */
function rcNumber(prerelease) {
  return prerelease.length === 2 && prerelease[0] === "rc" && isNumeric(prerelease[1]) ? Number(prerelease[1]) : null;
}

/** The target version for one bump. Throws on a combination that has no clear answer. */
export function nextVersion(current, bump) {
  const { major, minor, patch, prerelease } = parseVersion(current);
  const base = `${major}.${minor}.${patch}`;
  const rc = rcNumber(prerelease);
  switch (bump) {
    case "patch":
    case "minor":
    case "major":
      if (prerelease.length > 0) {
        throw new Error(
          `the current version ${current} is a prerelease: choose "release" for ${base}` +
            (rc === null ? "" : ` or "prerelease-rc" for ${base}-rc.${rc + 1}`) +
            ` instead of "${bump}"`,
        );
      }
      if (bump === "major") return `${major + 1}.0.0`;
      if (bump === "minor") return `${major}.${minor + 1}.0`;
      return `${major}.${minor}.${patch + 1}`;
    case "premajor-rc":
      if (prerelease.length > 0) {
        throw new Error(
          `the current version ${current} is already a prerelease: choose "prerelease-rc" for the next rc or "release" for ${base}`,
        );
      }
      return `${major + 1}.0.0-rc.1`;
    case "prerelease-rc":
      if (prerelease.length === 0) {
        throw new Error(`the current version ${current} is not a prerelease: start an rc line with "premajor-rc"`);
      }
      if (rc === null) {
        throw new Error(`the current version ${current} is not an rc (X.Y.Z-rc.N): only rc prereleases are supported`);
      }
      return `${base}-rc.${rc + 1}`;
    case "release":
      if (prerelease.length === 0) {
        throw new Error(`the current version ${current} is not a prerelease: there is no rc to release; choose patch or minor`);
      }
      return base;
    default:
      throw new Error(`unknown bump "${bump}" (expected one of: ${BUMPS.join(", ")})`);
  }
}

/** npm dist-tag: a prerelease goes to `next`, a stable version to `latest`. */
export function distTagFor(version) {
  return isPrerelease(version) ? "next" : "latest";
}

/**
 * The range an internal @wcstack/* dependency gets in a release at `version`.
 *
 * Stable: `^X.Y.Z`. Prerelease: the exact version. `^4.0.0-rc.1` would match
 * every later 4.0.0-rc.N (and 4.x), so @wcstack/server 4.0.0-rc.1 could install
 * with @wcstack/state 4.0.0-rc.3 — a pair no release run tested, while rcs may
 * still break each other (the SSR version gate compares major.minor only, so it
 * cannot tell rcs apart). Each rc is released in lockstep, so `@next` installs a
 * matching set either way; the pin only refuses a mixed one.
 */
export function internalRange(version) {
  return isPrerelease(version) ? version : `^${version}`;
}

/** Whether a state dist/wcs-manifest.json comes from the 4.0 engine. */
export function isEngine4Manifest(manifest) {
  return manifest !== null && typeof manifest === "object" && manifest.behaviorOptions != null;
}

/** Whether a prerelease may run from this branch (PRERELEASE_BRANCHES). */
export function isPrereleaseBranch(branch) {
  return PRERELEASE_BRANCHES.some((b) =>
    b.endsWith("/") ? branch.startsWith(b) && branch.length > b.length : branch === b,
  );
}

const prereleaseBranchesText = () =>
  PRERELEASE_BRANCHES.map((b) => (b.endsWith("/") ? `a ${b}* branch` : b)).join(" or ");

/** The versions the `v<version>` tags name (tags that are not a version are ignored). */
function taggedVersions(tags) {
  const out = [];
  for (const tag of tags) {
    if (!tag.startsWith("v")) continue;
    try {
      parseVersion(tag.slice(1));
      out.push(tag.slice(1));
    } catch {
      // not a release tag
    }
  }
  return out;
}

/** The reasons to refuse this release; empty when it may run. */
export function releaseGuards({ target, current, bump, branch, refType = "branch", engine4, tags = [] }) {
  const errors = [];
  const { major, minor, patch } = parseVersion(target);
  const base = `${major}.${minor}.${patch}`;
  const prerelease = isPrerelease(target);
  if (refType !== "branch") {
    errors.push(`the release runs from a branch, not a ${refType} (${branch})`);
  }
  if (engine4 && major < 4) {
    errors.push(
      `packages/state is the 4.0 engine (behaviorOptions in dist/wcs-manifest.json): ${target} would publish it as ${major}.x — start the 4.0 line with premajor-rc`,
    );
  }
  if (!engine4 && major >= 4) {
    errors.push(`packages/state is the 3.x engine: ${target} would publish the 3.x code as ${major}.x`);
  }
  if (!prerelease && current !== undefined && major > parseVersion(current).major && bump !== "release") {
    errors.push(
      `${target} is a new major on npm "latest": a major gets there only through "release", at the end of an rc series — start the series with premajor-rc on ${prereleaseBranchesText()}`,
    );
  }
  if (!prerelease && branch !== MAIN) {
    errors.push(`a final release (${target}, npm "latest") runs from ${MAIN} only, not from ${branch}`);
  }
  if (prerelease && !isPrereleaseBranch(branch)) {
    errors.push(
      branch === MAIN
        ? `a prerelease (${target}, npm "next") does not run from ${MAIN}: ${MAIN} carries stable versions only — run it from ${prereleaseBranchesText()}`
        : `a prerelease (${target}, npm "next") runs only from ${prereleaseBranchesText()}, not from ${branch}`,
    );
  }
  if (bump === "prerelease-rc" && tags.includes(`v${base}`)) {
    errors.push(`v${base} is already released: there is no rc after the final release (${target})`);
  }
  if (tags.includes(`v${target}`)) {
    errors.push(`v${target} is already tagged: ${target} is out, and the branch's package.json lags its tag — this needs a human`);
  }
  return errors;
}

/**
 * The tag the GitHub Release notes start from. A prerelease: the version it was bumped from
 * (v3.5.4 for 4.0.0-rc.1, rc.N for rc.N+1) when that tag exists. A stable release: the highest
 * stable tag below the target — never an rc, so the final release's notes cover the whole series.
 * Empty when there is none (GitHub then picks the base itself).
 */
export function previousTag({ target, current, tags }) {
  if (isPrerelease(target)) return tags.includes(`v${current}`) ? `v${current}` : "";
  const stable = taggedVersions(tags).filter((v) => !isPrerelease(v) && compareVersions(v, target) < 0);
  return stable.length === 0 ? "" : `v${maxVersion(stable)}`;
}

/** The whole plan; throws an Error whose `reasons` lists every refusal. */
export function planRelease({ bump, versions, branch, refType = "branch", engine4, tags = [] }) {
  const current = maxVersion(versions);
  let version;
  try {
    version = nextVersion(current, bump);
  } catch (error) {
    throw Object.assign(new Error(error.message), { reasons: [error.message] });
  }
  const reasons = releaseGuards({ target: version, current, bump, branch, refType, engine4, tags });
  if (reasons.length > 0) {
    throw Object.assign(new Error(reasons.join("; ")), { reasons });
  }
  return {
    current,
    version,
    prerelease: isPrerelease(version),
    distTag: distTagFor(version),
    previousTag: previousTag({ target: version, current, tags }),
  };
}

const VALUE_OPTIONS = ["--bump", "--branch", "--ref-type", "--state-manifest", "--tags"];

function parseArgs(argv) {
  const options = { versions: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_OPTIONS.includes(a)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} needs a value`);
      options[a.slice(2)] = value;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown option ${a}`);
    } else {
      options.versions.push(a);
    }
  }
  return options;
}

/** The repository's tags: one per line in `--tags <file>`, or `git tag --list "v*"` here. */
function readTags(file) {
  const text =
    file === undefined
      ? execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8", windowsHide: true })
      : readFileSync(file, "utf8");
  return text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
    if (!options.bump || !options.branch || options.versions.length === 0) {
      throw new Error("--bump, --branch and at least one current version are required");
    }
  } catch (error) {
    console.error(`::error::compute-next-version: ${error.message}`);
    console.error(
      "Usage: node scripts/compute-next-version.mjs --bump <type> --branch <name> [--ref-type branch] [--state-manifest <path>] [--tags <file>] <current-version>...",
    );
    return 1;
  }
  const manifestPath = options["state-manifest"] ?? "packages/state/dist/wcs-manifest.json";
  let engine4;
  try {
    engine4 = isEngine4Manifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  } catch (error) {
    console.error(`::error::compute-next-version: cannot read ${manifestPath} (the engine guard needs it): ${error.message}`);
    return 1;
  }
  let tags;
  try {
    tags = readTags(options.tags);
  } catch (error) {
    console.error(`::error::compute-next-version: cannot read the tags (the tag guard needs them): ${error.message}`);
    return 1;
  }
  try {
    const plan = planRelease({
      bump: options.bump,
      versions: options.versions,
      branch: options.branch,
      refType: options["ref-type"] ?? "branch",
      engine4,
      tags,
    });
    console.log(`current=${plan.current}`);
    console.log(`version=${plan.version}`);
    console.log(`prerelease=${plan.prerelease}`);
    console.log(`dist_tag=${plan.distTag}`);
    console.log(`previous_tag=${plan.previousTag}`);
    console.error(
      `Release plan: ${plan.current} → ${plan.version} (${options.bump}) from ${options.branch}, npm dist-tag "${plan.distTag}", ` +
        `notes from ${plan.previousTag || "GitHub's choice"}, state engine ${engine4 ? "4.0" : "3.x"}`,
    );
    return 0;
  } catch (error) {
    for (const reason of error.reasons ?? [error.message]) console.error(`::error::${reason}`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
