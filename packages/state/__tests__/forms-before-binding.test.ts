/**
 * forms-before-binding.test.ts — the forms add-on before state has bound a form (docs/v4-direction-2026-10.md
 * §5.22): what was typed is given back, a submit the page prevents is never the browser's, and one made before
 * the root was bound is made again once it is. A file of its own: a document is bound once, and these tests need
 * one that is not yet.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, forms, getBindingsReady, installFeatures } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;
/** What the user does to a control: `set` it, then the `input` event a browser sends (it leaves a shadow root). */
const user = <T extends Element>(n: T | null, set: (n: T) => void): void => {
  set(n!);
  n!.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
};

beforeAll(() => {
  installFeatures([forms]);
  bootstrapState();
});

describe("forms add-on: state が束ねる前のフォーム（v4-direction §5.22）", () => {
  /** A page whose controls `before` changes before state binds them (the router drew them while the state loaded). */
  async function typedPage(html: string, state: Record<string, any>, before: (root: ShadowRoot) => void) {
    const h = document.createElement(`forms-test-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state>${html}`;
    // (connected, so the document hears the typing; the state waits for setInitialState)
    document.body.appendChild(h);
    before(root);
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    const read = <T,>(fn: (s: any) => T): T => {
      let v!: T;
      el.createState("readonly", (s: any) => { v = fn(s); });
      return v;
    };
    return { root, read, $: <T extends Element = HTMLInputElement>(sel: string) => root.querySelector(sel) as T };
  }

  const FORM = `<input id="name" data-wcs="value: name"><input id="agree" type="checkbox" data-wcs="checked: agree">
    <select id="pick" data-wcs="value: pick"><option value="a">a</option><option value="b">b</option></select>
    <input type="radio" name="r" value="x" data-wcs="radio: r"><input id="ry" type="radio" name="r" value="y" data-wcs="radio: r">
    <textarea id="note" data-wcs="value: note"></textarea><input id="kept" data-wcs="value: kept">`;
  const state = () => ({ name: "", agree: false, pick: "a", r: "x", note: "", kept: "from state" });

  it("束ねる前に打った値は、束ねた後に戻り、state に届く（テキスト・チェックボックス・select・ラジオ・textarea）。打っていない欄には state の値が出る", async () => {
    const { $, read } = await typedPage(FORM, state(), (root) => {
      user(root.querySelector<HTMLInputElement>("#name"), (n) => { n.value = "typed"; });
      user(root.querySelector<HTMLInputElement>("#agree"), (n) => { n.checked = true; });
      user(root.querySelector<HTMLSelectElement>("#pick"), (n) => { n.value = "b"; });
      user(root.querySelector<HTMLInputElement>("#ry"), (n) => { n.checked = true; });
      user(root.querySelector<HTMLTextAreaElement>("#note"), (n) => { n.value = "a note"; });
    });
    expect([$("#name").value, $("#agree").checked, $<HTMLSelectElement>("#pick").value, $("#ry").checked, $<HTMLTextAreaElement>("#note").value, $("#kept").value])
      .toEqual(["typed", true, "b", true, "a note", "from state"]);
    expect(read((s) => [s.name, s.agree, s.pick, s.r, s.note, s.kept])).toEqual(["typed", true, "b", "y", "a note", "from state"]);
  });

  it("何も打っていなければ state の値が出て、イベントは出ない", async () => {
    const heard: string[] = [];
    const { $, read } = await typedPage(FORM, { ...state(), name: "Yamada", agree: true, pick: "b", r: "y" }, (root) => {
      for (const n of root.querySelectorAll("input,select,textarea")) n.addEventListener("input", () => heard.push((n as HTMLInputElement).id));
    });
    expect([$("#name").value, $("#agree").checked, $<HTMLSelectElement>("#pick").value, $("#ry").checked]).toEqual(["Yamada", true, "b", true]);
    expect(read((s) => [s.name, s.agree, s.pick, s.r])).toEqual(["Yamada", true, "b", "y"]);
    expect(heard).toEqual([]);
  });

  it("state が束ねない欄は、打ってあっても触らない（ページ自身のリスナーにイベントを出さない）", async () => {
    const heard: string[] = [];
    const { $ } = await typedPage(`<input id="free"><input id="name" data-wcs="value: name">`, { name: "" }, (root) => {
      const free = root.querySelector("#free") as HTMLInputElement;
      user(free, (n) => { n.value = "mine"; });
      free.addEventListener("input", () => heard.push("free"));
    });
    expect($("#free").value).toBe("mine");
    expect(heard).toEqual([]);
  });

  it("onsubmit#prevent を宣言したフォームは、state が束ねる前でもブラウザが送らない。#prevent の無いフォーム・form でないものは止めない", () => {
    const host = document.createElement("div");
    host.innerHTML = `<form id="p" data-wcs="onsubmit#prevent: go"></form><form id="ps" data-wcs="value: x; onsubmit#stop, prevent: go"></form>
      <form id="h" data-wcs="onsubmit: go"></form><form id="n"></form><div id="d" data-wcs="onsubmit#prevent: go"></div>`;
    document.body.appendChild(host);
    try {
      const submit = (id: string) => {
        const e = new Event("submit", { bubbles: true, cancelable: true });
        host.querySelector(`#${id}`)!.dispatchEvent(e);
        return e.defaultPrevented;
      };
      expect(["p", "ps", "h", "n", "d"].map(submit)).toEqual([true, true, false, false, false]);
    } finally {
      host.remove();
    }
  });
});

describe("forms add-on: ルートを束ねる前に押した送信", () => {
  // (the first test of the file to bind the document: a document is bound once)
  it("ブラウザには送らせず、束ねた後に、打った値を戻してから押したボタンでやり直す（1 回だけ）。束ねた後の送信は覚えない", async () => {
    document.body.innerHTML = `<wcs-state></wcs-state><form data-wcs="onsubmit#prevent: go"><input id="q" data-wcs="value: q"><button id="b">Go</button></form>
      <form id="other" data-wcs="onsubmit#prevent: go"></form><button id="outside">x</button>`;
    const [form, other] = [...document.querySelectorAll("form")];
    const q = document.querySelector("#q") as HTMLInputElement;
    user(q, (n) => { n.value = "typed"; });
    const by: unknown[] = [];
    for (const f of [form, other]) {
      const requestSubmit = f.requestSubmit.bind(f);
      vi.spyOn(f, "requestSubmit").mockImplementation((b?: HTMLElement | null) => { by.push(b ?? null); requestSubmit(b); });
    }
    /** A submit by `submitter`, as the browser sends it (happy-dom's events take no submitter). */
    const submit = (f: HTMLFormElement, submitter: Element) => {
      const e = new Event("submit", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "submitter", { value: submitter });
      f.dispatchEvent(e);
      return e.defaultPrevented;
    };
    // (a button outside the form is not given to requestSubmit: it would throw)
    expect([submit(form, document.querySelector("#b")!), submit(other, document.querySelector("#outside")!)]).toEqual([true, true]);
    const got: string[] = [];
    const el = document.querySelector("wcs-state") as any;
    el.setInitialState({ q: "", go() { got.push(this.q); } });
    await el.connectedCallbackPromise;
    await getBindingsReady(document);
    await flush();
    expect([got, q.value, by]).toEqual([["typed", "typed"], "typed", [document.querySelector("#b"), null]]);
    got.length = 0;
    const late = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(late);
    await flush();
    expect([got, late.defaultPrevented, by.length]).toEqual([["typed"], true, 2]);
  });
});

describe("forms add-on: 束ねる前の select と送信ボタン", () => {
  it("select はマークアップが選ぶもの（最後の selected、無ければ最初の有効な選択肢）と比べる。複数選択も", async () => {
    const h = document.createElement("forms-before-select");
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state>
      <select id="marked" data-wcs="value: marked"><option value="a">a</option><option value="b" selected>b</option><option value="c">c</option></select>
      <select id="first" data-wcs="value: first"><option value="x" disabled>x</option><option value="y">y</option><option value="z">z</option></select>
      <select id="many" multiple data-wcs="value: many"><option value="1" selected>1</option><option value="2">2</option></select>
      <select id="same" data-wcs="value: same"><option value="p">p</option><option value="q">q</option></select>`;
    document.body.appendChild(h);
    user(root.querySelector<HTMLSelectElement>("#marked"), (n) => { n.value = "c"; });
    user(root.querySelector<HTMLSelectElement>("#many"), (n) => { n.options[1].selected = true; });
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ marked: "a", first: "z", many: "1", same: "q" });
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    const value = (id: string) => (root.querySelector(`#${id}`) as HTMLSelectElement).value;
    let s: any;
    el.createState("readonly", (st: any) => { s = { marked: st.marked, first: st.first, same: st.same }; });
    // marked: the user's c wins; first: untouched (y, its first enabled option) — state's z; same: untouched — state's q
    expect([value("marked"), value("first"), value("same")]).toEqual(["c", "z", "q"]);
    expect(s).toEqual({ marked: "c", first: "z", same: "q" });
    expect([...(root.querySelector("#many") as HTMLSelectElement).options].map((o) => o.selected)).toEqual([true, true]);
  });
});

describe("forms add-on: 利用者が打っていない値", () => {
  it("スクリプトや履歴のキャッシュが（イベントなしで）入れた値は打った値ではない: state の値が出て、setter は走らない（community-hall）", async () => {
    const h = document.createElement("forms-before-scripted");
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><input id="n" data-wcs="value: count">`;
    document.body.appendChild(h);
    (root.querySelector("#n") as HTMLInputElement).value = "5"; // a previous engine's value, kept by a cache
    const sets: unknown[] = [];
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ stored: "2", get count() { return this.stored; }, set count(v: unknown) { sets.push(v); this.stored = v; } });
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    expect([(root.querySelector("#n") as HTMLInputElement).value, sets]).toEqual(["2", []]);
  });
});
