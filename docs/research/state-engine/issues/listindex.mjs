// Where does 3.3.0 throw "ListIndex not found" on a write to a row path? Chromium, several shapes.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
const require = createRequire(`${REPO}/e2e/package.json`);
const { chromium } = require("@playwright/test");
const BUNDLES = { "3.3.0": `${REPO}/packages/state/dist/auto.min.js`, next: `${REPO}/packages/state-next/dist/auto.min.js` };

const page = (state, body) => `<!doctype html><html><head><meta charset="utf-8">
<script type="module" src="https://esm.run/@wcstack/state/auto"></script></head><body>
<wcs-state><script type="module">export default ${state};</script></wcs-state>${body}</body></html>`;

const GROUPS = `{ groups: [{ name: "a", items: [{ v: 1 }, { v: 2 }] }], bump() { this["groups.0.items.0.v"] = 7; },
  get "groups.*.sum"() { return this["groups.*.items"].reduce((a, x) => a + x.v, 0); } }`;
const CASES = [
  { name: "V1 最上位のリスト・for で描かない", html: page(`{ items: [{ v: 1 }, { v: 2 }], get total() { return this.items.reduce((a, x) => a + x.v, 0); } }`, `<p id="out">{{ total }}</p>`), path: "items.0.v" },
  { name: "V2 入れ子のリスト・外側だけ for で描く", html: page(GROUPS, `<template data-wcs="for: groups"><section><h2>{{ .name }}</h2><p class="sum">{{ .sum }}</p></section></template><button id="b" data-wcs="onclick: bump">bump</button>`), path: "groups.0.items.0.v" },
  { name: "V3 入れ子のリスト・どちらも for で描かない", html: page(GROUPS, `<p>{{ groups.0.name }}</p><button id="b" data-wcs="onclick: bump">bump</button>`), path: "groups.0.items.0.v" },
  { name: "V4 入れ子のリスト・両方 for で描く（対照）", html: page(GROUPS, `<template data-wcs="for: groups"><section><ul><template data-wcs="for: .items"><li>{{ .v }}</li></template></ul></section></template><button id="b" data-wcs="onclick: bump">bump</button>`), path: "groups.0.items.0.v" },
];

const browser = await chromium.launch({ headless: true });
for (const bundle of ["3.3.0", "next"]) {
  for (const c of CASES) {
    const p = await browser.newPage();
    const errors = [];
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text().replace(/\s+/g, " ").slice(0, 170)); });
    p.on("pageerror", (e) => errors.push(("pageerror: " + e.message).slice(0, 170)));
    await p.route("http://wcs.test/page.html", (r) => r.fulfill({ contentType: "text/html", body: c.html }));
    await p.route("https://esm.run/@wcstack/state/auto", (r) => r.fulfill({ path: BUNDLES[bundle], contentType: "text/javascript" }));
    await p.goto("http://wcs.test/page.html");
    await p.waitForFunction(() => document.querySelector("wcs-state")?.connectedCallbackPromise !== undefined);
    const res = await p.evaluate(async (path) => {
      const el = document.querySelector("wcs-state");
      await el.connectedCallbackPromise;
      let thrown = null;
      try { el.createState("writable", (s) => { s[path] = 5; }); } catch (e) { thrown = String(e.message).slice(0, 120); }
      await new Promise((r) => setTimeout(r, 30));
      let v, readThrown = null, raw;
      try { el.createState("readonly", (s) => { v = s[path]; }); } catch (e) { readThrown = String(e.message).slice(0, 120); }
      // the value in the plain object, bypassing the proxy
      el.createState("readonly", (s) => { raw = JSON.stringify(path.startsWith("items") ? s.items : s.groups); });
      return { writeThrown: thrown, readThrown, read: v, raw };
    }, c.path);
    let click = null;
    if (await p.$("#b")) {
      errors.length = 0;
      await p.click("#b");
      await p.waitForTimeout(50);
      click = { raw: await p.evaluate(() => { let v; document.querySelector("wcs-state").createState("readonly", (s) => { v = JSON.stringify(s.groups); }); return v; }), errors: errors.slice(0, 1) };
    }
    console.log(`[${bundle}] ${c.name}\n   createState: ${JSON.stringify(res)}${click ? `\n   click bump (→7): ${JSON.stringify(click)}` : ""}`);
    await p.close();
  }
}
await browser.close();
