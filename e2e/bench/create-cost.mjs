// Focused create-cost measurement (create1k via #run, create10k via #runlots).
// Reuses the jsfb-verify timing method (MutationObserver-clocked click->DOM).
// Usage (from e2e/): node bench/create-cost.mjs --label before --samples 10

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
const PORT = Number(argOf("port", "4231"));
const LABEL = argOf("label", "run");
const SAMPLES = Number(argOf("samples", "10"));
const THROTTLE = Number(argOf("throttle", "1")); // CPU slowdown factor (1 = none, 4 = js-framework-benchmark)
const OUT = argOf("out", `bench-create-${LABEL}.json`);
const BENCH_URL = `http://127.0.0.1:${PORT}/packages/state/__e2e__/benchmark/index.html`;

async function waitForServer(url, timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { const res = await fetch(url); if (res.ok) return; } catch { /* not up */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`server not reachable: ${url}`);
    await new Promise(r => setTimeout(r, 200));
  }
}

async function timedClick(page, clickSel, condSrc, condArg = null) {
  return page.evaluate(
    ({ clickSel, condSrc, condArg }) =>
      new Promise((resolveP, rejectP) => {
        const cond = new Function("arg", condSrc);
        const target = document.querySelector("table.table") || document.body;
        let t0;
        const to = setTimeout(() => { mo.disconnect(); rejectP(new Error(`timeout ${clickSel}`)); }, 30000);
        const check = () => {
          if (cond(condArg)) { clearTimeout(to); mo.disconnect(); resolveP(performance.now() - t0); return true; }
          return false;
        };
        const mo = new MutationObserver(check);
        mo.observe(target, { childList: true, subtree: true, characterData: true, attributes: true });
        t0 = performance.now();
        document.querySelector(clickSel).click();
        queueMicrotask(() => queueMicrotask(check));
      }),
    { clickSel, condSrc, condArg },
  );
}

function median(xs) { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function stats(samples) {
  return {
    median: +median(samples).toFixed(2),
    min: +Math.min(...samples).toFixed(2),
    max: +Math.max(...samples).toFixed(2),
    samples: samples.map(x => +x.toFixed(2)),
  };
}
const COND_ROWCOUNT = `return document.querySelectorAll('tbody>tr').length === arg;`;

async function benchCreate(page, clickSel, count, samples) {
  const out = [];
  for (let i = 0; i < samples; i++) {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    out.push(await timedClick(page, clickSel, COND_ROWCOUNT, count));
  }
  return out;
}

async function main() {
  const server = spawn(process.execPath, ["serve.mjs"], {
    cwd: E2E_DIR, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
  });
  let browser;
  try {
    await waitForServer(BENCH_URL);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    let cdp = null;
    if (THROTTLE > 1) {
      cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
      console.log(`[${LABEL}] CPU throttle x${THROTTLE}`);
    }

    // keyed sanity: after #run, 1000 TR must have been added (keyed create).
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    await page.click("#run");
    await page.waitForFunction(() => document.querySelectorAll("tbody>tr").length === 1000, null, { timeout: 30000 });
    const firstId = await page.evaluate(() => document.querySelector("tbody>tr>td").textContent.trim());

    const timings = {};
    timings.create1k = stats(await benchCreate(page, "#run", 1000, samplesFor(SAMPLES)));
    console.log(`[${LABEL}] create1k  median=${timings.create1k.median}ms  min=${timings.create1k.min}  max=${timings.create1k.max}`);
    timings.create10k = stats(await benchCreate(page, "#runlots", 10000, Math.max(4, Math.ceil(SAMPLES / 2))));
    console.log(`[${LABEL}] create10k median=${timings.create10k.median}ms min=${timings.create10k.min} max=${timings.create10k.max}`);

    const result = { label: LABEL, timestamp: new Date().toISOString(), firstId, timings };
    await mkdir(dirname(resolve(OUT)), { recursive: true });
    await writeFile(resolve(OUT), JSON.stringify(result, null, 2));
    console.log(`written: ${resolve(OUT)}  (firstId=${firstId})`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
function samplesFor(n) { return n; }

main().catch(err => { console.error(err); process.exit(1); });
