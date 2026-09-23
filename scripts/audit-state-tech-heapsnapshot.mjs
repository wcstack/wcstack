// Attribution of the heap the runtime retains per rendered row (survey §10.7: 3.4 KB per row
// beyond the row records). Two heap snapshots of the benchmark page are taken through CDP,
// before and after creating 10,000 rows (garbage collected first), and their nodes are
// aggregated by constructor / type name; the difference is what the rows added, by name.
// The snapshot format is V8's: `nodes` is a flat array laid out by `snapshot.meta.node_fields`
// (type, name, id, self_size, edge_count, ...), `strings` resolves the names. Fresh page;
// shipped runtime by default, `--proto <file>` measures a prototype build instead.
// Run from the repository root after `npm ci` in e2e/:
//   node scripts/audit-state-tech-heapsnapshot.mjs [--proto <file>] [--fixture manual|tracked] [--top N]
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
const protoPath = arg('--proto', null);
const fixture = arg('--fixture', 'tracked');
const TOP = Number(arg('--top', 40));
const port = 4307;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
// フィクスチャの getter 本文の目印。**この綴りはフィクスチャ内で 1 度しか現れてはならない**
// （String.replace は先頭 1 件しか置換しない — packages/state/__e2e__/benchmark/index.html の NOTE）
const MARKER = 'this.$untrackDependency(() => this.selectedIndex)';
const original = await readFile(join(root, 'packages/state/__e2e__/benchmark/index.html'), 'utf8');
let html = original;
if (fixture === 'tracked') {
  html = original.replace(MARKER, 'this.selectedIndex')
    .replace(/onSelect\(e, \$1\) \{[\s\S]*?\n  \},/, 'onSelect(e, $1) { this.selectedIndex = $1; },');
  // 「変わったか」ではなく**意図した場所が変わったか**を見る。短いリテラルの replace は
  // 先頭 1 件しか置換しないので、フィクスチャのコメント等に同じ綴りが混ざると getter が
  // 無傷のまま素通りし、tracked が manual と同一物になる（サイクル 5 指摘 3）
  if (html === original || html.includes(MARKER)) {
    throw new Error('Fixture replacement failed: the getter still reads the marker literal');
  }
}
const runtime = protoPath === null ? null : await readFile(protoPath, 'utf8').then(s => s.includes('\nbootstrapState();') ? s : s + '\nbootstrapState();\n');
const server = spawn(process.execPath, ['serve.mjs'], { cwd: join(root, 'e2e'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });

async function snapshot(cdp) {
  const chunks = [];
  const onChunk = e => chunks.push(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, treatGlobalObjectsAsRoots: true, captureNumericValue: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  const parsed = JSON.parse(chunks.join(''));
  const fields = parsed.snapshot.meta.node_fields;
  const types = parsed.snapshot.meta.node_types[0];
  const iType = fields.indexOf('type'), iName = fields.indexOf('name'), iSize = fields.indexOf('self_size');
  const stride = fields.length;
  const nodes = parsed.nodes, strings = parsed.strings;
  const bySize = new Map();
  let total = 0, count = 0;
  for (let i = 0; i < nodes.length; i += stride) {
    const type = types[nodes[i + iType]];
    const name = strings[nodes[i + iName]];
    const size = nodes[i + iSize];
    const key = `${type}:${type === 'object' || type === 'closure' || type === 'code' || type === 'array' ? name : ''}`.slice(0, 80);
    const e = bySize.get(key) ?? { size: 0, count: 0 };
    e.size += size; e.count += 1;
    bySize.set(key, e);
    total += size; count += 1;
  }
  return { total, count, bySize };
}
function diff(after, before) {
  const rows = [];
  for (const [key, a] of after.bySize) {
    const b = before.bySize.get(key) ?? { size: 0, count: 0 };
    const dSize = a.size - b.size, dCount = a.count - b.count;
    if (dSize !== 0 || dCount !== 0) rows.push({ key, deltaBytes: dSize, deltaCount: dCount, bytesPerRow: +(dSize / 10000).toFixed(1), countPerRow: +(dCount / 10000).toFixed(2) });
  }
  rows.sort((x, y) => y.deltaBytes - x.deltaBytes);
  return { totalDeltaBytes: after.total - before.total, totalDeltaCount: after.count - before.count, top: rows.slice(0, TOP) };
}

let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 75) throw new Error('Server did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('**/benchmark/index.html', r => r.fulfill({ contentType: 'text/html', body: html }));
  if (runtime !== null) await page.route('**/dist/auto.min.js', r => r.fulfill({ contentType: 'text/javascript', body: runtime }));
  await page.goto(url, { waitUntil: 'networkidle' });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const before = await snapshot(cdp);
  await page.click('#runlots');
  await page.waitForFunction(() => document.querySelectorAll('tbody>tr').length === 10000);
  const after = await snapshot(cdp);
  const d = diff(after, before);
  const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), timestamp: new Date().toISOString(),
    browser: browser.version(), runtime: protoPath === null ? 'dist/auto.min.js (checked in)' : basename(protoPath), fixture, rows: 10000,
    before: { totalBytes: before.total, nodes: before.count }, after: { totalBytes: after.total, nodes: after.count },
    deltaBytesPerRow: +(d.totalDeltaBytes / 10000).toFixed(1), deltaNodesPerRow: +(d.totalDeltaCount / 10000).toFixed(2), top: d.top };
  await writeFile(join(outDir, `heap-snapshot-attribution${protoPath === null ? '' : '-proto'}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ runtime: report.runtime, deltaBytesPerRow: report.deltaBytesPerRow, deltaNodesPerRow: report.deltaNodesPerRow }));
  for (const r of d.top.slice(0, 25)) console.log(`${r.key.padEnd(48)} ${String(r.bytesPerRow).padStart(8)} B/row ${String(r.countPerRow).padStart(7)}/row`);
  await cdp.detach();
  await page.close();
} finally { if (browser) await browser.close(); server.kill(); }
process.exit(0);
