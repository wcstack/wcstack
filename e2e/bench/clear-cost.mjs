// Focused clear10k measurement: setup #runlots (10000), then time #clear->0.
// Usage (from e2e/): node bench/clear-cost.mjs --label after --throttle 4 --samples 12

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const E2E_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
function argOf(name, dflt) { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; }
const PORT = Number(argOf("port", "4290"));
const LABEL = argOf("label", "run");
const SAMPLES = Number(argOf("samples", "12"));
const THROTTLE = Number(argOf("throttle", "1"));
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
        const to = setTimeout(() => { mo.disconnect(); rejectP(new Error(`timeout ${clickSel}`)); }, 60000);
        const check = () => { if (cond(condArg)) { clearTimeout(to); mo.disconnect(); resolveP(performance.now() - t0); return true; } return false; };
        const mo = new MutationObserver(check);
        mo.observe(target, { childList: true, subtree: true, characterData: true, attributes: true });
        t0 = performance.now();
        document.querySelector(clickSel).click();
        queueMicrotask(() => queueMicrotask(check));
      }),
    { clickSel, condSrc, condArg });
}
function median(xs) { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function stats(s) { return { median: +median(s).toFixed(2), min: +Math.min(...s).toFixed(2), max: +Math.max(...s).toFixed(2) }; }

async function main() {
  const server = spawn(process.execPath, ["serve.mjs"], { cwd: E2E_DIR, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  let browser;
  try {
    await waitForServer(BENCH_URL);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    if (THROTTLE > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    }
    const out = [];
    for (let i = 0; i < SAMPLES; i++) {
      await page.goto(BENCH_URL, { waitUntil: "networkidle" });
      await page.click("#runlots");
      await page.waitForFunction(() => document.querySelectorAll("tbody>tr").length === 10000, null, { timeout: 60000 });
      out.push(await timedClick(page, "#clear", `return document.querySelectorAll('tbody>tr').length === 0;`));
    }
    const s = stats(out);
    console.log(`[${LABEL}] clear10k  median=${s.median}ms  min=${s.min}  max=${s.max}  (throttle x${THROTTLE}, n=${SAMPLES})`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
