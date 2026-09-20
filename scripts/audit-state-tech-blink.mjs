// Survey §11 item 6 (low priority): why does the shipped runtime's clear of 10,000 rows land on
// the high side (about 65–70 ms) even when the clear follows creation in the same task, where
// the bare-DOM page stays at 3.6 ms? The frame experiment (audit-state-tech-frame.mjs) showed
// that a rendered frame — laid-out rows — is what makes the bare DOM's replaceChildren() slow,
// so the question is whether something during the runtime's creation forces layout before the
// clear. This records a CDP trace with the `blink` category and the timeline stack traces
// around (1) create 10,000 rows and (2) the immediate clear, on a fresh page per sample, and
// reports every Layout / UpdateLayoutTree event in the two windows: whether it was forced from
// script (nested inside a script event) and the top JavaScript frame that forced it, plus the
// blink-level events that dominate the clear. Shipped auto.min.js, click → MutationObserver
// timing as in the frame experiment. Run from the repository root after `npm ci` in e2e/, with
// no other performance driver running:
//   node scripts/audit-state-tech-blink.mjs [--samples N]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { startTrace, stopTrace, summarize } from './research/cdpTrace.mjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'e2e/package.json'));
const { chromium } = require('@playwright/test');
const outDir = join(root, 'docs/research/state-next');
await mkdir(outDir, { recursive: true });
const N = process.argv.includes('--samples') ? Number(process.argv[process.argv.indexOf('--samples') + 1]) : 5;
// --bundle <file>: serve that runtime instead of the checked-in auto.min.js (bootstrapState() appended when missing);
// --out <file>: report name (default blink-trace.json)
const bundlePath = process.argv.includes('--bundle') ? process.argv[process.argv.indexOf('--bundle') + 1] : null;
const runtime = bundlePath === null ? null : await readFile(bundlePath, 'utf8').then(s => s.includes('\nbootstrapState();') ? s : s + '\nbootstrapState();\n');
const outName = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'blink-trace.json';
const port = 4303;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
const EXTRA = ['blink', 'disabled-by-default-devtools.timeline.stack', 'disabled-by-default-devtools.timeline.invalidationTracking'];
const SCRIPT_EVENTS = new Set(['FunctionCall', 'RunMicrotasks', 'EvaluateScript', 'v8.run', 'V8.Execute', 'v8.callFunction', 'EventDispatch', 'TimerFire', 'v8.compile']);
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });

// Layout-class events inside [start, end] on the marks' thread, with the innermost enclosing
// script event (if any) and the top frames of the recorded stack.
function layoutEvents(events, startMark, endMark) {
  const marks = events.filter(e => e.cat?.includes('blink.user_timing') && (e.name === startMark || e.name === endMark));
  const start = marks.find(e => e.name === startMark);
  const end = marks.filter(e => e.name === endMark).find(e => start && e.ts >= start.ts);
  if (!start || !end) return { error: 'marks not found' };
  const inWindow = events.filter(e => e.ph === 'X' && e.pid === start.pid && e.tid === start.tid && e.ts >= start.ts && e.ts + (e.dur ?? 0) <= end.ts + 1)
    .sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
  const out = [];
  for (const e of inWindow) {
    if (!/^(Layout|UpdateLayoutTree|ForcedLayout|LayoutTree|Document::UpdateStyleAndLayout|LocalFrameView::UpdateLifecycle|UpdateStyleAndLayout)/.test(e.name)) continue;
    const enclosing = inWindow.filter(p => p !== e && p.ts <= e.ts && p.ts + (p.dur ?? 0) >= e.ts + (e.dur ?? 0));
    const script = enclosing.filter(p => SCRIPT_EVENTS.has(p.name)).sort((a, b) => b.ts - a.ts)[0] ?? null;
    const stack = e.args?.beginData?.stackTrace ?? e.args?.data?.stackTrace ?? null;
    out.push({ name: e.name, atMs: Math.round((e.ts - start.ts) / 100) / 10, durMs: Math.round((e.dur ?? 0) / 100) / 10,
      forcedFromScript: script !== null, enclosingScriptEvent: script?.name ?? null,
      dirtyObjects: e.args?.beginData?.dirtyObjects ?? null, totalObjects: e.args?.beginData?.totalObjects ?? null,
      topFrames: stack ? stack.slice(0, 3).map(f => `${f.functionName || '(anonymous)'} ${f.url?.split('/').at(-1) ?? ''}:${f.lineNumber}:${f.columnNumber}`) : null });
  }
  return { count: out.length, events: out.slice(0, 20) };
}
// Self time of blink-category events in the window, top entries.
function blinkTop(events, startMark, endMark) {
  const s = summarize(events, startMark, endMark);
  if (s.error) return s;
  const marks = events.filter(e => e.cat?.includes('blink.user_timing') && (e.name === startMark || e.name === endMark));
  const start = marks.find(e => e.name === startMark);
  const end = marks.filter(e => e.name === endMark).find(e => e.ts >= start.ts);
  const inWindow = events.filter(e => e.ph === 'X' && e.pid === start.pid && e.tid === start.tid && e.ts >= start.ts && e.ts + (e.dur ?? 0) <= end.ts + 1 && e.cat?.split(',').includes('blink'));
  const total = new Map(); const count = new Map();
  for (const e of inWindow) { total.set(e.name, (total.get(e.name) ?? 0) + (e.dur ?? 0)); count.set(e.name, (count.get(e.name) ?? 0) + 1); }
  const top = [...total].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, us]) => ({ name: n, totalMs: Math.round(us / 100) / 10, count: count.get(n) }));
  return { summary: s, blinkEvents: inWindow.length, blinkTopByTotal: top };
}

