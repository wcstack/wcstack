// The open issues' reproductions (and the SSR / component-timing cases) in Chromium, on 3.3.0 and
// on state-next. Pages are served by route interception; the Issues' CDN URL answers the bundle.
// Usage: node run.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
const DIR = fileURLToPath(new URL(".", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
const require = createRequire(`${REPO}/e2e/package.json`);
const { chromium } = require("@playwright/test");
const BUNDLES = {
  "3.3.0": `${REPO}/packages/state/dist/auto.min.js`,
  next: `${REPO}/packages/state-next/dist/auto.min.js`,
};

const doc = (head, body) => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const STATE = `<script type="module" src="https://esm.run/@wcstack/state/auto"></script>`;
const ready = async (page) => {
  await page.waitForFunction(() => document.querySelector("wcs-state")?.connectedCallbackPromise !== undefined);
  await page.evaluate(async () => {
    await document.querySelector("wcs-state").connectedCallbackPromise.catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
  });
};
const tick = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
const write = (page, src) => page.evaluate((src) => {
  document.querySelector("wcs-state").createState("writable", new Function("s", src));
}, src);
const texts = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent.trim()), sel);

const X_CARD = `<script>
customElements.define("x-card", class extends HTMLElement {
  state = { mode: "view", toggle() { this.mode = this.mode === "view" ? "edit" : "view"; } };
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML =
      '<wcs-state bind-component="state"></wcs-state>'
      + '<span>{{ name }}</span> <span class="mode">{{ mode }}</span>'
      + '<button data-wcs="onclick: toggle">toggle</button>';
  }
});
</script>`;
const X_LIST_TOTAL = `<script>
customElements.define("x-list", class extends HTMLElement {
  state = { get total() { return this.$getAll("items.*.v", []).reduce((a, b) => a + b, 0); } };
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML =
      '<wcs-state bind-component="state"></wcs-state>'
      + '<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>'
      + '<p class="total">{{ total }}</p>';
  }
});
</script>`;
const X_LIST_BUMP = `<script>
customElements.define("x-list", class extends HTMLElement {
  state = { bump() { this["items.0.v"] = this["items.0.v"] + 10; } };
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML =
      '<wcs-state bind-component="state"></wcs-state>'
      + '<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>'
      + '<button data-wcs="onclick: bump">bump</button>';
  }
});
</script>`;
const GROUPS = `<wcs-state><script type="module">
export default { groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }, { v: 4 }] }] };
</script></wcs-state>`;
const X_D = `customElements.define("x-d", class extends HTMLElement {
  state = {};
  constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = '<wcs-state bind-component="state"></wcs-state><span class="d">{{ d }}</span>'; }
});`;
const shownD = (page) => page.evaluate(() => [...document.querySelectorAll("x-d")].map((c) => c.shadowRoot?.querySelector(".d")?.textContent ?? "(not upgraded)"));

