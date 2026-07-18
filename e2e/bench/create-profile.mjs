// Capture a real CPU profile of create10k (#runlots) and aggregate self-time
// by function, so we can see the TRUE wall-clock hotspots (not just the ones
// a prior analysis named). Usage (from e2e/): node bench/create-profile.mjs --throttle 4

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const E2E_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
function argOf(name, dflt) { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; }
const PORT = Number(argOf("port", "4240"));
const THROTTLE = Number(argOf("throttle", "4"));
const BENCH_URL = `http://127.0.0.1:${PORT}/packages/state/__e2e__/benchmark/index.html`;

async function waitForServer(url, timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { const res = await fetch(url); if (res.ok) return; } catch { /* not up */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`server not reachable: ${url}`);
    await new Promise(r => setTimeout(r, 200));
  }
}

// aggregate CDP profile nodes into self-time buckets keyed by function@url:line
function aggregate(profile) {
  const { nodes, samples, timeDeltas } = profile;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const selfById = new Map();
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i];
    const dt = timeDeltas[i] ?? 0;
    selfById.set(id, (selfById.get(id) ?? 0) + dt);
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
  const rows = [...byFn.entries()].sort((a, b) => b[1] - a[1]);
  return { rows, totalMs: total / 1000 };
}

async function main() {
  const server = spawn(process.execPath, ["serve.mjs"], { cwd: E2E_DIR, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  let browser;
  try {
    await waitForServer(BENCH_URL);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(40000);
    const cdp = await page.context().newCDPSession(page);
    if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });

    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 }); // 100us for detail
    await cdp.send("Profiler.start");
    await page.click("#runlots");
    await page.waitForFunction(() => document.querySelectorAll("tbody>tr").length === 10000, null, { timeout: 60000 });
    const { profile } = await cdp.send("Profiler.stop");

    const { rows, totalMs } = aggregate(profile);
    console.log(`\ncreate10k CPU profile (throttle x${THROTTLE}) — total sampled self-time ~${totalMs.toFixed(0)}ms\n`);
    console.log("  self(ms)   %    function");
    for (const [key, us] of rows.slice(0, 35)) {
      const ms = us / 1000;
      console.log(`  ${ms.toFixed(1).padStart(7)}  ${((us / 1000 / totalMs) * 100).toFixed(1).padStart(4)}%  ${key}`);
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
