// Append-accumulation probe for packages/state/__e2e__/benchmark/index.html.
//
// Regression driver for the BindingOwner mutation fanout: before the
// node-interest registry, every appended row registered its own BindingSession
// with the document owner, and every mutation batch was broadcast to ALL
// sessions (cost = sessions x mutated nodes). Consecutive appends therefore
// degraded quadratically (10k->11k slower than create 10k, 11k->12k ~2x that).
// With per-node dispatch the series must stay flat.
//
// Usage (from e2e/):  node bench/append-accumulation.mjs --label after
//
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const E2E_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
function argOf(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}
const PORT = Number(argOf("port", "4198"));
const LABEL = argOf("label", "run");
const APPENDS = Number(argOf("appends", "5"));
const BENCH_URL = `http://127.0.0.1:${PORT}/packages/state/__e2e__/benchmark/index.html`;

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

// Same MutationObserver-clocked click timing as jsfb-verify.mjs.
async function timedClick(page, clickSel, condSrc, condArg = null) {
  return page.evaluate(
    ({ clickSel, condSrc, condArg }) =>
      new Promise((resolveP, rejectP) => {
        const cond = new Function("arg", condSrc);
        const target = document.querySelector("table.table") || document.body;
        let t0;
        const to = setTimeout(() => {
          mo.disconnect();
          rejectP(new Error(`timeout waiting condition after click ${clickSel}`));
        }, 60000);
        const check = () => {
          if (cond(condArg)) {
            clearTimeout(to);
            mo.disconnect();
            resolveP(performance.now() - t0);
            return true;
          }
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

const COND_ROWCOUNT = `return document.querySelectorAll('tbody>tr').length === arg;`;

// The mutation callback runs as a microtask after the click handler, but the
// broadcast cost lands in the NEXT batch's delivery. Force the observer queue
// to drain (one rAF + settle) so each sample charges its own delivery cost.
async function settle(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))));
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
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });

    const create10k = await timedClick(page, "#runlots", COND_ROWCOUNT, 10000);
    await settle(page);
    console.log(`[${LABEL}] create10k      ${create10k.toFixed(1)}ms`);

    const appends = [];
    for (let i = 0; i < APPENDS; i++) {
      const t = await timedClick(page, "#add", COND_ROWCOUNT, 11000 + i * 1000);
      await settle(page);
      appends.push(t);
      console.log(`[${LABEL}] append ${10 + i}k->${11 + i}k  ${t.toFixed(1)}ms`);
    }

    const clear = await timedClick(page, "#clear", COND_ROWCOUNT, 0);
    console.log(`[${LABEL}] clear          ${clear.toFixed(1)}ms`);

    const first = appends[0];
    const last = appends[appends.length - 1];
    console.log(`[${LABEL}] append growth last/first = ${(last / first).toFixed(2)}x`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
