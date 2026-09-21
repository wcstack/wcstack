// One core chunk (requirement B13, wiring design §7-1): every `@wcstack/state/features/*` entry
// must import the core's chunk rather than carry a copy of it. A feature that re-bundles the core
// would give the page two proxies, two updaters and two registries — the same failure as loading
// the package twice from different URLs, but silent.
//
// The check reads the built `dist/split/**.js.map` and fails when a FEATURE entry or a chunk that
// only a feature imports attributes any code to a core directory (proxy/, updater/, bindings/ …).
// Run after `npm run build` in packages/state:
//   node scripts/check-state-split.mjs [--check]
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const splitDir = join(root, 'packages/state/dist/split');
// Directories that make up the core: no feature entry may contain code from any of them.
const CORE_DIRS = ['proxy', 'updater', 'bindings', 'apply', 'binding', 'dependency', 'list', 'structural', 'address', 'cache', 'core'];

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
for (const entry of featureEntries) {
  const name = relative(splitDir, entry).replaceAll('\\', '/');
  // the entry itself plus any chunk the core does not already carry
  const own = [...(await closure(entry))].filter((f) => !coreClosure.has(f));
  for (const file of own) {
    const groups = [...(await groupsOf(file))].filter((g) => CORE_DIRS.includes(g));
    if (groups.length > 0) {
      failures.push(`${name} carries core code in ${relative(splitDir, file).replaceAll('\\', '/')}: ${groups.join(', ')}`);
    }
  }
  report.push(`${name}: ${own.length} file(s) of its own`);
}
if (failures.length > 0) {
  console.error(`[state split] ${failures.length} violation(s): a feature entry re-bundles the core`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`[state split] ok: ${featureEntries.length} feature entries share one core chunk (${report.join('; ')})`);
