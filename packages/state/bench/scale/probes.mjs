/**
 * The axes of the scale verification (docs/state-engine-rewrite/scale-verification.ja.md §4.3).
 *
 * Plain JS on purpose: the same definitions run in happy-dom from src (bench/scale/scale.test.ts,
 * with the engine's work counted) and in Chromium from dist (bench/scale/browser.mjs, time and
 * heap only). A probe knows nothing about the engine's internals: it builds a page (markup and an
 * initial state) for a size, and names the write it measures.
 *
 *   kind "write"  — per size: mount, then `reps` times (after `warmup`): the untimed `reset`, then
 *                   the timed `write` (one createState("writable") and its drain).
 *   kind "mount"  — per size: the mount itself, `reps` times.
 *   kind "cycles" — one page; `cycle` run untimed until each checkpoint (the sizes), where the
 *                   engine's tables and the heap are read after a GC.
 *   kind "pages"  — a page made and disposed until each checkpoint (the sizes), then the heap.
 *   kind "custom" — `run(env)` returns its own rows and verdict.
 *
 * `expect` (what the verdict checks):
 *   counts: "constant" — every work counter equal at every size; or { counter: (n) => value }
 *   dom:    "constant" — the DOM changes of one write equal at every size; or { added | removed: (n) => value }
 *   k:      the largest acceptable growth exponent of the time (cost ~ n^k)
 *   stats:  "constant" — the engine's tables equal at every checkpoint (cycles)
 */

const range = (n) => Array.from({ length: n }, (_, i) => i);
let tags = 0;
/** A custom element name of its own for each build (a page defines its components again). */
const tagName = (base) => `${base}-${tags++}-${Math.random().toString(36).slice(2, 7)}`;

export const rows = (n, from = 0) => range(n).map((i) => ({ id: from + i, label: `row ${from + i}` }));
const LIST = `<ul><template data-wcs="for: items"><li><span>{{ .id }}</span> <b>{{ .label }}</b></li></template></ul>`;

// ---------------------------------------------------------------- locality

