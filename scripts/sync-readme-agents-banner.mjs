// wcstack package-README AI-agents banner sync.
//
// Every published @wcstack/* package README (README.md + README.ja.md) must
// carry the AI-agents entry-point banner directly below its H1, so an AI coding
// agent that lands on a single package (e.g. via its npm page) is redirected to
// the repository-level entry points before it starts building against a
// package-level reference. The canonical banner text lives here; this script is
// the single source that inserts / refreshes it.
//
// The vscode-wcs extension is intentionally excluded: its README targets the VS
// Code Marketplace audience (extension users), not app-building agents. It is
// filtered out automatically because its package.json is not scoped @wcstack/*
// — the same rule CI's detect-changes uses to pick release-target packages.
//
// Run:
//   node scripts/sync-readme-agents-banner.mjs           # insert / refresh in place
//   node scripts/sync-readme-agents-banner.mjs --check    # fail (exit 1) on drift
//
// Idempotent: re-running with no drift produces no changes.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKGDIR = join(ROOT, "packages");

// Marker substring that identifies the banner line (used to locate an existing,
// possibly outdated, banner so it can be refreshed in place).
const MARKER = "AI coding agents";

// Canonical banner. Kept as one blockquote line; the same English text is used
// in both README.md and README.ja.md — the audience is agents, and a single
// string avoids translation drift.
const BANNER =
  "> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).";

const check = process.argv.includes("--check");

// Published packages: packages/*/package.json scoped under @wcstack/. Auto-picks
// up new packages and excludes the non-published vscode-wcs extension.
function publishedPackages() {
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
    if (typeof name === "string" && name.startsWith("@wcstack/")) out.push(d);
  }
  return out.sort();
}

// Return the file content with the canonical banner placed directly below the
// H1, replacing any existing banner line. Preserves the file's EOL style.
function withBanner(content) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(eol);
  if (!lines[0]?.startsWith("# ")) {
    throw new Error("expected an H1 (`# ...`) on line 1");
  }
  // Walk past blank lines after the H1, then drop an existing banner line if
  // present (and the blank lines that trail it) so it can be reinserted fresh.
  let idx = 1;
  while (idx < lines.length && lines[idx].trim() === "") idx++;
  if (idx < lines.length && lines[idx].startsWith(">") && lines[idx].includes(MARKER)) {
    idx++;
    while (idx < lines.length && lines[idx].trim() === "") idx++;
  }
  return [lines[0], "", BANNER, "", ...lines.slice(idx)].join(eol);
}

const drift = [];
for (const pkg of publishedPackages()) {
  for (const name of ["README.md", "README.ja.md"]) {
    const fp = join(PKGDIR, pkg, name);
    if (!existsSync(fp)) {
      drift.push(`${pkg}/${name} (missing file)`);
      continue;
    }
    const current = readFileSync(fp, "utf8");
    let next;
    try {
      next = withBanner(current);
    } catch (e) {
      drift.push(`${pkg}/${name} (${e.message})`);
      continue;
    }
    if (next === current) continue;
    if (check) {
      drift.push(`${pkg}/${name}`);
    } else {
      writeFileSync(fp, next);
      console.log(`updated ${pkg}/${name}`);
    }
  }
}

if (check && drift.length > 0) {
  console.error(
    "README AI-agents banner drift detected in:\n  " +
      drift.join("\n  ") +
      "\n\nRun `node scripts/sync-readme-agents-banner.mjs` and commit the result.",
  );
  process.exit(1);
}

if (!check) {
  console.log(drift.length === 0 ? "all package READMEs in sync" : `issues: ${drift.join(", ")}`);
}
