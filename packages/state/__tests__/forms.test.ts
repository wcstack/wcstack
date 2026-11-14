/**
 * forms.test.ts — the forms add-on (src/features/forms.ts): what a form does outside the `input` event
 * (docs/seam-apps.md, ekiden-entry). A field being composed (an IME) is not written until its composition is
 * over; a value that arrived with no `input` event is told to state on `change` and before a submit; after a
 * reset the controls and state agree.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, forms, getBindingsReady, installFeatures, scopes } from "../src/index";
import { K_CHECKBOX, K_CUSTOM, K_PROP, K_RADIO } from "../src/dom/view";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([scopes, forms]);
  bootstrapState();
  // a design system's text field: its <input> is in its shadow root
  customElements.define("forms-ds-text", class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "value", event: "ds-input", getter: (e: Event) => (e.target as any).value }], inputs: [{ name: "value" }, { name: "label" }] };
    inner: HTMLInputElement;
    label = "";
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = "<input>";
      this.inner = this.shadowRoot!.querySelector("input")!;
      this.inner.addEventListener("input", () => this.dispatchEvent(new Event("ds-input")));
    }
    get value() { return this.inner.value; }
    set value(v) { this.inner.value = v ?? ""; }
  });
});

const kata = (v: unknown) => String(v).replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** A page bound in `where` (a shadow root by default); `write` changes the state and waits for the bindings. */
async function page(html: string, state: Record<string, any>, inDocument = false) {
  let root: ShadowRoot | HTMLElement;
  if (inDocument) {
    root = document.body;
    root.innerHTML = `<wcs-state></wcs-state>${html}`;
  } else {
    const h = document.createElement(`forms-test-${seq++}`);
    root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state>${html}`;
    document.body.appendChild(h);
  }
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  await el.connectedCallbackPromise;
  await getBindingsReady(inDocument ? document : root);
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
  };
  const read = <T,>(fn: (s: any) => T): T => {
    let v!: T;
    el.createState("readonly", (s: any) => { v = fn(s); });
    return v;
  };
  const $ = <T extends Element = HTMLInputElement>(sel: string) => root.querySelector(sel) as T;
  return { root, el, write, read, $ };
}

/** The events of a composition, as a browser sends them (they leave a shadow root). */
const composition = (n: Element, type: "compositionstart" | "compositionend") =>
  n.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
/** The user's typing: the field's value, then its `input` event. */
const type = (n: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  n.value = text;
  n.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
};

const named = (more: Record<string, unknown> = {}) => ({ raw: "", get kana() { return this.raw; }, set kana(v: string) { this.raw = kata(v); }, ...more });

describe("forms add-on: core との約束", () => {
  // src/features/forms.ts は dom/view.ts を import しない（分割ビルドの core が 1 チャンク増える）ので、
  // 束縛の種類の番号を自分で持つ。番号を変えるなら両方を変える
  it("束縛の種類の番号は dom/view.ts のものと同じ", () => {
    expect([K_PROP, K_RADIO, K_CHECKBOX, K_CUSTOM]).toEqual([1, 9, 10, 11]);
  });
});

describe("forms add-on: 変換中の欄", () => {
  it("変換中の欄には state が書かず、変換が終わってから、そのときの state の値を当てる", async () => {
    const { $, read } = await page(`<input id="a" data-wcs="value: kana"><input id="b" data-wcs="value: kana">`, named());
    const a = $("#a");
    a.focus();
    composition(a, "compositionstart");
    type(a, "や");
    await flush();
    // the setter made it ヤ: the other field of the path shows it, the field being composed is left alone
    expect([read((s) => s.raw), a.value, $("#b").value]).toEqual(["ヤ", "や", "ヤ"]);
    type(a, "やま");
    await flush();
    expect(a.value).toBe("やま");
    type(a, "やまだ");
    composition(a, "compositionend");
    await flush();
    await flush();
    expect([read((s) => s.raw), a.value, $("#b").value]).toEqual(["ヤマダ", "ヤマダ", "ヤマダ"]);
  });

  it("確定の直後に次の語の変換が始まったら、その変換が終わるまで待つ", async () => {
    const { $, read } = await page(`<input id="a" data-wcs="value: kana">`, named());
    const a = $("#a");
    a.focus();
    composition(a, "compositionstart");
    type(a, "みどり");
    composition(a, "compositionend");
    // (no task in between: the next word)
    composition(a, "compositionstart");
    type(a, "みどりし");
    await flush();
    await flush();
    expect([read((s) => s.raw), a.value]).toEqual(["ミドリシ", "みどりし"]);
    type(a, "みどりしみん");
    composition(a, "compositionend");
    await flush();
    await flush();
    expect(a.value).toBe("ミドリシミン");
  });

  it("変換中に state へ外から書かれた値は預かり、利用者が打ち続ければ利用者の文字が残る。打たずに終われば外の値が出る", async () => {
    const { $, read, write } = await page(`<input id="a" data-wcs="value: text">`, { text: "" });
    const a = $("#a");
    a.focus();
    composition(a, "compositionstart");
    type(a, "かわ");
    await write((s) => { s.text = "OUTSIDE"; });
    expect([read((s) => s.text), a.value]).toEqual(["OUTSIDE", "かわ"]);
    type(a, "川村");
    composition(a, "compositionend");
    await flush();
    await flush();
    expect([read((s) => s.text), a.value]).toEqual(["川村", "川村"]);
    // and with nothing typed after the write
    composition(a, "compositionstart");
    await write((s) => { s.text = "OUTSIDE"; });
    expect(a.value).toBe("川村");
    composition(a, "compositionend");
    await flush();
    await flush();
    expect(a.value).toBe("OUTSIDE");
  });

  it("別の欄の変換が始まったら、前の欄に預かった値を当てる", async () => {
    const { $, write } = await page(`<input id="a" data-wcs="value: a"><input id="b" data-wcs="value: b">`, { a: "", b: "" });
    const a = $("#a");
    const b = $("#b");
    a.focus();
    composition(a, "compositionstart");
    await write((s) => { s.a = "A"; });
    expect(a.value).toBe("");
    // (the first composition sent no end: its field lost the focus another way)
    b.focus();
    composition(b, "compositionstart");
    await flush();
    expect(a.value).toBe("A");
    composition(b, "compositionend");
    await flush();
  });

  it("変換の途中でページから外れた欄は、終わりの知らせが無くても、次の書き込みを預かり続けない", async () => {
    const { $, write } = await page(`<p><input id="a" data-wcs="value: a"></p>`, { a: "" });
    const a = $("#a");
    const p = a.parentElement!;
    a.focus();
    composition(a, "compositionstart");
    a.remove();
    p.append(a);
    await write((s) => { s.a = "BACK"; });
    expect(a.value).toBe("BACK");
  });

  it("変換中の欄を shadow root に持つ要素（デザインシステムのテキスト欄）への書き込みも預かる", async () => {
    const { $, read, write } = await page(`<forms-ds-text data-wcs="value: kana; label: label"></forms-ds-text>`, named({ label: "a" }));
    const ds = $<any>("forms-ds-text");
    ds.inner.focus();
    composition(ds.inner, "compositionstart");
    type(ds.inner, "さとう");
    await write((s) => { s.label = "b"; });
    expect([read((s) => s.raw), ds.value, ds.label]).toEqual(["サトウ", "さとう", "a"]);
    composition(ds.inner, "compositionend");
    await flush();
    await flush();
    expect([ds.value, ds.label]).toEqual(["サトウ", "b"]);
  });

  it("預かっている間に行が消えた束縛は、変換が終わっても当てない", async () => {
    const { $, write } = await page(`<template data-wcs="for: rows"><input data-wcs="value: .name"></template><input id="top" data-wcs="value: top">`, { rows: [{ name: "" }], top: "" });
    const row = $("input");
    row.focus();
    composition(row, "compositionstart");
    await write((s) => { s["rows.0.name"] = "held"; });
    expect(row.value).toBe("");
    await write((s) => { s.rows = []; });
    // (out of the page, its composition sends no end: the next binding applied finds it gone)
    await write((s) => { s.top = "t"; });
    await flush();
    expect([row.value, $("#top").value]).toEqual(["", "t"]);
  });
});

describe("forms add-on: input イベントなしで入った値", () => {
  const FORM = `<form data-wcs="onsubmit: send">
    <input id="name" data-wcs="value: nameIn"><input id="late" data-wcs="value: late"><input id="ro" data-wcs="value#ro: shownOnly">
    <input id="lazy" data-wcs="value#onchange: lazy"><input id="free"><button>send</button></form>`;
  const state = () => ({
    name: "seed", sets: 0, late: "seed", shownOnly: "kept", lazy: "", sent: null as unknown,
    get nameIn() { return this.name; },
    set nameIn(v: string) { this.name = v; this.sets++; },
    send(e: Event) { e.preventDefault(); this.sent = [this.name, this.late]; },
  });
  const fire = (n: Element, ...types: string[]) => { for (const t of types) n.dispatchEvent(new Event(t, { bubbles: true })); };

  it("change だけで入った値を state に届ける。input も出たなら 1 回だけ", async () => {
    const { $, read } = await page(FORM, state());
    const name = $("#name");
    name.value = "both";
    fire(name, "input", "change");
    await flush();
    expect(read((s) => [s.name, s.sets])).toEqual(["both", 1]);
    name.value = "change-only";
    fire(name, "change");
    await flush();
    expect(read((s) => [s.name, s.sets])).toEqual(["change-only", 2]);
    // (told: a second change with the same value tells nothing)
    fire(name, "change");
    await flush();
    expect(read((s) => s.sets)).toBe(2);
  });

  it("届けるのは欄の上で出る、バブルしない input: 上に束ねたハンドラは聞かない", async () => {
    const { $, root } = await page(FORM, state());
    const heard = vi.fn();
    root.addEventListener("input", heard);
    const name = $("#name");
    name.value = "x";
    fire(name, "change");
    expect(heard).not.toHaveBeenCalled();
  });

  it("change で書き戻す束縛（#onchange）は自分で聞くので、重ねて届けない。#ro の欄は 1 回知らせるだけで state は変わらない", async () => {
    const { $, read } = await page(FORM, state());
    const lazy = $("#lazy");
    const input = vi.fn();
    lazy.addEventListener("input", input);
    lazy.value = "typed";
    fire(lazy, "change");
    await flush();
    expect(read((s) => s.lazy)).toBe("typed");
    expect(input).not.toHaveBeenCalled();
    const ro = $("#ro");
    const told = vi.fn();
    ro.addEventListener("input", told);
    ro.value = "edited";
    fire(ro, "change");
    fire(ro, "change");
    await flush();
    expect(told).toHaveBeenCalledTimes(1);
    expect(read((s) => s.shownOnly)).toBe("kept");
  });

  it("イベントなしで入った値は、送信のとき、ページのハンドラより先に state に届ける。state が束ねていない欄には何もしない", async () => {
    const { $, read } = await page(FORM, state());
    $("#late").value = "silent";
    const free = $("#free");
    const told = vi.fn();
    free.addEventListener("input", told);
    free.value = "x";
    await flush();
    expect(read((s) => s.late)).toBe("seed");
    $<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(read((s) => s.sent)).toEqual(["seed", "silent"]);
    expect(read((s) => s.sets)).toBe(0);
    expect(told).not.toHaveBeenCalled();
  });

  it("state が欄を書き換えた後の値は state が知っている: 整形して書き戻す欄の change では届けない", async () => {
    const { $, read } = await page(`<input id="a" data-wcs="value: v">`, {
      raw: "", sets: 0,
      get v() { return this.raw; },
      set v(x: string) { this.raw = String(x).toUpperCase(); this.sets++; },
    });
    const a = $("#a");
    type(a, "abc");
    await flush();
    expect([a.value, read((s) => s.sets)]).toEqual(["ABC", 1]);
    a.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(read((s) => s.sets)).toBe(1);
  });

  it("最初の適用が失敗した束縛の書き戻しも、そのまま通る", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // (the first read throws: the binding's first apply fails, and its listener is attached all the same)
    const { $, read } = await page(`<input id="a" data-wcs="value: v">`, {
      raw: "", ready: false,
      get v() { if (!this.ready) throw new Error("not ready"); return this.raw; },
      set v(x: string) { this.raw = x; },
    });
    const a = $("#a");
    type(a, "typed");
    await flush();
    expect(read((s) => s.raw)).toBe("typed");
    errors.mockRestore();
  });

  it("form でないものの submit / reset は何もしない", async () => {
    const { $ } = await page(`<div id="d"><input data-wcs="value: v"></div>`, { v: "" });
    const d = $<HTMLElement>("#d");
    d.dispatchEvent(new Event("submit", { bubbles: true }));
    d.dispatchEvent(new Event("reset", { bubbles: true }));
    await flush();
    expect(d.querySelector("input")!.value).toBe("");
  });
});

describe("forms add-on: reset", () => {
  const FORM = `<form>
    <input id="name" data-wcs="value: name">
    <input id="agree" type="checkbox" data-wcs="checked: agree">
    <input id="n" type="number" value="1" data-wcs="valueAsNumber: n">
    <select id="pref" data-wcs="value: pref"><option value="">-</option><option value="a">a</option><option value="b">b</option></select>
    <input type="radio" name="sex" value="m" data-wcs="radio: sex"><input type="radio" name="sex" value="f" data-wcs="radio: sex">
    <input type="checkbox" value="x" data-wcs="checkbox: tags"><input type="checkbox" value="y" data-wcs="checkbox: tags">
    <input id="ro" data-wcs="value#ro: shownOnly"><input id="free" value="free"></form>
    <template data-wcs="for: rows"><input class="row" data-wcs="value: .v"></template>`;
  const state = () => ({ name: "Yamada", agree: true, n: 7, pref: "a", sex: "f", tags: ["x", "y"], shownOnly: "kept", rows: [{ v: "r" }] });
  const shown = ($: (s: string) => any, root: ParentNode) => ({
    name: $("#name").value, agree: $("#agree").checked, n: $("#n").value, pref: $("#pref").value,
    sex: [...root.querySelectorAll<HTMLInputElement>("input[type=radio]")].filter((r) => r.checked).map((r) => r.value).join(),
    tags: [...root.querySelectorAll<HTMLInputElement>("input[type=checkbox][value]")].filter((r) => r.checked).map((r) => r.value).join(),
    ro: $("#ro").value,
  });

  it("reset の後、束ねたコントロールの値を state に届け、書き戻さないもの（既定の無い radio・#ro）には state の値を書き直す", async () => {
    const { $, root, read } = await page(FORM, state());
    expect(shown($, root)).toEqual({ name: "Yamada", agree: true, n: "7", pref: "a", sex: "f", tags: "x,y", ro: "kept" });
    $<HTMLFormElement>("form").reset();
    await flush();
    await flush();
    // the markup's defaults: name "", agree unchecked, n 1, pref "" (its first option), no checkbox
    expect(read((s) => ({ name: s.name, agree: s.agree, n: s.n, pref: s.pref, sex: s.sex, tags: [...s.tags] })))
      .toEqual({ name: "", agree: false, n: 1, pref: "", sex: "f", tags: [] });
    expect(shown($, root)).toEqual({ name: "", agree: false, n: "1", pref: "", sex: "f", tags: "", ro: "kept" });
    // (a field outside the form is not touched)
    expect(root.querySelector<HTMLInputElement>(".row")!.value).toBe("r");
  });

  it("ハンドラが止めた reset では何もしない", async () => {
    const { $, read } = await page(FORM, state());
    const form = $<HTMLFormElement>("form");
    const told = vi.fn();
    $("#name").addEventListener("input", told);
    form.addEventListener("reset", (e) => e.preventDefault());
    // (the event alone: happy-dom's reset() empties the controls whatever a handler says)
    form.dispatchEvent(new Event("reset", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    expect(told).not.toHaveBeenCalled();
    expect(read((s) => s.name)).toBe("Yamada");
  });

  it("文書に直接あるページでも聞く", async () => {
    const { $, read, write } = await page(`<form><input id="name" data-wcs="value: name"></form>`, { name: "Yamada" }, true);
    const name = $("#name");
    name.value = "filled";
    name.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(read((s) => s.name)).toBe("filled");
    name.focus();
    composition(name, "compositionstart");
    await write((s) => { s.name = "held"; });
    expect(name.value).toBe("filled");
    composition(name, "compositionend");
    await flush();
    await flush();
    expect(name.value).toBe("held");
    $<HTMLFormElement>("form").reset();
    await flush();
    await flush();
    expect(read((s) => s.name)).toBe("");
    document.body.innerHTML = "";
  });

  it("Light DOM のコンポーネントの中のフォームも聞く（そのホストが居るルートで）", async () => {
    customElements.define("forms-light", class extends HTMLElement {
      state = {};
      connectedCallback() {
        if (this.childElementCount === 0) this.innerHTML = `<wcs-state bind-component="state"></wcs-state><form><input data-wcs="value: name"></form>`;
      }
    });
    const { $, read } = await page(`<forms-light data-wcs="state.name: name"></forms-light>`, { name: "Yamada" });
    await flush();
    await flush();
    const name = $("forms-light input");
    expect(name.value).toBe("Yamada");
    name.value = "filled";
    name.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();
    expect(read((s) => s.name)).toBe("filled");
    $<HTMLFormElement>("forms-light form").reset();
    await flush();
    await flush();
    await flush();
    expect(read((s) => s.name)).toBe("");
  });
});
