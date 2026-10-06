// Tables from the records of scale.test.ts (happy-dom.json) and browser.mjs (chromium.json):
//   node bench/scale/report.mjs <dir> [--md out.md]
// One row per probe: the verdict in each environment, the sizes, the time at the smallest and the
// largest size, the growth exponent k, and what was counted (happy-dom) or the heap per unit.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) ?? '.';
const mdAt = args.indexOf('--md');
const load = (name) => (existsSync(join(dir, name)) ? JSON.parse(readFileSync(join(dir, name), 'utf8')) : null);
const hd = load('happy-dom.json');
const cr = load('chromium.json');
if (!hd && !cr) throw new Error(`no happy-dom.json or chromium.json in ${dir}`);

const fmt = (ms) => (ms == null ? '-' : ms < 1 ? `${(ms * 1000).toFixed(1)} µs` : ms < 100 ? `${ms.toFixed(2)} ms` : `${Math.round(ms)} ms`);
const byId = (set) => new Map((set?.results ?? []).map((r) => [r.id, r]));
const H = byId(hd);
const C = byId(cr);
const ids = [...new Set([...H.keys(), ...C.keys()])];
const PROPS = { locality: '局所性', linearity: '線形性', boundedness: '有界性', limits: '限界', correctness: '正しさ' };

const verdict = (r) => (r == null ? '-' : r.pass ? (r.checks?.some((c) => c.soft && !c.pass) ? 'PASS（時間は要確認）' : 'PASS') : 'FAIL');
const span = (r) => {
  if (!r?.points) return '-';
  const a = r.points[0];
  const b = r.points[r.points.length - 1];
  return `${a.n} → ${b.n}`;
};
const times = (r) => {
  if (!r?.points || r.points.some((p) => p.ms == null) || r.kind === 'cycles') return '-';
  return `${fmt(r.points[0].ms)} → ${fmt(r.points[r.points.length - 1].ms)}`;
};
const kOf = (r) => (r?.k == null ? '-' : r.k.toFixed(2));
const evidence = (h, c) => {
  const parts = [];
  const counts = h?.points?.[0]?.counts;
  if (counts) {
    const nonzero = Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(', ');
    const chk = h.checks.find((x) => x.name === 'counts');
    parts.push(`回数（${h.points[0].n}）: ${nonzero || 'なし'}${chk ? (chk.pass ? '' : ` ⚠ ${typeof chk.detail === 'string' ? chk.detail : ''}`) : ''}`);
  }
  const stats = h?.points?.[0]?.stats;
  if (stats && (h.kind === 'cycles')) {
    const chk = h.checks.find((x) => x.name === 'stats');
    parts.push(`表: ${Object.entries(stats).map(([k, v]) => `${k} ${v}`).join(', ')}${chk?.pass ? '（一定）' : ' ⚠ 変化'}`);
  }
  for (const [label, r] of [['happy-dom', h], ['Chromium', c]]) {
    if (r?.heapPerUnit != null) parts.push(`ヒープ/回（${label}）: ${Math.round(r.heapPerUnit)} B`);
  }
  if (h?.rows) parts.push(h.rows.map((row) => JSON.stringify(row)).join(' '));
  else if (c?.rows) parts.push(c.rows.map((row) => JSON.stringify(row)).join(' '));
  return parts.join('<br>');
};

const lines = [];
lines.push(`# 規模の検証の結果`);
lines.push('');
lines.push(`- happy-dom: ${hd ? hd.date : '（無し）'}`);
lines.push(`- Chromium: ${cr ? `${cr.date}（${cr.bundle}${cr.throttle > 1 ? `、CPU ${cr.throttle} 倍の減速` : ''}）` : '（無し）'}`);
lines.push('');
lines.push('読み方（docs/state-engine-rewrite/scale-verification.ja.md §1・§4）:');
lines.push('');
lines.push('- 判定は、仕事の回数と DOM の変更の数（happy-dom）、表の大きさ（有界性）、軸ごとの結果（限界・正しさ）で行う。回数を数える軸では、時間の伸びは警告に留める。');
lines.push('- 「PASS（時間は要確認）」は、回数の判定は通り、時間の伸びの指数 k だけが目安（1.25）を超えたもの。happy-dom の DOM 操作の費用で、同じ軸の Chromium の k と比べて読む。');
lines.push('- k は「費用 ∝ 規模^k」の指数（規模 3 段の log-log の傾き）。0 前後は規模に依らない、1 前後は比例。');
lines.push('- 回数は最も小さい規模の値。局所性の軸と、回数を「一定」とした軸は、どの規模でも同じ値だった。');
lines.push('- 時間は書き込みと drain の時間の、中ほど半分の平均。Chromium のページはクロスオリジン分離（時計の刻み 5 µs）。');
lines.push('');
for (const [prop, label] of Object.entries(PROPS)) {
  const rows = ids.filter((id) => (H.get(id) ?? C.get(id)).property === prop);
  if (rows.length === 0) continue;
  lines.push(`## ${label}`);
  lines.push('');
  lines.push('| ID | 軸 | 判定（happy-dom / Chromium） | 規模 | 時間 happy-dom | k | 時間 Chromium | k | 根拠 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const id of rows) {
    const h = H.get(id);
    const c = C.get(id);
    const t = (h ?? c).title;
    lines.push(`| ${id} | ${t} | ${verdict(h)} / ${verdict(c)} | ${span(h ?? c)} | ${times(h)} | ${kOf(h)} | ${times(c)} | ${kOf(c)} | ${evidence(h, c)} |`);
  }
  lines.push('');
}
const all = [...H.values(), ...C.values()];
lines.push(`合計: ${all.filter((r) => r.pass).length} / ${all.length} が PASS。`);
const md = lines.join('\n');
if (mdAt >= 0) writeFileSync(args[mdAt + 1], `${md}\n`);
console.log(md);
