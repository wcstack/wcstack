// Structure gate for @wcstack/state 4.0: one core, add-ons that carry only their own code, and a
// core that does not reach into the add-ons (requirement B13, wiring design §7-1). It replaces the
// 3.x check-state-split.mjs (source maps) and audit-state-tech-coupling.mjs (tsc emit): the 4.0
// build emits neither, so the gate bundles the sources with esbuild in memory (`write: false`,
// `metafile: true`, about 0.1 s) and reads which module lands in which output and which module
// imports which. esbuild's import records are value edges only: an import used only as a type is
// gone, as in the shipped build. Nothing is written except the baseline on `--update`.
//
// Split build (the entries of build.mjs's split build: core, auto, features/<FEATURES>; module
// placement depends only on the entries and the graph, so minify and mangleProps are left out):
//   S1 A feature entry's own outputs (its import closure minus the core's) carry code from that
//      feature's modules only: no core module (core code the core chunk does not load lives in
//      an add-on's file — the seam leaks) and no other feature's module (a page that installed
//      one add-on would download another).
//   S2 dist/split/auto.js's own outputs carry no add-on code: it loads add-ons by URL.
//   S3 When dist/split exists, it has the same entries as this build (a stale dist, or the gate's
//      entry list drifted from build.mjs).
// Module graph (every shipped entry: exports, auto, core-entry, core, split-auto, features/*,
// public/defineState, public/manifest, public/parser):
//   G1 No feature module imports another feature's module (features/all.ts, the add-on set that
//      `.` and `/auto` install, may import them all).
//   G2 A module outside the add-ons imports an add-on module only through an edge listed in
//      the baseline's `coreToFeature` (today the full entries and the tooling entries).
//   G3 src/core.ts (`/core`), src/core-entry.ts (dist/core.min.js, the 20 KB target) and
//      src/split-auto.ts reach no add-on module.
//   G4 src/public/defineState.ts (`/define`) reaches no other module (requirement N2).
//   G5 Each add-on imports only the core modules the baseline's `featureToCore` lists for it — the
//      surface the add-ons build on. A new edge needs a look and `--update`.
// Evaluation (the TypeScript parser over every module of the graph, no emit):
//   E1 Only the modules in the baseline's `evaluatedModules` run code when they are evaluated (a
//      top-level statement, or a top-level call / `new` initializer that is not a plain allocation
//      or annotated `/*#__PURE__*/`). An add-on must not install itself on import (D15).
//
// S1-S3, G1, G3 and G4 have no baseline: they always hold. `--update` re-records the three lists
// (G2, G5, E1) and refuses while one of the others fails. `--check` is the default and is accepted
// so CI can state its intent. Needs packages/state's node_modules (esbuild, typescript):
//   node scripts/check-state-coupling.mjs [--check] [--update]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = join(root, 'packages/state');
const baselineFile = join(root, 'scripts/state-coupling-baseline.json');
const tag = '[state coupling]';
for (const arg of process.argv.slice(2)) {
  if (!['--check', '--update'].includes(arg)) {
    console.error(`${tag} unknown argument ${arg}; usage: check-state-coupling.mjs [--check] [--update]`);
    process.exit(1);
  }
}
const update = process.argv.includes('--update');
const require = createRequire(join(pkg, 'package.json'));
const { build } = require('esbuild');
const ts = require('typescript');

// The split build's add-ons, from build.mjs itself (importing build.mjs would run the build).
const featuresMatch = /export const FEATURES = (\[[^\]]*\])/.exec(readFileSync(join(pkg, 'build.mjs'), 'utf8'));
if (!featuresMatch) {
  console.error(`${tag} cannot read \`export const FEATURES = [...]\` from packages/state/build.mjs; align this gate with it`);
  process.exit(1);
}
const FEATURES = JSON.parse(featuresMatch[1].replaceAll("'", '"'));

