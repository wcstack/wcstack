// Per-operation counters and phase timings inside the real @wcstack/state runtime, to split
// the gap between the mechanism model (graph-mechanisms.json) and the browser measurement
// (selection-and-profiles.json). The named entry is rebuilt into an OS temporary directory
// with a Rollup transform that wraps a handful of runtime functions in counters; the
// repository source and dist are untouched. The benchmark fixture then runs against that
// build and each operation reports its counter deltas. Run from the repository root after
// `npm ci` in e2e/ and packages/state/, with no other performance driver running:
//   node scripts/audit-state-tech-counters.mjs            # stage 1: expansion / addresses / reads / apply
//   node scripts/audit-state-tech-counters.mjs --list     # stage 2: inside the list apply and the write path
//   node scripts/audit-state-tech-counters.mjs --content  # stage 3: inside row content creation
//   --trace           also record a CDP trace around create / append / clear (scripts/research/cdpTrace.mjs)
//   --pkg <dir>       build from that package directory instead of packages/state (a prototype sandbox)
//   --fixture <name>  manual (checked in) | tracked | keyed | keyedId — the last two need the $eq prototype;
//                     stage 1 without --fixture runs manual and tracked as before
//   Output: runtime-counters[-list|-content][-trace][-<fixture>][-proto].json
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { startTrace, stopTrace, summarize } from './research/cdpTrace.mjs';

const root = resolve(import.meta.dirname, '..');
const arg = (name, dflt) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt;
const pkg = resolve(arg('--pkg', join(root, 'packages/state')));
const isProto = pkg !== join(root, 'packages/state');
const requirePkg = createRequire(join(pkg, 'package.json'));
const requireE2e = createRequire(join(root, 'e2e/package.json'));
const { rollup } = requirePkg('rollup');
const { chromium } = requireE2e('@playwright/test');
const outDir = join(root, 'docs/research/state-next');
await mkdir(outDir, { recursive: true });
const mode = process.argv.includes('--content') ? 'content' : process.argv.includes('--list') ? 'list' : 'expansion';
const trace = process.argv.includes('--trace');
const fixtureArg = arg('--fixture', null);
const TRACED_OPS = new Set(['create1k', 'clear1k', 'create10k', 'append1k', 'clear']);

// --- instrumentation -------------------------------------------------------------------
const COUNTERS = ['walk', 'walkMs', 'enqueue', 'read', 'readMs', 'eval', 'stateAddr', 'absAddr', 'treePath', 'resolved', 'peek',
  'applyFrom', 'applyFromMs', 'apply', 'applyProp', 'drain', 'drainMs',
  'listDiff', 'listDiffMs', 'listIndex', 'listIndexMs', 'retire', 'revive', 'content', 'contentMs', 'activate', 'activateMs', 'deactivate', 'rowInit', 'rowInitMs',
  'pooledGet', 'pooledSet', 'applyFor', 'applyForMs', 'sessionActivate', 'sessionDispose', 'setTrap', 'setTrapMs', 'getTrap', 'setBy', 'setByMs',
  'planContent', 'planContentMs', 'clone', 'cloneMs', 'nodePath', 'nodePathMs', 'markNode', 'resolveInit', 'rowBindings', 'rowBindingsMs',
  'activatePlan', 'activatePlanMs', 'attachEvent', 'attachEventMs', 'setContentByNode', 'applyMs'];
