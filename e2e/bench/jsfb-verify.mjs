// js-framework-benchmark style verification + measurement driver for
// packages/state/__e2e__/benchmark/index.html.
//
// Reproduces the official keyed-ness classification (krausest/js-framework-benchmark
// webdriver-ts/src/isKeyed.ts: MutationObserver TR add/remove counting, storedTr,
// newNodes) and adds diagnostics the official check does not observe:
//   - recycledOnRun: how many TR nodes survive a full data replacement (pool reuse)
//   - swapTrAdded:   TR mutation-record volume during one swap (~ DOM move count)
//   - per-operation timings (median of N samples, MutationObserver-clocked)
//
// Usage (from e2e/):  node bench/jsfb-verify.mjs --label before --out results.json
// The server (serve.mjs) is spawned on PORT (default 4199) and killed on exit.

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
const PORT = Number(argOf("port", "4199"));
const LABEL = argOf("label", "run");
const OUT = argOf("out", `bench-${LABEL}.json`);
const BENCH_URL = `http://127.0.0.1:${PORT}/packages/state/__e2e__/benchmark/index.html`;

// --- official isKeyed.ts instrumentation, minimally adapted (no shadow DOM) ---
const INIT_DETECTOR = `
window.nonKeyedDetector_reset = function() {
  window.nonKeyedDetector_tradded = [];
  window.nonKeyedDetector_trremoved = [];
};
window.nonKeyedDetector_instrument = function() {
  var target = document.querySelector('table.table');
  if (!target) return false;
  function filterTRInNodeList(nodeList) {
    let trs = [];
    nodeList.forEach(n => {
      if (n.tagName === 'TR') {
        trs.push(n);
        trs = trs.concat(filterTRInNodeList(n.childNodes));
      }
    });
    return trs;
  }
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.type === 'childList') {
        nonKeyedDetector_tradded = nonKeyedDetector_tradded.concat(filterTRInNodeList(mutation.addedNodes));
        nonKeyedDetector_trremoved = nonKeyedDetector_trremoved.concat(filterTRInNodeList(mutation.removedNodes));
      }
    });
  });
  observer.observe(target, { childList: true, attributes: true, subtree: true, characterData: true });
  return true;
};
window.nonKeyedDetector_result = function() {
  function countDiff(list1, list2) {
    let s = new Set(list1);
    for (let o of list2) s.delete(o);
    return s.size;
  }
  return {
    tradded: nonKeyedDetector_tradded.length,
    trremoved: nonKeyedDetector_trremoved.length,
    removedStoredTr: nonKeyedDetector_trremoved.indexOf(window.storedTr) > -1,
    newNodes: countDiff(window.nonKeyedDetector_tradded, window.nonKeyedDetector_trremoved),
  };
};
window.nonKeyedDetector_storeTr = function() {
  let index = document.querySelector('tr:nth-child(1)') ? 2 : 3;
  window.storedTr = document.querySelector('tr:nth-child(' + index + ')');
};
window.nonKeyedDetector_reset();
`;

// --- helpers ----------------------------------------------------------------

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

async function waitCellText(page, row, text) {
  await page.waitForFunction(
    ([row, text]) => {
      const tr = document.querySelector(`tbody>tr:nth-of-type(${row})>td:nth-of-type(1)`);
      return tr && tr.textContent.trim() === text;
    },
    [row, text],
    { timeout: 15000 },
  );
}

// Times click -> DOM condition, clocked by a MutationObserver so the sample
// covers the handler plus the whole microtask-batched apply, without rAF
// frame quantization. condSrc is the body of a function(arg) returning boolean.
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
        }, 15000);
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

const ROWS = "tbody>tr";

// --- keyed classification (official algorithm) -------------------------------