// Source module -> the add-on it belongs to. Everything else under src/ is the core (or an entry).
const FEATURE_DIRS = { temporal: 'temporal', scopes: 'scopes', recursion: 'recursion', ssr: 'ssr', devtools: 'devtools', diagnostics: 'diagnostics', native: 'native-commands' };
const FEATURE_FILES = { 'filters/formats.ts': 'formats' };
const ADDON_SET = 'features/all.ts';
const idOf = (path) => path.replace(/^src\//, '');
function featureOf(path) {
  if (!path.startsWith('src/')) return null;
  const id = idOf(path);
  if (id === ADDON_SET) return '*';
  const entry = /^features\/([\w-]+)\.ts$/.exec(id);
  if (entry) return entry[1];
  return FEATURE_FILES[id] ?? FEATURE_DIRS[id.split('/')[0]] ?? null;
}
const describe = (path) => (featureOf(path) === null ? 'core' : `the "${featureOf(path)}" add-on`);

const options = { absWorkingDir: pkg, bundle: true, format: 'esm', target: 'es2022', write: false, metafile: true, logLevel: 'silent' };
const failures = [];
const notes = [];

// --- the split build ---------------------------------------------------------------------------
const splitEntries = { core: 'src/core.ts', auto: 'src/split-auto.ts', ...Object.fromEntries(FEATURES.map((f) => [`features/${f}`, `src/features/${f}.ts`])) };
const split = (await build({ ...options, entryPoints: splitEntries, outdir: 'dist/split', splitting: true, chunkNames: 'chunks/[name]-[hash]' })).metafile;
const outputByEntry = Object.fromEntries(Object.entries(split.outputs).filter(([, o]) => o.entryPoint).map(([file, o]) => [o.entryPoint, file]));
const outputClosure = (file, seen = new Set()) => {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const i of split.outputs[file].imports) if (i.kind === 'import-statement') outputClosure(i.path, seen);
  return seen;
};
const coreOutputs = outputClosure(outputByEntry['src/core.ts']);
/** the modules that put code into the entry's outputs beyond the core's */
function ownModules(entry) {
  const modules = [];
  for (const file of outputClosure(outputByEntry[entry])) {
    if (coreOutputs.has(file)) continue;
    for (const [path, input] of Object.entries(split.outputs[file].inputs)) if (input.bytesInOutput > 0) modules.push(path);
  }
  return modules;
}
for (const feature of FEATURES) {
  const foreign = ownModules(`src/features/${feature}.ts`).filter((path) => featureOf(path) !== feature);
  for (const path of foreign) {
    failures.push(featureOf(path) === null
      ? `S1 features/${feature}.js carries the core module ${path}, which the core does not load: move it under the add-on, or into the core's own import graph`
      : `S1 features/${feature}.js carries ${describe(path)}'s ${path}: route the call through a hooks.ts slot`);
  }
}
for (const path of ownModules('src/split-auto.ts').filter((p) => featureOf(p) !== null)) {
  failures.push(`S2 split/auto.js carries ${describe(path)}'s ${path}; it must load add-ons through ./features/ by URL`);
}
const distSplit = join(pkg, 'dist/split');
if (existsSync(distSplit)) {
  const shipped = readdirSync(distSplit, { recursive: true }).map((f) => String(f).replaceAll('\\', '/'))
    .filter((f) => f.endsWith('.js') && !f.startsWith('chunks/')).map((f) => f.replace(/\.js$/, '')).sort();
  const built = Object.keys(splitEntries).sort();
  if (shipped.join() !== built.join()) {
    failures.push(`S3 dist/split has the entries ${shipped.join(', ')} but this gate builds ${built.join(', ')}: rebuild (npm run build in packages/state), or align the gate with build.mjs`);
  }
} else {
  notes.push('dist/split is missing; S3 (entries against build.mjs) was skipped');
}

