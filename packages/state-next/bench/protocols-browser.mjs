// Real-browser check of the two protocol receptacles with the packages that use them:
// @wcstack/router hands route content and <wcs-head> clones to the binder, and
// <wcs-view-transition naming="auto"> takes state's DOM changes through the transition
// runner. Runs the same page on the current @wcstack/state as a control.
//   node packages/state-next/bench/protocols-browser.mjs   (repository root, after the build)
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "../../..");
const require = createRequire(join(root, "e2e/package.json"));
const { chromium } = require("@playwright/test");
const port = 4331;
const origin = `http://127.0.0.1:${port}`;
const html = (stateBundle) => `<!DOCTYPE html><html><head><title>start</title>
<script type="module" src="/packages/view-transition/dist/auto.min.js"></script>
<script type="module" src="/packages/router/dist/auto.min.js"></script>
<script type="module" src="${stateBundle}"></script>
</head><body>
<wcs-view-transition naming="auto"></wcs-view-transition>
<wcs-state><script type="module">export default {
  msg: "hi", n: 0, items: ["a", "b"],
  add() { this.items = this.items.concat("r" + this.items.length); },
  hit() { this.n++; },
};</script></wcs-state>
<wcs-router basename="/app"><template>
  <wcs-route path="/"><p id="home" data-wcs="textContent: msg"></p></wcs-route>
  <wcs-route path="/about">
    <wcs-head><title data-wcs="textContent: msg"></title></wcs-head>
    <p id="about">{{ msg }}|{{ n }}</p>
    <ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>
    <button id="add" data-wcs="onclick: add">add</button>
    <button id="hit" data-wcs="onclick: hit">hit</button>
  </wcs-route>
</template></wcs-router>
<wcs-outlet></wcs-outlet>
</body></html>`;

const server = spawn(process.execPath, ["serve.mjs"], { cwd: join(root, "e2e"), env: { ...process.env, PORT: String(port) }, stdio: "ignore", windowsHide: true });
let browser;
try {
  for (let i = 0; ; i++) { try { if ((await fetch(`${origin}/packages/router/dist/auto.min.js`)).ok) break; } catch {} if (i > 75) throw new Error("server"); await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ headless: true });
  for (const [label, bundle] of [["current @wcstack/state", "/packages/state/dist/auto.min.js"], ["state-next", "/packages/state-next/dist/auto.min.js"]]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
    await page.addInitScript(() => {
      const orig = document.startViewTransition?.bind(document);
      window.__vt = 0;
      if (orig) document.startViewTransition = (...a) => { window.__vt++; return orig(...a); };
    });
    await page.route(`${origin}/app/**`, (r) => r.fulfill({ contentType: "text/html", body: html(bundle) }));
    await page.goto(`${origin}/app/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
    const out = { home: await page.textContent("#home").catch(() => null) };
    const go = (path) => page.evaluate((p) => window.navigation ? navigation.navigate(p).finished : history.pushState({}, "", p), path);
    const snap = () => page.evaluate(() => ({
      about: document.querySelector("#about")?.textContent ?? null,
      rows: Array.from(document.querySelectorAll("li")).map((li) => `${li.textContent}${li.style.viewTransitionName ? "#" + li.style.viewTransitionName : ""}`).join(","),
      title: document.title, vt: window.__vt,
    }));
    await go("/app/about");
    await page.waitForTimeout(300);
    out.about = await snap();
    await page.click("#add");
    await page.waitForTimeout(400);
    out.afterAdd = await snap();
    await go("/app/");
    await page.waitForTimeout(200);
    await go("/app/about");
    await page.waitForTimeout(300);
    await page.click("#hit");
    await page.waitForTimeout(300);
    out.afterReturnHit = await snap();
    console.log(`== ${label}\n${JSON.stringify(out, null, 1)}`);
    if (errors.length > 0) console.log("  errors:", errors);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}
