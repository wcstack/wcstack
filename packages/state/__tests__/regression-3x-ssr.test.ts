/**
 * regression-3x-ssr.test.ts — @wcstack/state 3.4.0（3.x）で直した SSR ハイドレーションの不具合
 * （#258 の 6 つの修正、#334 #336 #347 #348 #349 #350 #351 #356 #358 #370）の回帰テストの形を、
 * 4.0 エンジン（state-next）で流す。
 *
 * どの形も同じ手順を 2 回流して比べる: CSR（enable-ssr なし）と、SSR（`data-wcs-server="orchestrated"` の
 * サーバー描画 → スナップショットの組み立て → 新しいルートでハイドレーション）。
 * 3.x の全描画への退避・その警告の文言・境界コメントの形式は 4.0 に無い（migration-v4 §3.6、出力の形式が違う）ので、
 * 利用者に見える期待（ハイドレーション後の表示が CSR と同じ・以後の書き込みに追従する・console.error を出さない・
 * SSR でだけ出る警告が無い）だけを確かめる。
 * issues.test.ts / issues-ssr.test.ts / issues2-ssr.test.ts / ssr.test.ts / coverage-addons-ssr.test.ts に既にある形は繰り返さない。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, registerFilters, scopes, ssr } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

beforeAll(() => {
  installFeatures([scopes, ssr]);
  bootstrapState();
  // 配列を返す出力フィルタ（#370 の for: のフィルタ用。組み込みには配列を返すものが無い）
  registerFilters({
    take: { factory: (options: string[]) => (value: unknown) => (value as unknown[]).slice(0, Number(options[0])), arity: [1, 1] },
  });
});

// ---------------------------------------------------------------- helpers

type Step = (s: any) => void;
type Observe = (root: ShadowRoot) => unknown;

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`rx3-ssr-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  return { root, el };
}

/** Renders `html` as the server does (an orchestrated render, then the snapshot builder); its HTML. */
async function serverRender(html: string, state: Record<string, any>, wait = 0): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  try {
    const h = document.createElement(`rx3-ssr-server-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = html;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    if (wait > 0) await sleep(wait);
    (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(root);
    const out = root.innerHTML;
    h.remove();
    return out;
  } finally {
    document.documentElement.removeAttribute("data-wcs-server");
  }
}

/** Loads the server's HTML in a fresh root and hydrates it. */
async function hydrate(html: string, state: Record<string, any>) {
  const h = document.createElement(`rx3-ssr-client-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  return { root, el };
}

interface Opts {
  /** How long the page runs before it is read (the server's `$connectedCallback`). */
  wait?: number;
  /** SSR: rewrites the server's output before the client loads it. */
  edit?: (out: string) => string;
  /** SSR: runs right before the client loads (after the server render). */
  beforeClient?: () => void;
}
interface Loaded { root: ShadowRoot; el: any; out?: string }
type Load = (html: string, state: () => Record<string, any>, opts?: Opts) => Promise<Loaded>;

/** CSR: the same markup without enable-ssr. */
const csr: Load = async (html, state, opts) => {
  const p = await page(html, state());
  if (opts?.wait) await sleep(opts.wait);
  return p;
};

/** SSR: rendered on the server (`<wcs-state enable-ssr>`), then hydrated on the client. */
const ssrLoad: Load = async (html, state, opts) => {
  let out = await serverRender(`<wcs-state enable-ssr></wcs-state>${html}`, state(), opts?.wait ?? 0);
  expect(out).toContain("<wcs-ssr");
  if (opts?.edit) out = opts.edit(out);
  opts?.beforeClient?.();
  const p = await hydrate(out, state());
  return { ...p, out };
};

interface Run { views: unknown[]; errors: string[]; warns: string[]; out?: string }

const msg = (x: unknown[]) => x.map((a) => String((a as Error)?.message ?? a)).join(" ");

/**
 * Loads the page, observes it, then runs each step (a write, or a function of the page) and observes again;
 * collects console.error (and uncaught errors) / console.warn meanwhile.
 */
async function play(load: Load, html: string, state: () => Record<string, any>, steps: Step[],
  observe: Observe, opts?: Opts): Promise<Run> {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const uncaught: string[] = [];
  const onError = (e: any) => { uncaught.push(String(e?.error?.message ?? e?.message ?? e)); e.preventDefault?.(); };
  const onRejection = (e: any) => { uncaught.push(String(e?.reason?.message ?? e?.reason ?? e)); e.preventDefault?.(); };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const views: unknown[] = [];
  try {
    const p = await load(html, state, opts);
    views.push(observe(p.root));
    for (const step of steps) {
      if ((step as any).isPageStep === true) await (step as unknown as (p: Loaded) => Promise<void>)(p);
      else {
        try {
          p.el.createState("writable", step as Step);
        } catch (e) {
          views.push(`throw: ${String((e as Error)?.message ?? e)}`);
        }
      }
      await flush();
      await flush();
      views.push(observe(p.root));
    }
    return { views, errors: [...error.mock.calls.map(msg), ...uncaught], warns: warn.mock.calls.map(msg), out: p.out };
  } catch (e) {
    const errs = [...error.mock.calls.map(msg), ...uncaught];
    if (e instanceof Error && errs.length > 0) e.message += `\n[console.error] ${errs.join(" | ").slice(0, 600)}`;
    throw e;
  } finally {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    error.mockRestore();
    warn.mockRestore();
  }
}

/** A step that acts on the page instead of writing the state. */
function pageStep(fn: (p: Loaded) => Promise<void> | void): Step {
  const f = async (p: Loaded) => { await fn(p); };
  (f as any).isPageStep = true;
  return f as unknown as Step;
}

/** The same steps on CSR and on SSR + hydration. */
async function both(html: string, state: () => Record<string, any>, steps: Step[],
  observe: Observe, opts?: Opts): Promise<{ csr: Run; ssr: Run }> {
  const c = await play(csr, html, state, steps, observe, opts);
  const s = await play(ssrLoad, html, state, steps, observe, opts);
  return { csr: c, ssr: s };
}

/** Both modes show `expected`; neither reports an error; SSR warns no more than CSR. */
function expectViews(r: { csr: Run; ssr: Run }, expected: unknown[]): void {
  expect({ csr: r.csr.views, ssr: r.ssr.views }).toEqual({ csr: expected, ssr: expected });
  expect({ csr: r.csr.errors, ssr: r.ssr.errors }).toEqual({ csr: [], ssr: [] });
  expect(r.ssr.warns).toEqual(r.csr.warns);
}

/** The visible text under `n` (templates / scripts left out), every whitespace removed. */
function flat(n: Node | null): string {
  if (n === null) return "<none>";
  const out: string[] = [];
  const walk = (p: Node): void => {
    for (const c of Array.from(p.childNodes)) {
      if (c.nodeType === 3) out.push((c as Text).data);
      else if (c.nodeType === 1 && !["template", "script", "style"].includes((c as Element).localName)) walk(c);
    }
  };
  walk(n);
  return out.join("").replace(/\s+/g, "");
}
const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => flat(n));
const rootView: Observe = (r) => flat(r.querySelector("#root"));

const T = (bind: string, body: string): string => `<template data-wcs="${bind.replace(/"/g, "&quot;")}">${body}</template>`;
/** A write; an object value is copied at each write (CSR and SSR never share one). */
const set = (key: string, value: unknown): Step => (s) => { s[key] = typeof value === "object" && value !== null ? structuredClone(value) : value; };
/** A row added; the object is made at each write (CSR and SSR never share one). */
const push = (make: () => unknown): Step => (s) => { s.items = [...s.items, make()]; };
const later = () => sleep(5);

// ================================================================ #258

