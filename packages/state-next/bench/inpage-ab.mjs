// A/B of state bundles on the js-framework-benchmark page, sampled inside the page: each page runs
// the op `iters` times back to back (no harness round trip per sample, which on a desktop machine
// is noisier than a few percent), and the bundles take turns page by page, the order reversed on
// every other page (ABBA), so neither gets the fresher machine. Run from e2e/ (where
// @playwright/test is installed), after building the bundles:
//   node ../packages/state-next/bench/inpage-ab.mjs --bundles a.js,b.js --op update10k \
//     [--pages 8] [--iters 40] [--warmup 5] [--throttle 4] [--out file.json]
// --throttle 4 is the official benchmark's CPU slowdown. Diagnosis:
//   --profile   CPU self time by function over the loop (build the bundles without identifier
//               mangling to read the names: esbuild minifyWhitespace + minifySyntax, terser mangle: false)
//   --alloc     sampled allocation by function, garbage included
//   --gcbefore  a forced GC before every sample (tells execution apart from GC timing)
// ops: update10k (repeated on one 10k table), append (clear, 10k, then +1k), clear10k (10k, then
// clear), create1k (clear, then 1k), replace1k (1k, then 1k again).
// Used for the size reduction of 2026-09-29 (docs/state-engine-rewrite/v4-remaining.ja.md §8).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const E2E = process.cwd();
const { chromium } = await import(pathToFileURL(resolve(E2E, 'node_modules/@playwright/test/index.mjs')).href);
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(arg('port', '4270'));
const OP = arg('op', 'update10k');
const PAGES = Number(arg('pages', '8'));
const ITERS = Number(arg('iters', '40'));
const WARMUP = Number(arg('warmup', '5'));
const THROTTLE = Number(arg('throttle', '1'));
const BUNDLES = arg('bundles').split(',').map((b) => resolve(b));
const OUT = arg('out', null);
const PROFILE = args.includes('--profile');
const ALLOC = args.includes('--alloc');
const GCBEFORE = args.includes('--gcbefore');
const URL_ = `http://127.0.0.1:${PORT}/packages/state/__e2e__/benchmark/index.html`;

async function waitForServer() {
  for (let t = Date.now(); ;) {
    try { if ((await fetch(URL_)).ok) return; } catch { /* not up */ }
    if (Date.now() - t > 15000) throw new Error('server not up');
    await new Promise((r) => setTimeout(r, 200));
  }
}

// runs inside the page: the timings of `iters` samples (after `warmup`), clocked like jsfb-verify
// (click → the MutationObserver callback that sees the condition)
async function loop({ op, iters, warmup, gcBefore }) {
  const rows = () => document.querySelectorAll('tbody>tr');
  const until = (cond) => new Promise((res) => {
    if (cond()) { res(); return; }
    const mo = new MutationObserver(() => { if (cond()) { mo.disconnect(); res(); } });
    mo.observe(document.querySelector('table.table'), { childList: true, subtree: true, characterData: true, attributes: true });
  });
  const click = (sel) => document.querySelector(sel).click();
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const timed = async (sel, cond) => {
    await settle();
    if (gcBefore) { globalThis.gc(); await settle(); }
    const t0 = performance.now();
    const done = until(cond);
    click(sel);
    await done;
    return performance.now() - t0;
  };
  const out = [];
  if (op === 'update10k') { click('#runlots'); await until(() => rows().length === 10000); }
  for (let i = 0; i < warmup + iters; i++) {
    let t;
    if (op === 'update10k') {
      const prev = rows()[9990].cells[1].textContent;
      t = await timed('#update', () => rows()[9990].cells[1].textContent !== prev);
    } else if (op === 'append') {
      click('#clear'); await until(() => rows().length === 0);
      click('#runlots'); await until(() => rows().length === 10000);
      t = await timed('#add', () => rows().length === 11000);
    } else if (op === 'clear10k') {
      click('#runlots'); await until(() => rows().length === 10000);
      t = await timed('#clear', () => rows().length === 0);
    } else if (op === 'create1k') {
      click('#clear'); await until(() => rows().length === 0);
      t = await timed('#run', () => rows().length === 1000);
    } else if (op === 'replace1k') {
      if (rows().length !== 1000) { click('#run'); await until(() => rows().length === 1000); }
      const prev = rows()[0].cells[0].textContent;
      t = await timed('#run', () => rows()[0].cells[0].textContent !== prev);
    } else {
      throw new Error(`unknown op ${op}`);
    }
    if (i >= warmup) out.push(t);
  }
  return out;
}

