// Pools the samples of one run-all.sh session across rounds and prints:
//   - per measure: median per bundle, the A/A floor (current vs currentB), next vs current
//   - the two targets: next / DOM floor under the same condition (warm 1,000, cold 10,000)
//   - the gzip size of state-next's auto bundle
// Run from the repository root: node packages/state-next/bench/summarize.mjs <dir>
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dir = process.argv[2] ?? "docs/research/state-engine/bench";
const files = await readdir(dir);
const pool = {}; // measure -> bundle -> samples[]
const add = (measure, bundle, samples) => {
  ((pool[measure] ??= {})[bundle] ??= []).push(...samples);
};
let floor = null;

for (const f of files) {
  if (f === "summary.json") continue;
  const j = JSON.parse(await readFile(join(dir, f), "utf8"));
  let m;
  if (f === "dom-floor-cold-warm.json") {
    floor = j;
  } else if ((m = f.match(/^jsfb-(\w+)-r\d+\.json$/))) {
    for (const [op, s] of Object.entries(j.timings)) add(`jsfb ${op} (cold page)`, m[1], s.samples);
    add("keyed (1 = passed)", m[1], [j.keyed.keyed ? 1 : 0]);
  } else if ((m = f.match(/^warm-vs-cold-.*statenext-(\w+)-r\d+\.json$/))) {
    for (const r of j.results) {
      add(`${r.op} cold`, m[1], r.cold.samples);
      if (r.warm) add(`${r.op} warm`, m[1], r.warm.samples);
    }
  } else if ((m = f.match(/^select-(\w+)-(\w+)-r\d+\.json$/))) {
    add(`select10k ${m[2]}`, m[1], j.select10k.samples);
    add(`remove1of10k ${m[2]}`, m[1], j.remove1of10k.samples);
  }
}

const median = (xs) => {
  if (!xs || xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};
const r2 = (x) => Math.round(x * 100) / 100;

const bundles = [...new Set(Object.values(pool).flatMap((p) => Object.keys(p)))];
const other = bundles.filter((b) => b !== "current" && b !== "currentB");
const rows = [];
for (const measure of Object.keys(pool).sort()) {
  const p = pool[measure];
  const cur = median([...(p.current ?? []), ...(p.currentB ?? [])]);
  const row = { measure, current: r2(median(p.current)), currentB: r2(median(p.currentB)) };
  row.aaPct = r2((100 * Math.abs(row.current - row.currentB)) / cur);
  for (const b of other) {
    row[b] = r2(median(p[b]));
    row[`${b}VsCurrentPct`] = r2((100 * (median(p[b]) - cur)) / cur);
  }
  rows.push(row);
}

const targets = {};
if (floor) {
  for (const b of other) {
    const warm1k = median(pool["create1k warm"]?.[b]);
    const cold10k = median(pool["create10k cold"]?.[b]);
    targets[b] = {
      "create1k warm": { engine: r2(warm1k), dom: floor.create1000.warm, ratio: r2(warm1k / floor.create1000.warm), pass: warm1k / floor.create1000.warm <= 2 },
      "create10k cold": { engine: r2(cold10k), dom: floor.create10000.cold, ratio: r2(cold10k / floor.create10000.cold), pass: cold10k / floor.create10000.cold <= 2 },
    };
  }
}

const bundlePath = "packages/state-next/dist/auto.min.js";
const code = await readFile(bundlePath);
const size = { file: bundlePath, bytes: code.length, gzip: gzipSync(code, { level: 9 }).length };

const cols = ["measure", "current", "currentB", "aaPct", ...other.flatMap((b) => [b, `${b}VsCurrentPct`])];
console.log(cols.join("\t"));
for (const r of rows) console.log(cols.map((c) => r[c]).join("\t"));
console.log("targets (engine / DOM floor, same condition, ≤ 2):", JSON.stringify(targets));
console.log("size:", JSON.stringify(size));
await writeFile(join(dir, "summary.json"), JSON.stringify({ timestamp: new Date().toISOString(), rows, targets, size }, null, 2));