async function runKeyedChecks(page) {
  await page.goto(BENCH_URL, { waitUntil: "networkidle" });
  await page.click("#add");
  await waitCellText(page, 1000, "1000");

  await page.evaluate(INIT_DETECTOR);
  await page.evaluate("window.nonKeyedDetector_instrument()");

  // swap
  await page.evaluate("nonKeyedDetector_storeTr()");
  await page.click("#swaprows");
  await waitCellText(page, 2, "999");
  const swapRes = await page.evaluate("nonKeyedDetector_result()");
  const keyedSwap = swapRes.tradded > 0 && swapRes.trremoved > 0 && swapRes.newNodes === 0;

  // run (replace all) + recycle diagnostic
  await page.evaluate("nonKeyedDetector_storeTr()");
  await page.evaluate("window.nonKeyedDetector_reset()");
  await page.evaluate(() => {
    window.__preRunTrs = new Set(document.querySelectorAll("tbody tr"));
  });
  await page.click("#run");
  await waitCellText(page, 1000, "2000");
  const runRes = await page.evaluate("nonKeyedDetector_result()");
  const keyedRun = runRes.tradded >= 1000 && runRes.trremoved >= 1000;
  const recycledOnRun = await page.evaluate(() =>
    [...document.querySelectorAll("tbody tr")].filter(tr => window.__preRunTrs.has(tr)).length,
  );

  // remove
  await page.evaluate("nonKeyedDetector_storeTr()");
  await page.evaluate("window.nonKeyedDetector_reset()");
  await waitCellText(page, 2, "1002");
  await page.click("tbody>tr:nth-of-type(2)>td:nth-of-type(3)>a>span");
  await waitCellText(page, 2, "1003");
  const removeRes = await page.evaluate("nonKeyedDetector_result()");
  const keyedRemove = removeRes.removedStoredTr;

  return {
    keyed: keyedSwap && keyedRun && keyedRemove,
    keyedSwap,
    keyedRun,
    keyedRemove,
    swapTrAdded: swapRes.tradded,
    swapTrRemoved: swapRes.trremoved,
    swapNewNodes: swapRes.newNodes,
    runTrAdded: runRes.tradded,
    runTrRemoved: runRes.trremoved,
    runNewNodes: runRes.newNodes,
    recycledOnRun,
    raw: { swapRes, runRes, removeRes },
  };
}

// --- timings ------------------------------------------------------------------

const COND_ROWCOUNT = `return document.querySelectorAll('${ROWS}').length === arg;`;

async function benchCreate1k(page, samples) {
  const out = [];
  for (let i = 0; i < samples; i++) {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    out.push(await timedClick(page, "#run", COND_ROWCOUNT, 1000));
  }
  return out;
}

async function benchReplace1k(page, warmup, samples) {
  await page.goto(BENCH_URL, { waitUntil: "networkidle" });
  await page.click("#run");
  await page.waitForFunction(c => document.querySelectorAll("tbody>tr").length === c, 1000);
  const out = [];
  for (let i = 0; i < warmup + samples; i++) {
    // condition: the LAST row's id changes (robust even if the apply were ever
    // split across microtasks; today the whole batch lands in one checkpoint)
    const prevLast = await page.evaluate(
      () => document.querySelectorAll("tbody>tr")[999].cells[0].textContent.trim(),
    );
    const t = await timedClick(
      page,
      "#run",
      `const rows = document.querySelectorAll('tbody>tr'); return rows.length === 1000 && rows[999].cells[0].textContent.trim() !== arg;`,
      prevLast,
    );
    if (i >= warmup) out.push(t);
  }
  return out;
}

async function benchUpdate10k(page, warmup, samples) {
  await page.goto(BENCH_URL, { waitUntil: "networkidle" });
  await page.click("#runlots");
  await page.waitForFunction(() => document.querySelectorAll("tbody>tr").length === 10000);
  const out = [];
  for (let i = 0; i < warmup + samples; i++) {
    // every 10th row starting at index 0 — the last updated row is index 9990
    const prevLabel = await page.evaluate(
      () => document.querySelectorAll("tbody>tr")[9990].cells[1].textContent.trim(),
    );
    const t = await timedClick(
      page,
      "#update",
      `return document.querySelectorAll('tbody>tr')[9990].cells[1].textContent.trim() !== arg;`,
      prevLabel,
    );
    if (i >= warmup) out.push(t);
  }
  return out;
}

async function benchSelect1k(page, warmup, samples) {
  await page.goto(BENCH_URL, { waitUntil: "networkidle" });
  await page.click("#run");
  await page.waitForFunction(() => document.querySelectorAll("tbody>tr").length === 1000);
  const out = [];
  for (let i = 0; i < warmup + samples; i++) {
    const row = (i % 2 === 0) ? 5 : 10;
    const t = await timedClick(
      page,
      `tbody>tr:nth-of-type(${row})>td:nth-of-type(2)>a`,
      `return document.querySelector('tbody>tr:nth-of-type(' + arg + ')').classList.contains('danger');`,
      row,
    );
    if (i >= warmup) out.push(t);
  }
  return out;
}

