// Tests for the release planning (scripts/compute-next-version.mjs) and the
// internal range alignment that uses it (scripts/align-internal-dep-ranges.mjs).
//
// Run: node --test scripts/compute-next-version.test.mjs   (Node >= 22, no install)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUMPS,
  compareVersions,
  distTagFor,
  internalRange,
  isEngine4Manifest,
  maxVersion,
  nextVersion,
  parseVersion,
  planRelease,
  releaseGuards,
} from "./compute-next-version.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "compute-next-version.mjs");
const ALIGN = join(here, "align-internal-dep-ranges.mjs");

describe("parseVersion", () => {
  it("reads a stable version and an rc", () => {
    assert.deepEqual(parseVersion("3.5.4"), { major: 3, minor: 5, patch: 4, prerelease: [] });
    assert.deepEqual(parseVersion("4.0.0-rc.12"), { major: 4, minor: 0, patch: 0, prerelease: ["rc", "12"] });
  });

  it("refuses what is not a version", () => {
    for (const bad of ["", "3.5", "v3.5.4", "3.5.4-", "03.5.4", "3.5.4-rc.01", "3.5.4+build", "undefined"]) {
      assert.throws(() => parseVersion(bad), /not a version/, bad);
    }
  });
});

describe("compareVersions / maxVersion", () => {
  it("orders by semver precedence (a prerelease ranks below its release)", () => {
    const sorted = ["4.0.0", "3.5.4", "4.0.0-rc.10", "4.0.0-rc.2", "1.0.0", "4.0.0-rc.1", "3.10.0"].sort(compareVersions);
    assert.deepEqual(sorted, ["1.0.0", "3.5.4", "3.10.0", "4.0.0-rc.1", "4.0.0-rc.2", "4.0.0-rc.10", "4.0.0"]);
  });

  it("follows semver §11 for prerelease identifiers", () => {
    assert.ok(compareVersions("1.0.0-alpha", "1.0.0-alpha.1") < 0);
    assert.ok(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.beta") < 0);
    assert.ok(compareVersions("1.0.0-beta", "1.0.0-alpha") > 0);
    assert.equal(compareVersions("4.0.0-rc.3", "4.0.0-rc.3"), 0);
  });

  it("takes the highest current version — the rc over a freshly added 1.0.0, 3.10 over 3.9", () => {
    assert.equal(maxVersion(["3.5.4", "1.0.0", "3.5.4"]), "3.5.4");
    assert.equal(maxVersion(["4.0.0-rc.1", "1.0.0", "4.0.0-rc.1"]), "4.0.0-rc.1");
    assert.equal(maxVersion(["3.9.0", "3.10.0"]), "3.10.0");
    assert.throws(() => maxVersion([]), /no current versions/);
  });
});

describe("nextVersion", () => {
  it("stable bumps keep today's arithmetic", () => {
    assert.equal(nextVersion("3.5.4", "patch"), "3.5.5");
    assert.equal(nextVersion("3.5.4", "minor"), "3.6.0");
    assert.equal(nextVersion("3.5.4", "major"), "4.0.0");
    assert.equal(nextVersion("3.9.9", "patch"), "3.9.10");
  });

  it("premajor-rc starts an rc line: 3.5.4 → 4.0.0-rc.1", () => {
    assert.equal(nextVersion("3.5.4", "premajor-rc"), "4.0.0-rc.1");
    assert.equal(nextVersion("4.2.1", "premajor-rc"), "5.0.0-rc.1");
  });

  it("prerelease-rc counts up: 4.0.0-rc.N → 4.0.0-rc.N+1 (numerically, past 9)", () => {
    assert.equal(nextVersion("4.0.0-rc.1", "prerelease-rc"), "4.0.0-rc.2");
    assert.equal(nextVersion("4.0.0-rc.9", "prerelease-rc"), "4.0.0-rc.10");
  });

  it("release ends the rc line: 4.0.0-rc.N → 4.0.0", () => {
    assert.equal(nextVersion("4.0.0-rc.1", "release"), "4.0.0");
    assert.equal(nextVersion("4.0.0-rc.7", "release"), "4.0.0");
  });

  it("refuses patch / minor / major on a prerelease and names the bump to use", () => {
    for (const bump of ["patch", "minor", "major"]) {
      assert.throws(() => nextVersion("4.0.0-rc.2", bump), /prerelease: choose "release" for 4\.0\.0 or "prerelease-rc" for 4\.0\.0-rc\.3/);
    }
  });

  it("refuses the rc bumps where they do not apply", () => {
    assert.throws(() => nextVersion("4.0.0-rc.2", "premajor-rc"), /already a prerelease/);
    assert.throws(() => nextVersion("3.5.4", "prerelease-rc"), /start an rc line with "premajor-rc"/);
    assert.throws(() => nextVersion("4.0.0-beta.1", "prerelease-rc"), /not an rc/);
    assert.throws(() => nextVersion("3.5.4", "release"), /no rc to release/);
    assert.throws(() => nextVersion("3.5.4", "prepatch"), /unknown bump/);
  });

  it("every bump type the workflow offers is handled", () => {
    const yaml = readFileSync(join(here, "..", ".github", "workflows", "release.yml"), "utf8");
    const options = /version_type:[\s\S]*?options:\n((?:\s+- [\w-]+.*\n)+)/.exec(yaml);
    assert.ok(options, "release.yml has version_type options");
    const offered = [...options[1].matchAll(/- ([\w-]+)/g)].map((m) => m[1]);
    assert.deepEqual(offered, [...BUMPS]);
  });
});

describe("distTagFor / internalRange", () => {
  it("a prerelease goes to next, a stable version to latest", () => {
    assert.equal(distTagFor("4.0.0-rc.1"), "next");
    assert.equal(distTagFor("4.0.0"), "latest");
    assert.equal(distTagFor("3.5.5"), "latest");
  });

  it("internal ranges: caret for a stable version, the exact version for an rc", () => {
    assert.equal(internalRange("4.0.0"), "^4.0.0");
    assert.equal(internalRange("4.0.0-rc.1"), "4.0.0-rc.1");
  });
});

describe("releaseGuards", () => {
  const ok = (args) => assert.deepEqual(releaseGuards(args), []);
  const refused = (args, pattern) => {
    const errors = releaseGuards(args);
    assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
  };

  it("lets through the planned runs: rcs from research, 4.0.0 and 3.x patches from main", () => {
    ok({ target: "4.0.0-rc.1", branch: "research/state-engine", engine4: true });
    ok({ target: "4.0.0-rc.2", branch: "release/4.0.0-rc.2", engine4: true });
    ok({ target: "4.0.0", branch: "main", engine4: true });
    ok({ target: "3.5.5", branch: "main", engine4: false });
  });

  it("(a) the 4.0 engine never ships under a major below 4", () => {
    refused({ target: "3.5.5", branch: "main", engine4: true }, /4\.0 engine .* would publish it as 3\.x/);
    refused({ target: "3.6.0", branch: "research/state-engine", engine4: true }, /would publish it as 3\.x/);
  });

  it("(a) the other way round: the 3.x engine never ships as 4.x", () => {
    refused({ target: "4.0.0", branch: "main", engine4: false }, /3\.x engine: 4\.0\.0 would publish the 3\.x code as 4\.x/);
    refused({ target: "4.0.0-rc.1", branch: "fix/x", engine4: false }, /3\.x engine/);
  });

  it("(b) a final release runs from main only — 4.x or not", () => {
    refused({ target: "4.0.0", branch: "research/state-engine", engine4: true }, /final release .* from main only, not from research\/state-engine/);
    refused({ target: "3.5.5", branch: "maint/3.x", engine4: false }, /from main only/);
  });

  it("(c) a prerelease does not run from main", () => {
    refused({ target: "4.0.0-rc.3", branch: "main", engine4: true }, /prerelease .* does not run from main/);
  });

  it("refuses a tag ref", () => {
    refused({ target: "4.0.0-rc.1", branch: "v3.5.4", refType: "tag", engine4: true }, /from a branch, not a tag/);
  });
});

describe("planRelease", () => {
  it("3.5.4 + premajor-rc on research → 4.0.0-rc.1 on next", () => {
    assert.deepEqual(
      planRelease({ bump: "premajor-rc", versions: ["3.5.4", "3.5.4"], branch: "research/state-engine", engine4: true }),
      { current: "3.5.4", version: "4.0.0-rc.1", prerelease: true, distTag: "next" },
    );
  });

  it("4.0.0-rc.3 + release on main → 4.0.0 on latest", () => {
    assert.deepEqual(
      planRelease({ bump: "release", versions: ["4.0.0-rc.3"], branch: "main", engine4: true }),
      { current: "4.0.0-rc.3", version: "4.0.0", prerelease: false, distTag: "latest" },
    );
  });

  it("collects every refusal (the old guard's case: patch with the 4.0 engine on research)", () => {
    assert.throws(
      () => planRelease({ bump: "patch", versions: ["3.5.4"], branch: "research/state-engine", engine4: true }),
      (error) => error.reasons.length === 2 && /3\.x/.test(error.reasons[0]) && /main only/.test(error.reasons[1]),
    );
  });

  it("an impossible bump is a refusal too", () => {
    assert.throws(
      () => planRelease({ bump: "major", versions: ["4.0.0-rc.3"], branch: "main", engine4: true }),
      (error) => error.reasons.length === 1 && /choose "release"/.test(error.reasons[0]),
    );
  });
});

describe("isEngine4Manifest", () => {
  it("reads behaviorOptions as the 4.0 marker", () => {
    assert.equal(isEngine4Manifest({ version: 2, behaviorOptions: { enableMustache: { type: "boolean", default: true } } }), true);
    assert.equal(isEngine4Manifest({ version: 2, syntax: {} }), false);
    assert.equal(isEngine4Manifest(null), false);
  });

  it("the committed 4.0 build of packages/state carries the marker the guard reads", () => {
    const manifest = JSON.parse(readFileSync(join(here, "..", "packages", "state", "dist", "wcs-manifest.json"), "utf8"));
    assert.equal(isEngine4Manifest(manifest), true);
  });
});

describe("CLI", () => {
  const tmp = mkdtempSync(join(tmpdir(), "wcs-next-version-"));
  const engine4 = join(tmp, "engine4.json");
  const engine3 = join(tmp, "engine3.json");
  writeFileSync(engine4, JSON.stringify({ version: 2, behaviorOptions: {} }));
  writeFileSync(engine3, JSON.stringify({ version: 2 }));
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

  it("prints the step outputs for an rc", () => {
    const r = run("--bump", "premajor-rc", "--branch", "research/state-engine", "--state-manifest", engine4, "3.5.4", "1.0.0");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "current=3.5.4\nversion=4.0.0-rc.1\nprerelease=true\ndist_tag=next\n");
    assert.match(r.stderr, /3\.5\.4 → 4\.0\.0-rc\.1 .* "next", state engine 4\.0/);
  });

  it("prints the step outputs for the final release", () => {
    const r = run("--bump", "release", "--branch", "main", "--ref-type", "branch", "--state-manifest", engine4, "4.0.0-rc.2");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "current=4.0.0-rc.2\nversion=4.0.0\nprerelease=false\ndist_tag=latest\n");
  });

  it("exits 1 with ::error:: lines and no outputs when a guard refuses", () => {
    const r = run("--bump", "premajor-rc", "--branch", "main", "--state-manifest", engine3, "3.5.4");
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    const errors = r.stderr.split("\n").filter((l) => l.startsWith("::error::"));
    assert.equal(errors.length, 2, r.stderr);
  });

  it("exits 1 on a missing manifest, missing options or an unknown option", () => {
    assert.match(run("--bump", "patch", "--branch", "main", "--state-manifest", join(tmp, "none.json"), "3.5.4").stderr, /cannot read/);
    assert.equal(run("--bump", "patch", "--branch", "main", "--state-manifest", join(tmp, "none.json"), "3.5.4").status, 1);
    assert.equal(run("--bump", "patch", "3.5.4").status, 1);
    assert.equal(run("--bump", "patch", "--branch", "main", "--dry", "3.5.4").status, 1);
    assert.equal(run("--bump").status, 1);
  });

  it("cleans up", () => rmSync(tmp, { recursive: true, force: true }));
});

