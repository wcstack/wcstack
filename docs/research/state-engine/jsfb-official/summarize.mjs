// Summarize webdriver-ts/results the way webdriver-ts-results does (Common.ts):
// median per benchmark, factor = value / fastest among the frameworks shown,
// CPU geometric mean weighted with the official benchmarkWeights, others unweighted.
// Usage: node summarize.mjs <resultsDir> [--json out.json]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "webdriver-ts/results";
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;

const CPU = [
  ["01_run1k", "create rows (1k)"],
  ["02_replace1k", "replace all rows (1k)"],
  ["03_update10th1k_x16", "partial update (every 10th of 1k, 4x)"],
  ["04_select1k", "select row (4x)"],
  ["05_swap1k", "swap rows (4x)"],
  ["06_remove-one-1k", "remove row (2x)"],
  ["07_create10k", "create many rows (10k)"],
  ["08_create1k-after1k_x2", "append 1k to 1k (2x)"],
  ["09_clear1k_x8", "clear 1k rows (4x)"],
];
const WEIGHTS = [
  0.64280248137063, 0.5607178150466176, 0.5643800750716564, 0.1925635870170522, 0.13200612879341714,
  0.5277091212292658, 0.5644449600965534, 0.5508359820582848, 0.4225836631419211,
];
const MEM = [
  ["21_ready-memory", "ready memory"],
  ["22_run-memory", "run memory (1k rows)"],
  ["25_run-clear-memory", "create/clear 1k x5"],
];
const SIZE = [
  ["41_size-uncompressed", "uncompressed size"],
  ["42_size-compressed", "compressed size"],
  ["43_first-paint", "first paint"],
];
const ORDER = ["vanillajs", "wcstack-signals", "wcstack-state-next", "wcstack-state-next-compact", "wcstack-state-next-core", "wcstack-state"];

const results = {};
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".json")) continue;
  const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const name = r.framework.replace(/-v[0-9][^_]*-keyed$/, "").replace(/-keyed$/, "");
  (results[name] ??= {})[r.benchmark] = r.values;
}
const names = ORDER.filter((n) => results[n]).concat(Object.keys(results).filter((n) => !ORDER.includes(n)));

const pick = (name, bench, key = "total") => {
  const v = results[name]?.[bench];
  if (!v) return null;
  return (v[key] ?? v.DEFAULT ?? Object.values(v)[0]) ?? null;
};
const ci95 = (s) => (s && s.values?.length > 1 ? (1.959964 * (s.stddev ?? s.standardDeviation ?? 0)) / Math.sqrt(s.values.length) : 0);
const fmt = (x, d = 1) => (x == null ? "—" : x.toFixed(d));

function table(title, rows, { weights = null, key = "total", unit = "", digits = 1, showCI = false } = {}) {
  const out = [];
  out.push(`### ${title}`, "");
  out.push(`| benchmark | ${names.join(" | ")} |`);
  out.push(`|---|${names.map(() => "---:").join("|")}|`);
  const logs = Object.fromEntries(names.map((n) => [n, { s: 0, w: 0 }]));
  const data = [];
  rows.forEach(([id, label], i) => {
    const vals = names.map((n) => pick(n, id, key));
    const meds = vals.map((v) => v?.median ?? null);
    const min = Math.min(...meds.filter((m) => m != null && m > 0));
    const cells = vals.map((v, j) => {
      if (v == null) return "—";
      const f = meds[j] / min;
      const w = weights ? weights[i] : 1;
      logs[names[j]].s += w * Math.log(f);
      logs[names[j]].w += w;
      const ci = showCI ? ` ±${fmt(ci95(v))}` : "";
      return `${fmt(meds[j], digits)}${unit}${ci} (${f.toFixed(2)})`;
    });
    data.push({ id, label, values: Object.fromEntries(names.map((n, j) => [n, vals[j] && { median: meds[j], factor: meds[j] / min, ci95: ci95(vals[j]) }])) });
    out.push(`| ${label} | ${cells.join(" | ")} |`);
  });
  const gm = names.map((n) => (logs[n].w ? Math.exp(logs[n].s / logs[n].w) : null));
  out.push(`| **geometric mean${weights ? " (weighted)" : ""}** | ${gm.map((g) => (g == null ? "—" : `**${g.toFixed(2)}**`)).join(" | ")} |`);
  out.push("");
  return { md: out.join("\n"), data, geomean: Object.fromEntries(names.map((n, i) => [n, gm[i]])) };
}

const cpu = table("CPU (ms, median; factor vs fastest)", CPU, { weights: WEIGHTS, showCI: true });
const script = table("CPU — script only (ms, median)", CPU, { key: "script" });
const paint = table("CPU — paint only (ms, median)", CPU, { key: "paint" });
const mem = table("Memory (MB, median)", MEM, { digits: 2 });
const size = table("Size and first paint", SIZE, { digits: 1 });
console.log([cpu.md, script.md, paint.md, mem.md, size.md].join("\n"));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ frameworks: names, cpu, script, paint, mem, size }, null, 2));
