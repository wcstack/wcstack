// Allocation sampling of the clear (survey §10.9 → round-3 §11 item 6): which functions of the
// runtime allocate during the clear of 10,000 rows performed right after creation? CDP's
// HeapProfiler sampling (every 4 KB of allocation) runs around the click → MutationObserver
// window of the clear; the samples are attributed to the allocating function (self) and summed.
// A scavenge inside the clear is triggered by these allocations, so they are what a form that
// avoids it has to remove. Unminified bundle for readable names. Run from the repository root
// after `npm ci` in e2e/:
//   node scripts/audit-state-tech-allocsample.mjs [--bundle <file>] [--op clear10k|create1k] [--fixture manual|tracked] [--samples N] [--top N]
// --op create1k samples the audit benchmark's cold creation of 1,000 rows on a fresh page instead
// (runtime design R5: what the young-generation GC of a cold creation is paying for); its report is
// written as alloc-sample-create1k-<bundle>.json so that the clear's artefacts are left alone.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'e2e/package.json'));
const { chromium } = require('@playwright/test');
const outDir = join(root, 'docs/research/state-next');
await mkdir(outDir, { recursive: true });
const arg = (name, dflt) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt;
const bundlePath = arg('--bundle', join(root, 'packages/state/dist/index.esm.js'));
const fixture = arg('--fixture', 'tracked');
const op = arg('--op', 'clear10k');
if (op !== 'clear10k' && op !== 'create1k') throw new Error(`unknown op ${op}`);
const N = Number(arg('--samples', 3));
const TOP = Number(arg('--top', 30));
const port = 4309;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
const original = await readFile(join(root, 'packages/state/__e2e__/benchmark/index.html'), 'utf8');
let html = original;
if (fixture === 'tracked') {
  html = original.replace('this.$untrackDependency(() => this.selectedIndex)', 'this.selectedIndex')
    .replace(/onSelect\(e, \$1\) \{[\s\S]*?\n  \},/, 'onSelect(e, $1) { this.selectedIndex = $1; },');
  if (html === original) throw new Error('Fixture replacement failed');
}
const code = await readFile(bundlePath, 'utf8');
const runtime = code.includes('\nbootstrapState();') ? code : code + '\nbootstrapState();\n';
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });

// Sum selfSize of the sampling profile per node (function), walking the tree.
function selfBytes(profile) {
  const out = new Map();
  const walk = node => {
    const cf = node.callFrame;
    const key = `${cf.functionName || '(anonymous)'} ${basename(cf.url || '')}:${cf.lineNumber + 1}`;
    if (node.selfSize > 0) out.set(key, (out.get(key) ?? 0) + node.selfSize);
    for (const c of node.children ?? []) walk(c);
  };
  walk(profile.head);
  return out;
}
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 75) throw new Error('Server did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  const total = new Map();
  const clears = [];
  let totalBytes = 0;
  for (let i = 0; i < N; i++) {
    const page = await browser.newPage();
    await page.route('**/benchmark/index.html', r => r.fulfill({ contentType: 'text/html', body: html }));
    await page.route('**/dist/auto.min.js', r => r.fulfill({ contentType: 'text/javascript', body: runtime }));
    await page.goto(url, { waitUntil: 'networkidle' });
    if (op === 'clear10k') {
      await page.click('#runlots');
      await page.waitForFunction(() => document.querySelectorAll('tbody>tr').length === 10000);
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    const [selector, rows] = op === 'clear10k' ? ['#clear', 0] : ['#run', 1000];
    const ms = await page.evaluate(({ selector, rows }) => new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('timeout')), 20000);
      const mo = new MutationObserver(() => {
        if (document.querySelectorAll('tbody>tr').length !== rows) return;
        clearTimeout(to); mo.disconnect(); res(performance.now() - t0);
      });
      mo.observe(document.querySelector('tbody'), { childList: true, subtree: true, attributes: true, characterData: true });
      const t0 = performance.now();
      document.querySelector(selector).click();
    }), { selector, rows });
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    await cdp.detach();
    clears.push(ms);
    for (const [k, v] of selfBytes(profile)) { total.set(k, (total.get(k) ?? 0) + v); totalBytes += v; }
    await page.close();
  }
  const rows = [...total].map(([fn, bytes]) => ({ fn, bytesPerRun: Math.round(bytes / N), share: +(bytes / totalBytes * 100).toFixed(1) })).sort((a, b) => b.bytesPerRun - a.bytesPerRun);
  const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), timestamp: new Date().toISOString(),
    browser: browser.version(), bundle: basename(bundlePath), op, fixture, rows: op === 'clear10k' ? 10000 : 1000, samples: N, samplingIntervalBytes: 4096,
    [op === 'clear10k' ? 'clearMs' : 'createMs']: clears.map(x => +x.toFixed(1)), allocatedBytesPerRun: Math.round(totalBytes / N), top: rows.slice(0, TOP) };
  const outName = op === 'clear10k' ? 'alloc-sample-clear.json' : `alloc-sample-create1k-${basename(bundlePath).replace(/\.js$/, '')}.json`;
  await writeFile(join(outDir, outName), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ op, ms: report.clearMs ?? report.createMs, allocatedMBPerRun: +(report.allocatedBytesPerRun / 1048576).toFixed(2) }));
  for (const r of rows.slice(0, 25)) console.log(`${String((r.bytesPerRun / 1024).toFixed(0)).padStart(7)} KB ${String(r.share).padStart(5)}%  ${r.fn}`);
} finally { if (browser) await browser.close(); server.kill(); }
process.exit(0);