// --- the module graph --------------------------------------------------------------------------
const graphEntries = ['src/exports.ts', 'src/auto.ts', 'src/core-entry.ts', 'src/core.ts', 'src/split-auto.ts', ...FEATURES.map((f) => `src/features/${f}.ts`),
  'src/public/defineState.ts', 'src/public/manifest.ts', 'src/public/parser.ts'];
const graph = (await build({ ...options, entryPoints: graphEntries, outdir: 'graph' })).metafile.inputs;
const importsOf = (path) => graph[path].imports.filter((i) => i.kind === 'import-statement' && graph[i.path]).map((i) => i.path);
const reach = (path, seen = new Set()) => {
  if (seen.has(path)) return seen;
  seen.add(path);
  for (const next of importsOf(path)) reach(next, seen);
  return seen;
};
const sources = Object.keys(graph).filter((p) => p.startsWith('src/')).sort();
const coreToFeature = [];
const featureToCore = {};
for (const from of sources) {
  const fromFeature = featureOf(from);
  for (const to of importsOf(from)) {
    const toFeature = featureOf(to);
    if (fromFeature === null && toFeature !== null) coreToFeature.push(`${idOf(from)} -> ${idOf(to)}`);
    else if (fromFeature !== null && fromFeature !== '*' && toFeature !== null && toFeature !== fromFeature) {
      failures.push(`G1 ${idOf(from)} (the "${fromFeature}" add-on) imports ${idOf(to)} (${toFeature === '*' ? 'the add-on set' : `the "${toFeature}" add-on`}); route the call through a hooks.ts slot`);
    } else if (fromFeature !== null && fromFeature !== '*' && toFeature === null && to.startsWith('src/')) {
      (featureToCore[fromFeature] ??= new Set()).add(idOf(to));
    }
  }
}
for (const entry of ['src/core.ts', 'src/core-entry.ts', 'src/split-auto.ts']) {
  const reached = [...reach(entry)].filter((p) => featureOf(p) !== null);
  if (reached.length > 0) failures.push(`G3 ${idOf(entry)} reaches add-on modules: ${reached.map(idOf).join(', ')}`);
}
{
  const reached = [...reach('src/public/defineState.ts')].filter((p) => p !== 'src/public/defineState.ts');
  if (reached.length > 0) failures.push(`G4 public/defineState.ts (\`/define\`) must import nothing at run time, but reaches ${reached.map(idOf).join(', ')}`);
}

// --- evaluation-time code ----------------------------------------------------------------------
// A plain allocation a bundler may drop; anything else called at the top level runs on import.
const PURE_INITIALIZER = /^(new (Map|Set|WeakMap|WeakSet|WeakRef|FinalizationRegistry|Array|Object|RegExp)\b|Symbol(\.for)?\(|Object\.(freeze|create|assign|fromEntries)\()/;
const DECLARATIONS = new Set([ts.SyntaxKind.ImportDeclaration, ts.SyntaxKind.ExportDeclaration, ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration, ts.SyntaxKind.TypeAliasDeclaration, ts.SyntaxKind.EnumDeclaration, ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.EmptyStatement, ts.SyntaxKind.VariableStatement, ts.SyntaxKind.ExportAssignment]);
const isCall = (node) => ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node);
const evaluated = {};
for (const path of sources.filter((p) => p.endsWith('.ts'))) {
  const sf = ts.createSourceFile(path, readFileSync(join(pkg, path), 'utf8'), ts.ScriptTarget.ESNext, true);
  const effects = [];
  const at = (node) => `line ${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${node.getText(sf).replace(/\s+/g, ' ').slice(0, 100)}`;
  for (const st of sf.statements) {
    if (!DECLARATIONS.has(st.kind)) effects.push(at(st));
    else if (ts.isExportAssignment(st) && isCall(st.expression)) effects.push(at(st));
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!d.initializer || !isCall(d.initializer)) continue;
        // getFullText includes the leading `/*#__PURE__*/`, getText does not
        if (/\/\*\s*[#@]__PURE__\s*\*\//.test(d.initializer.getFullText(sf)) || PURE_INITIALIZER.test(d.initializer.getText(sf))) continue;
        effects.push(at(d));
      }
    }
  }
  if (effects.length > 0) evaluated[idOf(path)] = effects;
}

