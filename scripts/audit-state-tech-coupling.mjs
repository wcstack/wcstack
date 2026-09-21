// Static import graph of packages/state: what a helper-only import drags in, which modules run
// code when they are evaluated, and which edges tie the core to optional features. By default
// the package is compiled with tsc into an OS temporary directory and the emitted JavaScript is
// analysed, so imports that only carry types (the repository does not set verbatimModuleSyntax)
// are not counted as value edges; `--source` analyses the TypeScript source instead, which
// over-counts those edges. Nothing under the repository is written except the JSON report.
// `--check` is the CI gate (docs/state-next-major-wiring-design.md §7-1): it writes no report
// and exits 1 when a module outside the baseline runs code at evaluation, when the number of
// value edges from the core into features exceeds the baseline, or when a pinned entry reaches
// more modules than allowed. The baseline is scripts/state-coupling-baseline.json (or
// `--baseline <file>`); the check also says when the baseline can be tightened.
// Run from the repository root:
//   node scripts/audit-state-tech-coupling.mjs [--source] [--check] [--baseline <file>]
import { readFile, writeFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
// --pkg <dir>: analyse a sandbox copy of packages/state instead (prototype measurements); the report
// is then written as coupling-proto.json and never used by --check
const pkgArg = process.argv.includes('--pkg') ? resolve(process.argv[process.argv.indexOf('--pkg') + 1]) : null;
const pkg = pkgArg ?? join(root, 'packages/state');
const require = createRequire(join(pkg, 'package.json'));
const ts = require('typescript');
const output = join(root, 'docs/research/state-next');
await mkdir(output, { recursive: true });
const fromSource = process.argv.includes('--source');
const check = process.argv.includes('--check');
const baselineFile = process.argv.includes('--baseline') ? resolve(process.argv[process.argv.indexOf('--baseline') + 1]) : join(root, 'scripts/state-coupling-baseline.json');
let src = join(pkg, 'src');
if (!fromSource) {
  const temp = await mkdtemp(join(tmpdir(), 'wcstack-state-coupling-'));
  // rootDir is the package directory, so the emitted tree is <temp>/src/**.js. Source maps are
  // off (inlineSources is switched off with them, or tsc reports TS5051 and exits non-zero).
  try {
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(pkg, 'tsconfig.json'), '--outDir', temp,
      '--declaration', 'false', '--declarationMap', 'false', '--sourceMap', 'false', '--inlineSources', 'false', '--noEmitOnError', 'false'], { stdio: 'ignore' });
  } catch (e) {
    // Type errors do not stop the emit (noEmitOnError=false); only a missing tree is fatal.
    await readdir(join(temp, 'src')).catch(() => { throw e; });
  }
  src = join(temp, 'src');
}
const ext = fromSource ? '.ts' : '.js';

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.name.endsWith(ext) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}
const files = new Set((await walk(src)).sort());
const id = f => relative(src, f).split(sep).join('/').replace(/\.js$/, '.ts');
const groupOf = m => m.includes('/') ? m.split('/')[0] : '(root)';
const modules = new Map();
const unresolved = [];
function resolveImport(from, spec) {
  const base = resolve(dirname(from), spec.replace(/\.js$/, ''));
  for (const candidate of [`${base}${ext}`, join(base, `index${ext}`)]) if (files.has(candidate)) return id(candidate);
  unresolved.push({ from: id(from), spec });
  return null;
}
const PURE_INITIALIZER = /^(new (Map|Set|WeakMap|WeakSet|WeakRef|FinalizationRegistry|Array|Object|RegExp)\b|Symbol(\.for)?\(|Object\.(freeze|create|assign|fromEntries)\(|createEmpty)/;
const snippet = (node, sf) => node.getText(sf).replace(/\s+/g, ' ').slice(0, 160);
const lineOf = (node, sf) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true);
  // Lines and evaluation-time statements are always taken from the TypeScript source, so the
  // reported line numbers point at the file a reader opens; imports come from the analysed tree.
  const sourcePath = fromSource ? file : join(pkg, 'src', id(file));
  const sourceText = fromSource ? text : await readFile(sourcePath, 'utf8');
  const source = fromSource ? sf : ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.ESNext, true);
  const m = { id: id(file), group: groupOf(id(file)), loc: sourceText.split('\n').length,
    imports: new Set(), typeOnly: new Set(), external: [], evaluation: [] };
  for (const st of source.statements) {
    if (ts.isExpressionStatement(st)) {
      m.evaluation.push({ kind: 'statement', line: lineOf(st, source), text: snippet(st, source) });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!d.initializer || !(ts.isCallExpression(d.initializer) || ts.isNewExpression(d.initializer))) continue;
        const init = d.initializer.getText(source).replace(/\s+/g, ' ');
        // a `/*#__PURE__*/` annotation is the author's statement that the initializer is a pure
        // allocation a bundler may drop; getFullText includes the leading comment, getText does not
        const annotatedPure = /\/\*\s*#__PURE__\s*\*\//.test(d.initializer.getFullText(source));
        m.evaluation.push({ kind: annotatedPure || PURE_INITIALIZER.test(init) ? 'allocation' : 'call-initializer', line: lineOf(d, source), text: snippet(d, source) });
      }
    }
  }
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) || (ts.isExportDeclaration(st) && st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      if (!spec.startsWith('.')) { m.external.push(spec); continue; }
      let typeOnly = false;
      if (ts.isImportDeclaration(st)) {
        const clause = st.importClause;
        const named = clause?.namedBindings;
        typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!named && ts.isNamedImports(named)
          && named.elements.length > 0 && named.elements.every(e => e.isTypeOnly)));
      } else typeOnly = !!st.isTypeOnly;
      const target = resolveImport(file, spec);
      if (target !== null) (typeOnly ? m.typeOnly : m.imports).add(target);
    }
  }
  modules.set(m.id, m);
}
function reach(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of modules.get(cur).imports) stack.push(next);
  }
  const byGroup = {};
  let loc = 0;
  for (const m of seen) { const mod = modules.get(m); loc += mod.loc; byGroup[mod.group] = (byGroup[mod.group] ?? 0) + mod.loc; }
  const evaluated = [...seen].filter(m => modules.get(m).evaluation.some(e => e.kind !== 'allocation'));
  return { files: seen.size, loc, byGroup: Object.fromEntries(Object.entries(byGroup).sort((a, b) => b[1] - a[1])), evaluatedModules: evaluated.sort() };
}
const entries = ['exports.ts', 'defineState.ts', 'bootstrapState.ts', 'components/State.ts', 'auto.ts', 'parser.ts', 'manifest.ts', 'updater/updater.ts', 'proxy/StateHandler.ts'].filter(e => modules.has(e));
const reachability = Object.fromEntries(entries.map(e => [e, reach(e)]));
// Group-level edges (value imports only).
const groupEdges = {};
const features = ['watch', 'scan', 'stream', 'recursion', 'webComponent', 'dcc', 'devtools', 'components'];
const coreToFeature = [];
for (const m of modules.values()) for (const target of m.imports) {
  const g = modules.get(target).group;
  if (g === m.group) continue;
  (groupEdges[m.group] ??= {})[g] = (groupEdges[m.group][g] ?? 0) + 1;
  if (!features.includes(m.group) && features.includes(g)) coreToFeature.push({ from: m.id, to: target });
}
// Strongly connected components (Tarjan) over value imports.
let index = 0; const stackT = []; const onStack = new Set(); const idx = new Map(); const low = new Map(); const sccs = [];
function strong(v) {
  idx.set(v, index); low.set(v, index); index++; stackT.push(v); onStack.add(v);
  for (const w of modules.get(v).imports) {
    if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
  }
  if (low.get(v) === idx.get(v)) {
    const comp = [];
    let w;
    do { w = stackT.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
    if (comp.length > 1) sccs.push(comp.sort());
  }
}
for (const m of modules.keys()) if (!idx.has(m)) strong(m);
sccs.sort((a, b) => b.length - a.length);
const evaluation = [...modules.values()].filter(m => m.evaluation.some(e => e.kind !== 'allocation'))
  .map(m => ({ module: m.id, group: m.group, effects: m.evaluation.filter(e => e.kind !== 'allocation') }));
const externals = {};
for (const m of modules.values()) for (const e of m.external) (externals[e] ??= []).push(m.id);
const totalLoc = [...modules.values()].reduce((a, m) => a + m.loc, 0);
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  timestamp: new Date().toISOString(), typescript: ts.version,
  analysis: fromSource ? 'typescript-source (type-only imports without the type keyword count as value edges)' : 'tsc-emitted-js (type-only imports elided)',
  modules: modules.size, loc: totalLoc,
  groups: Object.fromEntries([...[...modules.values()].reduce((acc, m) => acc.set(m.group, (acc.get(m.group) ?? 0) + m.loc), new Map())].sort((a, b) => b[1] - a[1])),
  unresolved, externals,
  reachability,
  evaluation,
  coreToFeatureEdges: coreToFeature.sort((a, b) => a.from.localeCompare(b.from)),
  groupEdges,
  cycles: sccs.map(c => ({ size: c.length, groups: [...new Set(c.map(m => modules.get(m).group))].sort(), members: c })),
};
if (!check) await writeFile(join(output, pkgArg !== null ? 'coupling-proto.json' : fromSource ? 'coupling-source.json' : 'coupling.json'), JSON.stringify(report, null, 2) + '\n');
const summary = {
  modules: report.modules, loc: report.loc, unresolved: unresolved.length,
  reachability: Object.fromEntries(Object.entries(reachability).map(([e, r]) => [e, { files: r.files, loc: r.loc, evaluated: r.evaluatedModules.length }])),
  evaluatedModules: evaluation.map(e => `${e.module} [${e.effects.map(x => x.kind === 'statement' ? 'S' : 'C').join('')}]`),
  coreToFeatureEdges: coreToFeature.length,
  cycles: sccs.map(c => `${c.length} modules across ${[...new Set(c.map(m => modules.get(m).group))].length} groups`),
};
console.log(JSON.stringify(summary, null, 2));

