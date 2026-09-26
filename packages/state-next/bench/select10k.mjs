// Selection and removal over 10,000 rows, per selection style, with the benchmark's own
// clock (click → MutationObserver condition, as e2e/bench/jsfb-verify.mjs timedClick).
// The checked-in benchmark page is served with its getter rewritten per variant:
//   manual   the page as checked in ($untracked + two explicit row writes)
//   tracked  an ordinary tracked getter: this.$1 === this.selectedIndex
//   eqIndex  the keyed subscription: this.$eqIndex("selectedIndex")
// Run from the repository root after `npm ci` in e2e/, with no other benchmark running:
//   node packages/state-next/bench/select10k.mjs --bundle <file> --variant tracked --label x --out <file>
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "../../..");
const require = createRequire(join(root, "e2e/package.json"));
const { chromium } = require("@playwright/test");
const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const bundle = arg("--bundle", null);
const variant = arg("--variant", "tracked");
const label = arg("--label", variant);
const out = arg("--out", null);
const SAMPLES = Number(arg("--samples", 15));
const WARMUP = 5;
const port = 4312;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;

const MARKER = "this.$untracked(() => this.selectedIndex)";
const original = await readFile(join(root, "packages/state/__e2e__/benchmark/index.html"), "utf8");
let html = original;
if (variant !== "manual") {
  const body = variant === "tracked" ? "this.$1 === this.selectedIndex" : 'this.$eqIndex("selectedIndex")';
  html = original.replace(`return this.$1 === ${MARKER};`, `return ${body};`)
    .replace(/onSelect\(e, \$1\) \{[\s\S]*?\n  \},/, "onSelect(e, $1) { this.selectedIndex = $1; },");
  if (html === original || html.includes(MARKER)) throw new Error("Fixture replacement failed");
}

async function timedClick(page, clickSel, condSrc, condArg) {
  return page.evaluate(({ clickSel, condSrc, condArg }) => new Promise((res, rej) => {
    const cond = new Function("arg", condSrc);
    const target = document.querySelector("table.table") || document.body;
    let t0;
    const to = setTimeout(() => { mo.disconnect(); rej(new Error(`timeout after ${clickSel}`)); }, 15000);
    const check = () => {
      if (cond(condArg)) { clearTimeout(to); mo.disconnect(); res(performance.now() - t0); return true; }
      return false;
    };
    const mo = new MutationObserver(check);
    mo.observe(target, { childList: true, subtree: true, characterData: true, attributes: true });
    t0 = performance.now();
    document.querySelector(clickSel).click();
    queueMicrotask(() => queueMicrotask(check));
  }), { clickSel, condSrc, condArg });
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return { median: +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2), min: +s[0].toFixed(2), max: +s.at(-1).toFixed(2), samples: xs.map((x) => +x.toFixed(2)) };
};

const server = spawn(process.execPath, ["serve.mjs"], { cwd: join(root, "e2e"), env: { ...process.env, PORT: String(port) }, stdio: "ignore", windowsHide: true });
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i > 75) throw new Error("server not reachable");
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.route("**/benchmark/index.html", (r) => r.fulfill({ contentType: "text/html", body: html }));
  if (bundle !== null) await page.route("**/packages/state/dist/auto.min.js", (r) => r.fulfill({ path: resolve(bundle), contentType: "text/javascript; charset=utf-8" }));

  const load10k = async () => {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.click("#runlots");
    await page.waitForFunction(() => document.querySelectorAll("tbody>tr").length === 10000);
  };

  await load10k();
  const select = [];
  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    const row = i % 2 === 0 ? 5 : 10;
    const t = await timedClick(page, `tbody>tr:nth-of-type(${row})>td:nth-of-type(2)>a`,
      "const trs = document.querySelectorAll('tbody>tr'); return trs[arg - 1].classList.contains('danger') && document.querySelectorAll('tbody>tr.danger').length === 1;", row);
    if (i >= WARMUP) select.push(t);
  }

  await load10k();
  const remove = [];
  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    const count = await page.evaluate(() => document.querySelectorAll("tbody>tr").length);
    const t = await timedClick(page, "tbody>tr:nth-of-type(2)>td:nth-of-type(3)>a",
      "return document.querySelectorAll('tbody>tr').length === arg;", count - 1);
    if (i >= WARMUP) remove.push(t);
  }

  const result = { label, variant, bundle, timestamp: new Date().toISOString(), select10k: stats(select), remove1of10k: stats(remove) };
  console.log(`[${label}] ${variant}: select10k ${result.select10k.median} ms, remove1of10k ${result.remove1of10k.median} ms`);
  if (out !== null) {
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(resolve(out), JSON.stringify(result, null, 2));
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}
