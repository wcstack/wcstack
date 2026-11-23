// Each part on its own, headless, with @wcstack/testing (vitest + happy-dom).
// The developers' parts are classes: define them and mount a page that hands one object to the part.
// The designers' parts are DCC definitions: the part's file goes before the page's markup, and mount() defines it.
import { afterEach, describe, expect, test } from "vitest";
import { fire, mount, settle } from "@wcstack/testing";
import { partFile } from "./helpers.js";

const define = (tag, cls) => { if (!customElements.get(tag)) customElements.define(tag, cls); };
async function classPart(tag, file) {
  const mod = await import(`../public/parts/${file}`);
  define(tag, mod.default);
}
const shadow = (el) => el.shadowRoot;
let app;
afterEach(() => { app?.unmount(); app = undefined; });

async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  for (;;) {
    await settle();
    try { const v = fn(); if (v) return v; } catch {}
    if (Date.now() > end) return fn();
  }
}

describe("developers' parts (bind-component)", () => {
  test("plot-tile: shows the plot it is given; a click writes the page's view", async () => {
    await classPart("plot-tile", "plot-tile.js");
    app = await mount(`
      <wcs-state json='{"plot":{"id":7,"no":"B-03","status":"used","tenant":{"name":"佐藤 太郎"}},"view":{"filter":"all","selectedId":null,"selectable":true}}'></wcs-state>
      <plot-tile data-wcs="state: plot; state.view: view"></plot-tile>`);
    const button = await until(() => shadow(app.root.querySelector("plot-tile"))?.querySelector("button"));
    await until(() => button.textContent.includes("B-03"));
    expect(button.querySelector(".no").textContent).toBe("B-03");
    expect(button.querySelector(".who").textContent).toBe("佐藤");
    expect(button.className).toContain("s-used");
    fire(button, "click");
    await settle();
    expect(app.state().read((s) => s["view.selectedId"])).toBe(7);
    await until(() => button.className.includes("selected"));
    expect(button.getAttribute("aria-pressed")).toBe("true");
    // the page changes the plot: the tile follows (nothing was copied)
    await app.state().write((s) => { s["plot.status"] = "free"; s["plot.tenant"] = null; });
    await until(() => button.className.includes("s-free"));
    expect(button.querySelector(".who").textContent).toBe("");
  });

  test("area-block: 空き n / m, one tile per plot, and the page reads its free count", async () => {
    await classPart("plot-tile", "plot-tile.js");
    await classPart("area-block", "area-block.js");
    const plots = ["free", "used", "free", "paused"].map((status, i) => ({ id: i + 1, no: `A-0${i + 1}`, status, tenant: null }));
    app = await mount(`
      <wcs-state json='${JSON.stringify({ area: { id: 1, name: "東", plots }, view: { filter: "all", selectedId: null, selectable: true } })}'></wcs-state>
      <area-block data-wcs="state: area; state.view: view"></area-block>
      <output data-wcs="textContent: area.freeCount"></output>`);
    const block = app.root.querySelector("area-block");
    await until(() => shadow(block)?.querySelectorAll("plot-tile").length === 4);
    await until(() => shadow(block).querySelector(".free").textContent === "2");
    expect(shadow(block).querySelector(".total").textContent).toBe("4");
    await until(() => app.root.querySelector("output").textContent === "2"); // the exported getter
  });

  test("garden-card: 利用率 from its plots, folding is private", async () => {
    await classPart("plot-tile", "plot-tile.js");
    await classPart("area-block", "area-block.js");
    await classPart("garden-card", "garden-card.js");
    const plots = ["used", "renewal", "free", "paused"].map((status, i) => ({ id: i + 1, no: `A-0${i + 1}`, status, tenant: null }));
    app = await mount(`
      <wcs-state json='${JSON.stringify({ garden: { id: 1, name: "見本", address: "どこか", areas: [{ id: 1, name: "東", plots }] }, view: { filter: "all", selectedId: null, selectable: true } })}'></wcs-state>
      <garden-card data-wcs="state: garden; state.view: view"></garden-card>
      <output data-wcs="textContent: garden.usage"></output>`);
    const card = app.root.querySelector("garden-card");
    await until(() => shadow(card)?.querySelector(".pct")?.textContent === "50");
    await until(() => app.root.querySelector("output").textContent === "50");
    fire(shadow(card).querySelector("button.fold"), "click");
    await until(() => shadow(card).querySelector(".areas").hidden === true);
    expect(app.state().read((s) => s.garden.folded)).toBeUndefined(); // never written to the page's data
  });

  test("tenant-editor: messages, the unsaved mark, writes in place", async () => {
    await classPart("tenant-editor", "tenant-editor.js");
    const t = { name: "佐藤", phone: "1", postal: "", address: "", saved: { name: "佐藤", phone: "1", postal: "", address: "" }, errors: {} };
    app = await mount(`
      <wcs-state json='${JSON.stringify({ t })}'></wcs-state>
      <tenant-editor data-wcs="state: t"></tenant-editor>
      <output class="valid" data-wcs="textContent: t.valid"></output>`);
    const ed = app.root.querySelector("tenant-editor");
    const name = await until(() => shadow(ed)?.querySelector("#name"));
    await until(() => name.value === "佐藤");
    expect(shadow(ed).querySelector(".dirty").hidden).toBe(true);
    name.value = "";
    fire(name, "input");
    await settle();
    expect(app.state().read((s) => s["t.name"])).toBe("");
    await until(() => shadow(ed).querySelector(".dirty").hidden === false);
    await until(() => app.root.querySelector("output.valid").textContent === "false");
    const phone = shadow(ed).querySelector("#phone");
    phone.value = "12a";
    fire(phone, "input");
    await until(() => shadow(ed).querySelector("#phone-msg").textContent.includes("数字とハイフン"));
    await app.state().write((s) => { s["t.errors"] = { name: "サーバーのメッセージ" }; });
    await until(() => shadow(ed).querySelector("#name-msg").textContent === "サーバーのメッセージ");
  });

  test("faq-node: counts below it, through its own children", async () => {
    await classPart("faq-node", "faq-node.js");
    const node = { id: 1, title: "親", questions: [{ q: "a", a: "" }], children: [{ id: 2, title: "子", questions: [{ q: "b", a: "" }, { q: "c", a: "" }], children: [] }] };
    app = await mount(`
      <wcs-state json='${JSON.stringify({ node, q: "" })}'></wcs-state>
      <faq-node data-wcs="state: node; state.q#ro: q"></faq-node>
      <output data-wcs="textContent: node.total"></output>`);
    const el = app.root.querySelector("faq-node");
    await until(() => shadow(el)?.querySelector(".count")?.textContent === "3");
    await until(() => app.root.querySelector("output").textContent === "3");
  });
});

