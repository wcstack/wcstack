// Measures the `$eq(path, key)` keyed-subscription prototype (scripts/research/
// keyedPrototypePatch.mjs applied to a sandbox copy of packages/state, built there) against
// the shipped bundle on the benchmark fixture, with the benchmark's own timing (click →
// MutationObserver). Fixture variants: manual (checked in: $untrackDependency + two row
// writes), tracked (the audit's ordinary tracked getter), keyed ($eq on the row index),
// keyedId ($eq on the row id, so removal does not re-evaluate every row). Selection is
// warm (3 warm-ups, then 10 samples alternating rows 5 and 10, each checked for exactly one
// selected row); removal and swap are 5 samples. Run from the repository root after the
// sandbox build, with no other performance driver running:
//   node scripts/audit-state-tech-keyed.mjs --proto <sandbox>/packages/state/dist/index.esm.js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'e2e/package.json'));
const { chromium } = require('@playwright/test');
const outDir = join(root, 'docs/research/state-next');
await mkdir(outDir, { recursive: true });
const protoPath = process.argv.includes('--proto') ? process.argv[process.argv.indexOf('--proto') + 1] : null;
if (!protoPath) throw new Error('usage: --proto <sandbox>/packages/state/dist/index.esm.js');
const protoRuntime = (await readFile(protoPath, 'utf8')) + '\nbootstrapState();\n';
const port = 4303;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
const original = await readFile(join(root, 'packages/state/__e2e__/benchmark/index.html'), 'utf8');
const GETTER = 'return this.$1 === this.$untrackDependency(() => this.selectedIndex);';
const ON_SELECT = /onSelect\(e, \$1\) \{[\s\S]*?\n  \},/;
function fixture(variant) {
  let html = original;
  const must = (a, b) => { const next = html.replace(a, b); if (next === html) throw new Error(`fixture anchor missing for ${variant}`); html = next; };
  if (variant === 'manual') return html;
  if (variant === 'tracked') { must(GETTER, 'return this.$1 === this.selectedIndex;'); must(ON_SELECT, 'onSelect(e, $1) { this.selectedIndex = $1; },'); return html; }
  if (variant === 'keyed') { must(GETTER, 'return this.$eq("selectedIndex", this.$1);'); must(ON_SELECT, 'onSelect(e, $1) { this.selectedIndex = $1; },'); return html; }
  if (variant === 'keyedId') {
    must('  selectedIndex: null,', '  selectedIndex: null,\n  selectedId: null,');
    must(GETTER, 'return this.$eq("selectedId", this["data.*.id"]);');
    must(ON_SELECT, 'onSelect(e, $1) { this.selectedId = this["data." + $1 + ".id"]; },');
    return html;
  }
  // keyedIdUntracked: the row id is read without a dependency edge, so no pattern edge
  // data.*.id → data.*.selected exists and a list replacement cannot expand over every row.
  // The same thing a runtime-level `$eq(path, keyPath)` would do internally.
  if (variant === 'keyedIdUntracked') {
    must('  selectedIndex: null,', '  selectedIndex: null,\n  selectedId: null,');
    must(GETTER, 'return this.$eq("selectedId", this.$untrackDependency(() => this["data.*.id"]));');
    must(ON_SELECT, 'onSelect(e, $1) { this.selectedId = this["data." + $1 + ".id"]; },');
    return html;
  }
  // round 3 (keyedRound3Patch.mjs): the runtime forms of the two keyed selections
  if (variant === 'keyedIdPath') {
    must('  selectedIndex: null,', '  selectedIndex: null,\n  selectedId: null,');
    must(GETTER, 'return this.$eqPath("selectedId", "data.*.id");');
    must(ON_SELECT, 'onSelect(e, $1) { this.selectedId = this["data." + $1 + ".id"]; },');
    return html;
  }
  if (variant === 'keyedIndex') { must(GETTER, 'return this.$eqIndex("selectedIndex");'); must(ON_SELECT, 'onSelect(e, $1) { this.selectedIndex = $1; },'); return html; }
  throw new Error(variant);
}
const stats = samples => { const s = [...samples].sort((a, b) => a - b); const m = s.length >> 1;
  return { median: +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2), min: +s[0].toFixed(2), max: +s.at(-1).toFixed(2), samples: samples.map(x => +x.toFixed(2)) }; };