describe("#258-1 入れ子の for・if / else の中の for を、実際のサーバー出力からハイドレーションできる", () => {
  const nested = (): any => ({
    count: 5,
    groups: [
      { title: "G1", items: [{ name: "x", n: 1 }, { name: "y", n: 2 }] },
      { title: "G2", items: [{ name: "z", n: 3 }] },
    ],
    get "groups.*.items.*.double"() { return (this as any)["groups.*.items.*.n"] * 2; },
  });
  const NESTED = `<p id="c">{{ count }}</p><p id="c2" data-wcs="textContent: count"></p>`
    + `<div id="outer"><template data-wcs="for: groups"><section class="g"><h3 data-wcs="textContent: .title"></h3>`
    + `<ul><template data-wcs="for: .items"><li class="i" data-wcs="textContent: .name"></li>`
    + `<li class="d" data-wcs="textContent: .double"></li></template></ul></section></template></div>`;
  const nestedView: Observe = (r) => ({ c: texts(r, "#c"), c2: texts(r, "#c2"), h3: texts(r, "h3"), i: texts(r, ".i"), d: texts(r, ".d") });

  it("入れ子の for: ページの {{ count }} も内側の行も生きていて、内側の葉・getter・内側と外側への追加に追従する", async () => {
    const r = await both(NESTED, nested, [
      set("count", 42),
      set("groups.0.title", "G1b"),
      set("groups.0.items.0.name", "x2"),
      set("groups.0.items.1.n", 20),
      (s) => { s["groups.1.items"] = [...s["groups.1.items"], { name: "w", n: 4 }]; },
      (s) => { s.groups = [...s.groups, { title: "G3", items: [{ name: "v", n: 9 }] }]; },
    ], nestedView);
    expectViews(r, [
      { c: ["5"], c2: ["5"], h3: ["G1", "G2"], i: ["x", "y", "z"], d: ["2", "4", "6"] },
      { c: ["42"], c2: ["42"], h3: ["G1", "G2"], i: ["x", "y", "z"], d: ["2", "4", "6"] },
      { c: ["42"], c2: ["42"], h3: ["G1b", "G2"], i: ["x", "y", "z"], d: ["2", "4", "6"] },
      { c: ["42"], c2: ["42"], h3: ["G1b", "G2"], i: ["x2", "y", "z"], d: ["2", "4", "6"] },
      { c: ["42"], c2: ["42"], h3: ["G1b", "G2"], i: ["x2", "y", "z"], d: ["2", "40", "6"] },
      { c: ["42"], c2: ["42"], h3: ["G1b", "G2"], i: ["x2", "y", "z", "w"], d: ["2", "40", "6", "8"] },
      { c: ["42"], c2: ["42"], h3: ["G1b", "G2", "G3"], i: ["x2", "y", "z", "w", "v"], d: ["2", "40", "6", "8", "18"] },
    ]);
  });

  it("入れ子の for: 内側の行への $resolve の書き込みが DOM に届く（listLedgerParentKey の形）", async () => {
    const html = `<div id="outer"><template data-wcs="for: groups"><div class="group"><h3 data-wcs="textContent: .title"></h3>`
      + `<template data-wcs="for: .items"><i data-wcs="textContent: .name"></i></template></div></template></div>`;
    const r = await both(html, () => ({ groups: [{ title: "G1", items: [{ name: "x" }, { name: "y" }] }] }), [
      (s) => { s.$resolve("groups.*.items.*.name", [0, 0], "x2"); },
      (s) => { s["groups.0.items"] = [{ name: "z" }, ...s["groups.0.items"]]; },
    ], (r) => ({ g: r.querySelectorAll(".group").length, i: texts(r, "i") }));
    expectViews(r, [{ g: 1, i: ["x", "y"] }, { g: 1, i: ["x2", "y"] }, { g: 1, i: ["z", "x2", "y"] }]);
  });

  it("if の中の for: 行の葉・追加・追加した行の葉・要素の書き込み・縮小・if の切り替えに追従し、行が重複しない（3.x 旧: [10, 2, 3, 1, 2]）", async () => {
    const html = `<p id="c">{{ count }}</p>` + T("if: show", `<ul>${T("for: items",
      `<li class="n" data-wcs="textContent: .n"></li><li class="d" data-wcs="textContent: .double"></li>`)}</ul>`);
    const r = await both(html, () => ({ count: 1, show: true, items: [{ n: 1 }, { n: 2 }], get "items.*.double"() { return (this as any)["items.*.n"] * 2; } }), [
      set("items.0.n", 10),
      push(() => ({ n: 3 })),
      set("items.2.n", 30),
      set("items.1", { n: 20 }),
      (s) => { s.items = [s.items[0]]; },
      set("show", false),
      set("show", true),
      set("items.0.n", 11),
    ], (r) => ({ c: texts(r, "#c"), n: texts(r, ".n"), d: texts(r, ".d") }));
    expectViews(r, [
      { c: ["1"], n: ["1", "2"], d: ["2", "4"] },
      { c: ["1"], n: ["10", "2"], d: ["20", "4"] },
      { c: ["1"], n: ["10", "2", "3"], d: ["20", "4", "6"] },
      { c: ["1"], n: ["10", "2", "30"], d: ["20", "4", "60"] },
      { c: ["1"], n: ["10", "20", "30"], d: ["20", "40", "60"] },
      { c: ["1"], n: ["10"], d: ["20"] },
      { c: ["1"], n: [], d: [] },
      { c: ["1"], n: ["10"], d: ["20"] },
      { c: ["1"], n: ["11"], d: ["22"] },
    ]);
  });

  it("else の中の for（サーバーは else を描く）: 行の葉の書き込みと、枝の切り替えに追従する", async () => {
    const html = T("if: show", `<p class="p">none</p>`) + T("else:", `<ul>${T("for: items", `<li class="n" data-wcs="textContent: .n"></li>`)}</ul>`);
    const r = await both(html, () => ({ show: false, items: [{ n: 1 }, { n: 2 }] }), [
      set("items.1.n", 20), set("show", true), set("show", false), push(() => ({ n: 3 })),
    ], (r) => ({ p: texts(r, ".p"), n: texts(r, ".n") }));
    expectViews(r, [
      { p: [], n: ["1", "2"] },
      { p: [], n: ["1", "20"] },
      { p: ["none"], n: [] },
      { p: [], n: ["1", "20"] },
      { p: [], n: ["1", "20", "3"] },
    ]);
  });

  it("内側のリストが全部空の入れ子 for: 後から内側・外側に行を足せる", async () => {
    const html = `<div><template data-wcs="for: groups"><section><h3 data-wcs="textContent: .title"></h3>`
      + `<ul><template data-wcs="for: .items"><li class="i" data-wcs="textContent: .name"></li></template></ul></section></template></div>`;
    const r = await both(html, () => ({ groups: [{ title: "G1", items: [] }, { title: "G2", items: [] }] }), [
      set("groups.0.items", [{ name: "a" }]),
      set("groups.1.items", [{ name: "b" }, { name: "c" }]),
      set("groups.0.items.0.name", "a2"),
      (s) => { s.groups = [...s.groups, { title: "G3", items: [{ name: "d" }] }]; },
    ], (r) => ({ h3: texts(r, "h3"), i: texts(r, ".i") }));
    expectViews(r, [
      { h3: ["G1", "G2"], i: [] },
      { h3: ["G1", "G2"], i: ["a"] },
      { h3: ["G1", "G2"], i: ["a", "b", "c"] },
      { h3: ["G1", "G2"], i: ["a2", "b", "c"] },
      { h3: ["G1", "G2", "G3"], i: ["a2", "b", "c", "d"] },
    ]);
  });
});

