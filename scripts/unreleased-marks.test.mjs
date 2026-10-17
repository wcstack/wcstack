// node --test scripts/unreleased-marks.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { marks, unmarked, check, strip } from "./unreleased-marks.mjs";

const files = (texts) => {
  const dir = mkdtempSync(join(tmpdir(), "wcs-marks-"));
  const paths = texts.map((t, i) => {
    const p = join(dir, `README${i}.md`);
    writeFileSync(p, t);
    return p;
  });
  return { dir, paths };
};

describe("marks / unmarked", () => {
  it("reads a mark with its version, and one without", () => {
    assert.deepEqual(marks("Since 4.3 (not released yet), x. 4.3（未リリース）から。 (not released yet)").map((m) => m.version), ["4.3", "4.3", null]);
    // en needs the space, ja none
    assert.deepEqual(marks("4.3(not released yet) 4.3 （未リリース）").map((m) => m.version), [null, null]);
  });

  it("finds a version written as a release in prose, not one with the mark, not a part of a longer version", () => {
    assert.deepEqual(unmarked("Since 4.3, mark it. Since 4.3 (not released yet), x. 3.5.1 からは y. §5.1 から z. 4.3.1 から").map((u) => u.version), ["4.3"]);
    assert.deepEqual(unmarked("4.3 から、4.3以降").map((u) => u.version), ["4.3", "4.3"]);
  });
});

describe("check", () => {
  it("passes a marked unreleased version, and versions of another major (a browser's)", () => {
    const { dir, paths } = files(["Since 4.3 (not released yet), x.", "Chrome 21.0 以降。 since 3.5, y. 4.3（未リリース）から"]);
    try {
      assert.deepEqual(check(paths, "4.2.0"), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an unreleased version without the mark, a mark without its version, and a mark of a released version", () => {
    const { dir, paths } = files(["Since 4.3, x.\n\nA (not released yet) y.\n\nSince 4.2 (not released yet), z."]);
    try {
      const p = check(paths, "4.2.0");
      assert.equal(p.length, 3);
      assert.match(p[0], /a mark without its version/);
      assert.match(p[1], /4\.2 is released \(4\.2\.0\)/);
      assert.match(p[2], /"Since 4\.3" names 4\.3, which is not released/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("strip", () => {
  it("removes the marks of the release's major.minor (ja keeps its space before a word)", () => {
    const { dir, paths } = files(["Since 4.3 (not released yet), mark it (fixed in 4.3 (not released yet)).", "4.3（未リリース）から。（4.3（未リリース）で修正）、4.3（未リリース）。"]);
    try {
      const { changed, problems } = strip(paths, "4.3.0");
      assert.deepEqual(problems, []);
      assert.deepEqual(changed.map((c) => c.text), ["Since 4.3, mark it (fixed in 4.3).", "4.3 から。（4.3 で修正）、4.3。"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a mark of another version: a patch cut while main holds the next minor's behavior", () => {
    const { dir, paths } = files(["Since 4.3 (not released yet), x."]);
    try {
      const { problems } = strip(paths, "4.2.1");
      assert.equal(problems.length, 1);
      assert.match(problems[0], /is not a mark of 4\.2 — this release would ship it as not released/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a file without marks is not changed", () => {
    const { dir, paths } = files(["nothing here"]);
    try {
      assert.deepEqual(strip(paths, "4.3.0"), { changed: [], problems: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