describe("designers' parts (DCC)", () => {
  test("midori-badge: the kind chooses the class and icon", async () => {
    app = await mount(`${partFile("midori-badge.html")}
      <wcs-state json='{"kind":"warn"}'></wcs-state>
      <midori-badge data-wcs="kind: kind">注意</midori-badge>`);
    const badge = [...app.root.querySelectorAll("midori-badge")].find((b) => !b.hasAttribute("data-wc-definition"));
    const box = await until(() => shadow(badge)?.querySelector(".box"));
    await until(() => box.className.includes("k-warn"));
    expect(shadow(badge).querySelector(".icon").textContent).toBe("!");
  });

  test("midori-toggle: checked both ways", async () => {
    app = await mount(`${partFile("midori-toggle.html")}
      <wcs-state json='{"on":false}'></wcs-state>
      <midori-toggle data-wcs="checked: on">休止</midori-toggle>`);
    const toggle = [...app.root.querySelectorAll("midori-toggle")].find((b) => !b.hasAttribute("data-wc-definition"));
    const input = await until(() => shadow(toggle)?.querySelector("input"));
    input.checked = true;
    fire(input, "input");
    fire(input, "change");
    await until(() => app.state().read((s) => s.on) === true);
    await app.state().write((s) => { s.on = false; });
    await until(() => input.checked === false);
  });
});