describe("#258-2 バージョン不一致でクライアントが描き直すときも、入れ子のテンプレートの中身を描き、書き込みに追従する", () => {
  it("入れ子の for の内側の行が描かれ、内側の葉の書き込みに追従する", async () => {
    const html = `<div><template data-wcs="for: groups"><section><h3 data-wcs="textContent: .title"></h3>`
      + `<ul><template data-wcs="for: .items"><li class="i" data-wcs="textContent: .name"></li></template></ul></section></template></div>`;
    const state = () => ({ groups: [{ title: "G1", items: [{ name: "x" }, { name: "y" }] }, { title: "G2", items: [{ name: "z" }] }] });
    const observe: Observe = (r) => ({ h3: texts(r, "h3"), i: texts(r, ".i") });
    const steps = [set("groups.0.items.0.name", "x2"), (s: any) => { s.groups = [...s.groups, { title: "G3", items: [{ name: "v" }] }]; }];
    const c = await play(csr, html, state, steps, observe);
    const s = await play(ssrLoad, html, state, steps, observe, { edit: (out) => out.replace(/<wcs-ssr version="[^"]*"/, '<wcs-ssr version="99.0.0"') });
    const expected = [
      { h3: ["G1", "G2"], i: ["x", "y", "z"] },
      { h3: ["G1", "G2"], i: ["x2", "y", "z"] },
      { h3: ["G1", "G2", "G3"], i: ["x2", "y", "z", "v"] },
    ];
    expect({ csr: c.views, ssr: s.views }).toEqual({ csr: expected, ssr: expected });
    expect(s.errors).toEqual([]);
    expect(s.warns).toEqual([expect.stringContaining('version="99.0.0"')]);
  });
});

describe("#258-3 ハイドレーションの後に作る行・枝も、その中の入れ子のテンプレートを保つ", () => {
  it("サーバーで偽だった if の中の for: クライアントで真になってから描かれ、追加・葉の書き込みに追従する", async () => {
    const html = T("if: show", `<ul>${T("for: items", `<li class="n" data-wcs="textContent: .n"></li>`)}</ul>`);
    const r = await both(html, () => ({ show: false, items: [{ n: 1 }, { n: 2 }] }), [
      set("show", true), push(() => ({ n: 3 })), set("items.0.n", 10),
    ], (r) => texts(r, ".n"));
    expectViews(r, [[], ["1", "2"], ["1", "2", "3"], ["10", "2", "3"]]);
  });

  it("サーバーで空だった if の中の for: 後から行を足し、縮め、if を切り替えられる", async () => {
    const html = T("if: show", `<ul>${T("for: items", `<li class="n" data-wcs="textContent: .n"></li>`)}</ul>`);
    const r = await both(html, () => ({ show: true, items: [] as any[] }), [
      set("items", [{ n: 1 }, { n: 2 }]),
      set("items.0.n", 10),
      (s) => { s.items = [s.items[1]]; },
      set("show", false),
      set("show", true),
      push(() => ({ n: 3 })),
    ], (r) => texts(r, ".n"));
    expectViews(r, [[], ["1", "2"], ["10", "2"], ["2"], [], ["2"], ["2", "3"]]);
  });

  it("ハイドレーション後に足した行の中の if: も描かれ、切り替えられる", async () => {
    const html = `<ul>${T("for: items", `<li><span class="n" data-wcs="textContent: .n"></span>${T("if: .on", `<b class="on" data-wcs="textContent: .n"></b>`)}</li>`)}</ul>`;
    const r = await both(html, () => ({ items: [{ n: 1, on: true }, { n: 2, on: false }] }), [
      set("items.0.n", 10),
      set("items.1.on", true),
      set("items.0.on", false),
      push(() => ({ n: 3, on: true })),
      set("items.2.on", false),
      set("items.2.on", true),
    ], (r) => ({ n: texts(r, ".n"), on: texts(r, ".on") }));
    expectViews(r, [
      { n: ["1", "2"], on: ["1"] },
      { n: ["10", "2"], on: ["10"] },
      { n: ["10", "2"], on: ["10", "2"] },
      { n: ["10", "2"], on: ["2"] },
      { n: ["10", "2", "3"], on: ["2", "3"] },
      { n: ["10", "2", "3"], on: ["2"] },
      { n: ["10", "2", "3"], on: ["2", "3"] },
    ]);
  });
});

describe("#258-4 ハイドレーションした for の行の中の if: を、どの行でも切り替えられる", () => {
  it("サーバーで枝が描かれていたどの行でも、行の中の if / else を切り替えられ、枝が重ならず他の行へ移らない", async () => {
    const html = `<ul>${T("for: items", `<li>${T("if: .on", `<b data-wcs="textContent: .n"></b>`)}${T("else:", "<i>off</i>")}</li>`)}</ul>`;
    const rows: Observe = (r) => Array.from(r.querySelectorAll("li"))
      .map((li) => Array.from(li.children).map((c) => `${c.localName}:${c.textContent}`).join(","));
    const r = await both(html, () => ({ items: [{ n: 1, on: true }, { n: 2, on: true }, { n: 3, on: true }] }), [
      set("items.1.on", false),
      set("items.2.on", false),
      set("items.1.on", true),
      set("items.0.on", false),
      set("items.2.on", true),
    ], rows);
    expectViews(r, [
      ["b:1", "b:2", "b:3"],
      ["b:1", "i:off", "b:3"],
      ["b:1", "i:off", "i:off"],
      ["b:1", "b:2", "i:off"],
      ["i:off", "b:2", "i:off"],
      ["i:off", "b:2", "b:3"],
    ]);
  });

  it("サーバーで内側が空だった入れ子 for の内側の行の中の if: も、行を足した後に切り替えられる", async () => {
    const html = `<div>${T("for: groups", `<section><ul>${T("for: .items", `<li><span class="n" data-wcs="textContent: .n"></span>${T("if: .on", "<b>!</b>")}</li>`)}</ul></section>`)}</div>`;
    const r = await both(html, () => ({ groups: [{ items: [] }, { items: [] }] }), [
      set("groups.1.items", [{ n: 1, on: false }, { n: 2, on: true }]),
      set("groups.1.items.0.on", true),
      set("groups.1.items.1.on", false),
      set("groups.0.items", [{ n: 9, on: true }]),
    ], (r) => texts(r, "li"));
    expectViews(r, [[], ["1", "2!"], ["1!", "2!"], ["1!", "2"], ["9!", "1!", "2"]]);
  });
});

describe("#258-5 ハイドレーションした for の行・if の枝の中の bind-component の子が、親への書き込みに追従する", () => {
  const lifecycle: string[] = [];
  const KID_BODY = `<wcs-state bind-component="state"></wcs-state><span class="kn" data-wcs="textContent: n"></span><span class="kl" data-wcs="textContent: label"></span>`;
  function defineShadowKid(): string {
    const tag = `rx3-ssr-skid-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state: Record<string, unknown> = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = KID_BODY;
      }
      connectedCallback(): void { lifecycle.push("connected"); }
      disconnectedCallback(): void { lifecycle.push("disconnected"); }
    });
    return tag;
  }
  /** The Light DOM kid's content (its `<wcs-state>` and bindings) is written in the markup. */
  function defineLightKid(): string {
    const tag = `rx3-ssr-lkid-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state: Record<string, unknown> = {};
      connectedCallback(): void { lifecycle.push("connected"); }
      disconnectedCallback(): void { lifecycle.push("disconnected"); }
    });
    return tag;
  }
  const kids = (tag: string): Observe => (r) => Array.from(r.querySelectorAll(tag)).map((kid) => {
    const k: ParentNode = (kid as HTMLElement).shadowRoot ?? kid;
    return `${texts(k, ".kn").join()}/${texts(k, ".kl").join()}`;
  });

  /**
   * CSR vs SSR; `atLoad` is the kids' lifecycle while the client loaded (hydrated) the page. The hydration
   * must not give a false mount-own-key-shadow.
   */
  async function kidCase(tag: string, html: string, state: () => any, steps: Step[]): Promise<{ csr: Run; ssr: Run; atLoad: string[] }> {
    const c = await play(csr, html, state, steps, kids(tag));
    let atLoad: string[] | null = null;
    const s = await play(ssrLoad, html, state, steps, (r) => {
      if (atLoad === null) atLoad = [...lifecycle];
      return kids(tag)(r);
    }, { beforeClient: () => { lifecycle.length = 0; } });
    expect(atLoad!.length, "子は読み込みで接続される").toBeGreaterThan(0);
    expect(s.warns.filter((w) => w.includes("mount-own-key-shadow"))).toEqual([]);
    return { csr: c, ssr: s, atLoad: atLoad! };
  }

  const rowState = () => ({ items: [{ n: 1, label: "a" }, { n: 2, label: "b" }] });
  const rowSteps: Step[] = [set("items.0.n", 10), set("items.1", { n: 20, label: "B" }), push(() => ({ n: 3, label: "c" }))];
  const rowViews = [["1/a", "2/b"], ["10/a", "2/b"], ["10/a", "20/B"], ["10/a", "20/B", "3/c"]];
  const ifState = () => ({ show: true, item: { n: 1, label: "a" } });
  const ifSteps: Step[] = [set("item.n", 10), set("item", { n: 20, label: "b" })];

  for (const [form, define, body] of [["Shadow DOM", defineShadowKid, ""], ["Light DOM", defineLightKid, KID_BODY]] as const) {
    it(`${form}: 行の中の部分マウント（state.n: .n; state.label: .label）`, async () => {
      const tag = define();
      const r = await kidCase(tag, `<div>${T("for: items", `<${tag} data-wcs="state.n: .n; state.label: .label">${body}</${tag}>`)}</div>`, rowState, rowSteps);
      expectViews(r, rowViews);
    });

    it(`${form}: 行の中の丸ごとマウント（state: items.*）`, async () => {
      const tag = define();
      const r = await kidCase(tag, `<div>${T("for: items", `<${tag} data-wcs="state: items.*">${body}</${tag}>`)}</div>`, rowState, rowSteps);
      expectViews(r, rowViews);
    });

    it(`${form}: if の中の部分マウントと丸ごとマウント`, async () => {
      const tag = define();
      const r = await kidCase(tag, T("if: show", `<${tag} data-wcs="state.n: item.n; state.label: item.label">${body}</${tag}><${tag} data-wcs="state: item">${body}</${tag}>`),
        ifState, ifSteps);
      expectViews(r, [["1/a", "1/a"], ["10/a", "10/a"], ["20/b", "20/b"]]);
    });

    // 3.x #258（bind-component の子）の修正の後半「ハイドレーションはブロックの中のカスタム要素を切断しない」。4.0 は
    // かつて領域のノードを文書から外して（detach()）view が錨の前へ挿し直し、行・枝の中の要素が一度切断されて再接続されていた
    // （row: connected×2 → disconnected×2 → connected×2）。今はサーバーのノードをその場に残して引き取る（目印だけを外す）
    it(`${form}: ハイドレーションで行・枝の中の子を切断・再接続しない`, async () => {
      const tag = define();
      const row = await kidCase(tag, `<div>${T("for: items", `<${tag} data-wcs="state.n: .n; state.label: .label">${body}</${tag}>`)}</div>`, rowState, []);
      const branch = await kidCase(tag, T("if: show", `<${tag} data-wcs="state: item">${body}</${tag}>`), ifState, []);
      expect({ row: row.atLoad, branch: branch.atLoad }).toEqual({ row: ["connected", "connected"], branch: ["connected"] });
    });
  }

  it("行・if の中身の直下（要素に包まれない）の {{ }} も、ハイドレーション後の書き込みに追従する", async () => {
    const html = `<p id="row">${T("for: items", "[{{ .n }}]")}</p><p id="if">${T("if: show", "({{ msg }})")}</p>`;
    const r = await both(html, () => ({ show: true, msg: "hi", items: [{ n: 1 }, { n: 2 }] }), [
      set("items.1.n", 20), set("msg", "yo"), push(() => ({ n: 3 })), set("show", false), set("show", true),
    ], (r) => ({ row: texts(r, "#row"), if: texts(r, "#if") }));
    expectViews(r, [
      { row: ["[1][2]"], if: ["(hi)"] },
      { row: ["[1][20]"], if: ["(hi)"] },
      { row: ["[1][20]"], if: ["(yo)"] },
      { row: ["[1][20][3]"], if: ["(yo)"] },
      { row: ["[1][20][3]"], if: [""] },
      { row: ["[1][20][3]"], if: ["(yo)"] },
    ]);
  });

  it("行の中の {{ items.*.n }}（フルパス）・行の getter・{{ .n }} が、葉の書き込みとリストの置換に追従する", async () => {
    const html = `<ul>${T("for: items", `<li class="m">n={{ items.*.n }} d={{ items.*.double }} s={{ .n }}</li>`)}</ul>`;
    const r = await both(html, () => ({ items: [{ n: 1 }, { n: 2 }], get "items.*.double"() { return (this as any)["items.*.n"] * 2; } }), [
      set("items.0.n", 10), set("items.1.n", 20), set("items", [{ n: 7 }, { n: 8 }, { n: 9 }]), set("items.0.n", 70),
    ], (r) => texts(r, ".m"));
    expectViews(r, [
      ["n=1d=2s=1", "n=2d=4s=2"],
      ["n=10d=20s=10", "n=2d=4s=2"],
      ["n=10d=20s=10", "n=20d=40s=20"],
      ["n=7d=14s=7", "n=8d=16s=8", "n=9d=18s=9"],
      ["n=70d=140s=70", "n=8d=16s=8", "n=9d=18s=9"],
    ]);
  });
});

