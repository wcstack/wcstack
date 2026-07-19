// js-framework-benchmark style MEMORY measurement driver for
// packages/state/__e2e__/benchmark/index.html (or --page <other bench page>).
//
// Mirrors the official memory benchmarks (krausest/js-framework-benchmark
// webdriver-ts memory suite): force GC via CDP HeapProfiler.collectGarbage,
// then read JSHeapUsedSize from Performance.getMetrics. Scenarios:
//   readyMemory     — page loaded, no rows
//   runMemory       — after create 1,000 rows
//   replace5Memory  — after 5x full data replacement (1,000 rows)
//   update5Memory   — after create 1k + 5x update every 10th row
//   creation10k     — after create 10,000 rows
//   clear10k        — after create 10,000 rows then clear (pool retention shows here)
//
// Usage (from e2e/):  node bench/memory-profile.mjs --label state-main --out out.json
// The server (serve.mjs) is spawned on PORT (default 4230) and killed on exit.

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
const PORT = Number(argOf("port", "4230"));
const LABEL = argOf("label", "run");
const OUT = argOf("out", `mem-${LABEL}.json`);
const PAGE = argOf("page", "packages/state/__e2e__/benchmark/index.html");
const SAMPLES = Number(argOf("samples", "3"));
const BENCH_URL = `http://127.0.0.1:${PORT}/${PAGE}`;

async function waitForServer(url, timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`server not reachable: ${url}`);
    await new Promise(r => setTimeout(r, 200));
  }
}

async function rowCount(page, n) {
  await page.waitForFunction(c => document.querySelectorAll("tbody>tr").length === c, n, {
    timeout: 20000,
  });
}

// Forced-GC heap reading in MB, same shape as the official suite: two GC
// passes, a short settle, then JSHeapUsedSize.
async function heapMB(client) {
  await client.send("HeapProfiler.collectGarbage");
  await client.send("HeapProfiler.collectGarbage");
  await new Promise(r => setTimeout(r, 100));
  const { metrics } = await client.send("Performance.getMetrics");
  return metrics.find(m => m.name === "JSHeapUsedSize").value / (1024 * 1024);
}

// --- scenarios: each returns once the target DOM state is reached -------------

const SCENARIOS = {
  async readyMemory(page) {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
  },
  async runMemory(page) {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    await page.click("#run");
    await rowCount(page, 1000);
  },
  async replace5Memory(page) {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    for (let i = 0; i < 5; i++) {
      const prevLast = await page.evaluate(() => {
        const rows = document.querySelectorAll("tbody>tr");
        return rows.length ? rows[999].cells[0].textContent.trim() : null;
      });
      await page.click("#run");
      await page.waitForFunction(
        prev => {
          const rows = document.querySelectorAll("tbody>tr");
          return rows.length === 1000 && rows[999].cells[0].textContent.trim() !== prev;
        },
        prevLast,
        { timeout: 20000 },
      );
    }
  },
  async update5Memory(page) {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    await page.click("#run");
    await rowCount(page, 1000);
    for (let i = 0; i < 5; i++) {
      const prevLabel = await page.evaluate(
        () => document.querySelectorAll("tbody>tr")[990].cells[1].textContent.trim(),
      );
      await page.click("#update");
      await page.waitForFunction(
        prev => document.querySelectorAll("tbody>tr")[990].cells[1].textContent.trim() !== prev,
        prevLabel,
        { timeout: 20000 },
      );
    }
  },
  async creation10k(page) {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    await page.click("#runlots");
    await rowCount(page, 10000);
  },
  async clear10k(page) {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    await page.click("#runlots");
    await rowCount(page, 10000);
    await page.click("#clear");
    await rowCount(page, 0);
  },
};

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const server = spawn(process.execPath, ["serve.mjs"], {
    cwd: E2E_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  let browser;
  try {
    await waitForServer(BENCH_URL);
    browser = await chromium.launch({ headless: true });
    const results = {};
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      const samples = [];
      for (let i = 0; i < SAMPLES; i++) {
        // Fresh page per sample so no heap state leaks across scenarios.
        const page = await browser.newPage();
        page.setDefaultTimeout(20000);
        const client = await page.context().newCDPSession(page);
        await client.send("Performance.enable");
        await scenario(page);
        samples.push(await heapMB(client));
        await page.close();
      }
      results[name] = {
        medianMB: +median(samples).toFixed(2),
        samples: samples.map(x => +x.toFixed(2)),
      };
      console.log(`  ${name.padEnd(16)} ${results[name].medianMB} MB`);
    }
    const out = {
      label: LABEL,
      timestamp: new Date().toISOString(),
      url: BENCH_URL,
      samplesPerScenario: SAMPLES,
      memory: results,
    };
    await mkdir(dirname(resolve(OUT)), { recursive: true });
    await writeFile(resolve(OUT), JSON.stringify(out, null, 2));
    console.log(`written: ${resolve(OUT)}`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
