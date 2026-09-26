// Break one jsfb trace down: main-thread time between the click and the last commit,
// by event name (self time of the top-level slices, so nested events are not double counted).
// Usage: node trace-breakdown.mjs <trace.json> [...]
import { readFileSync } from "node:fs";

const NAMES = new Set([
  "EventDispatch", "FunctionCall", "RunMicrotasks", "TimerFire", "FireAnimationFrame",
  "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit", "UpdateLayer",
  "MinorGC", "MajorGC", "V8.GC_SCAVENGER", "V8.GC_MARK_COMPACTOR", "ParseHTML",
  "HitTest", "ScheduleStyleRecalculation", "InvalidateLayout", "v8.evaluateModule",
]);

for (const file of process.argv.slice(2)) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const ev = Array.isArray(raw) ? raw : raw.traceEvents;
  const click = ev.find((e) => e.name === "EventDispatch" && e.args?.data?.type === "click");
  if (!click) { console.log(file, "no click"); continue; }
  const { pid, tid } = click;
  const main = ev.filter((e) => e.pid === pid && e.tid === tid && e.ph === "X" && e.ts >= click.ts);
  const commits = ev.filter((e) => e.pid === pid && (e.name === "Commit" || e.name === "Paint") && e.ts >= click.ts);
  const end = Math.max(...commits.map((e) => e.ts + (e.dur ?? 0)));
  const win = main.filter((e) => e.ts < end).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  // top-level: not contained in an earlier slice
  const top = [];
  let until = -1;
  for (const e of win) {
    if (e.ts >= until) { top.push(e); until = e.ts + e.dur; }
  }
  const byName = {};
  let busy = 0;
  for (const e of top) { busy += e.dur; }
  for (const e of win) {
    if (!NAMES.has(e.name)) continue;
    (byName[e.name] ??= { n: 0, ms: 0 });
    byName[e.name].n++;
    byName[e.name].ms += e.dur / 1000;
  }
  const total = (end - click.ts) / 1000;
  console.log(`\n${file.split(/[\\/]/).pop()}  click→last commit ${total.toFixed(1)} ms, main thread busy ${(busy / 1000).toFixed(1)} ms, idle ${(total - busy / 1000).toFixed(1)} ms`);
  console.log("  top-level:", top.map((e) => `${e.name}@+${((e.ts - click.ts) / 1000).toFixed(1)}(${(e.dur / 1000).toFixed(1)})`).join("  "));
  for (const [k, v] of Object.entries(byName).sort((a, b) => b[1].ms - a[1].ms)) {
    console.log(`  ${k.padEnd(22)} ${String(v.n).padStart(3)}  ${v.ms.toFixed(1)} ms (inclusive)`);
  }
}
