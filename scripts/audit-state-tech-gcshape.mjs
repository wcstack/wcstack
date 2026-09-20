// Survey §11 item 6: does a row shape that allocates less change the young-generation GC that
// lands inside a clear performed right after creation (§10.6: 22–35 ms of scavenge in the
// shipped runtime's immediate clear)? The DOM-floor page's bookkeeping shapes (none / current
// / folded, audit-state-tech-fold.mjs) create 10,000 rows and clear them in the same task,
// under a CDP trace with the v8.gc category; the scavenge time and count inside the clear
// window and the creation window are compared per shape. Fresh page per sample. Run from the
// repository root after `npm ci` in e2e/, with no other performance driver running:
//   node scripts/audit-state-tech-gcshape.mjs [--samples N]
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
const port = 4306;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
const pageScript = await readFile(join(root, 'scripts/research/domFloorPage.js'), 'utf8');
const domHtml = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>dom floor</title>'
  + '<link href="./css/currentStyle.css" rel="stylesheet">'
  + '<script type="importmap">{"imports":{"@lib/buildData":"./buildData.js"}}</script></head>'
  + '<body><div class="container"><table class="table table-hover table-striped test-data"><tbody></tbody></table></div>'
  + '<template id="row"><tr><td class="col-md-1" data-b>#</td><td class="col-md-4"><a data-b>#</a></td>'
  + '<td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr></template>'
  + '<script type="module">import { buildData } from "@lib/buildData";\n' + pageScript + '</script></body></html>';
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
const stats = samples => { const s = [...samples].sort((a, b) => a - b); const m = s.length >> 1;
  return { median: +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2), min: +s[0].toFixed(2), max: +s.at(-1).toFixed(2), samples: samples.map(x => +x.toFixed(2)) }; };
const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), timestamp: new Date().toISOString(),
  cpu: cpus()[0].model, samples: N, rows: 10000, results: [] };
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 75) throw new Error('Server did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  for (const shape of ['none', 'current', 'folded']) {
    const createMs = [], clearMs = [], createGc = [], clearGc = [], clearGcCount = [], createGcCount = [];
    for (let i = 0; i < N; i++) {
      const page = await browser.newPage();
      await page.route('**/benchmark/index.html', r => r.fulfill({ contentType: 'text/html', body: domHtml }));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.bench?.ready);
      const tracing = await startTrace(page);
      const t = await page.evaluate(async shape => {
        performance.mark('wcs-create-start');
        const create = await bench.createShaped(10000, shape);
        performance.mark('wcs-create-end');
        const tbody = document.querySelector('tbody');
        performance.mark('wcs-clear-start');
        const t0 = performance.now();
        tbody.replaceChildren();
        const clear = performance.now() - t0;
        performance.mark('wcs-clear-end');
        return { create: typeof create === 'number' ? create : (create?.ms ?? null), clear };
      }, shape);
      const events = await stopTrace(tracing);
      const c = summarize(events, 'wcs-create-start', 'wcs-create-end');
      const k = summarize(events, 'wcs-clear-start', 'wcs-clear-end');
      createMs.push(c.windowMs ?? 0); clearMs.push(k.windowMs ?? 0);
      createGc.push(c.gcMs ?? 0); clearGc.push(k.gcMs ?? 0);
      createGcCount.push(c.counts?.gc ?? 0); clearGcCount.push(k.counts?.gc ?? 0);
      await page.close();
    }
    const r = { shape, create: { windowMs: stats(createMs), gcMs: stats(createGc), gcEvents: stats(createGcCount) }, clear: { windowMs: stats(clearMs), gcMs: stats(clearGc), gcEvents: stats(clearGcCount) } };
    report.results.push(r);
    console.log(JSON.stringify({ shape, createMs: r.create.windowMs.median, createGcMs: r.create.gcMs.median, clearMs: r.clear.windowMs.median, clearRange: [r.clear.windowMs.min, r.clear.windowMs.max], clearGcMs: r.clear.gcMs.median, clearGcSamples: r.clear.gcMs.samples }));
  }
  await writeFile(join(outDir, 'gc-shape.json'), JSON.stringify(report, null, 2) + '\n');
} finally { if (browser) await browser.close(); server.kill(); }
process.exit(0);
