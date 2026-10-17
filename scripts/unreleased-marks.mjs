#!/usr/bin/env node
// What the READMEs on main describe before npm has it (docs/v4-direction-2026-10.md §5.1, ja).
//
// A README on main describes the next release, while npm `latest` — and the README a user
// installs — is the last one. A reader of the repository could not tell them apart: the
// ssr-news seam app read "Since 4.3, mark the element … with `data-wcs-ignore`" on 4.2.0,
// which ignored the attribute. So a behavior that is not released is written with its version
// and a mark:
//
//   en  `4.3 (not released yet)`   "Since 4.3 (not released yet), mark the element …"
//   ja  `4.3（未リリース）`         「4.3（未リリース）から、…」
//
// and the release removes the marks of its own major.minor.
//
//   node scripts/unreleased-marks.mjs [--check]        fails on a mark without a version, a mark
//                                                      of a released version, or a version not yet
//                                                      released written without the mark
//   node scripts/unreleased-marks.mjs --strip <ver>    removes the marks of <ver>'s major.minor;
//                                                      refuses one of another version (a patch cut
//                                                      while main holds the next minor's behavior)
//
// It reads the README.md / README.ja.md of the root and of every package but vscode-wcs, which
// is versioned on its own. The released version is packages/state/package.json's.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const MARK_EN = "(not released yet)";
const MARK_JA = "（未リリース）";

export function readmes(root = ROOT) {
  const out = [];
  for (const name of ["README.md", "README.ja.md"]) if (existsSync(join(root, name))) out.push(join(root, name));
  const pkgs = join(root, "packages");
  for (const pkg of readdirSync(pkgs).sort()) {
    if (pkg === "vscode-wcs") continue;
    for (const name of ["README.md", "README.ja.md"]) {
      const p = join(pkgs, pkg, name);
      if (existsSync(p)) out.push(p);
    }
  }
  return out;
}

const minor = (v) => {
  const m = /^(\d+)\.(\d+)/.exec(v);
  if (m === null) throw new Error(`not a version: ${v}`);
  return [Number(m[1]), Number(m[2])];
};
const after = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/** The marks in `text`: { version, index, length } (version null when none is written before it). */
export function marks(text) {
  const out = [];
  const re = /(\d+\.\d+)?( ?)(\(not released yet\)|（未リリース）)/g;
  for (let m; (m = re.exec(text)) !== null; ) {
    const en = m[3] === MARK_EN;
    // en: `4.3 (not released yet)` (one space); ja: `4.3（未リリース）` (none)
    const ok = m[1] !== undefined && (en ? m[2] === " " : m[2] === "");
    out.push({ version: ok ? m[1] : null, index: m.index, text: m[0], mark: m[2] + m[3] });
  }
  return out;
}

/** A version written as a release in prose ("since 4.3", "4.3 から"), without the mark. */
export function unmarked(text) {
  const out = [];
  const re = /(?:\b[Ss]ince|\bfrom|\b[Aa]s of|\b[Ii]n) (\d+\.\d+)(?![\d.]*\d)(?! \(not released yet\))|(?<![\d.§])(\d+\.\d+)(?![\d.]*\d) ?(?:から|以降)/g;
  for (let m; (m = re.exec(text)) !== null; ) out.push({ version: m[1] ?? m[2], index: m.index, text: m[0] });
  return out;
}

const line = (text, index) => text.slice(0, index).split("\n").length;

export function check(files, released) {
  const problems = [];
  const cur = minor(released);
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const where = (i) => `${relative(ROOT, f)}:${line(text, i)}`;
    for (const m of marks(text)) {
      if (m.version === null) problems.push(`${where(m.index)}: a mark without its version ("${m.text}") — write \`X.Y ${MARK_EN}\` / \`X.Y${MARK_JA}\``);
      else if (!after(minor(m.version), cur)) problems.push(`${where(m.index)}: ${m.version} is released (${released}) — drop the mark`);
    }
    for (const u of unmarked(text)) {
      // (another major is a browser's or a platform's version — "Chrome 21.0 以降")
      const v = minor(u.version);
      if (v[0] === cur[0] && after(v, cur)) problems.push(`${where(u.index)}: "${u.text}" names ${u.version}, which is not released (${released}) — mark it: \`${u.version} ${MARK_EN}\` / \`${u.version}${MARK_JA}\``);
    }
  }
  return problems;
}

/** Removes the marks of `version`'s major.minor; returns { changed: [files], problems: [...] }. */
export function strip(files, version) {
  const target = minor(version);
  const changed = [];
  const problems = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    let out = "";
    let prev = 0;
    for (const m of marks(text)) {
      if (m.version === null || !same(minor(m.version), target)) {
        problems.push(`${relative(ROOT, f)}:${line(text, m.index)}: "${m.text}" is not a mark of ${target.join(".")} — this release would ship it as not released`);
        continue;
      }
      const end = m.index + m.text.length;
      // ja: `4.3（未リリース）から` back to `4.3 から` — a space between the version and the word after
      // it, as the ja documents write it; none before punctuation
      const next = text[end] ?? "";
      const gap = m.mark === MARK_JA && next !== "" && !/[\s、。，．）)」』：:;,.!?！？]/.test(next) ? " " : "";
      out += text.slice(prev, m.index) + m.version + gap;
      prev = end;
    }
    if (prev > 0) changed.push({ file: f, text: out + text.slice(prev) });
  }
  return { changed, problems };
}

function main(argv) {
  const files = readmes();
  if (argv[0] === "--strip") {
    const version = argv[1];
    if (version === undefined) {
      console.error("usage: node scripts/unreleased-marks.mjs --strip <version>");
      return 1;
    }
    const { changed, problems } = strip(files, version);
    if (problems.length > 0) {
      for (const p of problems) console.error(p);
      return 1;
    }
    for (const c of changed) {
      writeFileSync(c.file, c.text);
      console.log(relative(ROOT, c.file).replace(/\\/g, "/"));
    }
    return 0;
  }
  const released = JSON.parse(readFileSync(join(ROOT, "packages/state/package.json"), "utf8")).version;
  const problems = check(files, released);
  for (const p of problems) console.error(p);
  if (problems.length > 0) return 1;
  let n = 0;
  for (const f of files) n += marks(readFileSync(f, "utf8")).length;
  console.log(`unreleased marks: ${n} in ${files.length} READMEs, all of versions after ${released}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
