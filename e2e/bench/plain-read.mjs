// Read-cost benchmark: ns per read through the state proxy, per address shape
// (R1 plain / R2 getter / R3 row — see packages/state/__e2e__/benchmark-read/index.html).
// docs/state-address-unification-impl-plan.md §4-4, decision rule §5-2.
//
// Usage (from e2e/):
//   node bench/plain-read.mjs --label main
//   node bench/plain-read.mjs --label placement \
//     --variant main=C:/abs/main/auto.js --variant main-again=C:/abs/main/auto.js \
//     --variant a2=C:/abs/a2/auto.js --variant b=C:/abs/b/auto.js
//
// --variant <name>=<bundle> swaps the state bundle the page loads for that file, by intercepting
// the request — the tracked packages/state/dist is never rewritten. Without --variant the page
// loads the tracked dist as the single variant "dist".
//
// Variants are measured interleaved, round by round, with the order rotated each round, so
// thermal drift and background load land on every variant alike. Give the same bundle twice
// (main / main-again) to get the noise floor: the delta between two runs of identical code.
// Every delta is reported against the FIRST variant.
//
// The statistic that decides is the MINIMUM (best-of), with p25 beside it as a cross-check —
// not the median. Measured 2026-09-18: identical bundles land, per page load, in one of two
// modes almost exactly 2x apart (~44 vs ~83 ns for R1), so two medians of the same code
// differed by 25%. That noise is additive (scheduling / core class / JIT tier); the code's
// own cost is the floor it is added to, and the minimum estimates that floor.

import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const E2E_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
function argOf(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}
function argsOf(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === `--${name}` && args[i + 1] !== undefined) out.push(args[i + 1]);
  return out;
}
const PORT = Number(argOf("port", "4251"));
const LABEL = argOf("label", "run");
const ROUNDS = Number(argOf("rounds", "12"));      // page loads per variant
const SAMPLES = Number(argOf("samples", "5"));     // timed samples per page load per shape
const WARMUP = Number(argOf("warmup", "3"));       // untimed samples per page load per shape (JIT)
const READS = Number(argOf("reads", "2000000"));   // reads per sample
const THROTTLE = Number(argOf("throttle", "1"));
const OUT = argOf("out", `bench-results/address-unification-read-${LABEL}.json`);
const PAGE_URL = `http://127.0.0.1:${PORT}/packages/state/__e2e__/benchmark-read/index.html`;
const SHAPES = [["R1 plain", "readPlain"], ["R2 getter", "readGetter"], ["R3 row", "readRow"]];

const VARIANTS = argsOf("variant").map((spec) => {
  const eq = spec.indexOf("=");
  if (eq <= 0) throw new Error(`--variant expects <name>=<bundle path>, got: ${spec}`);
  return { name: spec.slice(0, eq), bundle: resolve(spec.slice(eq + 1)) };
});
if (VARIANTS.length === 0) VARIANTS.push({ name: "dist", bundle: null });