describe("#258-5 追加: ハイドレーションはサーバーのノードをその場で引き取り、行・枝の中のカスタム要素を切断しない", () => {
  /** `c` / `d` per connectedCallback / disconnectedCallback of the probes (and of the Light DOM kids), and the elements connected. */
  const log: string[] = [];
  const seen: Element[] = [];
  const PROBE = `rx3-ssr-probe-${seq++}`;
  const KID = `rx3-ssr-pkid-${seq++}`;
  beforeAll(() => {
    customElements.define(PROBE, class extends HTMLElement {
      connectedCallback(): void { log.push("c"); seen.push(this); }
      disconnectedCallback(): void { log.push("d"); }
    });
    customElements.define(KID, class extends HTMLElement {
      state: Record<string, unknown> = {};
      connectedCallback(): void { log.push("c"); seen.push(this); }
      disconnectedCallback(): void { log.push("d"); }
    });
  });
  const P = `<${PROBE}></${PROBE}>`;

  interface Hydrated { csr: Run; ssr: Run; atLoad: string[]; connected: boolean[] }
  /**
   * CSR vs SSR. `atLoad` is the lifecycle while the client loaded (hydrated) the page; `connected`, for
   * each element connected meanwhile (the server's, as the client parsed them, and any built anew),
   * whether it is in the page then.
   */
  async function hydrated(html: string, state: () => any, steps: Step[], opts?: Opts): Promise<Hydrated> {
    const c = await play(csr, html, state, steps, view, opts);
    let atLoad: string[] | null = null;
    let connected: boolean[] = [];
    const s = await play(ssrLoad, html, state, steps, (r) => {
      if (atLoad === null) {
        atLoad = [...log];
        connected = seen.map((e) => e.isConnected);
      }
      return view(r);
    }, { ...opts, beforeClient: () => { log.length = 0; seen.length = 0; } });
    return { csr: c, ssr: s, atLoad: atLoad!, connected };
  }
  /** The page as rendered — its markup, anchors included (CSR and SSR put every node in the same place) — and its text. */
  const view = (r: ShadowRoot) => ({ html: r.querySelector("#root")!.innerHTML, text: flat(r.querySelector("#root")) });
  const textsOf = (r: Run) => (r.views as { text: string }[]).map((v) => v.text);
  /** Both modes give the same markup and text at each step, and no error. */
  function expectSame(r: Hydrated): void {
    expect(r.ssr.views).toEqual(r.csr.views);
    expect({ csr: r.csr.errors, ssr: r.ssr.errors }).toEqual({ csr: [], ssr: [] });
    expect(r.ssr.warns).toEqual(r.csr.warns);
  }
  /** Each of the `n` elements connected once, none disconnected, all still in the page. */
  function expectInPlace(r: Hydrated, n: number): void {
    expect(r.atLoad).toEqual(Array(n).fill("c"));
    expect(r.connected).toEqual(Array(n).fill(true));
  }

  it("入れ子の for（行の要素の中の for と、行の直下の for）: 外と内の行の要素を切断せず、以後の書き込み・並べ替え・追加・削除が効く", async () => {
    const html = `<div id="root">${T("for: groups", `<section>${P}<h3>{{ .t }}</h3><ul>${T("for: .items", `<li>${P}{{ .n }}</li>`)}</ul></section>`
      + T("for: .items", `${P}<b>{{ .n }}</b>`))}</div>`;
    const state = () => ({ groups: [{ t: "A", items: [{ n: 1 }, { n: 2 }] }, { t: "B", items: [{ n: 3 }] }] });
    const r = await hydrated(html, state, [
      set("groups.0.items.1.n", 20),
      (s) => { s.groups = [s.groups[1], s.groups[0]]; },
      (s) => { s["groups.1.items"] = [...s.groups[1].items, { n: 4 }]; },
      (s) => { s.groups = [s.groups[1]]; },
    ]);
    expectSame(r);
    // 2 sections, 3 + 3 rows of items
    expectInPlace(r, 8);
    expect(textsOf(r.ssr)).toEqual(["A1212B33", "A120120B33", "B33A120120", "B33A12041204", "A12041204"]);
  });

  it.each([
    ["if: の枝", { a: true, b: true }, [set("a", false), set("b", false), set("a", true)]],
    ["elseif: の枝（要素で包まない）", { a: false, b: true }, [set("b", false), set("a", true), set("b", false)]],
    ["else: の枝", { a: false, b: false }, [set("b", true), set("a", true), set("a", false)]],
  ] as const)("if / elseif / else の連鎖の %s を切断せずに引き取り（錨は CSR と同じ所）、以後の切り替えが効く", async (_name, data, steps) => {
    const html = `<div id="root">x${T("if: a", `<p>${P}A</p>`)}\n${T("elseif: b", `${P}B`)}\n${T("else:", `<i>${P}C</i>`)}y</div>`;
    const r = await hydrated(html, () => ({ ...data }), [...steps]);
    expectSame(r);
    expectInPlace(r, 1);
  });

  // 連鎖のテンプレートの間のコメント（空白と混ざっても）は、連鎖を切らない（CSR と同じ）。ハイドレーションも枝を引き取る
  // （migration-v4 §5 の既知の制限だった: 修正前は枝を捨てて描き直し、枝の中のカスタム要素を作り直した）
  it.each([
    ["if: の枝", { a: true, b: true }, [set("a", false), set("b", false), set("a", true)]],
    ["elseif: の枝（要素で包まない）", { a: false, b: true }, [set("b", false), set("a", true), set("b", false)]],
    ["else: の枝", { a: false, b: false }, [set("b", true), set("a", true), set("a", false)]],
  ] as const)("テンプレートの間にコメントのある if / elseif / else の連鎖の %s も、切断せずに引き取り、以後の切り替えが効く", async (_name, data, steps) => {
    const html = `<div id="root">x<!-- before -->${T("if: a", `<p>${P}A</p>`)}<!-- a|b -->${T("elseif: b", `${P}B`)}\n<!-- b|c --> <!-- 2 -->\n`
      + `${T("else:", `<i>${P}C</i>`)}<!-- after -->y</div>`;
    const r = await hydrated(html, () => ({ ...data }), [...steps]);
    expectSame(r);
    expectInPlace(r, 1);
  });

  it("行の中の if / elseif / else の間にコメントがあっても、行ごとに違う枝を切断せずに引き取る", async () => {
    const html = `<div id="root"><ul>${T("for: items", `<li>${P}{{ .n }}${T("if: .a", `${P}a`)}<!-- a|b -->${T("elseif: .b", `<b>${P}b</b>`)}`
      + `<!-- b|c -->\n${T("else:", `${P}c`)}</li>`)}</ul></div>`;
    const state = () => ({ items: [{ n: 1, a: true }, { n: 2, b: true }, { n: 3 }] });
    const r = await hydrated(html, state, [
      (s) => { s.items = [s.items[2], s.items[0], s.items[1]]; },
      set("items.0.a", true),
      set("items.1.a", false),
    ]);
    expectSame(r);
    expectInPlace(r, 6);
    expect(textsOf(r.ssr)).toEqual(["1a2b3c", "3c1a2b", "3a1a2b", "3a1c2b"]);
  });

  // コメントバインディングもコメントなので連鎖を切らない。行の中では、引き取る時にはもう値の文字になっている
  it.each([
    ["ページの連鎖", { a: true, b: false }],
    ["ページの連鎖（else の枝）", { a: false, b: false }],
    ["行の中の連鎖", { a: true, b: true }],
    ["行の中の連鎖（else の枝）", { a: false, b: true }],
  ] as const)("連鎖のテンプレートの間のコメントバインディング（%s）も、枝を切断せずに引き取り、以後の書き込みが効く", async (_name, { a, b }) => {
    const chain = (p: string) => `${T(`if: ${p}a`, `<p>${P}A</p>`)}<!--@@: ${p}note-->\n${T("else:", `<i>${P}C</i>`)}`;
    const html = b ? `<div id="root"><ul>${T("for: items", `<li>${chain(".")}</li>`)}</ul></div>` : `<div id="root">${chain("")}</div>`;
    const state = () => (b ? { items: [{ a, note: "N" }] } : { a, note: "N" });
    const r = await hydrated(html, state, b ? [set("items.0.note", "M"), set("items.0.a", !a)] : [set("note", "M"), set("a", !a)]);
    expectSame(r);
    expectInPlace(r, 1);
    expect(textsOf(r.ssr)).toEqual(a ? ["AN", "AM", "MC"] : ["NC", "MC", "AM"]);
  });

  it("2 つの連鎖が並び、それぞれのテンプレートの間にコメントがあっても、どちらの枝も引き取る", async () => {
    const html = `<div id="root">${T("if: a", `<p>${P}A</p>`)}<!-- 1 -->${T("else:", `<i>${P}notA</i>`)}<!-- between -->`
      + `${T("if: b", `<p>${P}B</p>`)}<!-- 2 -->${T("else:", `<i>${P}notB</i>`)}</div>`;
    const r = await hydrated(html, () => ({ a: false, b: true }), [set("a", true), set("b", false)]);
    expectSame(r);
    expectInPlace(r, 2);
    expect(textsOf(r.ssr)).toEqual(["notAB", "AB", "AnotB"]);
  });

  it("if の枝の中の for の行と、行の中の if / elseif / else（行ごとに違う枝）を切断しない", async () => {
    const html = `<div id="root">${T("if: show", `<ul>${T("for: items", `<li>${P}{{ .n }}${T("if: .a", `${P}a`)}${T("elseif: .b", `<b>${P}b</b>`)}${T("else:", `${P}c`)}</li>`)}</ul>`)}</div>`;
    const state = () => ({ show: true, items: [{ n: 1, a: true }, { n: 2, b: true }, { n: 3 }] });
    const r = await hydrated(html, state, [
      (s) => { s.items = [s.items[2], s.items[0], s.items[1]]; },
      set("items.0.a", true),
      push(() => ({ n: 4, b: true })),
      set("show", false),
      set("show", true),
    ]);
    expectSame(r);
    expectInPlace(r, 6);
    expect(textsOf(r.ssr)).toEqual(["1a2b3c", "3c1a2b", "3a1a2b", "3a1a2b4b", "", "3a1a2b4b"]);
  });

  it("行の中の行の Light DOM の bind-component の子（自分の for: の行も持つ）を切断せず、以後の書き込みが子に届く", async () => {
    const kid = `<${KID} data-wcs="state.n: .n; state.list: .list"><wcs-state bind-component="state"></wcs-state>`
      + `<b class="kn" data-wcs="textContent: n"></b><ul>${T("for: list", `<li>${P}{{ . }}</li>`)}</ul></${KID}>`;
    const html = `<div id="root">${T("for: groups", `<section>${T("for: .items", kid)}</section>`)}</div>`;
    const state = () => ({ groups: [{ items: [{ n: 1, list: ["a", "b"] }, { n: 2, list: ["c"] }] }, { items: [{ n: 3, list: [] }] }] });
    const r = await hydrated(html, state, [
      set("groups.0.items.1.n", 20),
      (s) => { s["groups.0.items.0.list"] = [...s.groups[0].items[0].list, "z"]; },
      (s) => { s.groups = [s.groups[1], s.groups[0]]; },
    ]);
    expectSame(r);
    // 3 kids, 3 rows of their own lists
    expectInPlace(r, 6);
    expect(textsOf(r.ssr)).toEqual(["1ab2c3", "1ab20c3", "1abz20c3", "31abz20c"]);
  });

  it("プランと形の合わない行だけを、その場で作り直す（前後の行は切断せず、順序も保つ）", async () => {
    const html = `<div id="root"><ul>${T("for: items", `<li>${P}<span data-wcs="textContent: .n"></span></li>`)}</ul></div>`;
    const r = await hydrated(html, () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }), [
      set("items.1.n", 20),
      (s) => { s.items = [s.items[2], s.items[1], s.items[0]]; },
    ], { edit: (out) => out.replace("<span>2</span>", "<i></i><span>2</span>") });
    expectSame(r);
    // the three rows' probes as parsed, then the new row's: the server's middle row goes, the others stay
    expect(r.atLoad).toEqual(["c", "c", "c", "c", "d"]);
    expect(r.connected).toEqual([true, false, true, true]);
    expect(textsOf(r.ssr)).toEqual(["123", "1203", "3201"]);
  });

  it("クライアントの行がサーバーより少なければ、余った行だけを外す", async () => {
    const html = `<div id="root"><ul>${T("for: items", `<li>${P}{{ .n }}</li>`)}</ul></div>`;
    const r = await hydrated(html, () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }), [push(() => ({ n: 4 }))], {
      edit: (out) => out.replace(/(<script type="application\/json">)[^<]*(<\/script>)/, `$1{"items":[{"n":1},{"n":2}]}$2`),
    });
    expect(r.atLoad).toEqual(["c", "c", "c", "d"]);
    expect(r.connected).toEqual([true, true, false]);
    expect(textsOf(r.ssr)).toEqual(["12", "124"]);
    expect(r.ssr.errors).toEqual([]);
  });

  it("行・枝の値のテキストにある {{ }} は、引き取った後もページのマークアップにならない", async () => {
    const html = `<div id="root"><p>${T("for: items", "[{{ .s }}]")}</p><p>${T("if: show", "({{ s }})")}</p>`
      + `<ul>${T("for: items", `<li><b>{{ .s }}</b><i data-wcs="innerHTML: .h"></i></li>`)}</ul></div>`;
    const state = () => ({ show: true, s: "{{ secret }}", secret: "LEAK", items: [{ s: "{{ secret }}", h: "<u>{{ secret }}</u>" }] });
    const r = await hydrated(html, state, [set("secret", "LEAK2"), set("items.0.s", "x")]);
    expectSame(r);
    expect(textsOf(r.ssr)).toEqual([
      "[{{secret}}]({{secret}}){{secret}}{{secret}}",
      "[{{secret}}]({{secret}}){{secret}}{{secret}}",
      "[x]({{secret}})x{{secret}}",
    ]);
  });
});

