// Selection fan-out and named CPU profiles; no runtime or fixture files are changed.
// Run after audit-state-next.mjs, with no other performance driver running.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'e2e/package.json'));
const { chromium } = require('@playwright/test');
const outDir = join(root, 'docs/research/state-next');
const build = JSON.parse(await readFile(join(outDir, 'size-and-syntax.json'), 'utf8'));
// フィクスチャの getter 本文の目印。**この綴りはフィクスチャ内で 1 度しか現れてはならない**
// （String.replace は先頭 1 件しか置換しない — packages/state/__e2e__/benchmark/index.html の NOTE）
const MARKER = 'this.$untrackDependency(() => this.selectedIndex)';
const html = await readFile(join(root, 'packages/state/__e2e__/benchmark/index.html'), 'utf8');
const namedCode = await readFile(join(build.temporaryBuildDirectory, 'index.esm.js'), 'utf8');
const port = 4298;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'),
  env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
let browser;
const errors = [];
const results = { revision: build.revision, timestamp: new Date().toISOString(), selection: [], profiles: [], errors };
const stats = samples => {
  const sorted = [...samples].sort((a,b) => a-b);
  return { median: sorted[sorted.length >> 1], min: sorted[0], max: sorted.at(-1), samples };
};
async function click(page, selector, rowCount) {
  return page.evaluate(({ selector, rowCount }) => new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    const timer = setTimeout(() => { mo.disconnect(); reject(new Error('DOM timeout')); }, 30000);
    let start;
    const mo = new MutationObserver(() => {
      if (rowCount !== null && document.querySelectorAll('tbody>tr').length !== rowCount) return;
      mo.disconnect(); clearTimeout(timer); resolve(performance.now() - start);
    });
    mo.observe(document.querySelector('tbody'), { childList: true, subtree: true, attributes: true, characterData: true });
    start = performance.now();
    element.click();
  }), { selector, rowCount });
}
async function pageFor({ natural = false, named = false } = {}) {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  let content = html;
  if (natural) {
    content = content.replace(MARKER, 'this.selectedIndex')
      .replace(/onSelect\(e, \$1\) \{[\s\S]*?\n  \},/, 'onSelect(e, $1) { this.selectedIndex = $1; },');
    // 「変わったか」ではなく**意図した場所が変わったか**を見る。短いリテラルの replace は
    // 先頭 1 件しか置換しないので、フィクスチャのコメント等に同じ綴りが混ざると getter が
    // 無傷のまま素通りし、natural が manual と同一物になる（サイクル 5 指摘 3）
    if (content === html || content.includes(MARKER) || content.includes('onSelect(e, $1) {\r\n')) {
      throw new Error('Fixture replacement failed: the getter still reads the marker literal');
    }
  }
  await page.route('**/benchmark/index.html', route => route.fulfill({ contentType: 'text/html', body: content }));
  if (named) await page.route('**/dist/auto.min.js', route => route.fulfill({ contentType: 'text/javascript', body: namedCode + '\nbootstrapState();\n' }));
  await page.goto(url, { waitUntil: 'networkidle' });
  return page;
}
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 75) throw new Error('Server did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  results.browser = browser.version();
  for (const natural of [false, true]) for (const count of [1000, 10000]) {
    const page = await pageFor({ natural });
    await click(page, count === 1000 ? '#run' : '#runlots', count);
    const samples = [];
    for (let i = 0; i < 18; i++) {
      const row = i % 2 ? 10 : 5;
      const elapsed = await click(page, `tbody>tr:nth-of-type(${row})>td:nth-of-type(2)>a`, null);
      const valid = await page.evaluate(row => document.querySelectorAll('tbody>tr.danger').length === 1 &&
        document.querySelector(`tbody>tr:nth-of-type(${row})`).classList.contains('danger'), row);
      if (!valid) throw new Error('Selection correctness check failed');
      if (i >= 3) samples.push(elapsed);
    }
    const result = { variant: natural ? 'tracked getter' : 'manual two-row invalidation', count, ...stats(samples) };
    results.selection.push(result); console.log(JSON.stringify(result));
    await page.close();
  }
  const contractPage = await pageFor();
  results.apiContracts = await contractPage.evaluate(() => {
    const element = document.querySelector('wcs-state');
    const result = {};
    element.createState('writable', s => {
      s.selectedIndex = 7;
      s.$resolve('selectedIndex', [], undefined);
      result.resolveUndefined = s.selectedIndex;
    });
    element.createState('readonly', s => {
      try { s.selectedIndex = 8; result.directReadonlyWrite = 'accepted'; }
      catch (e) { result.directReadonlyWrite = e.message; }
      try { s.$resolve('selectedIndex', [], 9); result.resolveReadonlyWrite = s.selectedIndex; }
      catch (e) { result.resolveReadonlyWrite = e.message; }
      try { s.$setAll('selectedIndex', [], 10); result.setAllReadonlyWrite = s.selectedIndex; }
      catch (e) { result.setAllReadonlyWrite = e.message; }
    });
    return result;
  });
  await contractPage.close();
  const valuePage = await browser.newPage();
  valuePage.on('pageerror', e => errors.push(e.message));
  await valuePage.route('**/benchmark/index.html', route => route.fulfill({ contentType: 'text/html', body:
    `<script type="module" src="../../dist/auto.min.js"></script><wcs-state json='{"x":"seed"}'></wcs-state>` +
    '<span id="prop" data-wcs="textContent: x"></span><span id="text">{{x}}</span><span id="attr" data-wcs="attr.title: x"></span>' }));
  await valuePage.goto(url, { waitUntil: 'networkidle' });
  await valuePage.waitForFunction(() => document.querySelector('#text').textContent === 'seed');
  results.emptyValueSemantics = await valuePage.evaluate(async () => {
    const snapshots = [];
    for (const value of [undefined, null]) {
      document.querySelector('wcs-state').createState('writable', s => { s.x = value; });
      await new Promise(r => setTimeout(r, 0));
      snapshots.push({ input: String(value), property: document.querySelector('#prop').textContent,
        mustache: document.querySelector('#text').textContent, attribute: document.querySelector('#attr').getAttribute('title') });
    }
    return snapshots;
  });
  await valuePage.close();
  // Named unminified runtime, CPU sampling enabled: diagnostic profiles, not benchmark timings.
  for (const op of ['create10k', 'append1kTo10k', 'clear10k']) {
    const page = await pageFor({ named: true });
    if (op !== 'create10k') await click(page, '#runlots', 10000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
    const elapsed = await click(page, op === 'create10k' ? '#runlots' : op === 'clear10k' ? '#clear' : '#add',
      op === 'create10k' ? 10000 : op === 'clear10k' ? 0 : 11000);
    const { profile } = await cdp.send('Profiler.stop');
    const byId = new Map(profile.nodes.map(n => [n.id, n.callFrame]));
    const self = new Map();
    profile.samples.forEach((id, i) => {
      const f = byId.get(id); const key = `${f.functionName || '(anonymous)'}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + profile.timeDeltas[i]);
    });
    const result = { op, elapsed, topSelfMs: [...self].sort((a,b) => b[1]-a[1]).slice(0, 25).map(([fn, us]) => ({ fn, ms: us/1000 })) };
    results.profiles.push(result); console.log(JSON.stringify(result));
    await page.close();
  }
  await writeFile(join(outDir, 'selection-and-profiles.json'), JSON.stringify(results, null, 2) + '\n');
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
} finally { if (browser) await browser.close(); server.kill(); }
