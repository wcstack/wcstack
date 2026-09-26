// Cold page versus warm page for the audit's headline list operations, with the benchmark's
// own timing method (jsfb-verify's timedClick: click → MutationObserver condition). The
// benchmark reloads the page before every sample; the counter harness keeps one page and runs
// operations back to back. Bundle, fixture variant, preceding operation sequence, timing
// method, setup style and a forced GC can be swapped so that JIT / GC / pool / rendering state,
// bundle shape and harness details are separated from the runtime itself. Run from the
// repository root after `npm ci` in e2e/, with no other performance driver running:
//   node scripts/audit-state-tech-warmth.mjs [--bundle auto|index|<file>] [--fixture manual|tracked]
//        [--sequence plain|counters] [--method jsfb|counters|task] [--setup input|sync] [--gc-before] [--ops a,b]
//        [--raw] [--suffix name]
//   --bundle index      serve the checked-in unminified dist/index.esm.js + bootstrapState()
//   --bundle <file>     serve that file as the runtime (e.g. a counter-instrumented temporary build)
//   --fixture tracked   the audit's "ordinary tracked getter" variant of the fixture (the counter
//                       harness's default) instead of the checked-in manual two-row notification
//   --sequence counters before the timed clear, reproduce the counter harness's preceding
//                       operations on the same page (create 1k → clear → create 10k → append 1k)
//   --method counters   the counter harness's observer (tbody, no early check); task = next macrotask
//   --setup sync        perform setup steps the way the counter harness does: a synthetic click inside
//                       page.evaluate, waiting on a MutationObserver, with no rendering frame in
//                       between (default input: Playwright page.click + rAF-polled waitForFunction)
//   --gc-before         force a full GC (CDP HeapProfiler.collectGarbage) right before each timed click
//   --ops clear10k      restrict to some of create1k, create10k, append1k, clear10k (create10k is not in
//                       the default set; requirements D14 / A3 measure it cold)
//   --raw               serve the --bundle file as is, without appending bootstrapState() — for a
//                       self-contained auto bundle (e.g. a release's dist/auto.min.js)
//   --suffix name       write warm-vs-cold-<tag>-<name>.json, so that a comparison does not overwrite
//                       the committed warm-vs-cold-<tag>.json artefacts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { cpus } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'e2e/package.json'));
const { chromium } = require('@playwright/test');
const outDir = join(root, 'docs/research/state-next');
await mkdir(outDir, { recursive: true });
const N = 6;
const port = 4301;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
const arg = (name, dflt) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt;
const bundle = arg('--bundle', 'auto');
const fixture = arg('--fixture', 'manual');
const sequence = arg('--sequence', 'plain');
const method = arg('--method', 'jsfb');
const setupStyle = arg('--setup', 'input');
const gcBefore = process.argv.includes('--gc-before');
const ops = arg('--ops', 'create1k,append1k,clear10k').split(',');
const raw = process.argv.includes('--raw');
const suffix = arg('--suffix', null);
const runtime = bundle === 'auto' ? null
  : bundle === 'index' ? (await readFile(join(root, 'packages/state/dist/index.esm.js'), 'utf8')) + '\nbootstrapState();\n'
  : await readFile(bundle, 'utf8').then(s => raw || s.includes('\nbootstrapState();') ? s : s + '\nbootstrapState();\n');
// フィクスチャの getter 本文の目印。**この綴りはフィクスチャ内で 1 度しか現れてはならない**
// （String.replace は先頭 1 件しか置換しない — packages/state/__e2e__/benchmark/index.html の NOTE）
const MARKER = 'this.$untracked(() => this.selectedIndex)';
let html = null;
if (fixture === 'tracked') {
  const original = await readFile(join(root, 'packages/state/__e2e__/benchmark/index.html'), 'utf8');
  html = original.replace(MARKER, 'this.selectedIndex')
    .replace(/onSelect\(e, \$1\) \{[\s\S]*?\n  \},/, 'onSelect(e, $1) { this.selectedIndex = $1; },');
  // 「変わったか」ではなく**意図した場所が変わったか**を見る。短いリテラルの replace は
  // 先頭 1 件しか置換しないので、フィクスチャのコメント等に同じ綴りが混ざると getter が
  // 無傷のまま素通りし、tracked が manual と同一物になる（サイクル 5 指摘 3）
  if (html === original || html.includes(MARKER)) {
    throw new Error('Fixture replacement failed: the getter still reads the marker literal');
  }
}
const bundleLabel = bundle === 'auto' ? 'dist/auto.min.js (checked in)' : bundle === 'index' ? 'dist/index.esm.js + bootstrapState() (checked in, unminified)' : basename(bundle);
const tag = [bundle === 'auto' ? 'auto' : bundle === 'index' ? 'index' : 'file', fixture, sequence, method, ...(setupStyle === 'sync' ? ['sync'] : []), ...(gcBefore ? ['gc'] : [])].join('-');
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
const stats = samples => { const s = [...samples].sort((a, b) => a - b); const m = s.length >> 1;
  return { median: +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2), min: +s[0].toFixed(2), max: +s.at(-1).toFixed(2), samples: samples.map(x => +x.toFixed(2)) }; };
