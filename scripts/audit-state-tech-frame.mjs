// Does a rendered frame between creating rows and clearing them change the cost of the clear?
// The clear's script time inside the runtime was seen at about 21 ms in some harness runs and
// about 60–70 ms in others, with no Layout or GC events in the traced window, so the extra
// time must sit inside the DOM calls the script makes. Two pages are measured, each with the
// clear performed (a) immediately after creation, in the same task (no frame can render),
// (b) after two requestAnimationFrame callbacks (a frame rendered, layout computed), and
// (c) after a setTimeout(0) task boundary. Bare DOM: the DOM-floor page and replaceChildren()
// timed synchronously. Runtime: the benchmark fixture with the shipped auto.min.js and the
// click → MutationObserver timing. Fresh page per sample. Run from the repository root after
// `npm ci` in e2e/, with no other performance driver running:
//   node scripts/audit-state-tech-frame.mjs
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
const N = 6;
const port = 4302;
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
const WAITS = {
  immediate: 'return Promise.resolve();',
  raf: 'return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));',
  task: 'return new Promise(r => setTimeout(r, 0));',
};
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
  // (1) bare DOM: create 10,000 rows, wait per variant, time replaceChildren() synchronously
  for (const [wait, waitSrc] of Object.entries(WAITS)) {
    const samples = [];
    for (let i = 0; i < N; i++) {
      const page = await browser.newPage();
      await page.route('**/benchmark/index.html', r => r.fulfill({ contentType: 'text/html', body: domHtml }));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.bench?.ready);
      samples.push(await page.evaluate(async waitSrc => {
        await bench.create(10000, { make: 'clone' });
        await new Function(waitSrc)();
        const tbody = document.querySelector('tbody');
        const t = performance.now();
        tbody.replaceChildren();
        return performance.now() - t;
      }, waitSrc));
      await page.close();
    }
    const r = { page: 'bare DOM (replaceChildren, synchronous)', wait, rows: 10000, ...stats(samples) };
    report.results.push(r); console.log(JSON.stringify({ page: r.page, wait, median: r.median, range: [r.min, r.max] }));
  }
  // (2) shipped runtime: click #runlots, wait per variant, time click #clear → MutationObserver
  for (const [wait, waitSrc] of Object.entries(WAITS)) {
    const samples = [];
    for (let i = 0; i < N; i++) {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });
      samples.push(await page.evaluate(async waitSrc => {
        const click = (selector, rowCount) => new Promise((res, rej) => {
          const to = setTimeout(() => rej(new Error('timeout ' + selector)), 15000);
          const mo = new MutationObserver(() => {
            if (document.querySelectorAll('tbody>tr').length !== rowCount) return;
            clearTimeout(to); mo.disconnect(); res(performance.now() - t0);
          });
          mo.observe(document.querySelector('tbody'), { childList: true, subtree: true, attributes: true, characterData: true });
          const t0 = performance.now();
          document.querySelector(selector).click();
        });
        await click('#runlots', 10000);
        await new Function(waitSrc)();
        return click('#clear', 0);
      }, waitSrc));
      await page.close();
    }
    const r = { page: 'shipped runtime (click #clear → MutationObserver)', wait, rows: 10000, ...stats(samples) };
    report.results.push(r); console.log(JSON.stringify({ page: r.page, wait, median: r.median, range: [r.min, r.max] }));
  }
  await writeFile(join(outDir, 'frame-vs-clear.json'), JSON.stringify(report, null, 2) + '\n');
} finally { if (browser) await browser.close(); server.kill(); }
process.exit(0);
