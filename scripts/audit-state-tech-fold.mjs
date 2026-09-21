// Bookkeeping-shape model for the row-record fold (survey §10 item 2): the DOM-floor page
// creates rows with the same template clone and text writes, and layers per-row bookkeeping on
// top — none (the floor), current (the runtime's plan-row shape: 3 binding copies, 3 25-field
// records, 6 per-binding ledgers, a content object and 5 content ledgers) or folded (one row
// object, 2 ledgers). The difference between current and folded bounds what a template-plan /
// row-instance separation can remove from row creation, independently of the rest of the
// runtime. Fresh page per sample (the ledgers retain rows), 7 samples, Chromium. Run from the
// repository root after `npm ci` in e2e/, with no other performance driver running:
//   node scripts/audit-state-tech-fold.mjs
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
const N = 7;
const port = 4304;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
const pageScript = await readFile(join(root, 'scripts/research/domFloorPage.js'), 'utf8');
const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>dom floor</title>'
  + '<link href="./css/currentStyle.css" rel="stylesheet">'
  + '<script type="importmap">{"imports":{"@lib/buildData":"./buildData.js"}}</script></head>'
  + '<body><div class="container"><table class="table table-hover table-striped test-data"><tbody></tbody></table></div>'
  + '<template id="row"><tr><td class="col-md-1" data-b>#</td><td class="col-md-4"><a data-b>#</a></td>'
  + '<td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr></template>'
  + '<script type="module">import { buildData } from "@lib/buildData";\n' + pageScript + '</script></body></html>';
const stats = samples => { const s = [...samples].sort((a, b) => a - b); const m = s.length >> 1;
  return { median: +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2), min: +s[0].toFixed(2), max: +s.at(-1).toFixed(2), samples: samples.map(x => +x.toFixed(2)) }; };
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), timestamp: new Date().toISOString(),
  cpu: cpus()[0].model, samples: N, results: [] };
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 75) throw new Error('Server did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  for (const n of [1000, 10000]) for (const shape of ['none', 'current', 'folded']) {
    const samples = [];
    let heapDelta = null;
    for (let i = 0; i < N; i++) {
      const page = await browser.newPage();
      await page.route('**/benchmark/index.html', r => r.fulfill({ contentType: 'text/html', body: html }));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.bench?.ready);
      // JS heap before/after (CDP), after forcing a collection on both sides: per-row retained bytes
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const before = (await cdp.send('Runtime.getHeapUsage')).usedSize;
      samples.push(await page.evaluate(o => bench.createShaped(o.n, o.shape), { n, shape }));
      await cdp.send('HeapProfiler.collectGarbage');
      const after = (await cdp.send('Runtime.getHeapUsage')).usedSize;
      await cdp.detach();
      heapDelta = heapDelta ?? [];
      heapDelta.push((after - before) / n);
      await page.close();
    }
    const r = { shape, rows: n, ...stats(samples), heapBytesPerRow: Math.round(stats(heapDelta).median) };
    report.results.push(r);
    console.log(JSON.stringify({ shape, rows: n, median: r.median, range: [r.min, r.max], heapBytesPerRow: r.heapBytesPerRow }));
  }
  await writeFile(join(outDir, 'fold-shape.json'), JSON.stringify(report, null, 2) + '\n');
} finally { if (browser) await browser.close(); server.kill(); }
process.exit(0);