describe("#258-6 同じリストを回す 2 つの for が、ハイドレーション後どちらも書き込みに追従する", () => {
  it("葉の書き込み・要素の書き込み・追加・並べ替え", async () => {
    const html = `<ul>${T("for: items", `<li class="a" data-wcs="textContent: .n"></li>`)}</ul><ol>${T("for: items", `<li class="b" data-wcs="textContent: .n"></li>`)}</ol>`;
    const r = await both(html, () => ({ items: [{ n: 1 }, { n: 2 }] }), [
      set("items.0.n", 10),
      set("items.1", { n: 20 }),
      push(() => ({ n: 3 })),
      (s) => { s.items = [s.items[2], s.items[0]]; },
      set("items.1.n", 11),
    ], (r) => ({ a: texts(r, ".a"), b: texts(r, ".b") }));
    expectViews(r, [
      { a: ["1", "2"], b: ["1", "2"] },
      { a: ["10", "2"], b: ["10", "2"] },
      { a: ["10", "20"], b: ["10", "20"] },
      { a: ["10", "20", "3"], b: ["10", "20", "3"] },
      { a: ["3", "10"], b: ["3", "10"] },
      { a: ["3", "11"], b: ["3", "11"] },
    ]);
  });
});

// ================================================================ #334

describe("#334 サーバー描画中に描いてあるリストを書き換えても、ハイドレーション後に一覧を書き換えられる", () => {
  const list = (row: string) => `<ul id="list">${T("for: items", row)}</ul><p>{{ count }}</p>`;
  const ROW = `<li data-wcs="textContent: .n"></li>`;
  const rowTexts: Observe = (r) => texts(r, "#list li");
  /** The state; `$connectedCallback` rewrites `items` after an await (the server's page-by-page load). */
  const during = (items: number[], mutate: (s: any) => Promise<void> | void) => () => ({
    items: items.map((n) => ({ n })),
    count: 0,
    async $connectedCallback(this: any) {
      await later();
      await mutate(this);
    },
  });
  const STEPS: Step[] = [
    set("count", 1),
    set("items.1.n", 20),
    push(() => ({ n: 99 })),
    (s) => { s.items = s.items.slice(1); },
    set("items", [{ n: 7 }, { n: 8 }]),
  ];

  it.each<[string, number[], (s: any) => void, string[][]]>([
    ["1 行だけ足す", [1], (s) => { s.items = [...s.items, { n: 2 }]; },
      [["1", "2"], ["1", "2"], ["1", "20"], ["1", "20", "99"], ["20", "99"], ["7", "8"]]],
    ["先頭の行を消す", [1, 2, 3], (s) => { s.items = s.items.slice(1); },
      [["2", "3"], ["2", "3"], ["2", "20"], ["2", "20", "99"], ["20", "99"], ["7", "8"]]],
    ["並べ替える", [1, 2, 3], (s) => { s.items = [...s.items].reverse(); },
      [["3", "2", "1"], ["3", "2", "1"], ["3", "20", "1"], ["3", "20", "1", "99"], ["20", "1", "99"], ["7", "8"]]],
    ["要素を書き込む", [1, 2, 3], (s) => { s["items.1"] = { n: 9 }; },
      [["1", "9", "3"], ["1", "9", "3"], ["1", "20", "3"], ["1", "20", "3", "99"], ["20", "3", "99"], ["7", "8"]]],
    ["丸ごと置き換える", [1, 2], (s) => { s.items = [{ n: 7 }, { n: 8 }, { n: 9 }]; },
      [["7", "8", "9"], ["7", "8", "9"], ["7", "20", "9"], ["7", "20", "9", "99"], ["20", "9", "99"], ["7", "8"]]],
  ])("サーバー描画中に%s", async (_name, items, mutate, views) => {
    const r = await both(list(ROW), during(items, mutate), STEPS, rowTexts, { wait: 30 });
    expectViews(r, views);
  });

  it("行の中の if が描いたノードも、サーバー描画中の追加・並べ替えの後に行の中に居る", async () => {
    const row = `<li><span data-wcs="textContent: .n"></span>${T("if: .show", "<b>!</b>")}</li>`;
    const state = () => ({
      items: [1, 2, 3].map((n) => ({ n, show: n % 2 === 1 })),
      count: 0,
      async $connectedCallback(this: any) {
        await later();
        this.items = [...this.items, { n: 4, show: false }, { n: 5, show: true }].reverse();
      },
    });
    const r = await both(list(row), state, [
      set("items.1.show", true), push(() => ({ n: 99, show: true })), (s) => { s.items = [...s.items].reverse(); },
    ], rowTexts, { wait: 30 });
    expectViews(r, [
      ["5!", "4", "3!", "2", "1!"],
      ["5!", "4!", "3!", "2", "1!"],
      ["5!", "4!", "3!", "2", "1!", "99!"],
      ["99!", "1!", "2", "3!", "4!", "5!"],
    ]);
  });

  it("行の直下の if が行の外に描いたノードも、サーバー描画中の追加・並べ替えの後に行と一緒に動く", async () => {
    const row = `<li data-wcs="textContent: .n"></li>${T("if: .show", `<li class="x">x</li>`)}`;
    const state = () => ({
      items: [{ n: 1, show: true }, { n: 2, show: false }],
      count: 0,
      async $connectedCallback(this: any) {
        await later();
        this.items = [...this.items, { n: 3, show: true }];
        await later();
        this.items = [...this.items].reverse();
      },
    });
    const r = await both(list(row), state, [
      set("items.1.show", true), set("items.0.show", false), push(() => ({ n: 4, show: true })), (s) => { s.items = [...s.items].reverse(); },
    ], rowTexts, { wait: 40 });
    expectViews(r, [
      ["3", "x", "2", "1", "x"],
      ["3", "x", "2", "x", "1", "x"],
      ["3", "2", "x", "1", "x"],
      ["3", "2", "x", "1", "x", "4", "x"],
      ["4", "x", "1", "x", "2", "x", "3"],
    ]);
  });

  it("祖先の if をサーバー描画中に一度隠して戻した行も、ハイドレーション後に書き換えられる", async () => {
    const html = `<ul id="list">${T("if: shown", T("for: items", ROW))}</ul>`;
    const state = () => ({
      shown: true,
      items: [{ n: 1 }, { n: 2 }],
      async $connectedCallback(this: any) {
        await later();
        this.items = [...this.items, { n: 3 }];
        this.shown = false;
        await later();
        this.shown = true;
        await later();
        this.items = [...this.items].reverse();
      },
    });
    const r = await both(html, state, [
      set("items.1.n", 20), push(() => ({ n: 4 })), set("shown", false), set("shown", true), (s) => { s.items = s.items.slice(1); },
    ], rowTexts, { wait: 60 });
    expectViews(r, [["3", "2", "1"], ["3", "20", "1"], ["3", "20", "1", "4"], [], ["3", "20", "1", "4"], ["20", "1", "4"]]);
  });
});

