// Micro-benchmark for the H1 receptacle's hot-path cost (wiring design §7-4): the benchmark's
// click → MutationObserver timing varies by ±10 % between runs, too coarse for a "< 1 %"
// target, so this times the read and write boundaries themselves inside a state method
// (`this` is the proxy, so every read passes the get trap → getByAddress and every write the
// set trap → setByAddress). Reads: one million reads of a plain property; writes: 100,000
// same-value writes (they return at the same-value guard, after the write hooks). Each
// runtime gets fresh pages; the method runs once to warm up and then N times per page.
// Run from the repository root after `npm ci` in e2e/, with no other performance driver running:
//   node scripts/audit-state-tech-hookcost.mjs <label>=<file> [<label>=<file> ...] [--samples N]
//   (the shipped auto.min.js is always measured first)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { cpus } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'e2e/package.json'));
const { chromium } = require('@playwright/test');
const outDir = join(root, 'docs/research/state-next');
await mkdir(outDir, { recursive: true });
const args = process.argv.slice(2);
const N = args.includes('--samples') ? Number(args[args.indexOf('--samples') + 1]) : 5;
const runtimes = [['shipped', null]];
for (const a of args) {
  if (a.startsWith('--') || !a.includes('=')) continue;
  const [label, file] = a.split('=');
  const code = await readFile(file, 'utf8');
  runtimes.push([label, code.includes('\nbootstrapState();') ? code : code + '\nbootstrapState();\n']);
}
const port = 4305;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
const original = await readFile(join(root, 'packages/state/__e2e__/benchmark/index.html'), 'utf8');
const METHOD = `  onMicro() {
    const READS = 1000000, WRITES = 100000;
    let sum = 0;
    let t = performance.now();
    for (let i = 0; i < READS; i++) sum += this.selectedIndex === null ? 0 : 1;
    const readMs = performance.now() - t;
    t = performance.now();
    for (let i = 0; i < WRITES; i++) this.selectedIndex = null;
    const writeMs = performance.now() - t;
    window.__micro = { readMs, writeMs, sum };
  },
  onSelect(e, $1) {`;
let html = original.replace(/  onSelect\(e, \$1\) \{/, METHOD);
html = html.replace('<button class="btn btn-primary btn-block" id="swaprows"', '<button id="micro" data-wcs="onclick: onMicro">micro</button><button class="btn btn-primary btn-block" id="swaprows"');
if (html === original || !html.includes('onMicro()') || !html.includes('id="micro"')) throw new Error('fixture injection failed');
const stats = samples => { const s = [...samples].sort((a, b) => a - b); const m = s.length >> 1;
  return { median: +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2), min: +s[0].toFixed(2), max: +s.at(-1).toFixed(2), samples: samples.map(x => +x.toFixed(2)) }; };
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), timestamp: new Date().toISOString(),
  cpu: cpus()[0].model, samples: N, reads: 1000000, writes: 100000, results: [] };
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
    const reads = [], writes = [];
    for (let i = 0; i < N; i++) {
      const page = await browser.newPage();
      await page.route('**/benchmark/index.html', r => r.fulfill({ contentType: 'text/html', body: html }));
      if (runtime !== null) await page.route('**/dist/auto.min.js', r => r.fulfill({ contentType: 'text/javascript', body: runtime }));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.click('#run');
      await page.waitForFunction(() => document.querySelectorAll('tbody>tr').length === 1000);
      // one warm-up, then five timed runs per page; the page's value is the minimum (the JIT tier a
      // page settles in varies between pages, and the minimum is the least sensitive to it)
      let bestRead = Infinity, bestWrite = Infinity;
      for (let k = 0; k < 6; k++) {
        await page.evaluate(() => { window.__micro = null; document.querySelector('#micro').click(); });
        await page.waitForFunction(() => window.__micro !== null);
        const m = await page.evaluate(() => window.__micro);
        if (k === 0) continue;
        bestRead = Math.min(bestRead, m.readMs); bestWrite = Math.min(bestWrite, m.writeMs);
      }
      reads.push(bestRead); writes.push(bestWrite);
      await page.close();
    }
    const r = { runtime: label, readMs: stats(reads), writeMs: stats(writes), nsPerRead: +(stats(reads).median * 1e6 / 1e6).toFixed(1), nsPerWrite: +(stats(writes).median * 1e6 / 1e5).toFixed(1) };
    report.results.push(r);
    console.log(JSON.stringify({ runtime: label, reads1M: r.readMs.median, readRange: [r.readMs.min, r.readMs.max], nsPerRead: r.nsPerRead, writes100k: r.writeMs.median, writeRange: [r.writeMs.min, r.writeMs.max], nsPerWrite: r.nsPerWrite }));
  }
  await writeFile(join(outDir, 'hook-cost-micro.json'), JSON.stringify(report, null, 2) + '\n');
} finally { if (browser) await browser.close(); server.kill(); }
process.exit(0);
