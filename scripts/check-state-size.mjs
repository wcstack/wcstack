// Size gate for @wcstack/state's shipped bundles (requirements N3, decision D18): the gzip size of
// dist/auto.min.js, dist/index.esm.js and the `@wcstack/state/core` entry may not exceed the
// recorded release measurement by more than 3 % (scripts/state-size-baseline.json). Growth beyond
// that needs an explicit baseline update with `--update`, which records the current dist as the new
// baseline. Reads the built dist, so it runs after `npm run build` (CI) or against the checked-in
// dist (locally). The helper-entry gate (re-export of defineState only, 1 KB) lives in
// audit-state-tech-helper-import.mjs --check.
//
// The core entry is measured as its CLOSURE — `dist/split/core.js` plus every chunk it imports —
// because the entry file itself is a 1 KB shell and the core lives in the shared chunks. That sum
// is what a page on the split entries downloads, and the number A2 is about (wiring design §7-2).
//   node scripts/check-state-size.mjs --check [--allowance 0.03]
//   node scripts/check-state-size.mjs --update
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'packages/state/dist');
const baselineFile = join(root, 'scripts/state-size-baseline.json');
const allowance = process.argv.includes('--allowance') ? Number(process.argv[process.argv.indexOf('--allowance') + 1]) : 0.03;
const FILES = ['auto.min.js', 'index.esm.js'];
const CLOSURES = { 'split/core.js': 'split/core (with its chunks)' };

const gzipOf = (buffer) => gzipSync(buffer, { level: 9 }).length;
/** every file the entry statically imports, transitively (the chunks a page actually fetches) */
async function closure(entry) {
  const seen = new Set();
  const stack = [normalize(entry)];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const code = await readFile(file, 'utf8');
    for (const m of code.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
      if (m[1].startsWith('.')) stack.push(normalize(join(dirname(file), m[1])));
    }
  }
  return [...seen];
}
async function measure() {
  const out = {};
  for (const name of FILES) {
    const buffer = await readFile(join(dist, name));
    out[name] = { bytes: buffer.length, gzip: gzipOf(buffer) };
  }
  for (const [entry, label] of Object.entries(CLOSURES)) {
    const files = await closure(join(dist, entry));
    const buffers = await Promise.all(files.map((f) => readFile(f)));
    out[label] = {
      files: files.length,
      bytes: buffers.reduce((n, b) => n + b.length, 0),
      // each file is gzipped on its own, the way a CDN serves them
      gzip: buffers.reduce((n, b) => n + gzipOf(b), 0),
    };
  }
  return out;
}

const current = await measure();
if (process.argv.includes('--update')) {
  await writeFile(baselineFile, JSON.stringify({ $comment: 'gzip level 9 of packages/state/dist at the recorded release; check-state-size.mjs --check allows +3 % over these (requirements N3 / D18). The split core entry is the sum of its chunks, each gzipped on its own. Update with --update after a release build.', ...current }, null, 2) + '\n');
  console.log('[state size] baseline updated', JSON.stringify(current));
  process.exit(0);
}
const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
let failed = false;
for (const name of Object.keys(current)) {
  if (!baseline[name]) {
    console.error(`[state size] ${name} is not in the baseline; record it with: node scripts/check-state-size.mjs --update`);
    failed = true;
    continue;
  }
  const limit = Math.round(baseline[name].gzip * (1 + allowance));
  const ok = current[name].gzip <= limit;
  console.log(`[state size] ${name}: ${current[name].gzip} bytes gzip (baseline ${baseline[name].gzip}, limit ${limit}) ${ok ? 'ok' : 'EXCEEDED'}`);
  if (!ok) failed = true;
}
if (failed) {
  console.error(`[state size] a shipped bundle grew by more than ${Math.round(allowance * 100)} % over the recorded release; if intended, record it with: node scripts/check-state-size.mjs --update`);
  process.exit(1);
}
