// The DOM floor (clone-path: clone the row, walk to its two text nodes, write them, append
// through a fragment — scripts/research/domFloorPage.js) measured both ways the engine is.
// Each is measured twice: with the rows' data built before the timer (the historical floor)
// and inside it (`withData`: the benchmark's state method builds its data inside the timed
// click, so this is the same condition — the ratio targets use it since 2026-09-25):
//   cold: a fresh page per sample, the first creation on it (like audit-state-tech-warmth's cold)
//   warm: one page, clear + create repeated (like audit-state-tech-dom.mjs, whose 37 ms is this)
// Run from the repository root after `npm ci` in e2e/:  node packages/state-next/bench/dom-floor-cold.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "../../..");
const require = createRequire(join(root, "e2e/package.json"));
const { chromium } = require("@playwright/test");
const N = 8;
const port = 4313;
const url = `http://127.0.0.1:${port}/packages/state/__e2e__/benchmark/index.html`;
const pageScript = await readFile(join(root, "scripts/research/domFloorPage.js"), "utf8");
// the same page audit-state-tech-dom.mjs builds
const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>dom floor</title>'
  + '<link href="./css/currentStyle.css" rel="stylesheet">'
  + '<script type="importmap">{"imports":{"@lib/buildData":"./buildData.js"}}</script></head>'
  + '<body><div class="container"><table class="table table-hover table-striped test-data"><tbody></tbody></table></div>'
  + '<template id="row"><tr><td class="col-md-1" data-b>#</td><td class="col-md-4"><a data-b>#</a></td>'
  + '<td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr></template>'
  + '<script type="module">import { buildData } from "@lib/buildData";\n' + pageScript
  // the data built inside the timed operation, like the engine's onRun / onRunLots
  + "\nwindow.bench.createWithData = (n) => { const expect = rows.length + n; return timed(() => createRows(buildData(n), { make: 'clone' }), count(expect)); };\n"
  + "</script></body></html>";
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const server = spawn(process.execPath, ["serve.mjs"], { cwd: join(root, "e2e"), env: { ...process.env, PORT: String(port) }, stdio: "ignore", windowsHide: true });
let browser;
try {
  for (let i = 0; ; i++) { try { if ((await fetch(url)).ok) break; } catch {} if (i > 75) throw new Error("server"); await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ headless: true });
  const open = async () => {
    const page = await browser.newPage();
    await page.route("**/benchmark/index.html", (r) => r.fulfill({ contentType: "text/html", body: html }));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.bench?.ready);
    return page;
  };
  const result = {};
  const make = ([withData, n]) => (withData ? bench.createWithData(n) : bench.create(n, { make: "clone" }));
  for (const n of [1000, 10000]) {
    const r = {};
    for (const withData of [false, true]) {
      const cold = [];
      for (let s = 0; s < N; s++) {
        const page = await open();
        cold.push(await page.evaluate(make, [withData, n]));
        await page.close();
      }
      const page = await open();
      const warm = [];
      for (let s = 0; s < N; s++) {
        await page.evaluate(() => bench.clear("replaceChildren"));
        warm.push(await page.evaluate(make, [withData, n]));
      }
      await page.close();
      const k = withData ? "WithData" : "";
      Object.assign(r, { [`cold${k}`]: +median(cold).toFixed(2), [`warm${k}`]: +median(warm).toFixed(2), [`cold${k}Samples`]: cold, [`warm${k}Samples`]: warm });
    }
    result[`create${n}`] = r;
    console.log(`create ${n}: cold ${r.cold} ms (with data ${r.coldWithData}), warm ${r.warm} ms (with data ${r.warmWithData})`);
  }
  const outArg = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "docs/research/state-engine/bench/dom-floor-cold-warm.json";
  const out = resolve(root, outArg);
  await mkdir(resolve(out, ".."), { recursive: true });
  await writeFile(out, JSON.stringify({ timestamp: new Date().toISOString(), variant: "clone-path", ...result }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
