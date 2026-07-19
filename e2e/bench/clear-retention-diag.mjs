// One-off diagnostic: is the post-clear heap retention bounded (pool/ledger)
// or a growing leak? Cycles create10k -> clear, measuring forced-GC heap after
// each clear. Also measures the official-style 1k create -> clear retention.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const E2E_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = 4233;
const PAGE = process.argv[2] || "packages/state/__e2e__/benchmark/index.html";
const BENCH_URL = `http://127.0.0.1:${PORT}/${PAGE}`;

async function waitForServer(url) {
  for (let i = 0; i < 75; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("server not reachable");
}
async function rowCount(page, n) {
  await page.waitForFunction(c => document.querySelectorAll("tbody>tr").length === c, n, { timeout: 30000 });
}
async function heapMB(client) {
  await client.send("HeapProfiler.collectGarbage");
  await client.send("HeapProfiler.collectGarbage");
  await new Promise(r => setTimeout(r, 100));
  const { metrics } = await client.send("Performance.getMetrics");
  return +(metrics.find(m => m.name === "JSHeapUsedSize").value / 1048576).toFixed(2);
}

const server = spawn(process.execPath, ["serve.mjs"], {
  cwd: E2E_DIR, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
let browser;
try {
  await waitForServer(BENCH_URL);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");

  await page.goto(BENCH_URL, { waitUntil: "networkidle" });
  console.log("ready              ", await heapMB(client));

  for (let cycle = 1; cycle <= 4; cycle++) {
    await page.click("#runlots");
    await rowCount(page, 10000);
    const at10k = await heapMB(client);
    await page.click("#clear");
    await rowCount(page, 0);
    console.log(`cycle ${cycle}: at10k ${at10k} -> afterClear`, await heapMB(client));
  }

  // official 25_run-clear-memory shape: fresh page, create 1k, clear
  await page.goto(BENCH_URL, { waitUntil: "networkidle" });
  await page.click("#run");
  await rowCount(page, 1000);
  const at1k = await heapMB(client);
  await page.click("#clear");
  await rowCount(page, 0);
  console.log(`run-clear-1k: at1k ${at1k} -> afterClear`, await heapMB(client));
} finally {
  if (browser) await browser.close();
  server.kill();
}
