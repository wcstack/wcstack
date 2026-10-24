#!/usr/bin/env node
// Emits Subresource Integrity digests for the single-tag bootstrap of every
// published package.
//
// The digests are computed from the working tree that is about to be published,
// never from what a CDN serves back afterwards. Asking the CDN for the hash of
// the file the CDN itself serves is circular and defeats the entire point of
// SRI, which is to not have to trust the CDN.
//
// Every package's dist/auto.min.js is hashed: it is the one artifact a page
// loads through <script src integrity>. A bare `import` from inside a module is
// not covered by the enclosing script's integrity attribute — that gap needs
// import map integrity instead (docs/sri.md §5). For @wcstack/state's split
// entries (dist/split/**: core.js, auto.js, each feature and each content-hashed
// chunk) every file is hashed as well, and the notes give the import map's
// `integrity` block to copy: a list written by hand from another build protects
// nothing, without a word (the prod-booking seam app, docs/seam-apps.md).
//
// Usage:
//   node scripts/generate-sri.mjs --version 1.26.0
//   node scripts/generate-sri.mjs --version 1.26.0 --out-json sri.json --out-notes sri-notes.md

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const ALGORITHM = "sha384";
const BOOTSTRAP = "dist/auto.min.js";
const CDN = "https://cdn.jsdelivr.net/npm";
const SPLIT_PACKAGE = "@wcstack/state";
const SPLIT_DIR = "dist/split";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