async function waitForServer(url, timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { const res = await fetch(url); if (res.ok) return; } catch { /* not up */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`server not reachable: ${url}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
const round2 = (x) => +x.toFixed(2);
const signed = (x) => (x >= 0 ? "+" : "") + x;

/** One fresh page per variant per round: a new realm, so no variant inherits another's JIT state. */
async function measureOnce(browser, variant) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  if (variant.bundle !== null) {
    await page.route("**/packages/state/dist/auto.min.js", (route) =>
      route.fulfill({ path: variant.bundle, contentType: "text/javascript; charset=utf-8" }));
  }
  if (THROTTLE > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  }
  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true" && window.__readBench.rows() === 1000);
  const result = {};
  for (const [shape, method] of SHAPES) {
    const run = () => page.evaluate(([m, n]) => window.__readBench.sample(m, n), [method, READS]);
    for (let i = 0; i < WARMUP; i++) await run();
    const nsPerRead = [];
    let checksum;
    for (let i = 0; i < SAMPLES; i++) {
      const sample = await run();
      nsPerRead.push((sample.ms * 1e6) / READS);
      checksum = sample.checksum;
    }
    result[shape] = { nsPerRead, checksum };
  }
  await context.close();
  if (pageErrors.length > 0) throw new Error(`[${variant.name}] page errors: ${pageErrors.join(" | ")}`);
  return result;
}

async function main() {
  const server = spawn(process.execPath, ["serve.mjs"], {
    cwd: E2E_DIR, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
  });
  let browser;
  try {
    await waitForServer(PAGE_URL);
    browser = await chromium.launch({ headless: true });
    const samples = Object.fromEntries(VARIANTS.map((v) => [v.name, Object.fromEntries(SHAPES.map(([s]) => [s, []]))]));
    const checksums = {};
    for (let round = 0; round < ROUNDS; round++) {
      // rotate the order so no variant always runs first (coldest) or last (hottest)
      const order = VARIANTS.map((_, i) => VARIANTS[(i + round) % VARIANTS.length]);
      for (const variant of order) {
        const measured = await measureOnce(browser, variant);
        for (const [shape] of SHAPES) {
          samples[variant.name][shape].push(...measured[shape].nsPerRead);
          // every variant must have computed the same thing, or the comparison is meaningless
          checksums[shape] ??= measured[shape].checksum;
          if (checksums[shape] !== measured[shape].checksum) {
            throw new Error(`[${variant.name}] ${shape}: checksum ${measured[shape].checksum} != ${checksums[shape]}`);
          }
        }
      }
      console.log(`[${LABEL}] round ${round + 1}/${ROUNDS} done`);
    }

    const base = VARIANTS[0].name;
    const summary = {};
    for (const variant of VARIANTS) {
      summary[variant.name] = {};
      for (const [shape] of SHAPES) {
        const xs = samples[variant.name][shape];
        const baseXs = samples[base][shape];
        const min = Math.min(...xs), baseMin = Math.min(...baseXs);
        const p25 = quantile(xs, 0.25), baseP25 = quantile(baseXs, 0.25);
        summary[variant.name][shape] = {
          minNs: round2(min), p25Ns: round2(p25), medianNs: round2(quantile(xs, 0.5)), maxNs: round2(Math.max(...xs)),
          deltaMinNs: round2(min - baseMin), deltaMinPct: round2(((min - baseMin) / baseMin) * 100),
          deltaP25Ns: round2(p25 - baseP25), deltaP25Pct: round2(((p25 - baseP25) / baseP25) * 100),
          samplesNs: xs.map(round2),
        };
      }
    }

    console.log(`\n[${LABEL}] ns/read over ${ROUNDS} page loads x ${SAMPLES} samples (delta vs "${base}")  reads/sample=${READS} throttle=x${THROTTLE}`);
    console.log(`    ${"variant".padEnd(14)} ${"min".padStart(8)} ${"p25".padStart(8)} ${"median".padStart(8)} ${"max".padStart(8)}   ${"delta(min)".padEnd(19)}delta(p25)`);
    for (const [shape] of SHAPES) {
      console.log(`  ${shape}`);
      for (const variant of VARIANTS) {
        const s = summary[variant.name][shape];
        const delta = variant.name === base
          ? ""
          : `   ${`${signed(s.deltaMinNs)}ns (${signed(s.deltaMinPct)}%)`.padEnd(19)}${signed(s.deltaP25Ns)}ns (${signed(s.deltaP25Pct)}%)`;
        console.log(`    ${variant.name.padEnd(14)} ${String(s.minNs).padStart(8)} ${String(s.p25Ns).padStart(8)} ${String(s.medianNs).padStart(8)} ${String(s.maxNs).padStart(8)}${delta}`);
      }
    }

    const result = {
      label: LABEL, timestamp: new Date().toISOString(),
      config: { rounds: ROUNDS, samplesPerPage: SAMPLES, warmup: WARMUP, reads: READS, throttle: THROTTLE, base },
      variants: VARIANTS, checksums, summary,
    };
    await mkdir(dirname(resolve(OUT)), { recursive: true });
    await writeFile(resolve(OUT), JSON.stringify(result, null, 2));
    console.log(`\nwritten: ${resolve(OUT)}`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