async function open(browser) {
  const page = await browser.newPage();
  if (html !== null) await page.route('**/benchmark/index.html', route => route.fulfill({ contentType: 'text/html', body: html }));
  if (runtime !== null) await page.route('**/dist/auto.min.js', route => route.fulfill({ contentType: 'text/javascript', body: runtime }));
  await page.goto(url, { waitUntil: 'networkidle' });
  return page;
}
async function collectGarbage(page) {
  if (!gcBefore) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.detach();
}
// jsfb (default): e2e/bench/jsfb-verify.mjs timedClick — observer on the table, condition on
// the row count, plus an early check two microtasks after the click. counters: the counter
// harness's observer on tbody with no early check. task: the next macrotask after the click.
async function timedClick(page, selector, rowCount) {
  return page.evaluate(({ selector, rowCount, method }) => new Promise((resolveP, rejectP) => {
    const element = document.querySelector(selector);
    let t0;
    if (method === 'task') {
      t0 = performance.now();
      element.click();
      setTimeout(() => {
        if (document.querySelectorAll('tbody>tr').length !== rowCount) rejectP(new Error(`row count mismatch after click ${selector}`));
        else resolveP(performance.now() - t0);
      }, 0);
      return;
    }
    const target = method === 'counters' ? document.querySelector('tbody') : (document.querySelector('table.table') || document.body);
    const to = setTimeout(() => { mo.disconnect(); rejectP(new Error(`timeout after click ${selector}`)); }, 15000);
    const check = () => {
      if (document.querySelectorAll('tbody>tr').length === rowCount) { clearTimeout(to); mo.disconnect(); resolveP(performance.now() - t0); return true; }
      return false;
    };
    const mo = new MutationObserver(check);
    mo.observe(target, { childList: true, subtree: true, characterData: true, attributes: true });
    t0 = performance.now();
    element.click();
    if (method === 'jsfb') queueMicrotask(() => queueMicrotask(check));
  }), { selector, rowCount, method });
}
const rows = n => page => page.waitForFunction(n => document.querySelectorAll('tbody>tr').length === n, n);
// input: a real Playwright click, then a rAF-polled wait (a rendering frame happens in between).
// sync: a synthetic click inside page.evaluate resolved by a MutationObserver (the counter
// harness's way; the next step can start before the browser renders a frame).
const step = setupStyle === 'sync'
  ? (page, selector, n) => page.evaluate(({ selector, n }) => new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(`timeout in setup ${selector}`)), 15000);
      const mo = new MutationObserver(() => { if (document.querySelectorAll('tbody>tr').length === n) { clearTimeout(to); mo.disconnect(); res(); } });
      mo.observe(document.querySelector('tbody'), { childList: true, subtree: true, attributes: true, characterData: true });
      document.querySelector(selector).click();
    }), { selector, n })
  : async (page, selector, n) => { await page.click(selector); await rows(n)(page); };
const OPS = {
  create1k: { setup: async () => {}, selector: '#run', rowCount: 1000, reset: page => step(page, '#clear', 0) },
  create10k: { setup: async () => {}, selector: '#runlots', rowCount: 10000, reset: page => step(page, '#clear', 0) },
  append1k: { setup: page => step(page, '#runlots', 10000), selector: '#add', rowCount: 11000, reset: page => step(page, '#clear', 0) },
  clear10k: sequence === 'counters'
    ? { setup: async page => { await step(page, '#run', 1000); await step(page, '#clear', 0); await step(page, '#runlots', 10000); await step(page, '#add', 11000); },
        selector: '#clear', rowCount: 0, reset: async () => {}, note: 'timed clear of 11,000 rows after create 1k → clear → create 10k → append 1k' }
    : { setup: page => step(page, '#runlots', 10000), selector: '#clear', rowCount: 0, reset: async () => {} },
};
const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), timestamp: new Date().toISOString(),
  cpu: cpus()[0].model, samples: N, bundle: bundleLabel, fixture, sequence, method, setup: setupStyle, gcBefore, results: [] };
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 75) throw new Error('Server did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  for (const [op, spec] of Object.entries(OPS)) {
    if (!ops.includes(op)) continue;
    // cold: a fresh page load before every sample (the benchmark's condition)
    const cold = [];
    for (let i = 0; i < N; i++) {
      const page = await open(browser);
      await spec.setup(page);
      await collectGarbage(page);
      cold.push(await timedClick(page, spec.selector, spec.rowCount));
      await page.close();
    }
    // warm: one page, samples back to back (the counter harness's condition; after the first
    // sample the pool holds up to 1,000 rows and the JIT has seen the code)
    const warm = [];
    const page = await open(browser);
    for (let i = 0; i < N; i++) {
      await spec.setup(page);
      await collectGarbage(page);
      warm.push(await timedClick(page, spec.selector, spec.rowCount));
      await spec.reset(page);
    }
    await page.close();
    const r = { op, note: spec.note, cold: stats(cold), warm: stats(warm) };
    report.results.push(r);
    console.log(JSON.stringify({ op, tag, cold: r.cold.median, coldRange: [r.cold.min, r.cold.max], warm: r.warm.median, warmRange: [r.warm.min, r.warm.max], warmSamples: r.warm.samples }));
  }
  await writeFile(join(outDir, `warm-vs-cold-${tag}${suffix ? `-${suffix}` : ''}.json`), JSON.stringify(report, null, 2) + '\n');
} finally { if (browser) await browser.close(); server.kill(); }
process.exit(0);
