/**
 * fixes-seam-apps.test.ts — 継ぎ目アプリ（docs/seam-apps.ja.md）で見つかった不具合の修正。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, installFormats, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal]);
  installFormats();
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`seam-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
    await flush();
  };
  return { root, write };
}

describe("router-auth: getter の if: は、閉じる更新で中身のバインディングを適用しない", () => {
  it("条件の getter が偽になる書き込みで、中身の {{ obj.n|locale }} は null で適用されない（エラーにならない）", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, write } = await page(`<template data-wcs="if: ok"><p class="v">{{ obj.n|locale }}</p></template>`, {
      obj: { n: 1234 },
      get ok() { return this["obj.n"] != null; },
    });
    expect(root.querySelector(".v")?.textContent).toBe("1,234");
    await write((s) => { s["obj.n"] = null; });
    expect(root.querySelector(".v")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("上のオブジェクトごと null にしても同じ（obj = null）", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, write } = await page(`<template data-wcs="if: ok"><p class="v">{{ obj.n|locale }}</p></template>`, {
      obj: { n: 1234 },
      get ok() { return this["obj.n"] != null; },
    });
    await write((s) => { s.obj = null; });
    expect(root.querySelector(".v")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("elseif の条件の getter も、閉じる分岐の中身を守る", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, write } = await page(
      `<template data-wcs="if: off"><p class="off">off</p></template>` +
      `<template data-wcs="elseif: ok"><p class="v">{{ obj.n|locale }}</p></template>` +
      `<template data-wcs="else:"><p class="none">none</p></template>`, {
        off: false,
        obj: { n: 5 },
        get ok() { return this["obj.n"] != null; },
      });
    expect(root.querySelector(".v")?.textContent).toBe("5");
    await write((s) => { s["obj.n"] = null; });
    expect(root.querySelector(".v")).toBeNull();
    expect(root.querySelector(".none")?.textContent).toBe("none");
    expect(errors).not.toHaveBeenCalled();
  });

  it("入れ子: 外の getter の if: が閉じれば、内の if: の中身も適用されない", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, write } = await page(
      `<template data-wcs="if: ok"><div><template data-wcs="if: show"><p class="v">{{ obj.n|locale }}</p></template></div></template>`, {
        show: true,
        obj: { n: 7 },
        get ok() { return this["obj.n"] != null; },
      });
    expect(root.querySelector(".v")?.textContent).toBe("7");
    await write((s) => { s["obj.n"] = null; });
    expect(root.querySelector(".v")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("開くときは中身が新しい値で描かれる（null → 数）", async () => {
    const { root, write } = await page(`<template data-wcs="if: ok"><p class="v">{{ obj.n|locale }}</p></template>`, {
      obj: { n: null },
      get ok() { return this["obj.n"] != null; },
    });
    expect(root.querySelector(".v")).toBeNull();
    await write((s) => { s["obj.n"] = 42000; });
    expect(root.querySelector(".v")?.textContent).toBe("42,000");
  });

  it("開いたままの分岐の中身は、同じ書き込みで新しい値になる", async () => {
    const { root, write } = await page(`<template data-wcs="if: ok"><p class="v">{{ obj.n|locale }}</p></template>`, {
      obj: { n: 1 },
      get ok() { return this["obj.n"] != null; },
    });
    await write((s) => { s["obj.n"] = 2000; });
    expect(root.querySelector(".v")?.textContent).toBe("2,000");
  });
});

/** A wc-bindable element whose output is already set when it connects (an open <wcs-sse>, a router). */
let tagSeq = 0;
function connectedTag(initial: unknown): string {
  const tag = `seam-conn-${tagSeq++}`;
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "connected", event: `${tag}:connected-changed` }] };
    connected: unknown = undefined;
    connectedCallback() {
      this.connected = initial;
      this.dispatchEvent(new CustomEvent(`${tag}:connected-changed`, { detail: initial }));
    }
  });
  return tag;
}