// ================================================================ #336

describe("#336 SSR のハイドレーションで、else: は同じ階層の直前の if: / elseif: と組む", () => {
  const flags = (data: Record<string, boolean>) => () => ({ a: false, b: false, c: false, d: false, ...data });
  const wrap = (body: string) => `<div id="root">${body}</div>`;

  it("外側の条件が最初から偽（サーバーは外側の else を描く）", async () => {
    const body = T("if: a", `<div>A ${T("if: b", "<i>B</i>")}${T("else:", "<s>notB</s>")}</div>`) + T("else:", "<p>notA</p>");
    const r = await both(wrap(body), flags({ a: false, b: true }), [set("a", true), set("b", false), set("a", false), set("a", true)], rootView);
    expectViews(r, ["notA", "AB", "AnotB", "notA", "AnotB"]);
  });

  it("if の中の if の中の if（3 段）で、各段の else がそれぞれの if と組む", async () => {
    const body = T("if: a", `<div>A ${T("if: b", `<span>B ${T("if: c", "<i>C</i>")}${T("else:", "<s>notC</s>")}</span>`)}`
      + `${T("else:", "<s>notB</s>")}</div>`) + T("else:", "<p>notA</p>");
    const r = await both(wrap(body), flags({ a: true, b: true, c: true }),
      [set("c", false), set("b", false), set("a", false), set("a", true), set("b", true), set("c", true)], rootView);
    expectViews(r, ["ABC", "ABnotC", "AnotB", "notA", "AnotB", "ABnotC", "ABC"]);
  });

  const CHAIN = T("if: a", `<div>A ${T("if: b", "<i>B</i>")}</div>`) + T("elseif: c", "<b>C</b>")
    + T("elseif: d", `<div>D ${T("if: b", "<i>B3</i>")}${T("else:", "<s>notB3</s>")}</div>`) + T("else:", "<p>none</p>");
  const CHAIN_STEPS = [set("a", false), set("c", true), set("a", true), set("b", false), set("c", false),
    set("a", false), set("d", true), set("b", true), set("a", true)];

  it("if → elseif → elseif → else の連鎖で、枝の中に if があっても else は連鎖と組む（サーバーは if の枝を描く）", async () => {
    const r = await both(wrap(CHAIN), flags({ a: true, b: true, c: true, d: true }), CHAIN_STEPS, rootView);
    expectViews(r, ["AB", "C", "C", "AB", "A", "A", "DnotB3", "DnotB3", "DB3", "AB"]);
  });

  it("同じ連鎖（サーバーは 2 つ目の elseif の枝を描く）", async () => {
    const r = await both(wrap(CHAIN), flags({ a: false, b: true, c: false, d: true }), CHAIN_STEPS, rootView);
    expectViews(r, ["DB3", "DB3", "C", "AB", "A", "A", "DnotB3", "DnotB3", "DB3", "AB"]);
  });
});

// ================================================================ #347

describe("#347 SSR のハイドレーション後、行テンプレートの直下に if: / {{ }} がある一覧を書き換えられる", () => {
  it("最後の行の if: が真の一覧に、真・偽の行を足して並べ替える", async () => {
    const body = `<div id="root"><ul>${T("for: items", `<li data-wcs="textContent: .n"></li>${T("if: .show", `<li class="x">x</li>`)}`)}</ul></div>`;
    const r = await both(body, () => ({ items: [{ n: 1, show: false }, { n: 2, show: true }] }),
      [push(() => ({ n: 3, show: false })), push(() => ({ n: 4, show: true })), (s) => { s.items = [...s.items].reverse(); }], rootView);
    expectViews(r, ["12x", "12x3", "12x34x", "4x32x1"]);
  });

  it("要素の書き込みの後も、行の直下の if / else が行と一緒に切り替わり、並べ替わる", async () => {
    const body = `<div id="root"><ul>${T("for: items", `<li data-wcs="textContent: .n"></li>${T("if: .show", `<li class="x">x</li>`)}${T("else:", `<li class="y">y</li>`)}`)}</ul></div>`;
    const r = await both(body, () => ({ items: [{ n: 1, show: true }, { n: 2, show: true }] }), [
      set("items.0", { n: 5, show: false }), set("items.0.show", true), set("items.1.show", false), (s) => { s.items = [...s.items].reverse(); },
    ], rootView);
    expectViews(r, ["1x2x", "5y2x", "5x2x", "5x2y", "2y5x"]);
  });

  it("{{ }} と if: を行の直下に並べた形（[{{ .n }}] の後に if）", async () => {
    const body = `<div id="root"><p>${T("for: items", `[{{ .n }}]${T("if: .show", "!")}`)}</p></div>`;
    const r = await both(body, () => ({ items: [{ n: 1, show: true }, { n: 2, show: false }, { n: 3, show: true }] }), [
      (s) => { s.items = [...s.items].reverse(); }, set("items.1.show", true), (s) => { s.items = s.items.slice(1); }, push(() => ({ n: 4, show: true })),
    ], rootView);
    expectViews(r, ["[1]![2][3]!", "[3]![2][1]!", "[3]![2]![1]!", "[2]![1]!", "[2]![1]![4]!"]);
  });
});

// ================================================================ #348

describe("#348 SSR のハイドレーションで、Light DOM の bind-component の子の if: / else: とページの else: がそれぞれ組む", () => {
  let kid = "";
  beforeAll(() => {
    kid = `rx3-ssr-kid-${seq++}`;
    customElements.define(kid, class extends HTMLElement { state = {}; });
  });

  it("子の if の枝の中の if と子の else、ページの else（子の中でも階層ごとに組む）", async () => {
    const body = T("if: a", `<div>A <${kid} data-wcs="state.x: x; state.y: y"><wcs-state bind-component="state"></wcs-state>`
      + `${T("if: x", `<b>X ${T("if: y", "<i>Y</i>")}</b>`)}${T("else:", "<s>nX</s>")}</${kid}></div>`) + T("else:", "<p>notA</p>");
    const r = await both(`<div id="root">${body}</div>`, () => ({ a: true, x: true, y: true }),
      [set("y", false), set("x", false), set("a", false), set("a", true), set("x", true), set("y", true)], rootView);
    expectViews(r, ["AXY", "AX", "AnX", "notA", "AnX", "AX", "AXY"]);
  });
});

// ================================================================ #349

describe("#349 SSR のハイドレーション後、サーバーが描いた行・枝の中の if: が行の文脈で、前の枝を残さず切り替わる", () => {
  it("for: の行の中の if / elseif / else（並べ替え・追加を含む）", async () => {
    const body = `<div id="root"><ul>${T("for: items", `<li>${T("if: .a", "<i>I</i>")}${T("elseif: .b", "<b>EI</b>")}${T("else:", "<s>E</s>")}</li>`)}</ul></div>`;
    const r = await both(body, () => ({ items: [{ a: false, b: false }, { a: true, b: false }] }), [
      set("items.0.a", true), set("items.0.a", false), set("items.0.b", true), set("items.0.a", true),
      set("items.1.a", false), (s) => { s.items = [...s.items].reverse(); }, push(() => ({ a: false, b: true })),
    ], rootView);
    expectViews(r, ["EI", "II", "EI", "EII", "II", "IE", "EI", "EIEI"]);
  });

  it("行の直下の if / else の枝の中の {{ .n }} が、行の文脈で書き込みに追従する", async () => {
    const body = `<div id="root"><p>${T("for: items", `${T("if: .show", "[{{ .n }}]")}${T("else:", "({{ .n }})")}`)}</p></div>`;
    const r = await both(body, () => ({ items: [{ n: 1, show: true }, { n: 2, show: false }] }), [
      set("items.1.n", 20), set("items.0.n", 10), set("items.0.show", false), set("items.1.show", true),
      (s) => { s.items = [...s.items].reverse(); },
    ], rootView);
    expectViews(r, ["[1](2)", "[1](20)", "[10](20)", "(10)(20)", "(10)[20]", "[20](10)"]);
  });
});

// ================================================================ #350