if (check) {
  const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
  const failures = [];
  const notes = [];
  const allowed = new Set(baseline.evaluatedModules ?? []);
  for (const e of evaluation) {
    if (allowed.has(e.module)) continue;
    failures.push(`${e.module} runs code at module evaluation and is not in the baseline: ` +
      e.effects.map(x => `line ${x.line}: ${x.text}`).join('; '));
  }
  for (const m of allowed) if (!evaluation.some(e => e.module === m)) notes.push(`${m} no longer runs code at evaluation; remove it from evaluatedModules in the baseline`);
  if (typeof baseline.maxCoreToFeatureEdges === 'number') {
    if (coreToFeature.length > baseline.maxCoreToFeatureEdges) {
      failures.push(`${coreToFeature.length} value edges from the core into features exceed the baseline of ${baseline.maxCoreToFeatureEdges}: ` +
        coreToFeature.map(e => `${e.from} -> ${e.to}`).join(', '));
    } else if (coreToFeature.length < baseline.maxCoreToFeatureEdges) {
      notes.push(`core -> feature edges are ${coreToFeature.length}; maxCoreToFeatureEdges in the baseline can be lowered from ${baseline.maxCoreToFeatureEdges}`);
    }
  }
  for (const [entry, limit] of Object.entries(baseline.reachability ?? {})) {
    const r = reachability[entry];
    if (!r) { failures.push(`entry ${entry} pinned in the baseline does not exist`); continue; }
    if (typeof limit.maxFiles === 'number' && r.files > limit.maxFiles) failures.push(`${entry} reaches ${r.files} modules; the baseline allows ${limit.maxFiles}`);
  }
  for (const n of notes) console.log(`note: ${n}`);
  if (failures.length) {
    console.error(`\n[state coupling] ${failures.length} violation(s) against ${relative(root, baselineFile)}:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`[state coupling] ok: ${evaluation.length} evaluated modules, ${coreToFeature.length} core -> feature edges (baseline ${relative(root, baselineFile)})`);
}