describe("state-collab-board / router-admin: 要素が bind のときに既に持っていた値でも $watch が 1 回動く", () => {
  it("bind で要素から引いた値（シードと違う）で、起動後に $watch が (cur, シード) で 1 回呼ばれる", async () => {
    const tag = connectedTag(true);
    const calls: unknown[][] = [];
    await page(`<${tag} data-wcs="connected: connected"></${tag}>`, {
      connected: false,
      $watch: { connected(cur: unknown, prev: unknown) { calls.push([cur, prev]); } },
    });
    expect(calls).toEqual([[true, false]]);
  });

  it("$connectedCallback が同じパスを書き換えたら呼ばない（コードの書き込みは今までどおり動かさない）", async () => {
    const tag = connectedTag(true);
    const calls: unknown[] = [];
    await page(`<${tag} data-wcs="connected: connected"></${tag}>`, {
      connected: false,
      $connectedCallback(this: any) { this.connected = "overridden"; },
      $watch: { connected(cur: unknown) { calls.push(cur); } },
    });
    expect(calls).toEqual([]);
  });

  it("要素の値がシードと同じなら呼ばない。起動後の変化は今までどおり 1 回ずつ", async () => {
    const tag = connectedTag(false);
    const calls: unknown[] = [];
    const { root } = await page(`<${tag} data-wcs="connected: connected"></${tag}>`, {
      connected: false,
      $watch: { connected(cur: unknown) { calls.push(cur); } },
    });
    expect(calls).toEqual([]);
    const el = root.querySelector(tag)!;
    el.dispatchEvent(new CustomEvent(`${tag}:connected-changed`, { detail: true }));
    await flush();
    await flush();
    expect(calls).toEqual([true]);
  });

  it("その値を読む根の getter の $watch も起動後に 1 回、(cur, undefined) で呼ばれる（2026-10-14 の決定）", async () => {
    const tag = connectedTag(true);
    const calls: unknown[][] = [];
    await page(`<${tag} data-wcs="connected: connected"></${tag}>`, {
      connected: false,
      get label() { return this.connected ? "online" : "offline"; },
      $watch: {
        connected(cur: unknown) { calls.push(["connected", cur]); },
        label(cur: unknown, prev: unknown) { calls.push(["label", cur, prev]); },
      },
    });
    expect(calls).toEqual([["connected", true], ["label", "online", undefined]]);
  });

  it("要素が書いたオブジェクトの下を読む getter・getter を読む getter でも呼ばれ、読まない getter は呼ばれない", async () => {
    const tag = connectedTag({ token: "t1", user: "alice" });
    const calls: unknown[][] = [];
    await page(`<${tag} data-wcs="connected: session"></${tag}>`, {
      session: null,
      n: 1,
      get token() { return this["session.token"] ?? null; },
      get loggedIn() { return this.token !== null; },
      get double() { return this.n * 2; },
      $watch: {
        token(cur: unknown, prev: unknown) { calls.push(["token", cur, prev]); },
        loggedIn(cur: unknown) { calls.push(["loggedIn", cur]); },
        double(cur: unknown) { calls.push(["double", cur]); },
      },
    });
    expect(calls).toEqual([["token", "t1", undefined], ["loggedIn", true]]);
  });

  it("$connectedCallback が要素の値を書き換えたら getter の $watch も呼ばない", async () => {
    const tag = connectedTag(true);
    const calls: unknown[] = [];
    await page(`<${tag} data-wcs="connected: connected"></${tag}>`, {
      connected: false,
      $connectedCallback(this: any) { this.connected = false; },
      get label() { return this.connected ? "online" : "offline"; },
      $watch: { label(cur: unknown) { calls.push(cur); } },
    });
    expect(calls).toEqual([]);
  });

  it("$connectedCallback での書き込みは、要素の無いパスでも動かさない（従来どおり）", async () => {
    const calls: unknown[] = [];
    await page(`<p>{{ n }}</p>`, {
      n: 0,
      $connectedCallback(this: any) { this.n = 5; },
      $watch: { n(cur: unknown) { calls.push(cur); } },
    });
    expect(calls).toEqual([]);
  });
});