async function benchSwap1k(page, warmup, samples) {
  await page.goto(BENCH_URL, { waitUntil: "networkidle" });
  await page.click("#run");
  await page.waitForFunction(() => document.querySelectorAll("tbody>tr").length === 1000);
  const out = [];
  for (let i = 0; i < warmup + samples; i++) {
    // wait until BOTH swapped rows show their exchanged ids
    const expected = await page.evaluate(() => {
      const rows = document.querySelectorAll("tbody>tr");
      return {
        row2: rows[998].cells[0].textContent.trim(),
        row999: rows[1].cells[0].textContent.trim(),
      };
    });
    const t = await timedClick(
      page,
      "#swaprows",
      `const rows = document.querySelectorAll('tbody>tr'); return rows[1].cells[0].textContent.trim() === arg.row2 && rows[998].cells[0].textContent.trim() === arg.row999;`,
      expected,
    );
    if (i >= warmup) out.push(t);
  }
  return out;
}

async function benchRemove1k(page, warmup, samples) {
  await page.goto(BENCH_URL, { waitUntil: "networkidle" });
  await page.click("#run");
  await page.waitForFunction(() => document.querySelectorAll("tbody>tr").length === 1000);
  const out = [];
  for (let i = 0; i < warmup + samples; i++) {
    const count = await page.evaluate(() => document.querySelectorAll("tbody>tr").length);
    const t = await timedClick(
      page,
      "tbody>tr:nth-of-type(2)>td:nth-of-type(3)>a",
      COND_ROWCOUNT,
      count - 1,
    );
    if (i >= warmup) out.push(t);
  }
  return out;
}

async function benchAppend1kTo10k(page, samples) {
  const out = [];
  for (let i = 0; i < samples; i++) {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    await page.click("#runlots");
    await page.waitForFunction(() => document.querySelectorAll("tbody>tr").length === 10000);
    out.push(await timedClick(page, "#add", COND_ROWCOUNT, 11000));
  }
  return out;
}

async function benchClear10k(page, samples) {
  const out = [];
  for (let i = 0; i < samples; i++) {
    await page.goto(BENCH_URL, { waitUntil: "networkidle" });
    await page.click("#runlots");
    await page.waitForFunction(() => document.querySelectorAll("tbody>tr").length === 10000);
    out.push(await timedClick(page, "#clear", COND_ROWCOUNT, 0));
  }
  return out;
}

// --- main ---------------------------------------------------------------------

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
    page.setDefaultTimeout(20000);

    console.log(`[${LABEL}] keyed classification (official isKeyed algorithm)...`);
    const keyed = await runKeyedChecks(page);
    console.log(JSON.stringify({ ...keyed, raw: undefined }, null, 2));

    console.log(`[${LABEL}] timings...`);
    const timings = {};
    timings.create1k = stats(await benchCreate1k(page, 8));
    console.log("  create1k       ", timings.create1k.median, "ms");
    timings.replace1k = stats(await benchReplace1k(page, 5, 10));
    console.log("  replace1k      ", timings.replace1k.median, "ms");
    timings.update10k = stats(await benchUpdate10k(page, 5, 10));
    console.log("  update10k      ", timings.update10k.median, "ms");
    timings.select1k = stats(await benchSelect1k(page, 5, 10));
    console.log("  select1k       ", timings.select1k.median, "ms");
    timings.swap1k = stats(await benchSwap1k(page, 5, 21));
    console.log("  swap1k         ", timings.swap1k.median, "ms");
    timings.remove1k = stats(await benchRemove1k(page, 5, 10));
    console.log("  remove1k       ", timings.remove1k.median, "ms");
    timings.append1kTo10k = stats(await benchAppend1kTo10k(page, 8));
    console.log("  append1kTo10k  ", timings.append1kTo10k.median, "ms");
    timings.clear10k = stats(await benchClear10k(page, 8));
    console.log("  clear10k       ", timings.clear10k.median, "ms");

    const result = {
      label: LABEL,
      timestamp: new Date().toISOString(),
      url: BENCH_URL,
      keyed,
      timings,
    };
    await mkdir(dirname(resolve(OUT)), { recursive: true });
    await writeFile(resolve(OUT), JSON.stringify(result, null, 2));
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
