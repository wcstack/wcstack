// Size gate for @wcstack/state 4.0 (requirements N2 / N3, decision D18). Reads the built
// packages/state/dist only — run it after `npm run build` (CI), or against the committed dist.
// Sizes are gzip level 9, each file on its own, the way a CDN serves them.
//
// Relative to scripts/state-size-baseline.json — the limit is the recorded size + 3 %, plus an
// entry's optional `slack` in bytes (a standing allowance for an entry expected to grow; kept
// across `--update`):
//   index.esm.js, auto.min.js                 the full entries
//   split/core.js (with its chunks)           what a page on `/core` downloads: the entry and every
//                                             chunk it imports, transitively
//   split/features/<name>.js (beyond the core) an add-on's own weight: its closure minus the core's
//   split/auto.js (beyond the core)           the split build's one-script loader
// Absolute (no baseline; `--update` refuses to record past them):
//   core.min.js ≤ 20,000 B                    the 4.0 core target
//   define.js (with its imports) ≤ 1,024 B    `/define`, the helper entry that pulls in no runtime
//                                             (N2). 4.0's `.` keeps most of the core on a
//                                             defineState-only import, so the 3.x probe through
//                                             index.esm.js would measure the core, not the helper.
// Every entry in the baseline must still exist, and every add-on in dist/split/features must be in
// the baseline.
// Whether an add-on carries code that is not its own is check-state-coupling.mjs's job.
//   node scripts/check-state-size.mjs [--check] [--update] [--allowance 0.03]
// `--check` is the default and is accepted so CI can state its intent; `--update` re-records the
// baseline (after a release build).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'packages/state/dist');
const baselineFile = join(root, 'scripts/state-size-baseline.json');
const tag = '[state size]';
const HARD_LIMITS = { 'core.min.js': 20000, 'define.js (with its imports)': 1024 };
const BASELINE_COMMENT = 'gzip level 9 of packages/state/dist (4.0) at the recorded release, each file gzipped on its own. check-state-size.mjs --check allows +3 % over these plus an entry\'s optional "slack" in bytes (kept across --update). "with its chunks" sums the entry and every chunk it imports; "beyond the core" sums the files of its closure that split/core.js does not load. The absolute limits (core.min.js 20,000 B, define.js 1,024 B) live in the script. Update with --update after a release build.';

let allowance = 0.03;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--allowance') {
    allowance = Number(args[++i]);
    if (!Number.isFinite(allowance) || allowance < 0) {
      console.error(`${tag} --allowance needs a non-negative number, e.g. --allowance 0.03`);
      process.exit(1);
    }
  } else if (!['--check', '--update'].includes(args[i])) {
    console.error(`${tag} unknown argument ${args[i]}; usage: check-state-size.mjs [--check] [--update] [--allowance 0.03]`);
    process.exit(1);
  }
}
const update = args.includes('--update');
if (!existsSync(join(dist, 'split/core.js'))) {
  console.error(`${tag} packages/state/dist is missing or incomplete; run npm run build in packages/state first`);
  process.exit(1);
}

const gzipOf = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
/** the file and every file it statically imports, transitively (what a page fetches for it) */
function closure(file, seen = new Set()) {
  file = normalize(file);
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const m of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*["'](\.[^"']+)["']/g)) closure(join(dirname(file), m[1]), seen);
  return seen;
}
const sizeOf = (files) => ({ files: files.length, bytes: files.reduce((n, f) => n + readFileSync(f).length, 0), gzip: files.reduce((n, f) => n + gzipOf(f), 0) });

const current = {};
for (const name of ['index.esm.js', 'auto.min.js']) current[name] = sizeOf([join(dist, name)]);
const core = closure(join(dist, 'split/core.js'));
current['split/core.js (with its chunks)'] = sizeOf([...core]);
const beyondCore = (file) => sizeOf([...closure(file)].filter((f) => !core.has(f)));
for (const f of readdirSync(join(dist, 'split/features')).filter((f) => f.endsWith('.js')).sort()) {
  current[`split/features/${f} (beyond the core)`] = beyondCore(join(dist, 'split/features', f));
}
current['split/auto.js (beyond the core)'] = beyondCore(join(dist, 'split/auto.js'));

let overHard = false;
for (const [name, limit] of Object.entries(HARD_LIMITS)) {
  const file = join(dist, name.replace(/ \(.*\)$/, ''));
  const gzip = sizeOf([...closure(file)]).gzip;
  const ok = gzip <= limit;
  console.log(`${tag} ${name}: ${gzip} B gzip (absolute limit ${limit}) ${ok ? 'ok' : 'EXCEEDED'}`);
  if (!ok) overHard = true;
}
const hardMessage = `${tag} an absolute limit is exceeded; it is a target, not a baseline: shrink the code`;

if (update) {
  if (overHard) {
    console.error(`${hardMessage} (refusing to re-record the baseline)`);
    process.exit(1);
  }
  let previous = {};
  try {
    previous = JSON.parse(readFileSync(baselineFile, 'utf8'));
  } catch {
    // no baseline yet: no slack to carry over
  }
  // a slack is a person's decision, not a measurement: keep it
  for (const name of Object.keys(current)) if (typeof previous[name]?.slack === 'number') current[name].slack = previous[name].slack;
  writeFileSync(baselineFile, JSON.stringify({ $comment: BASELINE_COMMENT, ...current }, null, 2) + '\n');
  console.log(`${tag} baseline updated`, JSON.stringify(current));
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
let unmatched = false;
let grew = false;
for (const name of Object.keys(baseline)) {
  if (name !== '$comment' && !current[name]) {
    console.error(`${tag} ${name} is in the baseline but not in the dist`);
    unmatched = true;
  }
}
for (const [name, size] of Object.entries(current)) {
  if (!baseline[name]) {
    console.error(`${tag} ${name}: ${size.gzip} B gzip, not in the baseline`);
    unmatched = true;
    continue;
  }
  const slack = baseline[name].slack ?? 0;
  const limit = Math.round(baseline[name].gzip * (1 + allowance)) + slack;
  const ok = size.gzip <= limit;
  console.log(`${tag} ${name}: ${size.gzip} B gzip (baseline ${baseline[name].gzip}, limit ${limit}${slack > 0 ? ` incl. ${slack} B slack` : ''}) ${ok ? 'ok' : 'EXCEEDED'}`);
  if (!ok) grew = true;
}
if (overHard) console.error(hardMessage);
if (unmatched) console.error(`${tag} the dist's entries differ from the baseline's; rebuild, or record the new set with: node scripts/check-state-size.mjs --update`);
if (grew) console.error(`${tag} a shipped file grew by more than ${Math.round(allowance * 100)} % over the recorded release; if intended, record it with: node scripts/check-state-size.mjs --update`);
if (overHard || unmatched || grew) process.exit(1);