/** A custom element that puts a node right after itself when it connects, as `<wcs-link>` puts its `<a>`. */
function insertingTag(): string {
  const tag = `seam-ins-${tagSeq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      if ((this.nextSibling as Element | null)?.localName !== "a") this.after(document.createElement("a"));
    }
  });
  return tag;
}

describe("town-archive: 行の中で <wcs-link>（直後に要素を差し込むカスタム要素）の後ろにある要素の委譲ハンドラ", () => {
  const click = (el: Element | null) => el!.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));

  it("詰めて書いた行: 押したボタンのハンドラが動く（隣のボタンのものでなく）。差し込まれた要素を押しても動かない", async () => {
    const tag = insertingTag();
    const calls: unknown[][] = [];
    const { root } = await page(
      `<ul><template data-wcs="for: items"><li><${tag}></${tag}><button class="star" data-wcs="onclick: star">s</button><button class="remove" data-wcs="onclick: remove">x</button></li></template></ul>`,
      {
        items: [{ id: 1 }, { id: 2 }],
        star(_e: Event, i: number) { calls.push(["star", i]); },
        remove(_e: Event, i: number) { calls.push(["remove", i]); },
      },
    );
    // 差し込まれた <a> で、後ろの兄弟は 1 つずつずれている
    expect([...root.querySelector("li")!.children].map((c) => c.localName)).toEqual([tag, "a", "button", "button"]);
    click(root.querySelectorAll(".star")[1]);
    click(root.querySelectorAll(".remove")[0]);
    click(root.querySelector("li a"));
    expect(calls).toEqual([["star", 1], ["remove", 0]]);
  });

  it("空白を挟んだ行でも、if: の中でも、後ろの要素のハンドラが動く", async () => {
    const tag = insertingTag();
    const calls: unknown[][] = [];
    const { root } = await page(
      `<ul><template data-wcs="for: items"><li>
          <${tag}></${tag}>
          <button class="star" data-wcs="onclick: star">s</button>
        </li></template></ul>
      <template data-wcs="if: on"><section><${tag}></${tag}> <button class="edit" data-wcs="onclick: edit">e</button></section></template>`,
      {
        items: [{ id: 1 }],
        on: true,
        star(_e: Event, i: number) { calls.push(["star", i]); },
        edit() { calls.push(["edit"]); },
      },
    );
    click(root.querySelector(".star"));
    click(root.querySelector(".edit"));
    expect(calls).toEqual([["star", 0], ["edit"]]);
  });

  it("差し込む要素が上の階層の兄弟でも（<td> の前の <td> の中でなく、祖先の前の兄弟）、その後ろの中のハンドラが動く", async () => {
    const tag = insertingTag();
    const calls: unknown[][] = [];
    const { root } = await page(
      `<template data-wcs="for: items"><div class="row"><${tag}></${tag}><p><span><button data-wcs="onclick: pick">p</button></span></p></div></template>`,
      { items: [{ id: 1 }, { id: 2 }], pick(_e: Event, i: number) { calls.push(["pick", i]); } },
    );
    click(root.querySelectorAll("button")[1]);
    expect(calls).toEqual([["pick", 1]]);
  });

  it("カスタム要素が前に無い行は今までどおり（ハンドラは要素に持たせず、道で見つける）", async () => {
    const calls: unknown[][] = [];
    const { root, write } = await page(
      `<ul><template data-wcs="for: items"><li><span data-wcs="textContent: .id"></span><button data-wcs="onclick: star">s</button></li></template></ul>`,
      { items: [{ id: 1 }, { id: 2 }], star(_e: Event, i: number) { calls.push(["star", i]); } },
    );
    click(root.querySelectorAll("button")[1]);
    await write((s) => { s.items = s.items.concat([{ id: 3 }]); });
    click(root.querySelectorAll("button")[2]);
    expect(calls).toEqual([["star", 1], ["star", 2]]);
  });
});

describe("town-archive: アクセサの組に束ねた要素が bind のときに持っていた値でも $watch が動く", () => {
  it("setter が別のパスへ書いた値: そのパスの $watch が (cur, シード) で、それを読む根の getter の $watch も起動後に 1 回ずつ呼ばれる", async () => {
    const tag = connectedTag(900);
    const calls: unknown[][] = [];
    await page(`<${tag} data-wcs="connected: widthRaw"></${tag}>`, {
      width: 0,
      get widthRaw() { return this.width; },
      set widthRaw(v: number) { if (v) this.width = v; },
      get cols() { return Math.max(2, Math.floor(this.width / 180)); },
      get other() { return 1; },
      $watch: {
        width(cur: unknown, prev: unknown) { calls.push(["width", cur, prev]); },
        cols(cur: unknown, prev: unknown) { calls.push(["cols", cur, prev]); },
        widthRaw(cur: unknown) { calls.push(["widthRaw", cur]); },
        other() { calls.push(["other"]); },
      },
    });
    expect(calls).toHaveLength(3);
    expect(calls).toEqual(expect.arrayContaining([["width", 900, 0], ["cols", 5, undefined], ["widthRaw", 900]]));
  });

  it("setter が値を捨てたら（何も書かなければ）呼ばない。起動後の値では今までどおり動く", async () => {
    const tag = connectedTag(0);
    const calls: unknown[][] = [];
    const { root } = await page(`<${tag} data-wcs="connected: widthRaw"></${tag}>`, {
      width: 0,
      get widthRaw() { return this.width; },
      set widthRaw(v: number) { if (v) this.width = v; },
      get cols() { return Math.max(2, Math.floor(this.width / 180)); },
      $watch: {
        width(cur: unknown) { calls.push(["width", cur]); },
        cols(cur: unknown) { calls.push(["cols", cur]); },
      },
    });
    expect(calls).toEqual([]);
    root.querySelector(tag)!.dispatchEvent(new CustomEvent(`${tag}:connected-changed`, { detail: 540 }));
    await flush();
    await flush();
    expect(calls).toEqual(expect.arrayContaining([["width", 540], ["cols", 3]]));
    expect(calls).toHaveLength(2);
  });

  it("$connectedCallback が setter の書いたパスを書き換えたら呼ばない。コードがアクセサの組へ書いた値でも呼ばない（従来どおり）", async () => {
    const tag = connectedTag(900);
    const calls: unknown[] = [];
    await page(`<${tag} data-wcs="connected: widthRaw"></${tag}>`, {
      width: 0,
      get widthRaw() { return this.width; },
      set widthRaw(v: number) { if (v) this.width = v; },
      $connectedCallback(this: any) { this.width = 300; },
      $watch: { width(cur: unknown) { calls.push(cur); } },
    });
    expect(calls).toEqual([]);
    await page(`<p>{{ width }}</p>`, {
      width: 0,
      get widthRaw() { return this.width; },
      set widthRaw(v: number) { this.width = v; },
      $connectedCallback(this: any) { this.widthRaw = 700; },
      $watch: { width(cur: unknown) { calls.push(cur); } },
    });
    expect(calls).toEqual([]);
  });
});
