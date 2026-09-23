// Heap held per rendered row by the real runtime: the benchmark fixture creates 10,000 rows,
// the page is garbage-collected through CDP, and the JS heap size is read before and after,
// for the shipped runtime and for a prototype build (e.g. the row-record prototype of the
// survey). Fresh page per sample; the delta after forced collections is the retained size of
// the rows, their bindings and the runtime's ledgers together (DOM nodes are outside the JS
// heap, so the bare DOM-floor page's number from audit-state-tech-fold.mjs is the comparison).
// Run from the repository root after `npm ci` in e2e/, with no other performance driver running:
//   node scripts/audit-state-tech-heap.mjs [--proto <file>] [--fixture manual|tracked] [--samples N]
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
const arg = (name, dflt) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt;
const protoPath = arg('--proto', null);
const fixture = arg('--fixture', 'tracked');
const N = Number(arg('--samples', 5));
const port = 4304;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
// フィクスチャの getter 本文の目印。**この綴りはフィクスチャ内で 1 度しか現れてはならない**
// （String.replace は先頭 1 件しか置換しない — packages/state/__e2e__/benchmark/index.html の NOTE）
const MARKER = 'this.$untrackDependency(() => this.selectedIndex)';
const original = await readFile(join(root, 'packages/state/__e2e__/benchmark/index.html'), 'utf8');
let html = original;
if (fixture === 'tracked') {
  html = original.replace(MARKER, 'this.selectedIndex')
    .replace(/onSelect\(e, \$1\) \{[\s\S]*?\n  \},/, 'onSelect(e, $1) { this.selectedIndex = $1; },');
  // 「変わったか」ではなく**意図した場所が変わったか**を見る。短いリテラルの replace は
  // 先頭 1 件しか置換しないので、フィクスチャのコメント等に同じ綴りが混ざると getter が
  // 無傷のまま素通りし、tracked が manual と同一物になる（サイクル 5 指摘 3）
  if (html === original || html.includes(MARKER)) {
    throw new Error('Fixture replacement failed: the getter still reads the marker literal');
  }
}
const withBootstrap = s => s.includes('\nbootstrapState();') ? s : s + '\nbootstrapState();\n';
const runtimes = [['shipped', null]];
if (protoPath !== null) runtimes.push([`proto (${basename(protoPath)})`, withBootstrap(await readFile(protoPath, 'utf8'))]);
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
const stats = samples => { const s = [...samples].sort((a, b) => a - b); const m = s.length >> 1;
  return { median: +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(0), min: +s[0].toFixed(0), max: +s.at(-1).toFixed(0), samples: samples.map(x => +x.toFixed(0)) }; };
async function heap(page) {
  const cdp = await page.context().newCDPSession(page);
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  return usedSize;
}
const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), timestamp: new Date().toISOString(),
  cpu: cpus()[0].model, samples: N, fixture, rows: 10000, results: [] };
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 75) throw new Error('Server did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  for (const [label, runtime] of runtimes) {
    const deltas = [];
    const perRow = [];
    for (let i = 0; i < N; i++) {
      const page = await browser.newPage();
      await page.route('**/benchmark/index.html', r => r.fulfill({ contentType: 'text/html', body: html }));
      if (runtime !== null) await page.route('**/dist/auto.min.js', r => r.fulfill({ contentType: 'text/javascript', body: runtime }));
      await page.goto(url, { waitUntil: 'networkidle' });
      const before = await heap(page);
      await page.click('#runlots');
      await page.waitForFunction(() => document.querySelectorAll('tbody>tr').length === 10000);
      const after = await heap(page);
      deltas.push(after - before);
      perRow.push((after - before) / 10000);
      await page.close();
    }
    const r = { runtime: label, heapDeltaBytes: stats(deltas), bytesPerRow: stats(perRow) };
    report.results.push(r);
    console.log(JSON.stringify({ runtime: label, deltaMB: +(r.heapDeltaBytes.median / 1048576).toFixed(2), bytesPerRow: r.bytesPerRow.median, range: [r.bytesPerRow.min, r.bytesPerRow.max] }));
  }
  await writeFile(join(outDir, 'heap-per-row.json'), JSON.stringify(report, null, 2) + '\n');
} finally { if (browser) await browser.close(); server.kill(); }
process.exit(0);
