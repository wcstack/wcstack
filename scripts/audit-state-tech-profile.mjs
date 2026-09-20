// Sampling profile of one benchmark operation (create 10,000 rows by default) through CDP's
// Profiler, aggregated by function as self time, so that the per-row cost of creation can be
// attributed to functions rather than to the coarse counters of audit-state-tech-counters.mjs.
// The unminified dist/index.esm.js (or a prototype build) is served so that names are readable;
// samples every 100 µs; three pages, the function table is summed over them and expressed per
// row. Run from the repository root after `npm ci` in e2e/, with no other performance driver running:
//   node scripts/audit-state-tech-profile.mjs [--bundle <file>] [--op create10k|append1k|select10k] [--fixture manual|tracked] [--samples N] [--top N]
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
const bundlePath = arg('--bundle', join(root, 'packages/state/dist/index.esm.js'));
const op = arg('--op', 'create10k');
const fixture = arg('--fixture', 'tracked');
const N = Number(arg('--samples', 3));
const TOP = Number(arg('--top', 40));
const port = 4308;
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
// --warm: after the cold (first) run on a fresh page, clear and profile the same operation once more on
// the same page; the report then carries cold and warm self times per function and their ratio, which
// separates first-run work (interpreter / lazy compilation, first template clone, ledger growth) from
// the steady-state cost. Meaningful for create1k, the audit benchmark's cold metric.
const warm = process.argv.includes('--warm');
const OPS = {
  create1k: { setup: async () => {}, selector: '#run', rows: 1000, perRow: 1000, reset: async page => { await page.click('#clear'); await page.waitForFunction(() => document.querySelectorAll('tbody>tr').length === 0); } },
  create10k: { setup: async () => {}, selector: '#runlots', rows: 10000, perRow: 10000, reset: async page => { await page.click('#clear'); await page.waitForFunction(() => document.querySelectorAll('tbody>tr').length === 0); } },
  append1k: { setup: async page => { await page.click('#runlots'); await page.waitForFunction(() => document.querySelectorAll('tbody>tr').length === 10000); }, selector: '#add', rows: 11000, perRow: 1000 },
  select10k: { setup: async page => { await page.click('#runlots'); await page.waitForFunction(() => document.querySelectorAll('tbody>tr').length === 10000); }, selector: 'tbody>tr:nth-of-type(5)>td:nth-of-type(2)>a', rows: 10000, perRow: 10000 },
};
const spec = OPS[op];
if (!spec) throw new Error(`unknown op ${op}`);
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });

// Self time per function from a CDP profile: each sample's leaf node gets the interval to the next sample.
function selfTimes(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const self = new Map();
  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i++) {
    const node = byId.get(samples[i]);
    const dt = (timeDeltas[i + 1] ?? 0) / 1000; // µs → ms, attributed to the sample that ran until the next one
    const cf = node.callFrame;
    const key = `${cf.functionName || '(anonymous)'} ${basename(cf.url || '') }:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + dt);
  }
  return self;
}
const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), timestamp: new Date().toISOString(),
  cpu: cpus()[0].model, bundle: basename(bundlePath), op, fixture, samples: N, samplingIntervalUs: 100, results: null };
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 75) throw new Error('Server did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  const total = new Map();
  const totalWarm = new Map();
  let windowMsSum = 0, windowMsWarmSum = 0;
  const profileClick = async (page, cdp) => {
    await cdp.send('Profiler.start');
    const ms = await page.evaluate(({ selector, rows }) => new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('timeout')), 20000);
      const mo = new MutationObserver(() => {
        if (document.querySelectorAll('tbody>tr').length !== rows) return;
        clearTimeout(to); mo.disconnect(); res(performance.now() - t0);
      });
      mo.observe(document.querySelector('tbody'), { childList: true, subtree: true, attributes: true, characterData: true });
      const t0 = performance.now();
      document.querySelector(selector).click();
    }), { selector: spec.selector, rows: spec.rows });
    const { profile } = await cdp.send('Profiler.stop');
    return { ms, self: selfTimes(profile) };
  };
  for (let i = 0; i < N; i++) {
    const page = await browser.newPage();
    await page.route('**/benchmark/index.html', r => r.fulfill({ contentType: 'text/html', body: html }));
    await page.route('**/dist/auto.min.js', r => r.fulfill({ contentType: 'text/javascript', body: runtime }));
    await page.goto(url, { waitUntil: 'networkidle' });
    await spec.setup(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    const cold = await profileClick(page, cdp);
    windowMsSum += cold.ms;
    for (const [k, v] of cold.self) total.set(k, (total.get(k) ?? 0) + v);
    if (warm) {
      await spec.reset(page);
      const w = await profileClick(page, cdp);
      windowMsWarmSum += w.ms;
      for (const [k, v] of w.self) totalWarm.set(k, (totalWarm.get(k) ?? 0) + v);
    }
    await cdp.detach();
    await page.close();
  }
  const rows = [...total].map(([fn, ms]) => ({ fn, msPerRun: +(ms / N).toFixed(2), usPerRow: +((ms / N) * 1000 / spec.perRow).toFixed(2),
    ...(warm ? { warmMsPerRun: +((totalWarm.get(fn) ?? 0) / N).toFixed(2), coldExtraMsPerRun: +(((ms - (totalWarm.get(fn) ?? 0)) / N)).toFixed(2) } : {}) })).sort((a, b) => b.msPerRun - a.msPerRun);
  const profiledMs = rows.reduce((a, r) => a + r.msPerRun, 0);
  report.results = { windowMsPerRun: +(windowMsSum / N).toFixed(1), profiledMsPerRun: +profiledMs.toFixed(1),
    ...(warm ? { warmWindowMsPerRun: +(windowMsWarmSum / N).toFixed(1), warmProfiledMsPerRun: +([...totalWarm.values()].reduce((a, v) => a + v, 0) / N).toFixed(1) } : {}), top: rows.slice(0, TOP) };
  await writeFile(join(outDir, `profile-${op}${warm ? '-coldwarm' : ''}-${basename(bundlePath).replace(/\.js$/, '')}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ op, bundle: report.bundle, windowMs: report.results.windowMsPerRun, profiledMs: report.results.profiledMsPerRun, warmWindowMs: report.results.warmWindowMsPerRun ?? null }));
  for (const r of rows.slice(0, 30)) console.log(`${String(r.msPerRun).padStart(7)} ms ${String(r.usPerRow).padStart(6)} µs/row${warm ? `  warm ${String(r.warmMsPerRun).padStart(6)}  cold-extra ${String(r.coldExtraMsPerRun).padStart(6)}` : ''}  ${r.fn}`);
} finally { if (browser) await browser.close(); server.kill(); }
process.exit(0);
