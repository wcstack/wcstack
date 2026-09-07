// Usage from e2e/: node bench/replace1k-compare.mjs --before de487346 --after 4abb5ed9
// Rebuild both sources with shared dependencies. Alternate AB / BA session pairs.
// Each session uses a fresh Chromium process. Measure DOM completion, not paint.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, dirname, basename, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stateDir = resolve(root, "packages/state");
const fixtureDir = resolve(stateDir, "__e2e__/benchmark");
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
}
function positiveInt(name, fallback) {
  const value = Number(arg(name, fallback));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid --${name}`);
  return value;
}
const pairs = positiveInt("pairs", 8);
const warmup = positiveInt("warmup", 40);
const samples = positiveInt("samples", 40);
const out = resolve(arg("out", resolve(root, "e2e/bench/results/replace1k-source-comparison.json")));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
const revisions = Object.fromEntries(["before", "after"].map((label) => {
  const requested = arg(label, label === "before" ? "de487346" : "HEAD");
  return [label, git("rev-parse", "--verify", `${requested}^{commit}`).toString().trim()];
}));
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const round = (value) => Number(value.toFixed(4));
function summarize(values) {
  return { medianMs: round(median(values)), minMs: round(Math.min(...values)), maxMs: round(Math.max(...values)) };
}
function version(name, base) {
  return createRequire(resolve(base, "package.json"))(`${name}/package.json`).version;
}

async function build(label, work) {
  const snapshot = resolve(work, label);
  await mkdir(snapshot);
  const archive = resolve(work, `${label}.tar`);
  await writeFile(archive, git("archive", revisions[label], "tsconfig.json", "packages/state/src",
    "packages/state/package.json", "packages/state/tsconfig.json", "packages/state/rollup.config.js", "packages/state/scripts"));
  execFileSync("tar", ["-xf", archive, "-C", snapshot], { windowsHide: true });
  const cwd = resolve(snapshot, "packages/state");
  const pkg = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8"));
  const currentPkg = JSON.parse(await readFile(resolve(stateDir, "package.json"), "utf8"));
  if (pkg.scripts.build !== currentPkg.scripts.build) throw new Error("Build commands differ; inspect before comparing");
  // Both snapshots inherit exactly the same node_modules from stateDir. No install.
  console.log(`Building ${label} ${revisions[label].slice(0, 8)} with shared node_modules...`);
  await new Promise((done, reject) => {
    const child = spawn("npm run build", { cwd, shell: true, windowsHide: true });
    let log = "";
    child.stdout.on("data", (chunk) => { log += chunk; });
    child.stderr.on("data", (chunk) => { log += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? done() : reject(new Error(`${label} build failed (${code}):\n${log}`)));
  });
  const bundle = await readFile(resolve(cwd, "dist/auto.min.js"));
  return { bundle, metadata: { revision: revisions[label], build: pkg.scripts.build,
    sha256: hash(bundle), bytes: bundle.length, packageVersion: pkg.version } };
}

async function measure(url, label, pair) {
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ headless: true });
  try {
    const browserVersion = browser.version();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(() => {
      let seed = 0x12345678;
      Math.random = () => {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        return (seed >>> 0) / 4294967296;
      };
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.click("#run");
    await page.waitForFunction(() => document.querySelectorAll("tbody > tr").length === 1000);
    const timings = [];
    for (let i = 0; i < warmup + samples; i++) {
      const timing = await page.evaluate(async () => {
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const tbody = document.querySelector("tbody");
        const previousLastId = Number(tbody.querySelector("tr:last-of-type").cells[0].textContent);
        const expectedLastId = previousLastId + 1000;
        const elapsed = await new Promise((done, reject) => {
          let start;
          const timer = setTimeout(() => { observer.disconnect(); reject(new Error("replace1k timeout")); }, 15000);
          const check = () => {
            const rows = tbody.querySelectorAll("tr");
            if (rows.length !== 1000 || Number(rows[999].cells[0].textContent) !== expectedLastId) return;
            const end = performance.now();
            observer.disconnect();
            clearTimeout(timer);
            done(end - start);
          };
          const observer = new MutationObserver(check);
          observer.observe(tbody, { childList: true, subtree: true, characterData: true, attributes: true });
          start = performance.now();
          document.querySelector("#run").click();
          queueMicrotask(() => queueMicrotask(check));
        });
        // Validate the whole DOM outside timing, before yielding to another task.
        const rows = [...tbody.querySelectorAll("tr")];
        let expected;
        document.querySelector("wcs-state").createState("readonly", (s) => { expected = s.data; });
        if (expected.length !== 1000 || rows.some((row, index) =>
          Number(row.cells[0].textContent) !== expected[index].id ||
          row.cells[1].textContent.trim() !== expected[index].label ||
          expected[index].id !== previousLastId + index + 1)) {
          throw new Error("replace1k resolved before all 1,000 IDs and labels matched state");
        }
        return elapsed;
      });
      timings.push(round(timing));
    }
    if (errors.length) throw new Error(`${label}: browser errors: ${errors.join("\n")}`);
    const measured = timings.slice(warmup);
    const result = { pair, label, startedAt, finishedAt: new Date().toISOString(), browserVersion,
      warmupMs: timings.slice(0, warmup), samplesMs: measured,
      firstHalfMedianMs: round(median(measured.slice(0, Math.ceil(measured.length / 2)))),
      secondHalfMedianMs: round(median(measured.slice(Math.floor(measured.length / 2)))),
      ...summarize(measured) };
    console.log(`Pair ${pair + 1} ${label}: ${result.medianMs.toFixed(2)} ms (range ${result.minMs.toFixed(2)}–${result.maxMs.toFixed(2)})`);
    return result;
  } finally {
    await browser.close();
  }
}

function comparison(sessions) {
  const ratios = Array.from({ length: pairs }, (_, pair) => {
    const before = sessions.find((s) => s.pair === pair && s.label === "before");
    const after = sessions.find((s) => s.pair === pair && s.label === "after");
    return after.medianMs / before.medianMs;
  });
  const logs = ratios.map(Math.log);
  // Resample independent session pairs, not samples from the same renderer.
  let seed = 0x23456789;
  const bootstrap = Array.from({ length: 10000 }, () => {
    const draw = logs.map(() => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return logs[Math.floor((seed >>> 0) / 4294967296 * logs.length)];
    });
    return Math.exp(mean(draw));
  }).sort((a, b) => a - b);
  const interval = [bootstrap[250], bootstrap[9750]];
  return {
    beforeMedianOfSessionMediansMs: round(median(sessions.filter((s) => s.label === "before").map((s) => s.medianMs))),
    afterMedianOfSessionMediansMs: round(median(sessions.filter((s) => s.label === "after").map((s) => s.medianMs))),
    pairedRatios: ratios.map(round),
    pairedGeometricMeanChangePercent: round((Math.exp(mean(logs)) - 1) * 100),
    pairedBootstrap95PercentInterval: interval.map((v) => round((v - 1) * 100)),
    withinTwoPercent: interval[0] >= 0.98 && interval[1] <= 1.02,
    interpretation: "Exploratory paired bootstrap over session medians; not a guarantee for other machines or workloads.",
  };
}

const work = await mkdtemp(resolve(stateDir, ".replace1k-"));
let server;
try {
  const builds = { before: await build("before", work), after: await build("after", work) };
  const fixture = await readFile(resolve(fixtureDir, "index.html"), "utf8");
  server = createServer(async (req, res) => {
    try {
      const [, label, ...parts] = new URL(req.url, "http://localhost").pathname.split("/");
      if (!(label in builds)) { res.writeHead(404).end(); return; }
      const asset = parts.join("/");
      if (asset === "auto.min.js") {
        res.setHeader("Content-Type", "text/javascript"); res.end(builds[label].bundle); return;
      }
      if (asset === "index.html") {
        res.setHeader("Content-Type", "text/html");
        res.end(fixture.replace("../../dist/auto.min.js", `/${label}/auto.min.js`)); return;
      }
      const file = resolve(fixtureDir, asset);
      if (!file.startsWith(fixtureDir + sep)) { res.writeHead(403).end(); return; }
      const mime = { ".js": "text/javascript", ".css": "text/css", ".woff": "font/woff", ".woff2": "font/woff2" };
      res.setHeader("Content-Type", mime[extname(file)] ?? "application/octet-stream");
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  const sessions = [];
  const environment = {
    node: process.version, platform: process.platform, release: os.release(), arch: process.arch,
    cpu: os.cpus()[0].model, logicalCpus: os.cpus().length,
    typescript: version("typescript", stateDir), rollup: version("rollup", stateDir),
    terser: version("terser", stateDir), playwright: version("@playwright/test", resolve(root, "e2e")),
    packageLockSha256: hash(await readFile(resolve(stateDir, "package-lock.json"))),
  };
  const result = {
    timestamp: new Date().toISOString(), environment,
    builds: Object.fromEntries(Object.entries(builds).map(([k, v]) => [k, v.metadata])),
    fixture: { htmlSha256: hash(fixture), buildDataSha256: hash(await readFile(resolve(fixtureDir, "buildData.js"))) },
    methodology: { pairs, warmup, samples, cpuThrottle: 1, viewport: [1280, 800], freshBrowserPerSession: true,
      order: "Alternating AB / BA pairs", randomSeed: "0x12345678",
      timing: "performance.now around programmatic click to DOM completion via MutationObserver; excludes paint and automation",
      validation: "All 1,000 sequential IDs and labels equal state after every warmup and measured replacement",
      settling: "Two requestAnimationFrame callbacks before every replacement; no forced GC; no concurrent benchmark sessions" },
    sessions,
  };
  await mkdir(dirname(out), { recursive: true });
  for (let pair = 0; pair < pairs; pair++) {
    for (const label of pair % 2 === 0 ? ["before", "after"] : ["after", "before"]) {
      sessions.push(await measure(`http://127.0.0.1:${port}/${label}/index.html`, label, pair));
      await writeFile(out, JSON.stringify(result, null, 2) + "\n");
    }
  }
  result.comparison = comparison(sessions);
  await writeFile(out, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result.comparison, null, 2));
  console.log(`Written: ${out}`);
} finally {
  if (server) await new Promise((done) => server.close(done));
  if (dirname(work) !== stateDir || !basename(work).startsWith(".replace1k-")) throw new Error("Unsafe cleanup path");
  await rm(work, { recursive: true, force: true });
}
