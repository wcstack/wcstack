// Size gate for @wcstack/state's shipped bundles (requirements N3, decision D18): the gzip size of
// dist/auto.min.js and dist/index.esm.js may not exceed the recorded release measurement by more
// than 3 % (scripts/state-size-baseline.json). Growth beyond that needs an explicit baseline update
// with `--update`, which records the current dist as the new baseline. Reads the built dist, so it
// runs after `npm run build` (CI) or against the checked-in dist (locally). The helper-entry gate
// (re-export of defineState only, 1 KB) lives in audit-state-tech-helper-import.mjs --check.
//   node scripts/check-state-size.mjs --check [--allowance 0.03]
//   node scripts/check-state-size.mjs --update
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'packages/state/dist');
const baselineFile = join(root, 'scripts/state-size-baseline.json');
const allowance = process.argv.includes('--allowance') ? Number(process.argv[process.argv.indexOf('--allowance') + 1]) : 0.03;
const FILES = ['auto.min.js', 'index.esm.js'];
const measure = async () => Object.fromEntries(await Promise.all(FILES.map(async f => {
  const b = await readFile(join(dist, f));
  return [f, { bytes: b.length, gzip: gzipSync(b, { level: 9 }).length }];
})));
const current = await measure();
if (process.argv.includes('--update')) {
  await writeFile(baselineFile, JSON.stringify({ $comment: 'gzip level 9 of packages/state/dist at the recorded release; check-state-size.mjs --check allows +3 % over these (requirements N3 / D18). Update with --update after a release build.', ...current }, null, 2) + '\n');
  console.log('[state size] baseline updated', JSON.stringify(current));
  process.exit(0);
}
const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
let failed = false;
for (const f of FILES) {
  const limit = Math.round(baseline[f].gzip * (1 + allowance));
  const ok = current[f].gzip <= limit;
  console.log(`[state size] ${f}: ${current[f].gzip} bytes gzip (baseline ${baseline[f].gzip}, limit ${limit}) ${ok ? 'ok' : 'EXCEEDED'}`);
  if (!ok) failed = true;
}
if (failed) {
  console.error(`[state size] a shipped bundle grew by more than ${Math.round(allowance * 100)} % over the recorded release; if intended, record it with: node scripts/check-state-size.mjs --update`);
  process.exit(1);
}