const ISSUES = [
  {
    name: "#319 出力専用メンバー（Issue の手順そのまま）",
    html: doc(`<script>
class ConfOutput extends HTMLElement {
  static wcBindable = { protocol: "wc-bindable", version: 1,
    properties: [{ name: "status", event: "conf-output:status" }] };
  status = "ready";
}
customElements.define("conf-output", ConfOutput);
</script>${STATE}`, `<wcs-state><script type="module">
export default { rows: [{ st: "seed" }, { st: "s2" }] };
</script></wcs-state>
<ul>
  <template data-wcs="for: rows">
    <li><conf-output data-wcs="status: .st"></conf-output><span>{{ .st }}</span></li>
  </template>
</ul>`),
    run: async (page) => ({ spans: await texts(page, "li span") }),
    expect: { spans: ["ready", "ready"] },
  },
  {
    name: "#319 双方向メンバーに #init=element",
    html: doc(`<script>
customElements.define("conf-num", class extends HTMLElement {
  static wcBindable = { protocol: "wc-bindable", version: 1,
    properties: [{ name: "value", event: "conf-num:change" }], inputs: [{ name: "value" }] };
  value = 42;
});
</script>${STATE}`, `<wcs-state><script type="module">
export default { rows: [{ n: 1 }, { n: 2 }] };
</script></wcs-state>
<ul><template data-wcs="for: rows"><li><conf-num data-wcs="value#init=element: .n"></conf-num><span>{{ .n }}</span></li></template></ul>`),
    run: async (page) => ({ spans: await texts(page, "li span") }),
    expect: { spans: ["42", "42"] },
  },
  {
    name: "#320 if で消して戻した for",
    html: doc(STATE, `<wcs-state><script type="module">
export default {
  showA: true,
  items: [{ id: 1, name: "item 1" }, { id: 2, name: "item 2" }],
};
</script></wcs-state>
<div><template data-wcs="if: showA">
  <ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>
</template></div>
<ol><template data-wcs="for: items"><li>{{ .id }}:{{ .name }}</li></template></ol>`),
    run: async (page) => {
      await write(page, `s.items = s.items.concat({ id: 3, name: "item 3" });`); await tick(page);
      await write(page, `s.showA = false;`); await tick(page);
      await write(page, `s.items = s.items.concat({ id: 4, name: "item 4" });`); await tick(page);
      await write(page, `s.showA = true;`); await tick(page);
      const afterShow = await texts(page, "ul li");
      await write(page, `s.items = s.items.toReversed();`); await tick(page);
      return { afterShow, afterReverse: await texts(page, "ul li") };
    },
    expect: { afterShow: ["item 1", "item 2", "item 3", "item 4"], afterReverse: ["item 4", "item 3", "item 2", "item 1"] },
  },
  {
    name: "#321 メソッドが私有キーに書く",
    html: doc(`${X_CARD}${STATE}`, `<wcs-state><script type="module">
export default { user: { name: "Alice" } };
</script></wcs-state>
<x-card data-wcs="state: user"></x-card>`),
    run: async (page) => {
      await page.evaluate(() => document.querySelector("x-card").shadowRoot.querySelector("button").click());
      await tick(page);
      return page.evaluate(() => ({ state: document.querySelector("x-card").state.mode, shown: document.querySelector("x-card").shadowRoot.querySelector(".mode").textContent }));
    },
    expect: { state: "edit", shown: "edit" },
  },
  {
    name: "#322 行の中のコンポーネントの getter で $getAll",
    html: doc(`${X_LIST_TOTAL}${STATE}`, `${GROUPS}
<template data-wcs="for: groups">
  <section><x-list data-wcs="state.items: .items"></x-list></section>
</template>`),
    run: async (page) => ({ totals: await page.evaluate(() => [...document.querySelectorAll("x-list")].map((c) => c.shadowRoot.querySelector(".total").textContent)) }),
    expect: { totals: ["3", "7"] },
  },
  {
    name: "#323 行の中のコンポーネントから this[\"items.0.v\"] に書く",
    html: doc(`${X_LIST_BUMP}${STATE}`, `${GROUPS}
<template data-wcs="for: groups">
  <section><x-list data-wcs="state.items: .items"></x-list></section>
</template>`),
    run: async (page) => {
      await page.evaluate(() => document.querySelectorAll("x-list")[1].shadowRoot.querySelector("button").click());
      await tick(page);
      return {
        value: await page.evaluate(() => { let v; document.querySelector("wcs-state").createState("readonly", (s) => { v = s["groups.1.items.0.v"]; }); return v; }),
        shown: await page.evaluate(() => [...document.querySelectorAll("x-list")[1].shadowRoot.querySelectorAll("li")].map((n) => n.textContent)),
      };
    },
    expect: { value: 13, shown: ["13", "4"] },
  },
  {
    name: "行の中のコンポーネント・クラスは先に定義（対照）",
    html: doc(`<script>${X_D}</script>${STATE}`, `<wcs-state><script type="module">
export default { nodes: [{ v: 1 }, { v: 2 }], get "nodes.*.double"() { return this["nodes.*.v"] * 2; } };
</script></wcs-state>
<ul><template data-wcs="for: nodes"><li><x-d data-wcs="state.d: .double"></x-d></li></template></ul>`),
    run: async (page) => {
      const before = await shownD(page);
      await write(page, `s["nodes.0.v"] = 9;`); await tick(page);
      return { before, after: await shownD(page) };
    },
    expect: { before: ["2", "4"], after: ["18", "4"] },
  },
  {
    name: "行の中のコンポーネント・クラスは描画の後に定義（autoloader の順）",
    html: doc(STATE, `<wcs-state><script type="module">
export default { nodes: [{ v: 1 }, { v: 2 }], get "nodes.*.double"() { return this["nodes.*.v"] * 2; } };
</script></wcs-state>
<ul><template data-wcs="for: nodes"><li><x-d data-wcs="state.d: .double"></x-d></li></template></ul>`),
    run: async (page) => {
      await page.evaluate(X_D); await tick(page);
      const before = await shownD(page);
      await write(page, `s["nodes.0.v"] = 9;`); await tick(page);
      return { before, after: await shownD(page) };
    },
    expect: { before: ["2", "4"], after: ["18", "4"] },
  },
];

