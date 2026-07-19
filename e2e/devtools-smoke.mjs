// Real-browser smoke test for the devtools playground example.
// Run from e2e/ (needs @playwright/test): node devtools-smoke.mjs
// Acceptance harness for docs/devtools-tag-design.md section 7 (real-browser pass).
// Note: headless pages may not fire rAF, so pane reads go through
// __flushRenderForTest() — the same seam the unit tests use.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const URL_ = "http://127.0.0.1:3000/examples/state-devtools-playground/";

// The example page loads packages from the CDN; e2e/serve.mjs rewrites those
// esm.run references to the local packages/*/dist bundles so this smoke test
// verifies the working tree, matching the rest of the e2e suite.
const server = spawn(process.execPath, [`${ROOT}/e2e/serve.mjs`], {
  env: { ...process.env, PORT: "3000" },
  stdio: "pipe",
});

const errors = [];
function fail(msg) {
  console.error("FAIL:", msg);
  console.error("page errors:", JSON.stringify(errors, null, 2));
  server.kill();
  process.exit(1);
}

await new Promise((r) => setTimeout(r, 1200));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

await page.goto(URL_, { waitUntil: "networkidle" });

const pane = (name) => page.evaluate((paneName) => {
  const devtools = document.querySelector("wcs-devtools");
  devtools.__flushRenderForTest();
  return devtools.shadowRoot.querySelector(`.pane-${paneName} .pane-body`).textContent;
}, name);

// 1. hook registry: one state source
const hook = await page.evaluate(() => {
  const registry = globalThis.__WCSTACK_DEVTOOLS_HOOK__;
  return registry ? { version: registry.version, kinds: [...registry.sources.values()].map((s) => s.kind) } : null;
});
if (!hook || hook.version !== 1 || hook.kinds.join() !== "state") fail("hook registry wrong: " + JSON.stringify(hook));

// 2. badge exists in shadow
const hasBadge = await page.evaluate(() => {
  const el = document.querySelector("wcs-devtools");
  return !!(el && el.shadowRoot && el.shadowRoot.querySelector(".badge"));
});
if (!hasBadge) fail("no badge");

// 3. state pane: roster + top-level keys
const stateText = await pane("state");
if (!stateText.includes("count:") || !stateText.includes("todos:")) fail("state pane: " + stateText.slice(0, 200));

// 4. wiring pane: LIVE bindings (devtools loaded first → not declared fallback)
const wiringText = await pane("wiring");
if (!/live binding/.test(wiringText) || /declared/.test(wiringText)) fail("wiring pane: " + wiringText.slice(0, 200));
if (!/count@default/.test(wiringText)) fail("wiring lacks count binding: " + wiringText.slice(0, 300));

// 5. +1 click (panel closed → no interception) → page updates, timeline records write+batch
await page.click("text=+1");
await page.waitForTimeout(200);
const counter = (await page.evaluate(() => document.querySelector(".big").textContent)).trim();
if (counter !== "1") fail("counter did not update: " + counter);
let timelineText = await pane("timeline");
if (!timelineText.includes("write") || !timelineText.includes("count@default") || !timelineText.includes("batch")) {
  fail("timeline missing write/batch: " + timelineText.slice(0, 300));
}

// 6. ghost command → warn badge (subscriberCount 0)
await page.click("text=fire ghost command");
await page.waitForTimeout(200);
await pane("timeline");
const warnCount = await page.evaluate(() =>
  document.querySelector("wcs-devtools").shadowRoot.querySelectorAll(".pane-timeline .badge-tag.warn").length
);
if (warnCount < 1) fail("no warn badge for ghost command");

// 7. clock start/stop → command + event rows
await page.click("text=start");
await page.waitForTimeout(1600);
await page.click("text=stop");
timelineText = await pane("timeline");
if (!timelineText.includes("startClock")) fail("no command row: " + timelineText.slice(-400));
if (!timelineText.includes("clockTick")) fail("no event row: " + timelineText.slice(-400));

// 8. inline edit from the State pane writes through the reactive pipeline
await page.evaluate(() => {
  const devtools = document.querySelector("wcs-devtools");
  devtools.__flushRenderForTest();
  const body = devtools.shadowRoot.querySelector(".pane-state .pane-body");
  const row = [...body.querySelectorAll(".tree-row")].find((r) => r.querySelector(".key").textContent === "count:");
  row.querySelector(".value").click();
  const input = body.querySelector("input");
  input.value = "42";
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
});
await page.waitForTimeout(300);
const counter2 = (await page.evaluate(() => document.querySelector(".big").textContent)).trim();
if (counter2 !== "42") fail("devtools edit did not reach the page: " + counter2);
const bodyText = await page.evaluate(() => document.body.textContent);
if (!bodyText.includes("double = 84")) fail("computed getter did not update after devtools edit");

// 9. path click highlights bound nodes
const highlightCount = await page.evaluate(() => {
  const devtools = document.querySelector("wcs-devtools");
  devtools.__flushRenderForTest();
  const body = devtools.shadowRoot.querySelector(".pane-state .pane-body");
  const row = [...body.querySelectorAll(".tree-row")].find((r) => r.querySelector(".key").textContent === "count:");
  row.querySelector(".key").click();
  return devtools.shadowRoot.querySelectorAll(".hl-box").length;
});
if (highlightCount < 1) fail("path click produced no highlight boxes");

// 10. no page errors overall
if (errors.length > 0) fail("page errors: " + errors.join(" | "));

console.log("SMOKE OK — hook/source, badge, state tree, live wiring, write/batch/command/event timeline, ghost-warn, devtools-edit round trip, highlight all verified");
await browser.close();
server.kill();
process.exit(0);
