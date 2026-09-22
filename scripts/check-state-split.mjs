// One core chunk, and no feature carrying another feature (requirement B13, wiring design §7-1).
//
// 1. Every `@wcstack/state/features/*` entry must import the core's chunk rather than carry a copy
//    of it. A feature that re-bundles the core would give the page two proxies, two updaters and two
//    registries — the same failure as loading the package twice from different URLs, but silent.
// 2. A feature entry must not carry a *different* feature's code either. A single static import
//    across the seam (`features/scopes` → `watch/watchRuntime`) puts the whole of that other feature
//    into a shared chunk, so a page that installed only `scopes` downloads the temporal runtime.
//    Cross-feature calls go through `src/bridge/*` receptacles instead.
// 3. The gzip of each feature's OWN code (its entry plus the chunks the core does not already carry)
//    may not grow more than 3 % over scripts/state-split-baseline.json. Feature weight is invisible
//    to check-state-size.mjs, which only measures the shipped bundles and the core closure.
//
// The check reads the built `dist/split/**.js.map`. Run after `npm run build` in packages/state:
//   node scripts/check-state-split.mjs [--check] [--update] [--allowance 0.03]
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const splitDir = join(root, 'packages/state/dist/split');
const baselineFile = join(root, 'scripts/state-split-baseline.json');
const allowance = process.argv.includes('--allowance') ? Number(process.argv[process.argv.indexOf('--allowance') + 1]) : 0.03;
// Directories that make up the core: no feature entry may contain code from any of them.
const CORE_DIRS = ['proxy', 'updater', 'bindings', 'apply', 'binding', 'dependency', 'list', 'structural', 'address', 'cache', 'core'];
// Source directory -> the feature entry that owns it. A feature entry may only carry its own
// directories; anything else listed here belongs to another feature and fails the check.
// Directories absent from both tables (`bridge/`, `features/`, `(root)` helpers, `platform/` …) are
// feature-neutral: they may be shared. `bridge/` exists precisely for that — it holds the
// receptacles through which one feature calls another without importing it.
const FEATURE_BY_DIR = {
  watch: 'temporal', scan: 'temporal', stream: 'temporal',
  webComponent: 'scopes', dcc: 'scopes',
  recursion: 'recursion',
  ssr: 'ssr', hydrater: 'ssr',
  devtools: 'devtools',
  formats: 'formats', filters: 'formats',
  diagnostics: 'diagnostics',
};

try {
  await stat(splitDir);
} catch {
  console.error(`[state split] ${relative(root, splitDir)} is missing; run the package build first`);
  process.exit(1);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    out.push(...(entry.isDirectory() ? await walk(full) : [full]));
  }
  return out;
}
/** the files an output file statically imports, transitively */
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
  return seen;
}
/** source directories the file's own code comes from (through its source map) */
async function groupsOf(file) {
  const map = JSON.parse(await readFile(`${file}.map`, 'utf8'));
  const groups = new Set();
  for (const source of map.sources) {
    const id = source.replaceAll('\\', '/').replace(/^.*\/src\//, '');
    groups.add(id.includes('/') ? id.split('/')[0] : '(root)');
  }
  return groups;
}

const outputs = (await walk(splitDir)).filter((f) => f.endsWith('.js'));
const featureEntries = outputs.filter((f) => /[\\/]features[\\/][^\\/]+\.js$/.test(f));
const coreClosure = await closure(join(splitDir, 'core.js'));
const failures = [];
const report = [];
const current = {};
for (const entry of featureEntries.sort()) {
  const name = relative(splitDir, entry).replaceAll('\\', '/');
  const feature = name.replace(/^features\//, '').replace(/\.js$/, '');
  // the entry itself plus any chunk the core does not already carry
  const own = [...(await closure(entry))].filter((f) => !coreClosure.has(f));
  let bytes = 0;
  let gzip = 0;
  for (const file of own.sort()) {
    const where = relative(splitDir, file).replaceAll('\\', '/');
    const buffer = await readFile(file);
    bytes += buffer.length;
    gzip += gzipSync(buffer, { level: 9 }).length;
    const groups = [...(await groupsOf(file))];
    const core = groups.filter((g) => CORE_DIRS.includes(g));
    if (core.length > 0) {
      failures.push(`${name} carries core code in ${where}: ${core.join(', ')}`);
    }
    const foreign = groups.filter((g) => FEATURE_BY_DIR[g] !== undefined && FEATURE_BY_DIR[g] !== feature);
    if (foreign.length > 0) {
      failures.push(
        `${name} carries the "${[...new Set(foreign.map((g) => FEATURE_BY_DIR[g]))].join('", "')}" feature in ${where}: ` +
        `${foreign.join(', ')} (route the call through a src/bridge/* receptacle)`,
      );
    }
  }
  current[name] = { files: own.length, bytes, gzip };
  report.push(`${name}: ${own.length} file(s), ${gzip} B gzip of its own`);
}

if (process.argv.includes('--update')) {
  await writeFile(baselineFile, JSON.stringify({
    $comment: 'gzip level 9 of each @wcstack/state feature entry\'s OWN code (the entry plus the chunks the core does not already carry) at the recorded release. check-state-split.mjs --check allows +3 % over these (requirement B13). Update with --update after a release build.',
    ...current,
  }, null, 2) + '\n');
  console.log('[state split] baseline updated', JSON.stringify(current));
  process.exit(0);
}

if (failures.length > 0) {
  console.error(`[state split] ${failures.length} violation(s): a feature entry carries code that is not its own`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

let grew = false;
const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
for (const name of Object.keys(current)) {
  if (!baseline[name]) {
    console.error(`[state split] ${name} is not in the baseline; record it with: node scripts/check-state-split.mjs --update`);
    grew = true;
    continue;
  }
  const limit = Math.round(baseline[name].gzip * (1 + allowance));
  if (current[name].gzip > limit) {
    console.error(`[state split] ${name}: ${current[name].gzip} B gzip of its own (baseline ${baseline[name].gzip}, limit ${limit}) EXCEEDED`);
    grew = true;
  }
}
if (grew) {
  console.error(`[state split] a feature entry grew by more than ${Math.round(allowance * 100)} % over the recorded release; if intended, record it with: node scripts/check-state-split.mjs --update`);
  process.exit(1);
}
console.log(`[state split] ok: ${featureEntries.length} feature entries share one core chunk and carry no other feature (${report.join('; ')})`);