async function timedClick(page, selector, rowCount) {
  return page.evaluate(({ selector, rowCount }) => new Promise((resolveP, rejectP) => {
    const target = document.querySelector('table.table');
    let t0;
    const to = setTimeout(() => { mo.disconnect(); rejectP(new Error(`timeout after click ${selector}`)); }, 15000);
    const check = () => {
      if (rowCount !== null && document.querySelectorAll('tbody>tr').length !== rowCount) return false;
      clearTimeout(to); mo.disconnect(); resolveP(performance.now() - t0); return true;
    };
    const mo = new MutationObserver(check);
    mo.observe(target, { childList: true, subtree: true, characterData: true, attributes: true });
    t0 = performance.now();
    document.querySelector(selector).click();
    if (rowCount !== null) queueMicrotask(() => queueMicrotask(check));
  }), { selector, rowCount });
}
const rows = (page, n) => page.waitForFunction(n => document.querySelectorAll('tbody>tr').length === n, n);
const selectedRow = page => page.evaluate(() => { const s = document.querySelectorAll('tbody>tr.danger'); return { count: s.length, index: s[0] ? [...s[0].parentNode.children].indexOf(s[0]) + 1 : null, id: s[0]?.querySelector('td')?.textContent?.trim() ?? null }; });
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
const gz = async f => { const b = await readFile(f); return { bytes: b.length, gzip: gzipSync(b, { level: 9 }).length }; };
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), timestamp: new Date().toISOString(), cpu: cpus()[0].model,
  sizes: { shippedAutoMin: await gz(join(root, 'packages/state/dist/auto.min.js')), protoAutoMin: await gz(join(dirname(protoPath), 'auto.min.js')) },
  results: [], errors: [],
};
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 75) throw new Error('Server did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  // --only <variant[,variant]> restricts the plan (e.g. `--only tracked` for a runtime-only comparison)
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
  const plan = [['shipped', 'manual'], ['shipped', 'tracked'], ['proto', 'manual'], ['proto', 'tracked'], ['proto', 'keyed'], ['proto', 'keyedId'], ['proto', 'keyedIdUntracked'], ['proto', 'keyedIdPath'], ['proto', 'keyedIndex']]
    .filter(([, variant]) => only === null || only.includes(variant));
  for (const [bundle, variant] of plan) for (const n of [1000, 10000]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/benchmark/index.html', r => r.fulfill({ contentType: 'text/html', body: fixture(variant) }));
    if (bundle === 'proto') await page.route('**/dist/auto.min.js', r => r.fulfill({ contentType: 'text/javascript', body: protoRuntime }));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click(n === 1000 ? '#run' : '#runlots'); await rows(page, n);
    // selection: 3 warm-ups + 10 samples, alternating rows 5 and 10
    const select = [];
    let ok = true;
    // the last click lands on row 10, so removing rows 1–5 afterwards keeps the selected row alive
    for (let i = 0; i < 13; i++) {
      const row = i % 2 ? 5 : 10;
      const t = await timedClick(page, `tbody>tr:nth-of-type(${row})>td:nth-of-type(2)>a`, null);
      const s = await selectedRow(page);
      if (s.count !== 1 || s.index !== row) ok = false;
      if (i >= 3) select.push(t);
    }
    // swap (the fixture swaps only while the list holds more than 998 rows), 5 samples
    let swap = null;
    let selectionAfterSwap = null;
    if (n === 1000) {
      // select row 2 (index 1, one of the two rows the fixture swaps), swap 5 times (odd, so a net
      // swap remains), and check whether the selection followed the id or the index and is still one row
      await timedClick(page, 'tbody>tr:nth-of-type(2)>td:nth-of-type(2)>a', null);
      const beforeSwap = await selectedRow(page);
      const s = []; for (let i = 0; i < 5; i++) s.push(await timedClick(page, '#swaprows', null)); swap = stats(s);
      const afterSwap = await selectedRow(page);
      selectionAfterSwap = { before: beforeSwap, after: afterSwap, count: afterSwap.count,
        followsId: beforeSwap.id !== null && beforeSwap.id === afterSwap.id, followsIndex: beforeSwap.index !== null && beforeSwap.index === afterSwap.index };
      // back to row 10 so that removing rows 1–5 keeps the selected row alive; the moved row must be unselected
      await timedClick(page, 'tbody>tr:nth-of-type(10)>td:nth-of-type(2)>a', null);
      const s10 = await selectedRow(page);
      if (s10.count !== 1 || s10.index !== 10) ok = false;
    }
    // removal of row 1, 5 samples; does the selection follow the id (keyedId) or the index?
    const before = await selectedRow(page);
    const remove = [];
    for (let i = 0; i < 5; i++) remove.push(await timedClick(page, 'tbody>tr:nth-of-type(1)>td:nth-of-type(3)>a', n - 1 - i));
    const after = await selectedRow(page);
    const r = { bundle, variant, rows: n, selectionCorrect: ok, select: stats(select), remove: stats(remove),
      selectionAfterRemove: { before, after, followsId: before.id !== null && before.id === after.id, followsIndex: before.index !== null && before.index === after.index }, swap, selectionAfterSwap, pageErrors: errors };
    report.results.push(r);
    console.log(JSON.stringify({ bundle, variant, rows: n, ok, select: r.select.median, selectRange: [r.select.min, r.select.max], remove: r.remove.median, followsId: r.selectionAfterRemove.followsId, swap: swap?.median ?? null,
      swapSelection: selectionAfterSwap ? `${selectionAfterSwap.count} row(s), ${selectionAfterSwap.followsId ? 'follows id' : selectionAfterSwap.followsIndex ? 'follows index' : 'lost'}` : null, errors: errors.length }));
    await page.close();
  }
  // --out <file> writes elsewhere (the hook-cost runs of survey §10.8 must not overwrite keyed-prototype.json)
  const outName = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'keyed-prototype.json';
  await writeFile(join(outDir, outName), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.sizes));
} finally { if (browser) await browser.close(); server.kill(); }
process.exit(0);
