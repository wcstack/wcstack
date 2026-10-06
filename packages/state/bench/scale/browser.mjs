// The scale verification in Chromium (docs/state-engine-rewrite/scale-verification.ja.md §4.4):
// every probe of probes.mjs in a fresh page over the built bundle, timed, its DOM changes and heap
// read. Run from packages/state after `npm run build`, with e2e's Playwright installed:
//   node bench/scale/browser.mjs [--bundle path/to/index.esm.js] [--only L1,N3] [--throttle 4] [--out dir]
// --bundle serves another build in place of dist/index.esm.js (a self-contained ESM bundle).
// The records go to <out>/chromium.json (default: the OS temp directory); report.mjs reads them.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const E2E = join(REPO, 'e2e');
const { chromium } = await import(pathToFileURL(join(E2E, 'node_modules/@playwright/test/index.mjs')).href);
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(arg('port', '4271'));
const BUNDLE = arg('bundle', null);
const ONLY = arg('only', null)?.split(',') ?? null;
const THROTTLE = Number(arg('throttle', '1'));
const OUT = arg('out', join(tmpdir(), 'wcs-scale'));
const URL_ = `http://127.0.0.1:${PORT}/packages/state/bench/scale/page.html`;

async function waitForServer() {
  for (let t = Date.now(); ;) {
    try { if ((await fetch(URL_)).ok) return; } catch { /* not up */ }
    if (Date.now() - t > 15000) throw new Error('server not up');
    await new Promise((r) => setTimeout(r, 200));
  }
}

const fmt = (ms) => (ms == null ? '-' : ms < 1 ? `${(ms * 1000).toFixed(1)} µs` : `${ms.toFixed(2)} ms`);
const server = spawn(process.execPath, ['serve.mjs'], { cwd: E2E, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
let browser;
const results = [];
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });
  const open = async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
    if (BUNDLE) await page.route('**/packages/state/dist/index.esm.js', (r) => r.fulfill({ path: resolve(BUNDLE), contentType: 'text/javascript; charset=utf-8' }));
    // cross-origin isolated: performance.now() is clamped to 100 µs otherwise (5 µs isolated), too
    // coarse for a write of a few µs
    await page.route('**/bench/scale/page.html', async (r) => {
      const res = await r.fetch();
      await r.fulfill({ response: res, headers: { ...res.headers(), 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } });
    });
    if (THROTTLE > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await page.goto(URL_, { waitUntil: 'load' });
    await page.waitForFunction(() => window.scaleReady === true);
    if (!(await page.evaluate(() => window.crossOriginIsolated))) console.warn('[scale] the page is not cross-origin isolated: times are clamped to 100 µs');
    return { ctx, page };
  };
  const first = await open();
  const ids = (await first.page.evaluate(() => window.scaleIds)).filter((id) => ONLY === null || ONLY.includes(id));
  await first.ctx.close();
  for (const id of ids) {
    const { ctx, page } = await open();
    const r = await page.evaluate((x) => window.runScale(x), id);
    results.push(r);
    await ctx.close();
    const lines = [`### ${r.id} ${r.title} — ${r.pass ? 'PASS' : 'FAIL'}`];
    if (r.points) {
      for (const p of r.points) lines.push(`  n=${p.n} ${fmt(p.ms)}${p.dom ? ` dom=${JSON.stringify(p.dom)}` : ''}${p.heap != null ? ` heap=${(p.heap / 1048576).toFixed(2)}MB` : ''}`);
      if (r.k != null) lines.push(`  k=${r.k.toFixed(2)}`);
      if (r.heapPerUnit != null) lines.push(`  heap/unit=${Math.round(r.heapPerUnit)} B`);
    } else {
      for (const row of r.rows) lines.push(`  ${JSON.stringify(row)}`);
    }
    for (const c of r.checks) lines.push(`  ${c.pass ? 'ok' : c.soft ? 'warn' : 'NG'} ${c.name}${c.detail !== undefined ? ` ${typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)}` : ''}`);
    console.log(lines.join('\n'));
  }
} finally {
  await browser?.close();
  server.kill();
}
mkdirSync(OUT, { recursive: true });
const file = join(OUT, 'chromium.json');
writeFileSync(file, JSON.stringify({ env: 'chromium', date: new Date().toISOString(), bundle: BUNDLE ? basename(BUNDLE) : 'dist/index.esm.js', throttle: THROTTLE, results }, null, 2));
console.log(`\n[scale] ${results.length} probes → ${file}`);
