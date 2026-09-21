// Reactive-graph mechanisms behind "every row reads one scalar" and per-row leaf writes,
// measured in Node without a DOM. These are models of the mechanism, not the runtime:
//   P  path-pattern dependency graph: one edge per path pattern, expanded to every row on
//      write, getter re-evaluated per row and applied only when the value changed (the shape
//      of the current design; `manual` is the fixture's hand-written two-row notification)
//   S  one computed cell per row over @wcstack/signals (the dist build in this checkout)
//   K  keyed subscription index: subscribers indexed by the key they compare against
// Every mechanism drives the same stub "DOM" and the same per-field binding bookkeeping; only
// the reactive bookkeeping differs. Run from the repository root:
//   node scripts/audit-state-tech-graph.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';

const root = resolve(import.meta.dirname, '..');
if (typeof globalThis.gc !== 'function') {
  execFileSync(process.execPath, ['--expose-gc', import.meta.filename, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(0);
}
const { signal, computed, effect, createRoot, flushSync } = await import(pathToFileURL(join(root, 'packages/signals/dist/index.esm.js')));
const output = join(root, 'docs/research/state-next');
await mkdir(output, { recursive: true });

class Stub { constructor() { this.className = ''; this.text = ''; } }
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const round = x => Math.round(x * 1000) / 1000;
function makeRows(n, fields) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) { const r = {}; for (let f = 0; f < fields; f++) r['f' + f] = f === 0 ? `row ${i}` : i * 31 + f; rows[i] = r; }
  return rows;
}

function mechanismP(fields) {
  const c = { evals: 0, notified: 0, applied: 0 };
  let rows = [], N = 0, selectedIndex = null, cache = [], stubs = [], records = [];
  const dirty = new Set();
  const drain = () => {
    for (const i of dirty) {
      c.evals++;
      const v = i === selectedIndex;
      if (!Object.is(cache[i], v)) { cache[i] = v; stubs[i].className = v ? 'danger' : ''; c.applied++; }
    }
    dirty.clear();
  };
  return {
    name: 'P path-pattern', counters: c,
    build(data) {
      rows = data; N = data.length; selectedIndex = null; cache = new Array(N).fill(false); stubs = new Array(N); records = new Array(N);
      for (let i = 0; i < N; i++) {
        const st = new Stub(); stubs[i] = st;
        const recs = new Array(fields);
        for (let f = 0; f < fields; f++) { const v = rows[i]['f' + f]; recs[f] = { stub: st, last: v }; if (f === 0) st.text = v; }
        records[i] = recs;
      }
    },
    select(i) { selectedIndex = i; for (let r = 0; r < N; r++) dirty.add(r); c.notified += N; drain(); },
    manualSelect(i) { const old = selectedIndex; selectedIndex = i; if (old !== null) dirty.add(old); dirty.add(i); c.notified += dirty.size; drain(); },
    setField(i, f, v) { rows[i]['f' + f] = v; const rec = records[i][f]; c.notified++; c.evals++; if (!Object.is(rec.last, v)) { rec.last = v; if (f === 0) rec.stub.text = v; c.applied++; } },
    replace(data) { this.build(data); },
    dispose() { rows = []; cache = []; stubs = []; records = []; dirty.clear(); },
  };
}

function mechanismS(fields) {
  const c = { evals: 0, notified: 0, applied: 0 };
  let dispose = null, cells = [];
  const sel = signal(null);
  return {
    name: 'S signals cell-per-row', counters: c,
    build(data) {
      const N = data.length; cells = new Array(N); sel.set(null);
      createRoot(d => {
        dispose = d;
        for (let i = 0; i < N; i++) {
          const st = new Stub();
          const sigs = new Array(fields);
          for (let f = 0; f < fields; f++) {
            const s = signal(data[i]['f' + f]); sigs[f] = s;
            if (f === 0) effect(() => { c.evals++; st.text = s.get(); c.applied++; });
            else effect(() => { c.evals++; s.get(); c.applied++; });
          }
          const selected = computed(() => { c.evals++; return i === sel.get(); });
          effect(() => { c.evals++; st.className = selected.get() ? 'danger' : ''; c.applied++; });
          cells[i] = { sigs, selected, st };
        }
      });
      flushSync();
    },
    select(i) { sel.set(i); c.notified++; flushSync(); },
    setField(i, f, v) { cells[i].sigs[f].set(v); c.notified++; flushSync(); },
    replace(data) { dispose?.(); this.build(data); },
    dispose() { dispose?.(); dispose = null; cells = []; flushSync(); },
  };
}

