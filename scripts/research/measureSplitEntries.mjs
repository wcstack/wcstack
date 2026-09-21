// What the split entries weigh (wiring design §8-11), measured on a sandbox that carries S3/S4/S5.
// Three numbers, each of which answers a different question:
//   1. SINGLE-FILE bundles (`core`, `core + <feature>`, `core + all`): what the core actually costs
//      once the features are tree-shaken out — comparable with the shipped `auto.min.js`.
//   2. The MULTI-ENTRY build (`rollup.split.config.js` → `dist-split/`): the closure a page really
//      downloads per composition (files gzipped one by one, as a CDN serves them), plus the check
//      that no feature entry re-bundles a core module (requirement B13).
//   3. ATTRIBUTION of the core bundle to source modules through its source map: where the remainder
//      lives, which is what A2 (35 KB) has to attack next.
// Temporary entries and config are written into the sandbox and removed again; dist-split/ stays.
//   node scripts/research/measureSplitEntries.mjs <sandbox>/packages/state
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(fileURLToPath(import.meta.url), '../../..');
const pkg = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!pkg) throw new Error('usage: measureSplitEntries.mjs <sandbox>/packages/state');
const require = createRequire(join(pkg, 'package.json'));
const { decode } = require('@jridgewell/sourcemap-codec');

const FEATURES = ['temporal', 'scopes', 'recursion', 'ssr', 'devtools', 'formats', 'diagnostics'];
const CORE_DIRS = ['proxy', 'updater', 'bindings', 'apply', 'binding', 'dependency', 'list', 'structural'];
const gzipOf = async (file) => gzipSync(await readFile(file), { level: 9 }).length;

// ---- 1. single-file bundles -------------------------------------------------------------------
await mkdir(join(pkg, 'src/_measure'), { recursive: true });
const compositions = ['core', 'core-all', ...FEATURES.map((f) => `core-${f}`)];
await writeFile(join(pkg, 'src/_measure/core.ts'), 'export * from "../entries/core";\n');
await writeFile(join(pkg, 'src/_measure/core-all.ts'),
  'export * from "../entries/core";\n' + FEATURES.map((f, i) => `export { default as f${i} } from "../features/${f}";`).join('\n') + '\n');
for (const feature of FEATURES) {
  await writeFile(join(pkg, `src/_measure/core-${feature}.ts`),
    `export * from "../entries/core";\nexport { default as feature } from "../features/${feature}";\n`);
}
await writeFile(join(pkg, 'rollup.measure.config.js'), `import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
export default ${JSON.stringify(compositions)}.map((name) => ({
  input: 'src/_measure/' + name + '.ts',
  output: { file: 'dist-measure/' + name + '.js', format: 'esm', sourcemap: true },
  plugins: [json(), typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false }), terser()],
}));
`);
execFileSync('npx', ['rollup', '-c', 'rollup.measure.config.js'], { cwd: pkg, stdio: 'ignore', shell: true });
const single = {};
for (const name of compositions) {
  const file = join(pkg, 'dist-measure', `${name}.js`);
  single[name] = { bytes: (await stat(file)).size, gzip: await gzipOf(file) };
}
for (const feature of FEATURES) {
  single[`core-${feature}`].gzipOverCore = single[`core-${feature}`].gzip - single.core.gzip;
}

// ---- 3. attribution of the core bundle (uses the source map written above) ---------------------
const coreJs = await readFile(join(pkg, 'dist-measure/core.js'), 'utf8');
const coreMap = JSON.parse(await readFile(join(pkg, 'dist-measure/core.js.map'), 'utf8'));
const lines = coreJs.split('\n');
const byModule = {};
decode(coreMap.mappings).forEach((segments, line) => segments.forEach((segment, i) => {
  if (segment.length < 4) return;
  const source = coreMap.sources[segment[1]].replaceAll('\\', '/');
  const id = source.includes('/src/') ? source.split('/src/').at(-1) : source;
  byModule[id] = (byModule[id] ?? 0) + Buffer.byteLength(lines[line].slice(segment[0], segments[i + 1]?.[0] ?? lines[line].length));
}));
const byGroup = {};
for (const [id, n] of Object.entries(byModule)) {
  const group = id.includes('/') ? id.split('/')[0] : '(root)';
  byGroup[group] = (byGroup[group] ?? 0) + n;
}
const sortDesc = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));