// --- baseline ----------------------------------------------------------------------------------
const current = {
  coreToFeature: coreToFeature.sort(),
  featureToCore: Object.fromEntries(Object.keys(featureToCore).sort().map((f) => [f, [...featureToCore[f]].sort()])),
  evaluatedModules: Object.keys(evaluated).sort(),
};
const BASELINE_COMMENT = 'Baseline for `node scripts/check-state-coupling.mjs --check` (CI gate for @wcstack/state 4.0; the rules are in the script header). coreToFeature: the only imports from a module outside the add-ons into an add-on module (G2). featureToCore: the core modules each add-on may import (G5). evaluatedModules: the only modules that may run code when evaluated (E1). Re-record with --update after a deliberate change; the rules without a baseline (S1-S3, G1, G3, G4) always hold.';

const hardFailures = failures.length;
if (update) {
  if (hardFailures > 0) {
    console.error(`${tag} ${hardFailures} violation(s) of a rule without a baseline:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(`${tag} refusing to re-record the baseline; fix the import first`);
    process.exit(1);
  }
  writeFileSync(baselineFile, JSON.stringify({ $comment: BASELINE_COMMENT, ...current }, null, 2) + '\n');
  console.log(`${tag} baseline updated: ${current.coreToFeature.length} core -> add-on edges, ${Object.values(current.featureToCore).flat().length} add-on -> core edges, ${current.evaluatedModules.length} evaluated modules`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
const allowedEdges = new Set(baseline.coreToFeature ?? []);
for (const edge of current.coreToFeature) if (!allowedEdges.has(edge)) failures.push(`G2 ${edge}: a module outside the add-ons imports an add-on module, and the edge is not in the baseline`);
for (const edge of allowedEdges) if (!current.coreToFeature.includes(edge)) notes.push(`${edge} is gone; drop it from coreToFeature with --update`);
for (const [feature, modules] of Object.entries(current.featureToCore)) {
  const allowed = new Set(baseline.featureToCore?.[feature] ?? []);
  for (const m of modules) if (!allowed.has(m)) failures.push(`G5 the "${feature}" add-on now imports the core's ${m}, which the baseline does not list for it`);
  for (const m of allowed) if (!modules.includes(m)) notes.push(`the "${feature}" add-on no longer imports ${m}; tighten featureToCore with --update`);
}
const allowedEvaluated = new Set(baseline.evaluatedModules ?? []);
for (const [module, effects] of Object.entries(evaluated)) {
  if (!allowedEvaluated.has(module)) failures.push(`E1 ${module} runs code when it is evaluated and is not in the baseline: ${effects.join('; ')}`);
}
for (const m of allowedEvaluated) if (!evaluated[m]) notes.push(`${m} no longer runs code when evaluated; drop it from evaluatedModules with --update`);

for (const n of notes) console.log(`${tag} note: ${n}`);
if (failures.length > 0) {
  console.error(`${tag} ${failures.length} violation(s) (rules in the script header; baseline ${relative(root, baselineFile).replaceAll('\\', '/')}):`);
  for (const f of failures) console.error(`  - ${f}`);
  if (failures.length > hardFailures) console.error(`${tag} if a G2 / G5 / E1 change is intended, record it with: node scripts/check-state-coupling.mjs --update`);
  process.exit(1);
}
console.log(`${tag} ok: ${FEATURES.length} add-ons carry only their own code beyond one core chunk; ${current.coreToFeature.length} core -> add-on edges, ${Object.values(current.featureToCore).flat().length} add-on -> core edges and ${current.evaluatedModules.length} evaluated modules, as in the baseline`);
