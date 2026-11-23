/**
 * mount-dcc.test.ts — Declarative Custom Component（@wcstack/state の data-wc-definition）の定義を
 * 載せたページを mount() する（docs/seam-apps.md、garden-plots）。
 * happy-dom のパーサは `<template shadowrootmode>` を親の shadow root にしないので、定義は shadow root を
 * 持たず、タグは定義されず、mount() は何も言わずに解決していた。
 */
import { describe, it, expect, vi } from "vitest";
import { mount, settle } from "../src/exports";

let seq = 0;

/** A definition as an author writes it in a page (or keeps in a part's file). */
const badge = (tag: string) => `<${tag} data-wc-definition>
  <template shadowrootmode="open">
    <span class="box" data-wcs="textContent: label"></span><slot></slot>
    <wcs-state><script type="module">
      export default { kind: "info", get label() { return "[" + this.kind + "]"; }, $bindables: ["kind"] };
    </script></wcs-state>
  </template>
</${tag}>`;

describe("mount(): ページに書いた DCC の定義", () => {
  it("定義がタグを定義し、ページの束縛が届く（mount() が定義とインスタンスを待つ）", async () => {
    const tag = `t-badge-${seq++}`;
    const app = await mount(`${badge(tag)}
      <wcs-state json='{"kind":"warn"}'></wcs-state>
      <${tag} id="use" data-wcs="kind: kind">text</${tag}>
      <p id="plain" data-wcs="textContent: kind"></p>`);
    expect(customElements.get(tag)).toBeDefined();
    // the definition has its shadow root, as a browser's parser would have made it
    const definition = document.querySelector(`${tag}[data-wc-definition]`)!;
    expect(definition.shadowRoot).not.toBeNull();
    expect(definition.querySelector("template")).toBeNull();
    // no settle(): mount() waited for the instance too
    expect(document.getElementById("use")!.shadowRoot!.querySelector(".box")!.textContent).toBe("[warn]");
    expect(document.getElementById("plain")!.textContent).toBe("warn");

    await app.state().write((s) => { s.kind = "free"; });
    await settle();
    expect(document.getElementById("use")!.shadowRoot!.querySelector(".box")!.textContent).toBe("[free]");
  });

  it("行の中のインスタンスと、定義の中に入れ子にした定義", async () => {
    const outer = `t-card-${seq++}`;
    const inner = `t-chip-${seq++}`;
    const app = await mount(`<${inner} data-wc-definition>
        <template shadowrootmode="open"><i class="chip" data-wcs="textContent: label"></i>
          <wcs-state><script type="module">export default { label: "", $bindables: ["label"] };</script></wcs-state>
        </template>
      </${inner}>
      <${outer} data-wc-definition>
        <template shadowrootmode="open"><b class="title" data-wcs="textContent: title"></b><${inner} data-wcs="label: title"></${inner}>
          <wcs-state><script type="module">export default { title: "", $bindables: ["title"] };</script></wcs-state>
        </template>
      </${outer}>
      <wcs-state json='{"rows":[{"t":"a"},{"t":"b"}]}'></wcs-state>
      <ul><template data-wcs="for: rows"><li><${outer} data-wcs="title: .t"></${outer}></li></template></ul>`);
    const cards = [...document.querySelectorAll(`li ${outer}`)];
    expect(cards.map((c) => c.shadowRoot!.querySelector(".title")!.textContent)).toEqual(["a", "b"]);
    expect(cards.map((c) => c.shadowRoot!.querySelector(inner)!.shadowRoot!.querySelector(".chip")!.textContent)).toEqual(["a", "b"]);
    expect(app.state().read((s) => s.rows.length)).toBe(2);
  });

  it("root: \"shadow\" でも同じ", async () => {
    const tag = `t-badge-${seq++}`;
    const app = await mount(`${badge(tag)}<wcs-state json='{"kind":"used"}'></wcs-state><${tag} id="use" data-wcs="kind: kind"></${tag}>`, { root: "shadow" });
    const use = (app.root as ShadowRoot).getElementById("use")!;
    expect(use.shadowRoot!.querySelector(".box")!.textContent).toBe("[used]");
  });

  it("shadowrootmode が open / closed でない template、すでに shadow root を持つ親の template は、そのまま残す", async () => {
    const host = `t-host-${seq++}`;
    customElements.define(host, class extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<slot></slot>"; }
    });
    await mount(`<wcs-state json='{"a":1}'></wcs-state>
      <div id="odd"><template shadowrootmode="sideways"><p>kept</p></template></div>
      <${host} id="has"><template shadowrootmode="open"><p>kept</p></template></${host}>
      <div id="closed"><template shadowrootmode="closed"><p>inside</p></template></div>`);
    expect(document.querySelector("#odd > template")).not.toBeNull();
    expect(document.querySelector("#has > template")).not.toBeNull();
    // a closed root is made, and is not reachable from outside — as in a browser
    expect(document.querySelector("#closed > template")).toBeNull();
    expect(document.getElementById("closed")!.shadowRoot).toBeNull();
  });

  it("失敗する定義（$bindables の誤り）でも mount() は解決する: 報告は @wcstack/state がする", async () => {
    const tag = `t-bad-${seq++}`;
    // (happy-dom has no reportError: @wcstack/state reports through console.error)
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      await mount(`<${tag} data-wc-definition>
          <template shadowrootmode="open"><span></span>
            <wcs-state><script type="module">export default { n: 0, $bindables: ["nope"] };</script></wcs-state>
          </template>
        </${tag}>
        <wcs-state json='{"a":1}'></wcs-state><p id="plain" data-wcs="textContent: a"></p>`);
      await settle();
    } finally {
      spy.mockRestore();
    }
    expect(customElements.get(tag)).toBeUndefined();
    expect(document.getElementById("plain")!.textContent).toBe("1");
    expect(errors.map(String).join("\n")).toContain(`$bindables entry "nope" does not exist on the state.`);
  });
});