const locality = [
  {
    id: "L1", title: "root のキーとバインディングが N 個: 1 個への書き込み",
    sizes: [100, 1000, 10000], kind: "write", reps: 200,
    build(n) {
      const state = {};
      let html = "";
      for (const i of range(n)) { state["k" + i] = i; html += `<p data-wcs="textContent: k${i}"></p>`; }
      return { html, state };
    },
    write(s, i) { s.k0 = i; },
    expect: { counts: "constant", dom: "constant", k: 0.3 },
  },
  {
    id: "L2", title: "root の一覧が L 個: 一覧と無関係なスカラーへの書き込み",
    sizes: [10, 100, 1000], kind: "write", reps: 200,
    build(n) {
      const state = { x: 0 };
      let html = `<p data-wcs="textContent: x"></p>`;
      for (const i of range(n)) { state["l" + i] = [{ v: i }]; html += `<template data-wcs="for: l${i}"><i>{{ .v }}</i></template>`; }
      return { html, state };
    },
    write(s, i) { s.x = i; },
    expect: { counts: "constant", dom: "constant", k: 0.3 },
  },
  {
    id: "L3a", title: "N 行の一覧: 行と無関係な書き込み",
    sizes: [100, 1000, 10000], kind: "write", reps: 200,
    build(n) { return { html: `<p data-wcs="textContent: title"></p>${LIST}`, state: { title: "", items: rows(n) } }; },
    write(s, i) { s.title = "t" + i; },
    expect: { counts: "constant", dom: "constant", k: 0.3 },
  },
  {
    id: "L3b", title: "N 行の一覧: 1 行の 1 フィールドへの書き込み",
    sizes: [100, 1000, 10000], kind: "write", reps: 200,
    build(n) { return { html: LIST, state: { items: rows(n) } }; },
    write(s, i) { s["items.0.label"] = "l" + i; },
    expect: { counts: "constant", dom: "constant", k: 0.3 },
  },
  {
    id: "L4", title: "無関係な root の getter が G 個: 1 個の getter が読む値への書き込み",
    sizes: [10, 100, 1000], kind: "write", reps: 200,
    build(n) {
      const state = {};
      let html = "";
      for (const i of range(n)) {
        state["x" + i] = i;
        Object.defineProperty(state, "g" + i, { get() { return this["x" + i] * 2; }, enumerable: true, configurable: true });
        html += `<p data-wcs="textContent: g${i}"></p>`;
      }
      return { html, state };
    },
    write(s, i) { s.x0 = i; },
    expect: { counts: "constant", dom: "constant", k: 0.3 },
  },
  {
    id: "L5", title: "入れ子の一覧（外 √N × 内 √N 行）: 葉の 1 フィールドへの書き込み",
    sizes: [100, 2500, 10000], kind: "write", reps: 200,
    build(n) {
      const side = Math.round(Math.sqrt(n));
      const groups = range(side).map((g) => ({ items: range(side).map((i) => ({ v: g * side + i })) }));
      return {
        html: `<template data-wcs="for: groups"><div><template data-wcs="for: .items"><i>{{ .v }}</i></template></div></template>`,
        state: { groups },
      };
    },
    write(s, i) { s["groups.0.items.0.v"] = i; },
    expect: { counts: "constant", dom: "constant", k: 0.3 },
  },
  {
    id: "L6", title: "ボリューム（<wcs-state mount>）が V 個: 1 つのボリュームの値への書き込み",
    sizes: [5, 50, 200], kind: "write", reps: 200,
    build(n) {
      let before = "";
      let html = "";
      for (const i of range(n)) {
        before += `<wcs-state mount="v${i}" json='{"x":${i}}'></wcs-state>`;
        html += `<p data-wcs="textContent: v${i}.x"></p>`;
      }
      return { before, html, state: { title: "" } };
    },
    write(s, i) { s["v0.x"] = i; },
    expect: { counts: "constant", dom: "constant", k: 0.3 },
  },
  {
    id: "L7", title: "bind-component の部品が C 個: 1 つの部品の値への書き込み",
    sizes: [10, 100, 500], kind: "write", reps: 200,
    build(n) {
      const tag = tagName("scale-cmp");
      customElements.define(tag, class extends HTMLElement {
        state = { x: 0 };
        constructor() {
          super();
          this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><b>{{ x }}</b>`;
        }
      });
      return { html: range(n).map(() => `<${tag}></${tag}>`).join(""), state: { title: "" }, ready: tag };
    },
    write(_s, i, _n, page) { page.root.querySelector(page.built.ready).state.x = i; },
    expect: { counts: "constant", dom: "constant", k: 0.3 },
  },
  {
    id: "L8", title: "選択の $eq を読む N 行: 選択の書き込み（前と今の行だけ）",
    sizes: [100, 1000, 10000], kind: "write", reps: 200,
    build(n) {
      return {
        html: `<ul><template data-wcs="for: items"><li data-wcs="class.on: .sel">{{ .label }}</li></template></ul>`,
        state: {
          selected: -1, items: rows(n),
          get "items.*.sel"() { return this.$eq("selected", this["items.*.id"]); },
        },
      };
    },
    write(s, i) { s.selected = i % 50; },
    expect: { counts: "constant", dom: "constant", k: 0.3 },
  },
];

// ---------------------------------------------------------------- linearity

/** A list operation on N rows: `reset` puts the list in place (untimed), `write` is the operation. */
function listOp(id, title, reset, write, expect) {
  return {
    id, title, sizes: [1000, 4000, 16000], kind: "write", reps: 5, warmup: 1,
    build(n) { return { html: LIST, state: { items: rows(n) } }; },
    reset, write,
    expect: { k: 1.25, ...expect },
  };
}

const linearity = [
  {
    id: "N1", title: "root のバインディングが N 個: 初回のマウント",
    sizes: [1000, 4000, 16000], kind: "mount", reps: 3,
    build(n) {
      const state = {};
      let html = "";
      for (const i of range(n)) { state["k" + i] = i; html += `<p data-wcs="textContent: k${i}"></p>`; }
      return { html, state };
    },
    expect: { k: 1.25 },
  },
  // a row's bindings are applied as its block is built (not through applyBinding): the rows built
  // are the DOM nodes added, the rows dropped the engine's rowRemoved, the rows moved its indexChanged
  listOp("N2a", "N 行の一覧: 作成（空から N 行）",
    (s, _i, n) => { s.items = []; return rows(n); }, (s, _i, _n, _p, data) => { s.items = data; },
    { counts: { rowRemoved: () => 0, indexChanged: () => 0 }, dom: { added: (n) => n, removed: () => 0 } }),
  listOp("N2b", "N 行の一覧: 全行の置き換え（新しいオブジェクト）",
    (s, i, n) => { s.items = rows(n, (i + 1) * 1e6); return rows(n, (i + 2) * 1e6); }, (s, _i, _n, _p, data) => { s.items = data; },
    { counts: { rowRemoved: (n) => n, indexChanged: () => 0 }, dom: { added: (n) => n, removed: (n) => n } }),
  listOp("N2c", "N 行の一覧: 全削除",
    (s, _i, n) => { s.items = rows(n); }, (s) => { s.items = []; },
    // (the list is all the <ul> holds: one replaceChildren() takes the rows and puts the anchor back)
    { counts: { rowRemoved: (n) => n }, dom: { added: () => 1, removed: (n) => n + 1 } }),
  listOp("N2d", "N 行の一覧: 末尾への N/10 行の追加",
    (s, _i, n) => { s.items = rows(n); return rows(n / 10, n); }, (s, _i, _n, _p, data) => { s.items = [...s.items, ...data]; },
    { counts: { rowRemoved: () => 0, indexChanged: () => 0 }, dom: { added: (n) => n / 10, removed: () => 0 } }),
  listOp("N2e", "N 行の一覧: 逆順",
    (s, _i, n) => { s.items = rows(n); }, (s) => { s.items = s.items.slice().reverse(); },
    { counts: { rowRemoved: () => 0, indexChanged: (n) => n }, dom: { added: (n) => n - 1, removed: (n) => n - 1 } }),
  listOp("N2f", "N 行の一覧: 2 行の入れ替え（2 番目と最後から 2 番目）",
    (s, _i, n) => { s.items = rows(n); },
    (s) => { const a = s.items.slice(); const t = a[1]; a[1] = a[a.length - 2]; a[a.length - 2] = t; s.items = a; },
    { counts: "constant", dom: "constant" }),
  listOp("N2g", "N 行の一覧: 中ほどの 1 行の削除",
    (s, _i, n) => { s.items = rows(n); }, (s) => { const a = s.items.slice(); a.splice(a.length >> 1, 1); s.items = a; },
    // the rows after it move up one place: their index is bookkeeping in proportion to N
    { counts: { rowRemoved: () => 1, indexChanged: (n) => n / 2 - 1 }, dom: "constant" }),
  {
    id: "N3", title: "0/1 の盤面（平らな一覧、N セル）: 先頭と末尾近くの 2 セルの変更",
    sizes: [10000, 40000, 90000], kind: "write", reps: 10, warmup: 1,
    build(n) {
      let seed = 1;
      const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const cells = range(n).map(() => (rand() < 0.3 ? 1 : 0));
      // the two cells the write flips start (and stay) equal: each write rebuilds their two rows at
      // every size (cells of different values would swap rows instead, as the board's random values say)
      cells[0] = 0;
      cells[n - 2] = 0;
      return { html: `<div><template data-wcs="for: cells"><i>{{ . }}</i></template></div>`, state: { cells } };
    },
    write(s) { const c = s.cells.slice(); c[0] ^= 1; c[c.length - 2] ^= 1; s.cells = c; },
    expect: { counts: "constant", dom: "constant", k: 1.25 },
  },
  {
    id: "N4", title: "1 つの値を読む root の getter が F 個: その値への書き込み",
    sizes: [10, 100, 1000], kind: "write", reps: 50,
    build(n) {
      const state = { x: 0 };
      let html = "";
      for (const i of range(n)) {
        Object.defineProperty(state, "g" + i, { get() { return this.x + i; }, enumerable: true, configurable: true });
        html += `<p data-wcs="textContent: g${i}"></p>`;
      }
      return { html, state };
    },
    write(s, i) { s.x = i; },
    expect: { counts: { evalGetter: (n) => n, applyBinding: (n) => n }, k: 1.25 },
  },
  {
    id: "N5", title: "getter の連鎖が D 段: 根元への書き込み",
    sizes: [10, 40, 120], kind: "write", reps: 100,
    build(n) { return { html: `<p data-wcs="textContent: g${n}"></p>`, state: chain(n) }; },
    write(s, i) { s.x = i; },
    expect: { counts: { evalGetter: (n) => n + 1, applyBinding: () => 1 }, k: 1.25 },
  },
  {
    id: "N6", title: "全行の getter が読む root の値（$eq なし、N 行）: その値への書き込み",
    sizes: [100, 1000, 10000], kind: "write", reps: 20,
    build(n) {
      return {
        html: `<ul><template data-wcs="for: items"><li data-wcs="class.on: .sel">{{ .label }}</li></template></ul>`,
        state: {
          selected: -1, items: rows(n),
          get "items.*.sel"() { return this["items.*.id"] === this.selected; },
        },
      };
    },
    write(s, i) { s.selected = i % 50; },
    expect: { counts: { evalGetter: (n) => n }, k: 1.25 },
  },
  {
    id: "N8", title: "$getAll で N 行を集める getter: 1 行の値への書き込み",
    sizes: [100, 1000, 10000], kind: "write", reps: 50,
    build(n) {
      return {
        html: `<p data-wcs="textContent: total"></p>${LIST}`,
        state: {
          items: rows(n).map((r) => ({ ...r, price: 1 })),
          get total() { return this.$getAll("items.*.price", []).reduce((a, b) => a + b, 0); },
        },
      };
    },
    write(s, i) { s["items.0.price"] = i; },
    expect: { counts: { evalGetter: () => 1, applyBinding: () => 1 }, k: 1.25 },
  },
];

/** `g0` reads `x`, `g<i>` reads `g<i-1>`: a chain of `n + 1` getters. */
export function chain(n) {
  const state = { x: 0 };
  Object.defineProperty(state, "g0", { get() { return this.x; }, enumerable: true, configurable: true });
  for (let i = 1; i <= n; i++) {
    Object.defineProperty(state, "g" + i, { get() { return this["g" + (i - 1)] + 1; }, enumerable: true, configurable: true });
  }
  return state;
}

// ---------------------------------------------------------------- boundedness

const boundedness = [
  {
    id: "B1", title: "root の getter が読む動的なキー（dict.<id>）: id を替え続ける",
    sizes: [1000, 2000, 4000], kind: "cycles",
    build() {
      return {
        html: `<p data-wcs="textContent: view"></p>`,
        state: { dict: { k0: 0 }, cur: "k0", get view() { return this["dict." + this.cur]; } },
      };
    },
    // the data keeps only the current key: what grows is what the engine keeps
    cycle(s, i) { s.dict = { ["k" + i]: i }; s.cur = "k" + i; },
    expect: { stats: "constant" },
  },
  {
    id: "B2", title: "コードから書く動的なキー（log.<id>）: 書き続ける（100 件ごとに空にする）",
    sizes: [1000, 2000, 4000], kind: "cycles",
    build() { return { html: `<p data-wcs="textContent: n"></p>`, state: { n: 0, log: {} } }; },
    cycle(s, i) { if (i % 100 === 0) s.log = {}; s["log.e" + i] = i; },
    expect: { stats: "constant" },
  },
  {
    id: "B3", title: "1,000 行の一覧: 新しいオブジェクトで置き換え続ける",
    sizes: [50, 100, 200], kind: "cycles",
    build() { return { html: LIST, state: { items: rows(1000) } }; },
    cycle(s, i) { s.items = rows(1000, (i + 1) * 1e6); },
    expect: { stats: "constant" },
  },
  {
    id: "B4", title: "if: の出し入れ（100 行の一覧を含む部分木）: 出し入れし続ける",
    sizes: [100, 200, 400], kind: "cycles",
    build() {
      return {
        html: `<template data-wcs="if: show"><section><h2>{{ title }}</h2>${LIST}</section></template>`,
        state: { show: true, title: "t", items: rows(100) },
      };
    },
    cycle(s) { s.show = !s.show; },
    expect: { stats: "constant" },
  },
  {
    id: "B5", title: "bind-component の部品を if: で出し入れし続ける",
    sizes: [100, 200, 400], kind: "cycles",
    build() {
      const tag = tagName("scale-toggle");
      customElements.define(tag, class extends HTMLElement {
        state = { x: 0, items: rows(20) };
        constructor() {
          super();
          this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><b>{{ x }}</b>${LIST}`;
        }
      });
      return { html: `<template data-wcs="if: show"><${tag}></${tag}></template>`, state: { show: true } };
    },
    cycle(s) { s.show = !s.show; },
    expect: { stats: "constant" },
  },
  {
    id: "B6", title: "ページの差し替え（<wcs-state> ごと 200 行のページを作り直す）",
    sizes: [20, 40, 80], kind: "pages",
    build() { return { html: `<p data-wcs="textContent: title"></p>${LIST}`, state: { title: "t", items: rows(200) } }; },
    expect: {},
  },
];

