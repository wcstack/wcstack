// DOM-only floor for the list operations the benchmark fixture drives, so engine cost can be
// separated from platform cost: no wcstack runtime is loaded, the same table markup and CSS
// are used, and timing is MutationObserver-clocked like e2e/bench/jsfb-verify.mjs. Also probes
// whether Element.moveBefore() keeps focus / custom-element state where insertBefore() does
// not. Run from the repository root after `npm ci` in e2e/ (browsers already installed):
//   node scripts/audit-state-tech-dom.mjs [--quick]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { cpus } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'e2e/package.json'));
const { chromium, firefox, webkit } = require('@playwright/test');
const outDir = join(root, 'docs/research/state-next');
await mkdir(outDir, { recursive: true });
const quick = process.argv.includes('--quick');
const S = quick ? 3 : 7;
const port = 4299;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
const pageScript = await readFile(join(root, 'scripts/research/domFloorPage.js'), 'utf8');
const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>dom floor</title>'
  + '<link href="./css/currentStyle.css" rel="stylesheet">'
  + '<script type="importmap">{"imports":{"@lib/buildData":"./buildData.js"}}</script></head>'
  + '<body><div class="container"><table class="table table-hover table-striped test-data"><tbody></tbody></table></div>'
  + '<template id="row"><tr><td class="col-md-1" data-b>#</td><td class="col-md-4"><a data-b>#</a></td>'
  + '<td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr></template>'
  + '<script type="module">import { buildData } from "@lib/buildData";\n' + pageScript + '</script></body></html>';
const stats = samples => { const s = [...samples].sort((a, b) => a - b); return { median: s[s.length >> 1], min: s[0], max: s.at(-1), samples }; };
const errors = [];
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  timestamp: new Date().toISOString(), cpu: cpus()[0].model, quick, browsers: {}, results: [], moveBefore: {}, errors,
};
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
const createVariants = [
  ['clone-path', { make: 'clone', resolve: 'path' }],
  ['import-path', { make: 'import', resolve: 'path' }],
  ['clone-qsa', { make: 'clone', resolve: 'qsa' }],
  ['clone-walker', { make: 'clone', resolve: 'walker' }],
  ['clone-direct', { make: 'clone', resolve: 'path', batch: 'direct' }],
  ['clone-records', { make: 'clone', resolve: 'path', records: true }],
  ['innerHTML', { make: 'html' }],
  ['createElement', { make: 'element' }],
];
async function runBrowser(type, name, full) {
  let browser;
  try { browser = await type.launch({ headless: true }); }
  catch (e) { errors.push(`${name}: launch failed: ${e.message.split('\n')[0]}`); console.log(errors.at(-1)); return; }
  report.browsers[name] = browser.version();
  const record = (throttle, op, variant, n, samples) => {
    const r = { browser: name, throttle, op, variant, n, ...stats(samples) };
    report.results.push(r); console.log(JSON.stringify({ ...r, samples: undefined }));
  };
  async function open(throttle = 1) {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    await page.route('**/benchmark/index.html', r => r.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.bench?.ready);
    if (throttle > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
    return page;
  }
  const clear = page => page.evaluate(() => bench.clear('replaceChildren'));
  const create = (page, n, make = 'clone') => page.evaluate(o => bench.create(o.n, { make: o.make }), { n, make });
  async function repeat(page, count, fn, warm = 0) {
    const samples = [];
    for (let s = 0; s < count + warm; s++) { const t = await fn(s); if (s >= warm) samples.push(t); }
    return samples;
  }
  try {
    for (const throttle of name === 'chromium' ? [1, 4] : [1]) {
      const variants = full && throttle === 1 ? createVariants : createVariants.slice(0, 1);
      for (const n of [1000, 10000]) for (const [variant, opts] of variants) {
        if (throttle > 1 && n === 1000) continue;
        const page = await open(throttle);
        record(throttle, 'create', variant, n, await repeat(page, S, async () => { await clear(page); return page.evaluate(o => bench.create(o.n, o.opts), { n, opts }); }));
        await page.close();
      }
      if (full && throttle === 1) {
        const page = await open();
        record(1, 'create', 'pool-reuse', 10000, await repeat(page, S, async () => {
          await clear(page); await create(page, 10000); await page.evaluate(() => bench.clear('pool')); return create(page, 10000, 'pool');
        }));
        await page.close();
      }
      { const page = await open(throttle);
        record(throttle, 'append', 'clone-path', 1000, await repeat(page, S, async () => { await clear(page); await create(page, 10000); return create(page, 1000); }));
        await page.close(); }
      for (const variant of full && throttle === 1 ? ['replaceChildren', 'textContent', 'innerHTML', 'range', 'removeLast', 'removeFirst'] : ['replaceChildren']) {
        const page = await open(throttle);
        record(throttle, 'clear', variant, 10000, await repeat(page, S, async () => { await create(page, 10000); return page.evaluate(v => bench.clear(v), variant); }));
        await page.close();
      }
    }
    if (full) {
      for (const variant of ['data', 'nodeValue', 'textContent']) {
        const page = await open(); await create(page, 10000);
        record(1, 'update', variant, 10000, await repeat(page, S, () => page.evaluate(v => bench.update(v), variant), 2));
        await page.close();
      }
      for (const n of [1000, 10000]) for (const variant of ['classList', 'className']) {
        const page = await open(); await create(page, n);
        record(1, 'select', variant, n, await repeat(page, S, s => page.evaluate(o => bench.select(o.variant, o.row), { variant, row: s % 2 ? 9 : 4 }), 2));
        await page.close();
      }
      { const page = await open(); await create(page, 1000);
        record(1, 'remove', 'remove', 1000, await repeat(page, S, () => page.evaluate(() => bench.remove(4)), 2));
        await page.close(); }
    }
    const probePage = await open();
    const available = await probePage.evaluate(() => bench.moveBeforeAvailable);
    const probe = { available };
    for (const variant of available ? ['insertBefore', 'moveBefore'] : ['insertBefore']) {
      await clear(probePage); await create(probePage, 1000);
      probe[variant] = await probePage.evaluate(v => bench.moveProbe(v), variant);
    }
    report.moveBefore[name] = probe; console.log(JSON.stringify({ browser: name, moveBefore: probe }));
    await probePage.close();
    for (const variant of available ? ['insertBefore', 'moveBefore'] : ['insertBefore']) {
      const page = await open(); await create(page, 1000);
      record(1, 'swap', variant, 1000, await repeat(page, S, () => page.evaluate(v => bench.swap(v), variant), 2));
      await page.close();
    }
  } catch (e) { errors.push(`${name}: ${e.message.split('\n')[0]}`); console.log(errors.at(-1)); }
  await browser.close();
}
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 75) throw new Error('Server did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  await runBrowser(chromium, 'chromium', true);
  await runBrowser(firefox, 'firefox', false);
  await runBrowser(webkit, 'webkit', false);
  await writeFile(join(outDir, 'dom-floor.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ browsers: report.browsers, results: report.results.length, errors }, null, 2));
} finally { server.kill(); }
