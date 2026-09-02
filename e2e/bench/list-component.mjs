// Timing + heap driver for packages/state/__e2e__/benchmark-component/index.html —
// the jsfb page with every row rendered by a bind-component component.
//
// This is the measurement the v2 mount design is judged on (docs/state-mount-design.md
// §7, docs/state-mount-impl-plan.md P0-4 / P2-11 / P5-1): the plain jsfb page
// (bench/jsfb-verify.mjs) must stay within noise, and this page is where the
// component machinery — inner/outer proxy pair, derived mapping rules, per-row
// ledger piggyback, cross-boundary address stack — is expected to show up.
//
// Operations (median of --samples, fresh page per sample so buildData ids restart):
//   create1k   click #run        → 1,000 <bench-row> with the last id rendered
//   update     click #update     → row 991's label (inside its shadow) changed (0-based 990)
//   select     click row 2       → its .r gets .danger (parent row-field write → child)
//   swap       click #swaprows   → row 2 shows the id row 999 had
//   clear      click #clear      → 0 rows
// Heap (MB, forced GC, --mem-samples each): ready / run1k / update5 / clear1k, plus
// creation10k with --big.
//
// Shadow-root mutations are invisible to a MutationObserver on the light DOM, so the
// clock polls the condition: every microtask turn first (state applies in a microtask
// batch), then setTimeout(0) until it holds or 15 s pass.
//
// Usage (from e2e/):  node bench/list-component.mjs --label before-mount --out bench-results/x.json
// The server (serve.mjs) is spawned on PORT (default 4241) and killed on exit.

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
const PORT = Number(argOf("port", "4241"));
const LABEL = argOf("label", "run");
const OUT = argOf("out", `list-component-${LABEL}.json`);
const PAGE = argOf("page", "packages/state/__e2e__/benchmark-component/index.html");
const SAMPLES = Number(argOf("samples", "5"));
const MEM_SAMPLES = Number(argOf("mem-samples", "3"));
const BIG = args.includes("--big");
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

// Page-side helpers, installed once per page. Row n is 1-based.
const HELPERS = `
window.__rows = () => document.querySelectorAll("#rows bench-row");
window.__cell = (n, cls) => {
  const row = window.__rows()[n - 1];
  const el = row && row.shadowRoot && row.shadowRoot.querySelector(cls);
  return el ? el.textContent.trim() : null;
};
window.__hasDanger = (n) => {
  const row = window.__rows()[n - 1];
  return !!(row && row.shadowRoot && row.shadowRoot.querySelector(".r.danger"));
};
`;

// Clicks clickSel, then polls condSrc (body of function(arg) returning boolean):
// microtask turns first, then setTimeout(0) up to 15 s. Resolves with elapsed ms.
async function timedClick(page, clickSel, condSrc, condArg = null) {
  return page.evaluate(
    ({ clickSel, condSrc, condArg }) =>
      new Promise((resolveP, rejectP) => {
        const cond = new Function("arg", condSrc);
        const t0 = performance.now();
        document.querySelector(clickSel).click();
        let turns = 0;
        const microtaskPoll = () => {
          if (cond(condArg)) return resolveP(performance.now() - t0);
          if (++turns < 4000) return queueMicrotask(microtaskPoll);
          macrotaskPoll();
        };
        const macrotaskPoll = () => {
          if (cond(condArg)) return resolveP(performance.now() - t0);
          if (performance.now() - t0 > 15000) return rejectP(new Error(`timeout waiting condition after click ${clickSel}`));
          setTimeout(macrotaskPoll, 0);
        };
        queueMicrotask(microtaskPoll);
      }),
    { clickSel, condSrc, condArg },
  );
}