/** The .js files under `dir`, as paths relative to `base` with "/" separators, sorted. */
function jsFiles(base, dir) {
  const out = [];
  for (const entry of readdirSync(join(base, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...jsFiles(base, rel));
    else if (entry.name.endsWith(".js")) out.push(rel);
  }
  return out.sort();
}

function integrityOf(filePath) {
  const digest = createHash(ALGORITHM).update(readFileSync(filePath)).digest("base64");
  return `${ALGORITHM}-${digest}`;
}

// Discovery: packages/* scoped under @wcstack/, plus the unscoped `wcstack`
// entry bundle (release.yml builds the same set, with `wcstack` forced last in
// its build order). Packages with no bootstrap (server, signals, lint) are
// reported as skipped rather than silently dropped — a missing row must be a
// stated decision, not something the reader has to notice on their own.
// A `private: true` package is never published, so it gets no row at all.
function collect(version) {
  const entries = [];
  const skipped = [];
  const pkgsDir = join(repoRoot, "packages");
  for (const entry of readdirSync(pkgsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = join(pkgsDir, entry.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const name = pkgJson.name ?? "";
    if (!(name.startsWith("@wcstack/") || name === "wcstack")) continue;
    // 公開しないパッケージ（`private: true`）は CDN に載らない
    if (pkgJson.private === true) continue;

    const bootstrap = join(pkgsDir, entry.name, BOOTSTRAP);
    if (!existsSync(bootstrap)) {
      skipped.push(name);
      continue;
    }
    const split = name === SPLIT_PACKAGE && existsSync(join(pkgsDir, entry.name, SPLIT_DIR))
      ? jsFiles(join(pkgsDir, entry.name), SPLIT_DIR).map((file) => ({
        file,
        integrity: integrityOf(join(pkgsDir, entry.name, file)),
        url: `${CDN}/${name}@${version}/${file}`,
      }))
      : null;
    entries.push({
      name,
      integrity: integrityOf(bootstrap),
      url: `${CDN}/${name}@${version}/${BOOTSTRAP}`,
      ...(split !== null ? { split } : {}),
    });
  }
  return { entries, skipped };
}

function toJson(version, entries, skipped) {
  return `${JSON.stringify({
    version,
    algorithm: ALGORITHM,
    file: BOOTSTRAP,
    generatedFrom: "the published tree, not a CDN response",
    alsoUsableAs: "script-src hash source (CSP3 integrity matching: Chromium, Firefox 115+, Safari); see docs/csp.md",
    packages: Object.fromEntries(entries.map((e) => [e.name, {
      integrity: e.integrity,
      url: e.url,
      // every file of the split entries: an import map's `integrity` needs one per URL (docs/sri.md §5.1)
      ...(e.split ? { split: Object.fromEntries(e.split.map((f) => [f.file, { integrity: f.integrity, url: f.url }])) } : {}),
    }])),
    withoutBootstrap: skipped,
  }, null, 2)}\n`;
}

function toNotes(version, entries, skipped) {
  const example = entries.find((e) => e.name === "@wcstack/state") ?? entries[0];
  const lines = [
    "## Subresource Integrity",
    "",
    `\`dist/auto.min.js\` is a self-contained bundle with no static imports, so a single \`integrity\``,
    "attribute covers every line of wcstack that runs. Digests below are computed from the published",
    "tree, so you can verify them against this tag without trusting the CDN.",
    "",
  ];
  if (example) {
    lines.push(
      "```html",
      `<script type="module"`,
      `        src="${example.url}"`,
      `        integrity="${example.integrity}"></script>`,
      "```",
      "",
      "Use the versioned `cdn.jsdelivr.net` path above rather than `esm.run`: `esm.run` redirects to",
      "jsDelivr's `+esm` endpoint, which re-bundles the package, so its bytes are not the published",
      "bytes and no fixed digest can match them.",
      "",
      "Loading several packages? Use one pinned tag per package — each bootstrap is self-contained,",
      "so the tags fetch in parallel and each keeps its own full-coverage digest. Do NOT use",
      "jsDelivr's `/combine/` endpoint: concatenated minified ESM does not even parse (top-level",
      "identifiers collide), and jsDelivr itself rules out SRI for combined responses. See",
      "`docs/sri.md` §3.1.",
      "",
    );
  }
  lines.push(
    "<details><summary>All packages</summary>",
    "",
    "| Package | integrity |",
    "|---|---|",
    ...entries.map((e) => `| \`${e.name}\` | \`${e.integrity}\` |`),
    "",
    "</details>",
    "",
    "The same digests double as CSP `script-src` hash sources: CSP3 allows an external script whose",
    "`integrity` matches a hash in `script-src`, so no separate value needs computing. Chromium, Firefox",
    "115+ and Safari implement that matching; an older browser blocks the script, so keep the CDN host",
    "listed if you support one. Which parts of wcstack a hash can and cannot cover: `docs/csp.md` §3.",
    "",
    ...splitNotes(entries),
    `Machine-readable: \`sri.json\` attached to this release.`,
  );
  if (skipped.length > 0) {
    lines.push(
      "",
      `No single-tag bootstrap, so not listed: ${skipped.map((s) => `\`${s}\``).join(", ")}.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** The import map block for @wcstack/state's split entries: every file of this release, nothing by hand. */
function splitNotes(entries) {
  const state = entries.find((e) => e.split);
  if (!state) return [];
  const entryFiles = state.split.filter((f) => f.file === `${SPLIT_DIR}/core.js` || f.file.startsWith(`${SPLIT_DIR}/features/`));
  const imports = Object.fromEntries(entryFiles.map((f) => [
    `${SPLIT_PACKAGE}/${f.file.slice(SPLIT_DIR.length + 1).replace(/\.js$/, "")}`,
    f.url,
  ]));
  const integrity = Object.fromEntries(state.split.map((f) => [f.url, f.integrity]));
  return [
    `<details><summary>The split entries of \`${SPLIT_PACKAGE}\` (import map \`integrity\`)</summary>`,
    "",
    "Every file the split entries can request — the entries, the split auto entry, each feature and each",
    "content-hashed chunk. Keep the `imports` you use and the whole `integrity` list: an entry for a",
    "URL nobody requests is ignored, and a requested URL without one is not checked — both silently.",
    "See `docs/sri.md` §5.1.",
    "",
    "```html",
    `<script type="importmap">`,
    JSON.stringify({ imports, integrity }, null, 2),
    "</script>",
    "```",
    "",
    "</details>",
    "",
  ];
}

function main() {
  const version = arg("version");
  if (!version) {
    console.error("generate-sri: --version is required (e.g. --version 1.26.0)");
    process.exit(1);
  }
  const { entries, skipped } = collect(version);
  if (entries.length === 0) {
    console.error(`generate-sri: no ${BOOTSTRAP} found — build the packages first`);
    process.exit(1);
  }

  // resolve(), not join(): an absolute --out-json must stay where the caller
  // asked rather than being re-rooted under the repo.
  const outJson = arg("out-json");
  const outNotes = arg("out-notes");
  if (outJson) writeFileSync(resolve(repoRoot, outJson), toJson(version, entries, skipped));
  if (outNotes) writeFileSync(resolve(repoRoot, outNotes), toNotes(version, entries, skipped));

  if (!outJson && !outNotes) {
    process.stdout.write(toNotes(version, entries, skipped));
    return;
  }
  console.log(
    `generate-sri: ${entries.length} bootstrap digests at v${version}` +
    (skipped.length ? ` (${skipped.length} package(s) have no bootstrap: ${skipped.join(", ")})` : ""),
  );
}

main();