function mechanismK(fields) {
  const c = { evals: 0, notified: 0, applied: 0 };
  let rows = [], selectedIndex = null, records = [];
  const byKey = new Map();
  return {
    name: 'K keyed index', counters: c,
    build(data) {
      rows = data; const N = data.length; selectedIndex = null; records = new Array(N); byKey.clear();
      for (let i = 0; i < N; i++) {
        const st = new Stub();
        const recs = new Array(fields);
        for (let f = 0; f < fields; f++) { const v = rows[i]['f' + f]; recs[f] = { stub: st, last: v }; if (f === 0) st.text = v; }
        records[i] = recs;
        let last = false;
        byKey.set(i, () => { c.evals++; const v = i === selectedIndex; if (!Object.is(last, v)) { last = v; st.className = v ? 'danger' : ''; c.applied++; } });
      }
    },
    select(i) { const old = selectedIndex; selectedIndex = i; if (old !== null) { c.notified++; byKey.get(old)?.(); } c.notified++; byKey.get(i)?.(); },
    setField(i, f, v) { rows[i]['f' + f] = v; const rec = records[i][f]; c.notified++; c.evals++; if (!Object.is(rec.last, v)) { rec.last = v; if (f === 0) rec.stub.text = v; c.applied++; } },
    replace(data) { this.build(data); },
    dispose() { rows = []; records = []; byKey.clear(); },
  };
}

const mechanisms = { P: mechanismP, S: mechanismS, K: mechanismK };
const REP = 7;
const results = [];
const snap = c => ({ ...c });
const delta = (a, b) => ({ evals: b.evals - a.evals, notified: b.notified - a.notified, applied: b.applied - a.applied });
function record(r) { results.push(r); console.log(JSON.stringify(r)); }
for (const N of [1000, 10000]) for (const [key, make] of Object.entries(mechanisms)) {
  // build
  let samples = [];
  for (let r = 0; r < REP; r++) { const m = make(1); const data = makeRows(N, 1); const t = performance.now(); m.build(data); samples.push(performance.now() - t); m.dispose(); }
  record({ mechanism: key, n: N, op: 'build', medianMs: round(median(samples)) });
  // selection change (20 alternating), per-op median
  {
    const m = make(1); m.build(makeRows(N, 1));
    for (let w = 0; w < 3; w++) m.select(w % 2 ? 10 : 5);
    samples = []; const counts = [];
    for (let k = 0; k < 20; k++) { const before = snap(m.counters); const t = performance.now(); m.select(k % 2 ? 10 : 5); samples.push(performance.now() - t); counts.push(delta(before, m.counters)); }
    record({ mechanism: key, n: N, op: 'select', medianMs: round(median(samples)), perOp: { evals: median(counts.map(c => c.evals)), notified: median(counts.map(c => c.notified)), applied: median(counts.map(c => c.applied)) } });
    if (m.manualSelect) {
      samples = []; const counts2 = [];
      for (let k = 0; k < 20; k++) { const before = snap(m.counters); const t = performance.now(); m.manualSelect(k % 2 ? 10 : 5); samples.push(performance.now() - t); counts2.push(delta(before, m.counters)); }
      record({ mechanism: key, n: N, op: 'select-manual', medianMs: round(median(samples)), perOp: { evals: median(counts2.map(c => c.evals)), notified: median(counts2.map(c => c.notified)), applied: median(counts2.map(c => c.applied)) } });
    }
    m.dispose();
  }
  // update every 10th row's first field
  {
    const m = make(1); m.build(makeRows(N, 1));
    samples = []; let counts = null;
    for (let r = 0; r < REP + 2; r++) {
      const before = snap(m.counters); const t = performance.now();
      for (let i = 0; i < N; i += 10) m.setField(i, 0, `row ${i} !${r}`);
      const dt = performance.now() - t; if (r >= 2) { samples.push(dt); counts = delta(before, m.counters); }
    }
    record({ mechanism: key, n: N, op: 'update-every-10th', medianMs: round(median(samples)), perOp: counts });
    m.dispose();
  }
  // replace all rows
  {
    const m = make(1); m.build(makeRows(N, 1));
    samples = [];
    for (let r = 0; r < REP; r++) { const data = makeRows(N, 1); const t = performance.now(); m.replace(data); samples.push(performance.now() - t); }
    record({ mechanism: key, n: N, op: 'replace', medianMs: round(median(samples)) });
    m.dispose();
  }
}
// memory: reactive bookkeeping per row, 10,000 rows, 1 and 10 bound fields
const memory = [];
for (const fields of [1, 10]) for (const [key, make] of Object.entries(mechanisms)) {
  const samples = [];
  for (let r = 0; r < 3; r++) {
    const data = makeRows(10000, fields);
    const m = make(fields);
    globalThis.gc(); globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    m.build(data);
    globalThis.gc(); globalThis.gc();
    const after = process.memoryUsage().heapUsed;
    samples.push((after - before) / 10000);
    m.dispose();
  }
  const r = { mechanism: key, n: 10000, fields, bytesPerRow: Math.round(median(samples)) };
  memory.push(r); console.log(JSON.stringify(r));
}
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  timestamp: new Date().toISOString(), node: process.version, cpu: cpus()[0].model,
  signalsDist: 'packages/signals/dist/index.esm.js', repetitions: REP,
  note: 'Models of the mechanisms, not the wcstack runtime; the browser measurement of the real runtime is in selection-and-profiles.json.',
  results, memory,
};
await writeFile(join(output, 'graph-mechanisms.json'), JSON.stringify(report, null, 2) + '\n');
