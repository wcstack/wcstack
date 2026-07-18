// Profile a single benchmark op's self-time by function. Generic: --op selects
// which button + wait condition. Usage (from e2e/):
//   node bench/op-profile.mjs --op clear --throttle 4
// ops: create10k (#runlots->10000), clear10k (setup runlots then #clear->0),
//      append (setup runlots then #add->11000)

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const E2E_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
function argOf(name, dflt) { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; }
const PORT = Number(argOf("port", "4245"));
const THROTTLE = Number(argOf("throttle", "4"));
const OP = argOf("op", "clear10k");
const PAGE = argOf("page", "packages/state/__e2e__/benchmark/index.html");
const BENCH_URL = `http://127.0.0.1:${PORT}/${PAGE}`;

async function waitForServer(url, timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { const res = await fetch(url); if (res.ok) return; } catch { /* not up */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`server not reachable: ${url}`);
    await new Promise(r => setTimeout(r, 200));
  }
}

function aggregate(profile) {
  const { nodes, samples, timeDeltas } = profile;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const selfById = new Map();
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i];
    selfById.set(id, (selfById.get(id) ?? 0) + (timeDeltas[i] ?? 0));
  }
  const byFn = new Map();
  let total = 0;
  for (const [id, us] of selfById) {
    const n = byId.get(id);
    if (!n) continue;
    const cf = n.callFrame;
    const file = (cf.url || "").split("/").slice(-1)[0] || cf.url || "(native)";
    const key = `${cf.functionName || "(anonymous)"}  @ ${file}:${cf.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) ?? 0) + us);
    total += us;
  }
  return { rows: [...byFn.entries()].sort((a, b) => b[1] - a[1]), totalMs: total / 1000 };
}

async function setupAndAct(page) {
  if (OP === "create10k") {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    return { click: "#runlots", wait: () => document.querySelectorAll("tbody>tr").length === 10000 };
  }
  if (OP === "clear10k") {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    await page.click("#runlots");
    await page.waitForFunction(() => document.querySelectorAll("tbody>tr").length === 10000, null, { timeout: 60000 });
    return { click: "#clear", wait: () => document.querySelectorAll("tbody>tr").length === 0 };
  }
  if (OP === "append") {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    await page.click("#runlots");
    await page.waitForFunction(() => document.querySelectorAll("tbody>tr").length === 10000, null, { timeout: 60000 });
    return { click: "#add", wait: () => document.querySelectorAll("tbody>tr").length === 11000 };
  }
  throw new Error(`unknown op ${OP}`);
}

async function main() {
  const server = spawn(process.execPath, ["serve.mjs"], { cwd: E2E_DIR, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  let browser;
  try {
    await waitForServer(BENCH_URL);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    const cdp = await page.context().newCDPSession(page);
    if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

    const { click, wait } = await setupAndAct(page);

    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");
    const t0 = await page.evaluate(() => performance.now());
    await page.click(click);
    await page.waitForFunction(wait, null, { timeout: 60000 });
    const t1 = await page.evaluate(() => performance.now());
    const { profile } = await cdp.send("Profiler.stop");

    const { rows, totalMs } = aggregate(profile);
    console.log(`\n${OP} CPU profile (throttle x${THROTTLE}) — wall ${(t1 - t0).toFixed(0)}ms, sampled self ~${totalMs.toFixed(0)}ms\n`);
    console.log("  self(ms)   %    function");
    for (const [key, us] of rows.slice(0, 32)) {
      console.log(`  ${(us / 1000).toFixed(1).padStart(7)}  ${((us / 1000 / totalMs) * 100).toFixed(1).padStart(4)}%  ${key}`);
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