describe("align-internal-dep-ranges.mjs", () => {
  const setup = () => {
    const tmp = mkdtempSync(join(tmpdir(), "wcs-align-"));
    const server = join(tmp, "server");
    const testing = join(tmp, "testing");
    const plain = join(tmp, "plain");
    for (const dir of [server, testing, plain]) mkdirSync(dir);
    writeFileSync(join(server, "package.json"), JSON.stringify({ name: "@wcstack/server", dependencies: { "@wcstack/state": "^3.5.4", other: "^1.0.0" } }, null, 2) + "\n");
    writeFileSync(join(testing, "package.json"), JSON.stringify({
      name: "@wcstack/testing",
      peerDependencies: { "@wcstack/state": "^3.5.4", "@wcstack/server": "^3.5.4" },
      devDependencies: { "@wcstack/state": "file:../state" },
    }, null, 2) + "\n");
    writeFileSync(join(plain, "package.json"), JSON.stringify({ name: "@wcstack/plain", devDependencies: { "@wcstack/state": "file:../state" } }, null, 2) + "\n");
    return { tmp, server, testing, plain };
  };
  const read = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const align = (...args) => spawnSync(process.execPath, [ALIGN, ...args], { encoding: "utf8" });

  it("pins the exact rc for a prerelease target and leaves file: links alone", () => {
    const { tmp, server, testing, plain } = setup();
    try {
      const r = align("4.0.0-rc.1", server, testing, plain);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(r.stdout.trim().split("\n"), [server, testing]);
      assert.deepEqual(read(server).dependencies, { "@wcstack/state": "4.0.0-rc.1", other: "^1.0.0" });
      assert.deepEqual(read(testing).peerDependencies, { "@wcstack/state": "4.0.0-rc.1", "@wcstack/server": "4.0.0-rc.1" });
      assert.deepEqual(read(testing).devDependencies, { "@wcstack/state": "file:../state" });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("goes back to a caret range for the final release", () => {
    const { tmp, server } = setup();
    try {
      align("4.0.0-rc.3", server);
      const r = align("4.0.0", server);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(read(server).dependencies["@wcstack/state"], "^4.0.0");
      // nothing to rewrite: no output, still exit 0
      assert.equal(align("4.0.0", server).stdout, "");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refuses a target that is not a version", () => {
    assert.equal(align("v4.0.0", "x").status, 1);
    assert.equal(align("4.0.0-rc.1").status, 1);
  });
});