// ---------------------------------------------------------------- limits

const limits = [
  {
    id: "X1", title: "getter の連鎖の上限（128 段の入れ子）",
    kind: "custom",
    async run(env) {
      const out = [];
      for (const d of [126, 127, 128, 200]) {
        const errors = env.captureErrors();
        let text = null;
        let overflow = false;
        try {
          const page = await env.page({ html: `<p data-wcs="textContent: g${d}"></p>`, state: chain(d) });
          text = page.root.querySelector("p").textContent;
          page.dispose();
        } catch (e) {
          overflow = e instanceof RangeError;
        }
        const msgs = errors.stop();
        out.push({ d, text, errors: msgs.length, first: msgs[0]?.slice(0, 120) ?? "", overflow });
      }
      // a chain of d + 1 getters nests d + 1 evaluations: up to 128
      const pass = out.every((r) => !r.overflow && (r.d < 128 ? r.text === String(r.d) && r.errors === 0 : r.errors > 0 && r.text === ""));
      return { rows: out, pass };
    },
  },
  {
    id: "X2", title: "一覧の入れ子の深さ（1 段 1 行）: 描画と葉への書き込み",
    kind: "custom",
    async run(env) {
      const out = [];
      for (const d of [8, 32, 100]) {
        let tpl = `<b>{{ .v }}</b>`;
        for (let k = d - 1; k >= 0; k--) tpl = `<template data-wcs="for: ${k === 0 ? "l" : ".l"}"><div>${tpl}</div></template>`;
        let data = { v: "leaf" };
        for (let k = 0; k < d; k++) data = { l: [data] };
        const errors = env.captureErrors();
        let ok = false;
        let ms = null;
        let overflow = false;
        try {
          const page = await env.page({ html: tpl, state: { l: data.l } });
          const path = ["l", ...range(d - 1).flatMap(() => ["0", "l"]), "0", "v"].join(".");
          ms = await page.timed((s) => { s[path] = "w"; });
          ok = page.root.querySelector("b")?.textContent === "w";
          page.dispose();
        } catch (e) {
          overflow = e instanceof RangeError;
        }
        out.push({ d, ok, ms: ms?.ms ?? null, errors: errors.stop().length, overflow });
      }
      return { rows: out, pass: out.every((r) => r.ok && !r.overflow && r.errors === 0) };
    },
  },
  {
    id: "X3", title: "自己再帰の部品の細長い木（state: . の連鎖）: 描画と葉への書き込み",
    kind: "custom",
    async run(env) {
      const out = [];
      for (const d of [10, 50, 150]) {
        const tag = tagName("scale-tree");
        customElements.define(tag, class extends HTMLElement {
          state = {};
          connectedCallback() {
            const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
            if (root.firstChild === null) {
              root.innerHTML = `<wcs-state bind-component="state"></wcs-state><span class="v">{{ v }}</span>`
                + `<template data-wcs="for: children"><${tag} data-wcs="state: ."></${tag}></template>`;
            }
          }
        });
        let node = { v: "leaf", children: [] };
        for (let k = 0; k < d; k++) node = { v: k, children: [node] };
        const errors = env.captureErrors();
        let ok = false;
        let mount = null;
        let ms = null;
        let overflow = false;
        try {
          const page = await env.page({ html: `<${tag} data-wcs="state: root"></${tag}>`, state: { root: node }, ready: tag });
          mount = page.mountMs;
          const path = ["root", ...range(d).flatMap(() => ["children", "0"]), "v"].join(".");
          ms = await page.timed((s) => { s[path] = "w"; });
          let el = page.root.querySelector(tag);
          for (let k = 0; k < d; k++) el = el.shadowRoot.querySelector(tag);
          ok = el.shadowRoot.querySelector(".v").textContent === "w";
          page.dispose();
        } catch (e) {
          overflow = e instanceof RangeError;
        }
        out.push({ d, ok, mountMs: mount, ms: ms?.ms ?? null, errors: errors.stop().length, overflow });
      }
      return { rows: out, pass: out.every((r) => r.ok && !r.overflow && r.errors === 0) };
    },
  },
];