// ---- 2. the multi-entry build -----------------------------------------------------------------
// The sandbox carries a prototype config; the ported package builds dist/split from its own
// rollup.config.js, so there the split output is already there after `npm run build`.
try {
  await stat(join(pkg, 'rollup.split.config.js'));
  execFileSync('npx', ['rollup', '-c', 'rollup.split.config.js'], { cwd: pkg, stdio: 'ignore', shell: true });
} catch {
  await stat(join(pkg, 'dist/split/core.js'));
}
// the sandbox writes dist-split/, the ported package builds dist/split/
const splitDir = await stat(join(pkg, 'dist-split')).then(() => join(pkg, 'dist-split'), () => join(pkg, 'dist/split'));
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}
const outputs = (await walk(splitDir)).filter((f) => f.endsWith('.js'));
const files = {};
const carriesCore = {};
for (const file of outputs) {
  const map = JSON.parse(await readFile(`${file}.map`, 'utf8'));
  const groups = {};
  for (const source of map.sources) {
    const id = source.replaceAll('\\', '/').replace(/^.*\/src\//, '');
    const group = id.includes('/') ? id.split('/')[0] : '(root)';
    groups[group] = (groups[group] ?? 0) + 1;
  }
  const name = relative(splitDir, file).replaceAll('\\', '/');
  files[name] = { bytes: (await stat(file)).size, gzip: await gzipOf(file), sourceGroups: sortDesc(groups) };
  if (name.startsWith('features/')) {
    const core = Object.keys(groups).filter((g) => CORE_DIRS.includes(g));
    if (core.length > 0) carriesCore[name] = core;
  }
}
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
const coreClosure = await closure(join(splitDir, 'core.js'));
const download = {};
const sum = async (list) => ({ files: list.length, bytes: (await Promise.all(list.map(async (f) => (await stat(f)).size))).reduce((a, b) => a + b, 0),
  gzip: (await Promise.all(list.map(gzipOf))).reduce((a, b) => a + b, 0) });
download.core = await sum(coreClosure);
let all = [...coreClosure];
for (const feature of FEATURES) {
  const list = [...new Set([...coreClosure, ...(await closure(join(splitDir, 'features', `${feature}.js`)))])];
  download[`core+${feature}`] = await sum(list);
  all = [...new Set([...all, ...list])];
}
download['core+all'] = await sum(all);

// ---- write the artefact and clean the temporary entries ---------------------------------------
await rm(join(pkg, 'src/_measure'), { recursive: true, force: true });
await rm(join(pkg, 'rollup.measure.config.js'), { force: true });
await rm(join(pkg, 'dist-measure'), { recursive: true, force: true });
const out = {
  timestamp: new Date().toISOString(),
  pkg: pkg.replaceAll('\\', '/'),
  note: 'Single-file bundles are one gzip -9 stream each (comparable with the shipped auto.min.js); dist-split files are gzipped one by one, as a CDN serves them. byModule/byGroup are minified bytes of the core bundle attributed through its source map.',
  singleFile: single,
  splitFiles: files,
  splitDownload: download,
  featureEntriesCarryingCoreModules: carriesCore,
  coreBundleByGroup: sortDesc(byGroup),
  coreBundleByModule: Object.fromEntries(Object.entries(sortDesc(byModule)).slice(0, 30)),
};
const outFile = join(root, 'docs/research/state-next/split-entry-sizes.json');
await writeFile(outFile, JSON.stringify(out, null, 2) + '\n');
console.log(`core ${single.core.gzip} gzip; core+all ${single['core-all'].gzip}; split core download ${download.core.gzip} in ${download.core.files} files`);
console.log(`feature entries carrying core modules: ${Object.keys(carriesCore).length === 0 ? 'none' : JSON.stringify(carriesCore)}`);
console.log(`wrote ${relative(root, outFile)}`);