const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), timestamp: new Date().toISOString(),
  cpu: cpus()[0].model, samples: N, categories: EXTRA, bundle: 'dist/auto.min.js (checked in)', rows: 10000, results: [] };
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 75) throw new Error('Server did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  for (let i = 0; i < N; i++) {
    const page = await browser.newPage();
    if (runtime !== null) await page.route('**/dist/auto.min.js', r => r.fulfill({ contentType: 'text/javascript', body: runtime }));
    await page.goto(url, { waitUntil: 'networkidle' });
    const tracing = await startTrace(page, EXTRA);
    const timings = await page.evaluate(async () => {
      const click = (selector, rowCount) => new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('timeout ' + selector)), 20000);
        const mo = new MutationObserver(() => {
          if (document.querySelectorAll('tbody>tr').length !== rowCount) return;
          clearTimeout(to); mo.disconnect(); res(performance.now() - t0);
        });
        mo.observe(document.querySelector('tbody'), { childList: true, subtree: true, attributes: true, characterData: true });
        const t0 = performance.now();
        document.querySelector(selector).click();
      });
      performance.mark('wcs-create-start');
      const create = await click('#runlots', 10000);
      performance.mark('wcs-create-end');
      await Promise.resolve();
      performance.mark('wcs-clear-start');
      const clear = await click('#clear', 0);
      performance.mark('wcs-clear-end');
      return { create, clear };
    });
    const events = await stopTrace(tracing);
    const r = { sample: i, createMs: +timings.create.toFixed(1), clearMs: +timings.clear.toFixed(1), traceEvents: events.length,
      create: { layout: layoutEvents(events, 'wcs-create-start', 'wcs-create-end'), ...blinkTop(events, 'wcs-create-start', 'wcs-create-end') },
      clear: { layout: layoutEvents(events, 'wcs-clear-start', 'wcs-clear-end'), ...blinkTop(events, 'wcs-clear-start', 'wcs-clear-end') } };
    report.results.push(r);
    console.log(JSON.stringify({ sample: i, createMs: r.createMs, clearMs: r.clearMs, events: events.length,
      createLayouts: r.create.layout.count, createForced: r.create.layout.events?.filter(e => e.forcedFromScript).length,
      clearLayouts: r.clear.layout.count, clearLayoutMs: r.clear.summary?.layoutMs, clearTop: r.clear.blinkTopByTotal?.slice(0, 4).map(t => `${t.name} ${t.totalMs}ms×${t.count}`) }));
    await page.close();
  }
  report.bundle = bundlePath === null ? report.bundle : bundlePath;
  await writeFile(join(outDir, outName), JSON.stringify(report, null, 2) + '\n');
} finally { if (browser) await browser.close(); server.kill(); }
process.exit(0);