// ---------------------------------------------------------------- correctness

/**
 * A todo-like state: rows with a nested list, a filtered getter, a `$eq` selection and a count.
 * The same random operations go to the engine (through the proxy) and to a plain model, and after
 * every batch the DOM must read as the model renders.
 */
function correctness(id, n, ops) {
  return {
    id, title: `種を固定したランダムな操作 ${ops} 回（${n} 行）: DOM が参照モデルと一致`,
    kind: "custom",
    async run(env) {
      let seed = 7 + n;
      const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const pick = (k) => Math.floor(rand() * k);
      let next = 0;
      const item = () => ({ id: next++, label: `t${next}`, done: rand() < 0.5, tags: range(pick(3)).map((t) => `g${t}`) });
      const initial = range(n).map(item);
      const clone = (x) => JSON.parse(JSON.stringify(x));
      const model = { items: clone(initial), filter: "all", selected: -1 };
      const page = await env.page({
        html: `<p class="count">{{ remaining }}</p>`
          + `<ul class="all"><template data-wcs="for: items"><li data-wcs="class.done: .done; class.sel: .sel">`
          + `<span>{{ .label }}</span><template data-wcs="for: .tags"><em>{{ . }}</em></template></li></template></ul>`
          + `<ol class="shown"><template data-wcs="for: shown"><li>{{ .label }}</li></template></ol>`,
        state: {
          items: clone(initial), filter: "all", selected: -1,
          // the documented form (migration guide §3): a filter that reads only the array is not evaluated
          // again when a row it does not hold changes; reading every row's `done` makes it follow them all
          get shown() {
            const f = this.filter;
            const done = this.$getAll("items.*.done", []);
            return f === "all" ? this.items : this.items.filter((_t, i) => done[i] === (f === "done"));
          },
          get remaining() { return this.$getAll("items.*.done", []).filter((d) => !d).length; },
          get "items.*.sel"() { return this.$eq("selected", this["items.*.id"]); },
        },
      });
      const expected = () => {
        const shown = model.filter === "all" ? model.items : model.items.filter((t) => t.done === (model.filter === "done"));
        return {
          count: String(model.items.filter((t) => !t.done).length),
          all: model.items.map((t) => `${t.label}|${t.done}|${t.id === model.selected}|${t.tags.join(",")}`),
          shown: shown.map((t) => t.label),
        };
      };
      const actual = () => ({
        count: page.root.querySelector(".count").textContent,
        all: [...page.root.querySelectorAll(".all > li")].map((li) =>
          `${li.querySelector("span").textContent}|${li.classList.contains("done")}|${li.classList.contains("sel")}|${[...li.querySelectorAll("em")].map((e) => e.textContent).join(",")}`),
        shown: [...page.root.querySelectorAll(".shown > li")].map((li) => li.textContent),
      });
      // each op: [apply to the proxy, apply to the model]
      const op = () => {
        const len = model.items.length;
        const k = len > 0 ? pick(len) : 0;
        switch (len === 0 ? 3 : pick(10)) {
          case 0: { const l = `x${pick(1e6)}`; return [(s) => { s[`items.${k}.label`] = l; }, () => { model.items[k].label = l; }, `label ${k}`]; }
          case 1: return [(s) => { s[`items.${k}.done`] = !s[`items.${k}.done`]; }, () => { model.items[k].done = !model.items[k].done; }, `done ${k}`];
          case 2: { if (len > n * 1.5) return op(); const t = item(); const c = clone(t); return [(s) => { const a = s.items.slice(); a.splice(k, 0, t); s.items = a; }, () => { model.items.splice(k, 0, c); }, `insert ${k}`]; }
          case 3: { const t = item(); const c = clone(t); return [(s) => { s.items = [...s.items, t]; }, () => { model.items.push(c); }, "push"]; }
          case 4: return [(s) => { const a = s.items.slice(); a.splice(k, 1); s.items = a; }, () => { model.items.splice(k, 1); }, `remove ${k}`];
          case 5: { const j = pick(len); return [(s) => { const a = s.items.slice(); const [x] = a.splice(k, 1); a.splice(j, 0, x); s.items = a; }, () => { const [x] = model.items.splice(k, 1); model.items.splice(j, 0, x); }, `move ${k}→${j}`]; }
          case 6: { const f = ["all", "done", "active"][pick(3)]; return [(s) => { s.filter = f; }, () => { model.filter = f; }, `filter ${f}`]; }
          case 7: { const id = model.items[k].id; return [(s) => { s.selected = id; }, () => { model.selected = id; }, `select ${id}`]; }
          case 8: { const g = `n${pick(100)}`; return [(s) => { s[`items.${k}.tags`] = [...s[`items.${k}.tags`], g]; }, () => { model.items[k].tags.push(g); }, `tag ${k}`]; }
          default: return [(s) => { s.items = s.items.slice().reverse(); }, () => { model.items.reverse(); }, "reverse"];
        }
      };
      /** Where the DOM first differs from the model: the part, the position, both values. */
      const diff = (a, e) => {
        if (a.count !== e.count) return { part: "count", actual: a.count, expected: e.count };
        for (const part of ["all", "shown"]) {
          const n = Math.max(a[part].length, e[part].length);
          for (let i = 0; i < n; i++) if (a[part][i] !== e[part][i]) return { part, index: i, actual: a[part][i] ?? null, expected: e[part][i] ?? null, lengths: [a[part].length, e[part].length] };
        }
        return null;
      };
      let mismatches = 0;
      let firstMismatch = null;
      const log = [];
      for (let done = 0; done < ops;) {
        const batch = 1 + pick(4);
        // each op is made against the model as the ops before it in the batch left it, and lands on
        // both at once (the engine's writes of the batch drain together)
        await page.write((s) => {
          for (let b = 0; b < batch; b++) {
            const [toEngine, toModel, name] = op();
            toEngine(s);
            toModel();
            log.push(name);
          }
        });
        done += batch;
        const d = diff(actual(), expected());
        if (d !== null) {
          mismatches++;
          firstMismatch ??= { after: done, ops: log.slice(-batch), ...d };
        }
      }
      page.dispose();
      return { rows: [{ n, ops, mismatches, rowsAtEnd: model.items.length }], pass: mismatches === 0, firstMismatch };
    },
  };
}

export const probes = [
  ...locality.map((p) => ({ ...p, property: "locality" })),
  ...linearity.map((p) => ({ ...p, property: "linearity" })),
  ...boundedness.map((p) => ({ ...p, property: "boundedness" })),
  ...limits.map((p) => ({ ...p, property: "limits" })),
  ...[correctness("C1a", 100, 2000), correctness("C1b", 1000, 500)].map((p) => ({ ...p, property: "correctness" })),
];