describe("#350 SSR のハイドレーション後、行の中の if の枝の {{ $1 }} もすぐに添字を出す", () => {
  it("行の中の if の枝の {{ $1 }}", async () => {
    const html = `<ul>${T("for: items", `<li><b>{{ .id }}</b>${T("if: .id", "<i>#{{ $1 }}</i>")}</li>`)}</ul>`;
    const r = await both(html, () => ({ items: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
      [set("items.0.id", "A"), push(() => ({ id: "d" })), (s) => { s.items = s.items.slice(1); }], (r) => texts(r, "li").join(" "));
    // 最後の手順（先頭の行を消す）は #360（入れ子のテンプレートの $1 が添字の振り直しに追従する）も見る
    expectViews(r, ["a#0 b#1 c#2", "A#0 b#1 c#2", "A#0 b#1 c#2 d#3", "b#0 c#1 d#2"]);
  });
});

// ================================================================ #351

describe("#351 SSR のハイドレーション後、配列をそのまま返す getter の for: が、元のパスへの書き込みに追従する", () => {
  const state = () => ({ items: [{ name: "a" }, { name: "b" }], get visible() { return (this as any).items; } });

  it("getter の for: だけのページ: 元のパスへの要素の書き込みの後も、行の追加・削除を描く（3.3: a b のまま）", async () => {
    const r = await both(`<ul class="v">${T("for: visible", "<li>{{ .name }}</li>")}</ul>`, state, [
      set("items.0", { name: "z" }), push(() => ({ name: "n" })), (s) => { s.items = s.items.slice(1); },
    ], (r) => texts(r, "ul.v li"));
    expectViews(r, [["a", "b"], ["z", "b"], ["z", "b", "n"], ["b", "n"]]);
  });

  it("for: items と for: visible の両方: 要素の書き込み → 追加 → 葉の書き込み", async () => {
    const html = `<ul class="i">${T("for: items", "<li>{{ .name }}</li>")}</ul><ul class="v">${T("for: visible", "<li>{{ .name }}</li>")}</ul>`;
    const r = await both(html, state, [set("items.0", { name: "z" }), push(() => ({ name: "n" })), set("items.1.name", "y")],
      (r) => ({ i: texts(r, "ul.i li"), v: texts(r, "ul.v li") }));
    expectViews(r, [
      { i: ["a", "b"], v: ["a", "b"] },
      { i: ["z", "b"], v: ["z", "b"] },
      { i: ["z", "b", "n"], v: ["z", "b", "n"] },
      { i: ["z", "y", "n"], v: ["z", "y", "n"] },
    ]);
  });
});

// ================================================================ #356

describe("#356 サーバー描画中に隠した・消した・真のまま描き直したブロックの中のブロックが、ハイドレーション後に正しく出る", () => {
  it("要素で包まない 3 段の if: の外側がサーバー描画の最後に隠れても、真にすると各段が出て切り替わる", async () => {
    const html = `<div id="root"><div id="d">${T("if: shown", `A ${T("if: b", `B ${T("if: c", "<i>C</i>")}`)}`)}</div></div>`;
    const state = () => ({ shown: true, b: true, c: true, async $connectedCallback(this: any) { await later(); this.shown = false; } });
    const r = await both(html, state, [set("shown", true), set("b", false), set("b", true), set("c", false)], rootView, { wait: 30 });
    expectViews(r, ["", "ABC", "A", "ABC", "AB"]);
  });

  /** `$connectedCallback` mutates after an await; it also hides `if: gone` in the same pass. */
  const rerender = (data: Record<string, unknown>, mutate: (s: any) => void) => () => ({
    gone: true,
    ...JSON.parse(JSON.stringify(data)),
    async $connectedCallback(this: any) {
      await later();
      mutate(this);
    },
  });
  const GONE = `<p>${T("if: gone", "<i>G</i>")}</p>`;
  const OUTER = (inner: string): string => `<div id="root"><div id="d">${T("if: count|gt(0)", `A ${inner}`)}</div>${GONE}</div>`;

  it.each<[string, string, () => any, Step[], string[]]>([
    ["入れ子の if: は描き直しの後で適用される", OUTER(T("if: inner", "<b>B</b>")),
      rerender({ count: 1, inner: true }, (s) => { s.count = 2; s.gone = false; }),
      [set("inner", false), set("count", 0), set("count", 3)], ["AB", "A", "", "A"]],
    ["入れ子の if: を同じ回に先に描いた", OUTER(T("if: inner", "<b>B</b>")),
      rerender({ count: 1, inner: false }, (s) => { s.inner = true; s.count = 2; s.gone = false; }),
      [set("inner", false), set("inner", true)], ["AB", "A", "AB"]],
    ["入れ子の if: / else: を同じ回に先に切り替えた", OUTER(`${T("if: inner", "<b>B</b>")}${T("else:", "<s>nB</s>")}`),
      rerender({ count: 1, inner: true }, (s) => { s.inner = false; s.count = 2; s.gone = false; }),
      [set("inner", true), set("inner", false)], ["AnB", "AB", "AnB"]],
    ["外側が items.length の if: で、中の要素で包まない if: を先に描いた",
      `<div id="root"><div id="d">${T("if: items.length", `N=<span data-wcs="textContent: items.length"></span> ${T("if: flag", "<b>F</b>")}`)}</div>${GONE}</div>`,
      rerender({ items: [1], flag: false }, (s) => { s.flag = true; s.items = [1, 2]; s.gone = false; }),
      [set("flag", false), set("flag", true)], ["N=2F", "N=2", "N=2F"]],
    ["行の中の if: .c|gt(0) と、その中の if: .x",
      `<div id="root"><ul id="d">${T("for: items", `<li>row</li>${T("if: .c|gt(0)", `C ${T("if: .x", "<b>X</b>")}`)}`)}</ul>${GONE}</div>`,
      rerender({ items: [{ c: 1, x: false }] }, (s) => { s["items.0.x"] = true; s["items.0.c"] = 2; s.gone = false; }),
      [set("items.0.x", false), set("items.0.x", true), push(() => ({ c: 1, x: true })), (s) => { s.items = [...s.items].reverse(); }],
      ["rowCX", "rowC", "rowCX", "rowCXrowCX", "rowCXrowCX"]],
  ])("サーバー描画中に真のまま描き直した if:（%s）", async (_name, html, state, steps, views) => {
    const r = await both(html, state, steps, rootView, { wait: 30 });
    expectViews(r, views);
  });

  it("サーバー描画中に消した行（行の直下の if: が真）の中身を残さず、以後の追加・切り替えが行の中に出る", async () => {
    const html = `<div id="root"><ul id="d">${T("for: items", `<li data-wcs="textContent: .n"></li>${T("if: .show", `<li class="x">x</li>`)}`)}</ul></div>`;
    const state = () => ({
      items: [{ n: 1, show: true }, { n: 2, show: true }, { n: 3, show: true }],
      async $connectedCallback(this: any) { await later(); this.items = [this.items[0], this.items[2]]; },
    });
    const r = await both(html, state, [push(() => ({ n: 4, show: false })), set("items.1.show", false)], rootView, { wait: 30 });
    expectViews(r, ["1x3x", "1x3x4", "1x34"]);
  });
});

// ================================================================ #358

describe("#358 SSR のハイドレーションで作った行・枝の、未定義の要素への spread（...:）が、定義の後にクライアントの行と同じに動く", () => {
  const define = (tag: string) => customElements.define(tag, class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }], inputs: [{ name: "name" }] };
    n: unknown;
    set name(v: unknown) { this.n = v; this.textContent = `hello ${v}`; }
    get name(): unknown { return this.n; }
    get status(): string { return "ready"; }
    // happy-dom: a clone of an element made before the definition is upgraded only when it connects
    // (Chromium upgrades it on cloneNode / customElements.upgrade); a value set before that is taken over here
    connectedCallback(): void {
      if (Object.prototype.hasOwnProperty.call(this, "name")) {
        const v = (this as any).name;
        delete (this as any).name;
        this.name = v;
      }
    }
  });
  /** CSR and SSR each get a tag of their own (a tag is defined once); `"define"` defines it. */
  async function spreadCase(body: (tag: string) => string, data: Record<string, unknown>, steps: (Step | "define")[],
    view: (tag: string) => Observe): Promise<{ csr: Run; ssr: Run }> {
    const runIn = async (load: Load) => {
      const tag = `rx3-ssr-late-${seq++}`;
      const r = await play(load, body(tag), () => structuredClone(data),
        steps.map((s) => (s === "define" ? pageStep(async () => { define(tag); await flush(); }) : s)), view(tag));
      const norm = (xs: string[]) => xs.map((x) => x.split(tag).join("x-late"));
      return { ...r, errors: norm(r.errors), warns: norm(r.warns) };
    };
    return { csr: await runIn(csr), ssr: await runIn(ssrLoad) };
  }
  const greets = (tag: string): Observe => (r) => Array.from(r.querySelectorAll(tag)).map((el) => el.textContent || "-").join(" / ");
  /** As 3.x: SSR shows what CSR shows, and reports what CSR reports (nothing more). */
  function expectSame(r: { csr: Run; ssr: Run }, views: string[]): void {
    expect({ csr: r.csr.views, ssr: r.ssr.views }).toEqual({ csr: views, ssr: views });
    expect({ errors: r.ssr.errors, warns: r.ssr.warns }).toEqual({ errors: r.csr.errors, warns: r.csr.warns });
    expect(r.ssr.errors.filter((e) => /deferred spread failed|items\.\*\.status/.test(e))).toEqual([]);
  }

  it("定義の前に消して足した（使い回した）行も、定義の後に新しい行の値で展開され、書き込みに追従する", async () => {
    const r = await spreadCase((tag) => `<ul>${T("for: items", `<li><${tag} data-wcs="...: ."></${tag}></li>`)}</ul>`,
      { items: [{ name: "a" }, { name: "b" }] },
      [(s) => { s.items = s.items.slice(1); }, push(() => ({ name: "c" })), "define",
        set("items.1.name", "C"), (s) => { s.items = s.items.slice(1); }, push(() => ({ name: "d" }))],
      greets);
    expectSame(r, ["- / -", "-", "- / -", "hello b / hello c", "hello b / hello C", "hello C", "hello C / hello d"]);
  });

  it("行の添字の束縛（attr.data-i: $1）を併せた要素は、展開の後に行の添字が変わると当て直される", async () => {
    const indexes = (tag: string): Observe => (r) => Array.from(r.querySelectorAll(tag))
      .map((el) => `${el.textContent || "-"}@${el.getAttribute("data-i")}`).join(" / ");
    const r = await spreadCase((tag) => `<ul>${T("for: items", `<li><${tag} data-wcs="...: .; attr.data-i: $1"></${tag}></li>`)}</ul>`,
      { items: [{ name: "a" }, { name: "b" }] },
      ["define", (s) => { s.items = [{ name: "z" }, ...s.items]; }, (s) => { s.items = [...s.items].reverse(); }],
      indexes);
    // 4.0 は定義の前から attr.data-i を当てる（3.x の CSR は展開まで null — 3.x の期待は "-@null / -@null"）。定義の後は 3.x と同じ
    expect(r.ssr.views).toEqual(["-@0 / -@1", "hello a@0 / hello b@1", "hello z@0 / hello a@1 / hello b@2", "hello b@0 / hello a@1 / hello z@2"]);
    expect(r.ssr.views).toEqual(r.csr.views);
    expect({ errors: r.ssr.errors, warns: r.ssr.warns }).toEqual({ errors: r.csr.errors, warns: r.csr.warns });
  });

  it("サーバーが描いた if の枝の spread は、定義の前に閉じても開き直すと展開され、書き込みに追従する", async () => {
    const r = await spreadCase((tag) => `<div>${T("if: show", `<${tag} data-wcs="...: one"></${tag}>`)}</div>`,
      { show: true, one: { name: "z", status: "" } },
      [set("show", false), "define", set("show", true), set("one.name", "y")],
      greets);
    expectSame(r, ["-", "", "", "hello z", "hello y"]);
  });

  it("サーバーが描いた行の中の if の枝の spread は、開いたまま定義すると行の文脈で展開され、書き込みに追従する", async () => {
    const r = await spreadCase((tag) => `<ul>${T("for: items", `<li>${T("if: .show", `<${tag} data-wcs="...: ."></${tag}>`)}</li>`)}</ul>`,
      { items: [{ name: "a", show: true, status: "" }, { name: "b", show: true, status: "" }] },
      ["define", set("items.1.name", "B"), set("items.0.show", false), set("items.0.show", true), set("items.0.name", "A")],
      greets);
    expectSame(r, ["- / -", "hello a / hello b", "hello a / hello B", "hello B", "hello a / hello B", "hello A / hello B"]);
  });
});