// SSR: the server's output (happy-dom, as @wcstack/server renders) hydrated in Chromium; the page's
// inline state script is put back into the <wcs-state> the server emitted.
const DOUBLE = `get "nodes.*.double"() { return this["nodes.*.v"] * 2; }`;
const ssrPage = (file, stateSrc, head = "") => {
  const server = readFileSync(`${DIR}/${file}.html`, "utf8")
    .replace(`<wcs-state enable-ssr=""></wcs-state>`, `<wcs-state enable-ssr=""><script type="module">export default ${stateSrc};</script></wcs-state>`);
  // record the server's nodes before any module runs (a classic script at the end of the body)
  return doc(`${head}${STATE}`, `${server}<script>window.__serverLis = [...document.querySelectorAll("li")];</script>`);
};
const adopted = (page) => page.evaluate(() => window.__serverLis.length > 0 && window.__serverLis.every((n) => n.isConnected));
const SSR = [
  {
    name: "SSR 行の getter（属性）",
    html: ssrPage("ssr-row-getter", `{ nodes: [{ v: 1 }, { v: 2 }], ${DOUBLE} }`),
    run: async (page) => { const a = await adopted(page); const before = await texts(page, "li"); await write(page, `s["nodes.1.v"] = 10;`); await tick(page); return { adopted: a, before, after: await texts(page, "li") }; },
    expect: { adopted: true, before: ["2", "4"], after: ["2", "20"] },
  },
  {
    name: "SSR 入れ子の for の内側の行",
    html: ssrPage("ssr-nested-for", `{ groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }] }], get "groups.*.items.*.double"() { return this["groups.*.items.*.v"] * 2; } }`),
    run: async (page) => { const a = await adopted(page); const before = await texts(page, "ol li"); await write(page, `s["groups.0.items.1.v"] = 10; s["groups.1.items.0.v"] = 20;`); await tick(page); return { adopted: a, before, after: await texts(page, "ol li") }; },
    expect: { adopted: true, before: ["2", "4", "6"], after: ["2", "20", "40"] },
  },
  {
    name: "SSR 行の中の mustache",
    html: ssrPage("ssr-row-mustache", `{ nodes: [{ v: 1 }, { v: 2 }], ${DOUBLE} }`),
    run: async (page) => { const a = await adopted(page); const before = await texts(page, "li"); await write(page, `s["nodes.0.v"] = 7;`); await tick(page); return { adopted: a, before, after: await texts(page, "li") }; },
    expect: { adopted: true, before: ["1 x2 = 2", "2 x2 = 4"], after: ["7 x2 = 14", "2 x2 = 4"] },
  },
  {
    name: "SSR if の中の for",
    html: ssrPage("ssr-if-for", `{ open: true, nodes: [{ v: 1 }, { v: 2 }], ${DOUBLE} }`),
    run: async (page) => { const a = await adopted(page); const before = await texts(page, "li"); await write(page, `s["nodes.1.v"] = 5;`); await tick(page); return { adopted: a, before, after: await texts(page, "li") }; },
    expect: { adopted: true, before: ["2", "4"], after: ["2", "10"] },
  },
  {
    name: "SSR 行の中の bind-component・クラスは先に定義",
    html: ssrPage("ssr-row-component", `{ nodes: [{ v: 1 }, { v: 2 }], ${DOUBLE} }`, `<script>${X_D}</script>`),
    run: async (page) => { const a = await adopted(page); const before = await shownD(page); await write(page, `s["nodes.0.v"] = 9;`); await tick(page); return { adopted: a, before, after: await shownD(page), marker: await page.evaluate(() => document.querySelectorAll("[data-wcs-wired]").length) }; },
    expect: { adopted: true, before: ["2", "4"], after: ["18", "4"], marker: 0 },
  },
  {
    name: "SSR 行の中の bind-component・クラスは後で定義",
    html: ssrPage("ssr-row-component", `{ nodes: [{ v: 1 }, { v: 2 }], ${DOUBLE} }`),
    run: async (page) => { const a = await adopted(page); await page.evaluate(X_D); await tick(page); const before = await shownD(page); await write(page, `s["nodes.0.v"] = 9;`); await tick(page); return { adopted: a, before, after: await shownD(page), marker: await page.evaluate(() => document.querySelectorAll("[data-wcs-wired]").length) }; },
    expect: { adopted: true, before: ["2", "4"], after: ["18", "4"], marker: 0 },
  },
];

const browser = await chromium.launch({ headless: true });
const rows = [];
async function runCase(c, bundleName) {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });
  page.on("pageerror", (e) => errors.push(("pageerror: " + e.message).slice(0, 140)));
  await page.route("http://wcs.test/page.html", (r) => r.fulfill({ contentType: "text/html", body: c.html }));
  await page.route("https://esm.run/@wcstack/state/auto", (r) => r.fulfill({ path: BUNDLES[bundleName], contentType: "text/javascript" }));
  await page.goto("http://wcs.test/page.html");
  let got;
  try {
    await ready(page);
    got = await c.run(page);
  } catch (e) {
    got = { error: String(e).slice(0, 160) };
  }
  await page.close();
  const ok = JSON.stringify(got) === JSON.stringify(c.expect);
  rows.push({ case: c.name, bundle: bundleName, ok, got, errors });
  console.log(`${ok ? "OK  " : "NG  "} [${bundleName}] ${c.name}  ${ok ? "" : JSON.stringify(got)}${errors.length ? "  console: " + JSON.stringify(errors.slice(0, 2)) : ""}`);
}
for (const c of ISSUES) for (const b of ["3.3.0", "next"]) await runCase(c, b);
for (const c of SSR) await runCase(c, "next");
await browser.close();