async function waitFn(page, src, arg = null) {
  await page.waitForFunction(new Function("arg", src), arg, { timeout: 20000 });
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stats(samples) {
  return {
    median: +median(samples).toFixed(2),
    min: +Math.min(...samples).toFixed(2),
    max: +Math.max(...samples).toFixed(2),
    samples: samples.map(x => +x.toFixed(2)),
  };
}

const COND = {
  rows1k: `return window.__rows().length === 1000 && window.__cell(1000, ".id") === "1000";`,
  rows0: `return window.__rows().length === 0;`,
  // onUpdate writes every 10th row from index 0, i.e. 0-based 990 = 1-based row 991.
  updated991: `return (window.__cell(991, ".label") || "") !== arg && (window.__cell(991, ".label") || "").endsWith("!!!");`,
  danger2: `return window.__hasDanger(2);`,
  swapped: `return window.__cell(2, ".id") === arg;`,
};

async function freshPage(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(BENCH_URL, { waitUntil: "networkidle" });
  await page.evaluate(HELPERS);
  return page;
}

async function runTimings(browser) {
  const timings = { create1k: [], update: [], select: [], swap: [], clear: [] };
  const errors = [];
  for (let i = 0; i < SAMPLES; i++) {
    const page = await freshPage(browser);
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`); });

    timings.create1k.push(await timedClick(page, "#run", COND.rows1k));

    const prevLabel = await page.evaluate(() => window.__cell(991, ".label"));
    timings.update.push(await timedClick(page, "#update", COND.updated991, prevLabel));

    timings.select.push(await timedClick(page, "#rows bench-row:nth-of-type(2)", COND.danger2));

    const id999 = await page.evaluate(() => window.__cell(999, ".id"));
    timings.swap.push(await timedClick(page, "#swaprows", COND.swapped, id999));

    timings.clear.push(await timedClick(page, "#clear", COND.rows0));
    await page.close();
  }
  return {
    timings: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, stats(v)])),
    errors,
  };
}

async function heapMB(client) {
  await client.send("HeapProfiler.collectGarbage");
  await client.send("HeapProfiler.collectGarbage");
  await new Promise(r => setTimeout(r, 100));
  const { metrics } = await client.send("Performance.getMetrics");
  return metrics.find(m => m.name === "JSHeapUsedSize").value / (1024 * 1024);
}

const MEM_SCENARIOS = {
  async ready() {},
  async run1k(page) {
    await page.click("#run");
    await waitFn(page, COND.rows1k);
  },
  async update5(page) {
    await page.click("#run");
    await waitFn(page, COND.rows1k);
    for (let i = 0; i < 5; i++) {
      const prev = await page.evaluate(() => window.__cell(991, ".label"));
      await page.click("#update");
      await waitFn(page, `return window.__cell(991, ".label") !== arg;`, prev);
    }
  },
  async clear1k(page) {
    await page.click("#run");
    await waitFn(page, COND.rows1k);
    await page.click("#clear");
    await waitFn(page, COND.rows0);
  },
  ...(BIG ? {
    async creation10k(page) {
      await page.click("#runlots");
      await waitFn(page, `return window.__rows().length === 10000 && window.__cell(10000, ".id") === "10000";`);
    },
  } : {}),
};

async function runMemory(browser) {
  const memoryMB = {};
  for (const [name, scenario] of Object.entries(MEM_SCENARIOS)) {
    const samples = [];
    for (let i = 0; i < MEM_SAMPLES; i++) {
      const page = await freshPage(browser);
      const client = await page.context().newCDPSession(page);
      await client.send("Performance.enable");
      await scenario(page);
      samples.push(await heapMB(client));
      await page.close();
    }
    memoryMB[name] = { median: +median(samples).toFixed(2), samples: samples.map(x => +x.toFixed(2)) };
  }
  return memoryMB;
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
    const { timings, errors } = await runTimings(browser);
    const memoryMB = await runMemory(browser);
    const result = { label: LABEL, page: PAGE, samples: SAMPLES, memSamples: MEM_SAMPLES, timings, memoryMB, errors };
    const outPath = resolve(E2E_DIR, OUT);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(result, null, 2));
    console.log(`[${LABEL}] timings (ms, median of ${SAMPLES}):`);
    for (const [k, v] of Object.entries(timings)) console.log(`  ${k.padEnd(10)} ${String(v.median).padStart(9)}  (min ${v.min} / max ${v.max})`);
    console.log(`[${LABEL}] heap (MB, median of ${MEM_SAMPLES}):`);
    for (const [k, v] of Object.entries(memoryMB)) console.log(`  ${k.padEnd(10)} ${String(v.median).padStart(9)}`);
    if (errors.length) console.log(`[${LABEL}] page errors:\n  ${errors.join("\n  ")}`);
    console.log(`written: ${outPath}`);
    process.exitCode = errors.length ? 1 : 0;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