const labelOf = (cf) => {
  const file = (cf.url || '').split('/').pop() || '(native)';
  return file.includes('auto.min.js') ? cf.functionName || '(anonymous)' : `[${cf.functionName || file}]`;
};

const server = spawn(process.execPath, ['serve.mjs'], { cwd: E2E, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
let browser;
const results = Object.fromEntries(BUNDLES.map((b) => [basename(b), []]));
const cpu = {};
const allocs = {};
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, args: GCBEFORE ? ['--js-flags=--expose-gc'] : [] });
  for (let p = 0; p < PAGES; p++) {
    const order = p % 2 === 0 ? BUNDLES : [...BUNDLES].reverse();
    for (const b of order) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.route('**/packages/state/dist/auto.min.js', (r) => r.fulfill({ path: b, contentType: 'text/javascript; charset=utf-8' }));
      const cdp = await ctx.newCDPSession(page);
      if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      await page.goto(URL_, { waitUntil: 'networkidle' });
      if (PROFILE) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
        await cdp.send('Profiler.start');
      }
      if (ALLOC) {
        await cdp.send('HeapProfiler.enable');
        await cdp.send('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      }
      const ts = await page.evaluate(loop, { op: OP, iters: ITERS, warmup: WARMUP, gcBefore: GCBEFORE });
      if (ALLOC) {
        const { profile } = await cdp.send('HeapProfiler.getSamplingProfile');
        await cdp.send('HeapProfiler.stopSampling');
        const agg = (allocs[basename(b)] ??= new Map());
        const walk = (node) => {
          const key = labelOf(node.callFrame);
          agg.set(key, (agg.get(key) ?? 0) + node.selfSize);
          for (const c of node.children) walk(c);
        };
        walk(profile.head);
      }
      if (PROFILE) {
        const { profile } = await cdp.send('Profiler.stop');
        const byId = new Map(profile.nodes.map((n) => [n.id, n]));
        const agg = (cpu[basename(b)] ??= new Map());
        for (let k = 0; k < profile.samples.length; k++) {
          const key = labelOf(byId.get(profile.samples[k]).callFrame);
          agg.set(key, (agg.get(key) ?? 0) + (profile.timeDeltas[k] ?? 0));
        }
      }
      results[basename(b)].push(ts);
      await ctx.close();
    }
  }
} finally {
  await browser?.close();
  server.kill();
}

const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
const names = Object.keys(results);
const base = results[names[0]].flat();
for (const n of names) {
  const all = results[n].flat();
  const perPage = results[n].map((ts) => q(ts, 0.5));
  console.log(`${OP} ${n.padEnd(20)} p10 ${q(all, 0.1).toFixed(2)} p25 ${q(all, 0.25).toFixed(2)} median ${q(all, 0.5).toFixed(2)} (x${(q(all, 0.5) / q(base, 0.5)).toFixed(3)}, p25 x${(q(all, 0.25) / q(base, 0.25)).toFixed(3)})  pages ${perPage.map((x) => x.toFixed(1)).join(' ')}  n=${all.length}`);
}
for (const [n, agg] of Object.entries(cpu)) {
  console.log(`== cpu ${n} (ms of self time per page)`);
  for (const [k, us] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 28)) console.log(`${(us / 1000 / PAGES).toFixed(1).padStart(7)} ${k}`);
}
for (const [n, agg] of Object.entries(allocs)) {
  let total = 0;
  for (const [, v] of agg) total += v;
  console.log(`== alloc ${n} (sampled KB per page, total ${(total / PAGES / 1024).toFixed(0)})`);
  for (const [k, v] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${(v / PAGES / 1024).toFixed(1).padStart(9)} ${k}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify({ op: OP, throttle: THROTTLE, results }, null, 1));