const PRELUDE = `const __c = (globalThis.__wcsCounters ??= { ${COUNTERS.map(c => `${c}: 0`).join(', ')} });\nconst __d = {};\n`;
// Declarations are matched at the start of a line so that earlier call sites or comments
// mentioning the same name are never rewritten, and a name that matches more than once is
// refused rather than silently instrumenting the first hit.
function single(code, re, decl) {
  const all = code.match(new RegExp(re.source, 'gm')) ?? [];
  if (all.length !== 1) throw new Error(`instrumentation pattern ${all.length === 0 ? 'not found' : 'ambiguous'}: ${decl}`);
}
function wrapFunction(code, decl, counter, msCounter) {
  const name = decl.match(/function (\w+)\(/)[1];
  const exported = decl.startsWith('export ') ? 'export ' : '';
  const re = new RegExp(`^${exported}function ${name}\\(`, 'm');
  single(code, re, decl);
  const orig = `__orig_${name}`;
  const body = msCounter
    ? `__d.${name} = (__d.${name} ?? 0) + 1; const __t = performance.now(); try { return ${orig}(...a); } finally { if (--__d.${name} === 0) __c.${msCounter} += performance.now() - __t; }`
    : `return ${orig}(...a);`;
  return code.replace(re, `${exported}function ${name}(...a) { __c.${counter}++; ${body} }\nfunction ${orig}(`);
}
function wrapMethod(code, decl, counter, msCounter) {
  const name = decl.match(/(\w+)\(/)[1];
  const re = new RegExp(`^    ${name}\\(([^)]*)\\) \\{`, 'm');
  single(code, re, decl);
  const m = code.match(re);
  const orig = `__orig_${name}`;
  const body = msCounter
    ? `const __t = performance.now(); try { return this.${orig}(...a); } finally { __c.${msCounter} += performance.now() - __t; }`
    : `return this.${orig}(...a);`;
  return code.replace(re, `    ${name}(...a) { __c.${counter}++; ${body} }\n    ${orig}(${m[1]}) {`);
}
// Wrap every occurrence of an exact call expression (a platform call such as importNode).
function wrapCall(code, callText, counter, msCounter) {
  if (!code.includes(callText)) throw new Error(`instrumentation pattern not found: ${callText}`);
  return code.replaceAll(callText, `(() => { __c.${counter}++; const __t = performance.now(); try { return ${callText}; } finally { __c.${msCounter} += performance.now() - __t; } })()`);
}
const INSTRUMENT_EXPANSION = {
  'dependency/walkDependency.ts': c => wrapFunction(c, 'export function walkDependency(', 'walk', 'walkMs'),
  'proxy/methods/getByAddress.ts': c => wrapFunction(wrapFunction(c, 'export function getByAddress(', 'read', 'readMs'), 'function _getByAddress(', 'eval'),
  'apply/applyChangeFromBindings.ts': c => wrapFunction(c, 'export function applyChangeFromBindings(', 'applyFrom', 'applyFromMs'),
  'apply/applyChange.ts': c => wrapFunction(c, 'export function applyChange(', 'apply'),
  'apply/applyChangeToProperty.ts': c => wrapFunction(c, 'export function applyChangeToProperty(', 'applyProp'),
  'address/StateAddress.ts': c => wrapFunction(c, 'export function createStateAddress(', 'stateAddr'),
  'address/AbsoluteStateAddress.ts': c => wrapFunction(c, 'export function createAbsoluteStateAddress(', 'absAddr'),
  'address/TreePath.ts': c => wrapFunction(c, 'export function getTreePath(', 'treePath'),
  'address/ResolvedAddress.ts': c => wrapFunction(c, 'export function getResolvedAddress(', 'resolved'),
  'binding/getBindingSetByAbsoluteStateAddress.ts': c => wrapFunction(wrapFunction(c, 'export function peekBindingsByAbsoluteStateAddress(', 'peek'), 'export function peekBindingsForAddress(', 'peek'),
  'updater/updater.ts': c => wrapMethod(wrapMethod(c, 'enqueueAbsoluteAddress(', 'enqueue'), '_applyChange(', 'drain', 'drainMs'),
};
// Inside the list apply (diff, list indexes, row contents, session rows, pool) and the
// synchronous write path (set trap → setByAddress → walk). The get trap is counted only.
const INSTRUMENT_LIST = {
  'dependency/walkDependency.ts': c => wrapFunction(c, 'export function walkDependency(', 'walk', 'walkMs'),
  'updater/updater.ts': c => wrapMethod(wrapMethod(c, 'enqueueAbsoluteAddress(', 'enqueue'), '_applyChange(', 'drain', 'drainMs'),
  'apply/applyChangeFromBindings.ts': c => wrapFunction(c, 'export function applyChangeFromBindings(', 'applyFrom', 'applyFromMs'),
  'apply/applyChangeToFor.ts': c => wrapFunction(wrapFunction(wrapFunction(c, 'export function applyChangeToFor(', 'applyFor', 'applyForMs'),
    'function getPooledContents(', 'pooledGet'), 'function setPooledContent(', 'pooledSet'),
  'list/createListDiff.ts': c => wrapFunction(c, 'export function createListDiff(', 'listDiff', 'listDiffMs'),
  'list/createListIndex.ts': c => wrapFunction(c, 'export function createListIndex(', 'listIndex'),
  'list/listIndexesByList.ts': c => wrapFunction(wrapFunction(c, 'export function retireListIndexes(', 'retire'), 'export function reviveListIndexes(', 'revive'),
  'structural/createContent.ts': c => wrapFunction(c, 'export function createContent(', 'content', 'contentMs'),
  'structural/activateContent.ts': c => wrapFunction(wrapFunction(c, 'export function activateContent(', 'activate'), 'export function deactivateContent(', 'deactivate'),
  'bindings/BindingSession.ts': c => wrapMethod(wrapMethod(wrapMethod(c, 'initializeRow(', 'rowInit', 'rowInitMs'), 'activate(', 'sessionActivate'), 'dispose(', 'sessionDispose'),
  'proxy/traps/set.ts': c => wrapFunction(c, 'export function set(', 'setTrap', 'setTrapMs'),
  'proxy/traps/get.ts': c => wrapFunction(c, 'export function get(', 'getTrap'),
  'proxy/methods/setByAddress.ts': c => wrapFunction(c, 'export function setByAddress(', 'setBy', 'setByMs'),
};
// Inside row content creation on the row-plan path: template clone (importNode), node-path
// resolution, ledger marks, row bindings and records, event attachment, activation, list index.
const INSTRUMENT_CONTENT = {
  'updater/updater.ts': c => wrapMethod(c, '_applyChange(', 'drain', 'drainMs'),
  'apply/applyChangeToFor.ts': c => wrapFunction(c, 'export function applyChangeToFor(', 'applyFor', 'applyForMs'),
  'structural/createContent.ts': c => wrapCall(wrapFunction(wrapFunction(c, 'export function createContent(', 'content', 'contentMs'),
    'function createPlanContent(', 'planContent', 'planContentMs'), 'document.importNode(fragmentInfo.fragment, true)', 'clone', 'cloneMs'),
  'structural/resolveNodePath.ts': c => wrapFunction(c, 'export function resolveNodePath(', 'nodePath', 'nodePathMs'),
  'bindings/collectNodesAndBindingInfos.ts': c => wrapFunction(c, 'export function markNodeRegistered(', 'markNode'),
  'bindings/initializeBindingPromiseByNode.ts': c => wrapFunction(c, 'export function resolveInitializedBinding(', 'resolveInit'),
  'bindings/initializeBindings.ts': c => wrapFunction(c, 'export function initializeRowBindings(', 'rowBindings', 'rowBindingsMs'),
  'bindings/BindingSession.ts': c => wrapMethod(wrapMethod(c, 'initializeRow(', 'rowInit', 'rowInitMs'), 'activatePlanRows(', 'activatePlan', 'activatePlanMs'),
  'event/handler.ts': c => wrapFunction(c, 'export function attachEventHandler(', 'attachEvent', 'attachEventMs'),
  'structural/contentsByNode.ts': c => wrapFunction(c, 'export function setContentByNode(', 'setContentByNode'),
  'structural/activateContent.ts': c => wrapFunction(c, 'export function activateContent(', 'activate', 'activateMs'),
  'list/createListIndex.ts': c => wrapFunction(c, 'export function createListIndex(', 'listIndex', 'listIndexMs'),
  // the initial apply of each binding inside activation (state read + DOM write), so that
  // activateMs splits into plan-row registration, initial apply and the rest
  'apply/applyChange.ts': c => wrapFunction(c, 'export function applyChange(', 'apply', 'applyMs'),
  'proxy/methods/getByAddress.ts': c => wrapFunction(c, 'export function getByAddress(', 'read', 'readMs'),
};
const INSTRUMENT = { expansion: INSTRUMENT_EXPANSION, list: INSTRUMENT_LIST, content: INSTRUMENT_CONTENT }[mode];
const instrumented = new Set();
const plugin = {
  name: 'wcs-counters',
  transform(code, id) {
    const rel = id.replaceAll('\\', '/').split('/src/')[1];
    const fn = rel && INSTRUMENT[rel];
    if (!fn) return null;
    instrumented.add(rel);
    return { code: PRELUDE + fn(code), map: null };
  },
};
// --- build --------------------------------------------------------------------------------
const temp = await mkdtemp(join(tmpdir(), 'wcstack-state-counters-'));
process.chdir(pkg);
const configs = (await import(pathToFileURL(join(pkg, 'rollup.config.js')))).default;
const config = configs.find(c => c.output.file.endsWith('index.esm.js'));
const warnings = [];
const bundle = await rollup({ ...config, plugins: [...config.plugins, plugin], onwarn: w => warnings.push(w.code) });
const generated = await bundle.generate({ format: 'esm' });
await bundle.close();
const missing = Object.keys(INSTRUMENT).filter(k => !instrumented.has(k));
if (missing.length) throw new Error(`modules not instrumented: ${missing.join(', ')}`);
const runtime = generated.output.find(o => o.type === 'chunk').code + '\nbootstrapState();\n';
await writeFile(join(temp, 'index.instrumented.js'), runtime);

// --- fixture variants ---------------------------------------------------------------------
const html = await readFile(join(root, 'packages/state/__e2e__/benchmark/index.html'), 'utf8');
const GETTER = 'return this.$1 === this.$untracked(() => this.selectedIndex);';
const ON_SELECT = /onSelect\(e, \$1\) \{[\s\S]*?\n  \},/;
function fixture(variant) {
  let out = html;
  const must = (a, b) => { const next = out.replace(a, b); if (next === out) throw new Error(`fixture anchor missing for ${variant}`); out = next; };
  if (variant === 'manual') return out;
  if (variant === 'tracked') { must(GETTER, 'return this.$1 === this.selectedIndex;'); must(ON_SELECT, 'onSelect(e, $1) { this.selectedIndex = $1; },'); return out; }
  if (variant === 'keyed') { must(GETTER, 'return this.$eq("selectedIndex", this.$1);'); must(ON_SELECT, 'onSelect(e, $1) { this.selectedIndex = $1; },'); return out; }
  if (variant === 'keyedId') {
    must('  selectedIndex: null,', '  selectedIndex: null,\n  selectedId: null,');
    must(GETTER, 'return this.$eq("selectedId", this["data.*.id"]);');
    must(ON_SELECT, 'onSelect(e, $1) { this.selectedId = this["data." + $1 + ".id"]; },');
    return out;
  }
  // keyedIdUntracked: the row id is read without a dependency edge (what a runtime-level
  // `$eq(path, keyPath)` would do internally), so no pattern edge data.*.id → data.*.selected.
  if (variant === 'keyedIdUntracked') {
    must('  selectedIndex: null,', '  selectedIndex: null,\n  selectedId: null,');
    must(GETTER, 'return this.$eq("selectedId", this.$untracked(() => this["data.*.id"]));');
    must(ON_SELECT, 'onSelect(e, $1) { this.selectedId = this["data." + $1 + ".id"]; },');
    return out;
  }
  // round 3 (keyedRound3Patch.mjs): the runtime forms of the two keyed selections
  if (variant === 'keyedIdPath') {
    must('  selectedIndex: null,', '  selectedIndex: null,\n  selectedId: null,');
    must(GETTER, 'return this.$eqPath("selectedId", "data.*.id");');
    must(ON_SELECT, 'onSelect(e, $1) { this.selectedId = this["data." + $1 + ".id"]; },');
    return out;
  }
  if (variant === 'keyedIndex') { must(GETTER, 'return this.$eqIndex("selectedIndex");'); must(ON_SELECT, 'onSelect(e, $1) { this.selectedIndex = $1; },'); return out; }
  throw new Error(`unknown fixture ${variant}`);
}
const variants = fixtureArg ? [fixtureArg] : mode === 'expansion' ? ['manual', 'tracked'] : ['tracked'];

// --- browser ------------------------------------------------------------------------------
const port = 4300;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
const errors = [];
const active = [...new Set(Object.values(INSTRUMENT).join(' ').match(/'(\w+)'(?=[,)])/g).map(s => s.slice(1, -1)))].filter(c => COUNTERS.includes(c));
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  timestamp: new Date().toISOString(), cpu: cpus()[0].model,
  mode: { expansion: 'expansion', list: 'list-apply-and-write-path', content: 'row-content-creation' }[mode], trace, package: pkg, fixtures: variants,
  counters: active, instrumented: [...instrumented].sort(), temporaryBuildDirectory: temp, ops: [], errors,
};
async function measure(page, variant, op, selector, rowCount) {
  const tracing = trace && TRACED_OPS.has(op) ? await startTrace(page) : null;
  const r = await page.evaluate(({ selector, rowCount, active }) => new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    const c = globalThis.__wcsCounters;
    const before = { ...c };
    const timer = setTimeout(() => { mo.disconnect(); reject(new Error('DOM timeout')); }, 30000);
    let start;
    const mo = new MutationObserver(() => {
      if (rowCount !== null && document.querySelectorAll('tbody>tr').length !== rowCount) return;
      mo.disconnect(); clearTimeout(timer);
      const elapsed = performance.now() - start;
      performance.mark('wcs-op-end');
      const delta = {};
      for (const k of active) delta[k] = Math.round((c[k] - before[k]) * 1000) / 1000;
      resolve({ elapsed: Math.round(elapsed * 100) / 100, delta });
    });
    mo.observe(document.querySelector('tbody'), { childList: true, subtree: true, attributes: true, characterData: true });
    performance.mark('wcs-op-start');
    start = performance.now();
    element.click();
  }), { selector, rowCount, active });
  const record = { variant, op, rows: rowCount, ...r };
  if (tracing) record.trace = summarize(await stopTrace(tracing));
  report.ops.push(record);
  console.log(JSON.stringify(trace ? { variant, op, elapsed: r.elapsed, trace: record.trace } : record));
  return record;
}
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 75) throw new Error('Server did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  for (const variant of variants) {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(`${variant}: ${e.message}`));
    await page.route('**/benchmark/index.html', route => route.fulfill({ contentType: 'text/html', body: fixture(variant) }));
    await page.route('**/dist/auto.min.js', route => route.fulfill({ contentType: 'text/javascript', body: runtime }));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!globalThis.__wcsCounters);
    const select = async (rows, n) => {
      for (let i = 0; i < n; i++) {
        const row = i % 2 ? 10 : 5;
        await measure(page, variant, i < 2 ? `select-warm-${rows}` : `select-${rows}`, `tbody>tr:nth-of-type(${row})>td:nth-of-type(2)>a`, null);
        const ok = await page.evaluate(row => document.querySelectorAll('tbody>tr.danger').length === 1 &&
          document.querySelector(`tbody>tr:nth-of-type(${row})`).classList.contains('danger'), row);
        if (!ok) throw new Error(`selection check failed (${variant})`);
        if (i < 2) report.ops.pop();
      }
    };
    if (mode === 'content') {
      // Row creation only, several samples each so medians can be taken: create/clear 1k ×5,
      // then 10k, append, clear ×3.
      for (let i = 0; i < 5; i++) { await measure(page, variant, 'create1k', '#run', 1000); await measure(page, variant, 'clear1k', '#clear', 0); }
      for (let i = 0; i < 3; i++) {
        await measure(page, variant, 'create10k', '#runlots', 10000);
        await measure(page, variant, 'append1k', '#add', 11000);
        await measure(page, variant, 'clear', '#clear', 0);
      }
    } else {
      await measure(page, variant, 'create1k', '#run', 1000);
      await select(1000, 5);
      await measure(page, variant, 'clear1k', '#clear', 0);
      await measure(page, variant, 'create10k', '#runlots', 10000);
      await select(10000, 5);
      if (variant !== 'manual') {
        await measure(page, variant, 'update-every-10th', '#update', null);
        await measure(page, variant, 'append1k', '#add', 11000);
        await measure(page, variant, 'swap', '#swaprows', null);
        await measure(page, variant, 'remove-row1', 'tbody>tr:nth-of-type(1)>td:nth-of-type(3)>a', 10999);
        await measure(page, variant, 'clear', '#clear', 0);
      }
    }
    await page.close();
  }
  const base = { expansion: 'runtime-counters', list: 'runtime-counters-list', content: 'runtime-counters-content' }[mode];
  const name = `${base}${trace ? '-trace' : ''}${fixtureArg ? `-${fixtureArg}` : ''}${isProto ? '-proto' : ''}.json`;
  await writeFile(join(outDir, name), JSON.stringify(report, null, 2) + '\n');
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
} finally { if (browser) await browser.close(); server.kill(); }
process.exit(0);