// ================================================================ #370

describe("#370 スナップショットが if: / elseif: の出力フィルタを保ち、ハイドレーション後に条件が反転しない（for: のフィルタは 4.0 では拒む）", () => {
  const wrap = (body: string) => `<div id="root">${body}</div>`;
  /** The structural bindings of the snapshot's templates, in document order. */
  const snapshotBindTexts = (out: string): string[] => {
    const host = document.createElement("div");
    host.innerHTML = out;
    return Array.from(host.querySelectorAll("wcs-ssr template")).map((t) => t.getAttribute("data-wcs") ?? "");
  };

  it("if: x|not と else:", async () => {
    let out = "";
    const r = await both(wrap(`${T("if: x|not", "<b>notX</b>")}${T("else:", "<i>X</i>")}`), () => ({ x: false }), [set("x", true), set("x", false)], rootView,
      { edit: (o) => { out = o; return o; } });
    expect(snapshotBindTexts(out)).toEqual(["if: x|not", "else:"]);
    expectViews(r, ["notX", "X", "notX"]);
  });

  it("複数のフィルタ・引数付きのフィルタ・elseif: の連鎖", async () => {
    const r = await both(wrap(`${T("if: n|gt(3)|not", "<b>small</b>")}${T("elseif: n|eq(10)", "<i>ten</i>")}${T("else:", "<s>big</s>")}`),
      () => ({ n: 1 }), [set("n", 5), set("n", 10), set("n", 2)], rootView);
    expectViews(r, ["small", "big", "ten", "small"]);
  });

  it("行の中の if: $1|eq(0) と if: .n|gt(3) / else:", async () => {
    const body = `<ul>${T("for: items", `<li>${T("if: $1|eq(0)", "<b>first</b>")}<span data-wcs="textContent: .n"></span>${T("if: .n|gt(3)", "<i>!</i>")}${T("else:", "<s>-</s>")}</li>`)}</ul>`;
    const r = await both(wrap(body), () => ({ items: [{ n: 1 }, { n: 5 }, { n: 2 }] }), [
      set("items.0.n", 9), (s) => { s.items = [...s.items].reverse(); }, (s) => { s.items = s.items.slice(1); },
    ], rootView);
    expectViews(r, ["first1-5!2-", "first9!5!2-", "first2-5!9!", "first5!9!"]);
  });

  it("文字列の引数（区切り・空白・引用符を含む）も同じ値で読み直される", async () => {
    const body = `${T(`if: label|eq("a, b")`, "<b>AB</b>")}${T(`if: label|eq('it'"'"'s "x"')`, "<i>Q</i>")}${T("if: label|eq( ' ' )", "<s>SP</s>")}`;
    const r = await both(wrap(body), () => ({ label: "a, b" }), [set("label", `it's "x"`), set("label", " "), set("label", "a, b")], rootView);
    expectViews(r, ["AB", "Q", "SP", "AB"]);
  });

  /** Loads `body` under a root `<wcs-state>` (on a server: an orchestrated render); the rejection of its connectedCallbackPromise. */
  const refusal = async (body: string, server: boolean): Promise<{ reason: string | null; logged: string[] }> => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    if (server) document.documentElement.setAttribute("data-wcs-server", "orchestrated");
    try {
      const h = document.createElement(`rx3-ssr-refuse-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state${server ? " enable-ssr" : ""}></wcs-state>${body}`;
      const el = root.querySelector("wcs-state") as any;
      el.setInitialState({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] });
      document.body.appendChild(h);
      const reason = await el.connectedCallbackPromise.then(() => null, (e: Error) => e.message);
      h.remove();
      return { reason, logged: error.mock.calls.map(msg) };
    } finally {
      document.documentElement.removeAttribute("data-wcs-server");
      error.mockRestore();
    }
  };

  // 3.x #370 は for: の出力フィルタをスナップショットに保ち、フィルタの後のリストを描いた。4.0 は for: のフィルタを
  // 受け付けない: for: items の行は items.<添字> なので、フィルタの後の配列の行は別の要素を指してしまう。以前の 4.0 は
  // フィルタを黙って捨て、フィルタの前のリストを描いた（CSR / SSR とも ["123", "0123", "0723", "23"]）。いまは正本パーサが
  // [wcs/binding-syntax] #121 で拒む（spread の #105 と同じ — lint も同じパーサで報告する。migration-v4 §3.4）。
  // 代わりに、絞り込んだリストを返す getter を for: で回す
  it.each([
    ["CSR", false, "for: items|take(2)"],
    ["サーバーの描画", true, "for: items|take(2)"],
    ["CSR・登録されていないフィルタの名前", false, "for: items|nosuch"],
    ["CSR・行の中の for:", false, "for: .items|take(1)"],
  ] as [string, boolean, string][])("for: のフィルタはバインディングを読む時点で [wcs/binding-syntax] で拒み、黙って捨てない（%s: %s）", async (label, server, bind) => {
    const body = label.includes("行の中")
      ? wrap(`<ul>${T("for: groups", `<li>${T(bind, "<b></b>")}</li>`)}</ul>`)
      : wrap(`<ul>${T(bind, `<li data-wcs="textContent: .n"></li>`)}</ul>`);
    const r = await refusal(body, server);
    expect(r.reason).toBe(`[@wcstack/state] [wcs/binding-syntax] #121 "${bind}"`);
    // the init-failure header (#49) names the element, then the error itself
    expect(r.logged).toEqual([`[@wcstack/state] #49 "wcs-state" ${r.reason}`]);
  });

  // （写しの行への書き込み（firstTwo.1.n）は items の要素に入り、元のパスへの書き込み（items.0.n）は写しの行に届く — F26 の修正）
  it("対照: フィルタで絞り込んだリストを返す getter を for: で回せば、SSR でも CSR と同じに描き、書き込みに追従する", async () => {
    const html = wrap(`<ul>${T("for: firstTwo", `<li data-wcs="textContent: .n"></li>`)}</ul>`);
    const r = await both(html, () => ({
      items: [{ n: 1 }, { n: 2 }, { n: 3 }],
      get firstTwo() { return (this as any).items.slice(0, 2); },
    }), [(s) => { s.items = [{ n: 0 }, ...s.items]; }, set("firstTwo.1.n", 7), set("items.0.n", 5), (s) => { s.items = s.items.slice(2); }], rootView);
    expectViews(r, ["12", "01", "07", "57", "23"]);
  });

  it("バージョン不一致でクライアントが描き直すときも、テンプレートのフィルタを保つ", async () => {
    const html = wrap(`${T("if: x|not", "<b>notX</b>")}${T("else:", "<i>X</i>")}`);
    const s = await play(ssrLoad, html, () => ({ x: false }), [set("x", true), set("x", false)], rootView,
      { edit: (o) => o.replace(/<wcs-ssr version="[^"]*"/, '<wcs-ssr version="99.0.0"') });
    expect(s.views).toEqual(["notX", "X", "notX"]);
    expect(s.errors).toEqual([]);
    expect(s.warns).toEqual([expect.stringContaining('version="99.0.0"')]);
  });
});
