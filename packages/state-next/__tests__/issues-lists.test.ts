/**
 * issues-lists.test.ts — 現行 @wcstack/state 3.3 の Issue #359〜#366（リスト・行・要素の書き込み・添字のパス）を
 * state-next で流す。各 Issue の「期待」を確かめる。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes]);
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`tmp-lists-page-${seq++}`);
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
  const read = (path: string) => {
    let v: unknown;
    el.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  return { root, el, write, read };
}

/** A component whose `<wcs-state bind-component="state">` sits in its shadow root. */
function component(markup: string, state: () => Record<string, any>): string {
  const tag = `tmp-lists-cmp-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    state = state();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${markup}`;
    }
  });
  return tag;
}

const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);
const click = async (n: Element) => { (n as HTMLElement).click(); await flush(); await flush(); };

/** Runs `fn`, returning what it threw (or `undefined`). */
const thrown = (fn: () => void): unknown => { try { fn(); return undefined; } catch (e) { return e; } };

// ---------------------------------------------------------------- #359

describe("#359 入れ替えが揃わないうちに前に代入していた配列へ戻しても、行は状態どおりの値を映す", () => {
  const ul = `<ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>`;
  const ids = (s: any) => s.items.map((x: any) => String(x.id));

  it("Issue の手順（前の配列そのものに戻す）", async () => {
    let saved: any;
    const { root, write, el } = await page(ul, { items: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const state = () => { let v: string[] = []; el.createState("readonly", (s: any) => { v = ids(s); }); return v; };
    expect(texts(root, "li")).toEqual(["1", "2", "3"]);
    await write((s) => { saved = s.items; s.items = [...s.items, { id: 4 }]; });
    expect(texts(root, "li")).toEqual(["1", "2", "3", "4"]);
    await write((s) => { s["items.0"] = s["items.2"]; });
    expect(texts(root, "li")).toEqual(["3", "2", "3", "4"]);
    expect(state()).toEqual(["3", "2", "3", "4"]);
    await write((s) => { s.items = saved; });
    expect(state()).toEqual(["1", "2", "3"]);
    expect(texts(root, "li")).toEqual(["1", "2", "3"]);
    await write((s) => { s["items.1"] = { id: 9 }; });
    expect(state()).toEqual(["1", "9", "3"]);
    expect(texts(root, "li")).toEqual(["1", "9", "3"]);
  });

  it("プリミティブの一覧", async () => {
    let saved: any;
    const { root, write, read } = await page(`<ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`, { items: ["a", "b", "c"] });
    await write((s) => { saved = s.items; s.items = [...s.items, "d"]; });
    await write((s) => { s["items.0"] = s["items.2"]; });
    expect(texts(root, "li")).toEqual(["c", "b", "c", "d"]);
    await write((s) => { s.items = saved; });
    expect(read("items")).toEqual(["a", "b", "c"]);
    expect(texts(root, "li")).toEqual(["a", "b", "c"]);
  });

  it.each<[string, (s: any) => void, (s: any, saved: any) => void, (s: any) => void, string[]]>([
    ["控えを取る入れ替えの前半", (s) => { s.items = [...s.items, { id: 4 }]; }, (s) => { const _t = s["items.0"]; s["items.0"] = s["items.2"]; }, () => {}, ["1", "2", "3"]],
    ["step2 と step3 の間で filter を挟む", (s) => { s.items = [...s.items, { id: 4 }]; }, (s) => { s["items.0"] = s["items.2"]; }, (s) => { s.items = s.items.filter((x: any) => x.id !== 2); }, ["1", "2", "3"]],
  ])("同じ結果になる形: %s", async (_name, step1, step2, between, expected) => {
    let saved: any;
    const { root, write, el } = await page(ul, { items: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    await write((s) => { saved = s.items; step1(s); });
    await write((s) => step2(s, saved));
    await write(between);
    await write((s) => { s.items = saved; });
    let st: string[] = [];
    el.createState("readonly", (s: any) => { st = ids(s); });
    expect(st).toEqual(expected);
    expect(texts(root, "li")).toEqual(expected);
  });

  it.each<[string, (s: any) => void, (s: any) => void, (s: any, saved: any) => void]>([
    ["写しで戻す", (s) => { s.items = [...s.items, { id: 4 }]; }, (s) => { s["items.0"] = s["items.2"]; }, (s, saved) => { s.items = [...saved]; }],
    ["入れ替えを揃えてから戻す", (s) => { s.items = [...s.items, { id: 4 }]; }, (s) => { const t = s["items.0"]; s["items.0"] = s["items.2"]; s["items.2"] = t; }, (s, saved) => { s.items = saved; }],
    ["同じ長さの写し", (s) => { s.items = [...s.items]; }, (s) => { s["items.0"] = s["items.2"]; }, (s, saved) => { s.items = saved; }],
  ])("対照: %s", async (_name, step1, step2, step3) => {
    let saved: any;
    const { root, write } = await page(ul, { items: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    await write((s) => { saved = s.items; step1(s); });
    await write(step2);
    await write((s) => step3(s, saved));
    expect(texts(root, "li")).toEqual(["1", "2", "3"]);
  });
});

// ---------------------------------------------------------------- #360

describe("#360 外側の for を並べ替えると、行の中の入れ子のテンプレートに書いた {{ $1 }} も新しい添字になる", () => {
  const shown = (root: ParentNode) => texts(root, "b, i");

  it("内側の for の中の $1（Issue の HTML）", async () => {
    const { root, write } = await page(
      `<template data-wcs="for: groups"><p><b>{{ .n }}{{ $1 }}</b><template data-wcs="for: .items"><i>{{ .id }}:{{ $1 }}</i></template></p></template>`,
      { groups: [{ n: "a", items: [{ id: 1 }, { id: 2 }] }, { n: "b", items: [{ id: 3 }] }] },
    );
    expect(shown(root)).toEqual(["a0", "1:0", "2:0", "b1", "3:1"]);
    await write((s) => { s.groups = [...s.groups].reverse(); });
    expect(shown(root)).toEqual(["b0", "3:0", "a1", "1:1", "2:1"]);
  });

  it("if の中の $1", async () => {
    const { root, write } = await page(
      `<template data-wcs="for: groups"><p><b>{{ .n }}{{ $1 }}</b><template data-wcs="if: .show"><i>{{ .n }}:{{ $1 }}</i></template></p></template>`,
      { groups: [{ n: "a", show: true }, { n: "b", show: true }] },
    );
    expect(shown(root)).toEqual(["a0", "a:0", "b1", "b:1"]);
    await write((s) => { s.groups = [...s.groups].reverse(); });
    expect(shown(root)).toEqual(["b0", "b:0", "a1", "a:1"]);
  });

  const nested = () => ({
    groups: [
      { n: "a", items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      { n: "b", items: [{ id: 4 }, { id: 5 }] },
    ],
    get "groups.*.items.*.pos"() { const self = this as any; return `${self.$1}.${self.$2}`; },
  });

  it("$1 と $2 を並べた形", async () => {
    const { root, write } = await page(
      `<template data-wcs="for: groups"><p><template data-wcs="for: .items"><i>{{ .id }}:{{ $1 }}.{{ $2 }}</i></template></p></template>`, nested(),
    );
    expect(texts(root, "i")).toEqual(["1:0.0", "2:0.1", "3:0.2", "4:1.0", "5:1.1"]);
    await write((s) => { s.groups = [...s.groups].reverse(); });
    expect(texts(root, "i")).toEqual(["4:0.0", "5:0.1", "1:1.0", "2:1.1", "3:1.2"]);
  });

  it("外側の反転と同じバッチで内側の行を入れ替える", async () => {
    const { root, write } = await page(
      `<template data-wcs="for: groups"><p><template data-wcs="for: .items"><i>{{ .id }}:{{ $1 }}.{{ $2 }}</i></template></p></template>`, nested(),
    );
    await write((s) => {
      const t = s["groups.0.items.0"];
      s["groups.0.items.0"] = s["groups.0.items.2"];
      s["groups.0.items.2"] = t;
      s.groups = [...s.groups].reverse();
    });
    expect(texts(root, "i")).toEqual(["4:0.0", "5:0.1", "3:1.0", "2:1.1", "1:1.2"]);
  });

  it("対照: 行 getter で $1.$2 を描く", async () => {
    const { root, write } = await page(
      `<template data-wcs="for: groups"><p><template data-wcs="for: .items"><i>{{ .id }}:{{ .pos }}</i></template></p></template>`, nested(),
    );
    await write((s) => { s.groups = [...s.groups].reverse(); });
    expect(texts(root, "i")).toEqual(["4:0.0", "5:0.1", "1:1.0", "2:1.1", "3:1.2"]);
  });
});

// ---------------------------------------------------------------- #361

describe("#361 入れ替えを 2 つのバッチに分けても、$watch(\"items.*\") は書いた位置で呼ばれる", () => {
  const ul = `<ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>`;
  const setup = async (seen: [number, number][]) => page(ul, {
    items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    $watch: { "items.*"(cur: any, _prev: unknown, i: number) { seen.push([cur.id, i]); } },
  });

  it("Issue の手順（2 つのバッチ）", async () => {
    const seen: [number, number][] = [];
    let t: any;
    const { root, write } = await setup(seen);
    await write((s) => { t = s["items.0"]; s["items.0"] = s["items.2"]; });
    expect(texts(root, "li")).toEqual(["3", "2", "3"]);
    expect(seen).toEqual([[3, 0]]);
    seen.length = 0;
    await write((s) => { s["items.2"] = t; });
    expect(texts(root, "li")).toEqual(["3", "2", "1"]);
    expect(seen).toEqual([[1, 2]]);
  });

  it("対照: 1 つのバッチで入れ替える", async () => {
    const seen: [number, number][] = [];
    const { root, write } = await setup(seen);
    await write((s) => { const t = s["items.0"]; s["items.0"] = s["items.2"]; s["items.2"] = t; });
    expect(texts(root, "li")).toEqual(["3", "2", "1"]);
    expect([...seen].sort((a, b) => a[1] - b[1])).toEqual([[3, 0], [1, 2]]);
  });

  it("対照: リストに無かった値を 2 つのバッチで書く", async () => {
    const seen: [number, number][] = [];
    const { write } = await setup(seen);
    await write((s) => { s["items.0"] = { id: 7 }; });
    expect(seen).toEqual([[7, 0]]);
    await write((s) => { s["items.2"] = { id: 8 }; });
    expect(seen).toEqual([[7, 0], [8, 2]]);
  });
});

// ---------------------------------------------------------------- #362

describe("#362 元の配列をそのまま返す getter を for で描いても、元のパスへの書き込みで行が描き直される", () => {
  const todoState = (toggle: (this: any) => void, shownAll = false) => ({
    filter: "all",
    todos: [{ title: "a", done: false }, { title: "b", done: false }],
    get shown() {
      const self = this as any;
      if (shownAll) return self.todos;
      return self.filter === "all" ? self.todos : self.todos.filter((t: any) => t.done === (self.filter === "done"));
    },
    get left() { return (this as any).$getAll("todos.*.done", []).filter((d: boolean) => !d).length; },
    toggle,
  });
  const html = (list: string) => `<b>{{ left }}</b><ul><template data-wcs="for: ${list}"><li><span>{{ .title }}:{{ .done }}</span><button data-wcs="onclick: toggle">t</button></li></template></ul>`;
  function replaceToggle(this: any) { const i = this.$1; this["todos." + i] = { ...this["todos." + i], done: !this["todos." + i].done }; }
  function leafToggle(this: any) { const i = this.$1; this["todos." + i + ".done"] = !this["todos." + i + ".done"]; }

  /** `left` and the rows, as one string per step. */
  const snap = (root: ParentNode) => `${root.querySelector("b")!.textContent} | ${texts(root, "span").join(",")}`;

  // state-next でも起きていた（F24・F25、2026-09-27 に修正: 同じ配列を持つ一覧は書き込みを互いに届ける）
  it.each<[string, (this: any) => void]>([
    ["要素の差し替え", replaceToggle],
    ["葉の書き込み", leafToggle],
  ])("Issue の手順（%s）", async (_name, toggle) => {
    const { root, write, read } = await page(html("shown"), todoState(toggle));
    const seen = [snap(root)];
    await click(root.querySelectorAll("button")[0]);
    expect(read("todos.0.done")).toBe(true);
    seen.push(snap(root));
    await write((s) => { s.filter = "active"; });
    seen.push(snap(root));
    await write((s) => { s.filter = "all"; });
    seen.push(snap(root));
    expect(seen).toEqual(["2 | a:false,b:false", "1 | a:true,b:false", "1 | b:false", "1 | a:true,b:false"]);
  });

  // state-next でも起きていた（F24・F25、2026-09-27 に修正: 同じ配列を持つ一覧は書き込みを互いに届ける）
  it("簡略形（shown が this.todos だけを返す）で createState から書く", async () => {
    const { root, write } = await page(html("shown"), todoState(replaceToggle, true));
    const seen = [snap(root)];
    await write((s) => { s["todos.0"] = { ...s["todos.0"], done: true }; });
    seen.push(snap(root));
    await write((s) => { s["todos.1.title"] = "B"; });
    seen.push(snap(root));
    expect(seen).toEqual(["2 | a:false,b:false", "1 | a:true,b:false", "1 | a:true,B:false"]);
  });

  // state-next でも起きていた（F24・F25、2026-09-27 に修正: 同じ配列を持つ一覧は書き込みを互いに届ける）
  it("別の行も差し替えてから絞り込みを切り替える", async () => {
    const { root, write } = await page(html("shown"), todoState(replaceToggle));
    await click(root.querySelectorAll("button")[0]);
    await write((s) => { s["todos.1"] = { title: "B", done: false }; });
    const seen = [snap(root)];
    await write((s) => { s.filter = "active"; });
    await write((s) => { s.filter = "all"; });
    seen.push(snap(root));
    expect(seen).toEqual(["1 | a:true,B:false", "1 | a:true,B:false"]);
  });

  it("対照: for: todos で描く", async () => {
    const { root } = await page(html("todos"), todoState(replaceToggle));
    await click(root.querySelectorAll("button")[0]);
    expect(texts(root, "span")).toEqual(["a:true", "b:false"]);
  });
});

// ---------------------------------------------------------------- #363

describe("#363 入れ子の配列を深さ 1 の for で描いても、2 つの数値の添字のパスで読み書きできる", () => {
  const html = `<ul><template data-wcs="for: groups.0.items"><li>{{ .v }}</li></template></ul>`;
  const state = () => ({ groups: [{ items: [{ v: 1 }, { v: 2 }] }] });

  // --- the issue's complaint: reads and writes throw [wcs/wildcard-rank] and do not land
  it.each<[string, (s: any) => void]>([
    ["葉の書き込み", (s) => { s["groups.0.items.1.v"] = 9; }],
    ["要素の書き込み", (s) => { s["groups.0.items.1"] = { v: 9 }; }],
    ["$resolve", (s) => { s.$resolve("groups.*.items.*.v", [0, 1], 9); }],
  ])("読みと %s が投げず、状態に着地する", async (_name, fn) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, el, read } = await page(`${html}<p>{{ groups.0.items.1.v }}</p>`, state());
      let v: unknown;
      expect(thrown(() => { v = read("groups.0.items.1.v"); })).toBeUndefined();
      expect(v).toBe(2);
      const e = thrown(() => el.createState("writable", fn));
      await flush();
      await flush();
      expect(e).toBeUndefined();
      expect(read("groups.0.items.1.v")).toBe(9);
      expect(root.querySelector("p")!.textContent).toBe("9");
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("置換の後の書き込みが投げず、状態に着地する", async () => {
    const { el, write, read } = await page(html, state());
    await write((s) => { s["groups.0.items"] = [{ v: 7 }, { v: 8 }]; });
    const e = thrown(() => el.createState("writable", (s: any) => { s["groups.0.items.1.v"] = 9; }));
    expect(e).toBeUndefined();
    expect(read("groups.0.items.1.v")).toBe(9);
  });

  it("別名の getter（current）: 読み書きが投げず、状態に着地する", async () => {
    const { el, read } = await page(`<ul><template data-wcs="for: current"><li>{{ .t }}</li></template></ul>`, {
      sel: 0,
      tabs: [{ items: [{ t: "a" }, { t: "b" }] }, { items: [{ t: "c" }] }],
      get current() { const self = this as any; return self.tabs[self.sel].items; },
    });
    let v: unknown;
    expect(thrown(() => { v = read("tabs.0.items.1"); })).toBeUndefined();
    expect(v).toEqual({ t: "b" });
    expect(thrown(() => el.createState("writable", (s: any) => { s["tabs.0.items.1"] = { t: "B" }; }))).toBeUndefined();
    expect(read("tabs.0.items.1.t")).toBe("B");
  });

  it("プリミティブの入れ子（for: items.0.tags）: 置換の後の要素の書き込みが投げず、状態に着地する", async () => {
    const { el, write, read } = await page(`<ul><template data-wcs="for: items.0.tags"><li>{{ . }}</li></template></ul>`,
      { items: [{ tags: ["a", "b"] }, { tags: ["c"] }] });
    await write((s) => { s["items.0.tags"] = ["x", "y", "z"]; });
    expect(thrown(() => el.createState("writable", (s: any) => { s["items.0.tags.1"] = "B"; }))).toBeUndefined();
    expect(read("items.0.tags.1")).toBe("B");
  });

  // --- the issue's expected display (表示)
  // state-next でも起きていた（F24・F25、2026-09-27 に修正: 同じ配列を持つ一覧は書き込みを互いに届ける）
  it.each<[string, (s: any) => void]>([
    ["葉の書き込み", (s) => { s["groups.0.items.1.v"] = 9; }],
    ["要素の書き込み", (s) => { s["groups.0.items.1"] = { v: 9 }; }],
    ["$resolve", (s) => { s.$resolve("groups.*.items.*.v", [0, 1], 9); }],
  ])("表示: for: groups.0.items が 1,2 を描き、%s の後 1,9 になる", async (_name, fn) => {
    const { root, write } = await page(html, state());
    const seen = [texts(root, "li").join(",")];
    await write(fn);
    seen.push(texts(root, "li").join(","));
    expect(seen).toEqual(["1,2", "1,9"]);
  });

  // state-next でも起きていた（F24・F25、2026-09-27 に修正: 同じ配列を持つ一覧は書き込みを互いに届ける）
  it("表示: 置換の後の書き込み（7,8 → 7,9）", async () => {
    const { root, write } = await page(html, state());
    await write((s) => { s["groups.0.items"] = [{ v: 7 }, { v: 8 }]; });
    const seen = [texts(root, "li").join(",")];
    await write((s) => { s["groups.0.items.1.v"] = 9; });
    seen.push(texts(root, "li").join(","));
    expect(seen).toEqual(["7,8", "7,9"]);
  });

  // state-next でも起きていた（F24・F25、2026-09-27 に修正: 同じ配列を持つ一覧は書き込みを互いに届ける）
  it("表示: 別名の getter（for: current）で a,b → a,B", async () => {
    const { root, write } = await page(`<ul><template data-wcs="for: current"><li>{{ .t }}</li></template></ul>`, {
      sel: 0,
      tabs: [{ items: [{ t: "a" }, { t: "b" }] }, { items: [{ t: "c" }] }],
      get current() { const self = this as any; return self.tabs[self.sel].items; },
    });
    const seen = [texts(root, "li").join(",")];
    await write((s) => { s["tabs.0.items.1"] = { t: "B" }; });
    seen.push(texts(root, "li").join(","));
    expect(seen).toEqual(["a,b", "a,B"]);
  });

  // state-next でも起きていた（F24・F25、2026-09-27 に修正: 同じ配列を持つ一覧は書き込みを互いに届ける）
  it("表示: プリミティブの入れ子（for: items.0.tags）で a,b → x,y,z → x,B,z", async () => {
    const { root, write } = await page(`<ul><template data-wcs="for: items.0.tags"><li>{{ . }}</li></template></ul>`,
      { items: [{ tags: ["a", "b"] }, { tags: ["c"] }] });
    const seen = [texts(root, "li").join(",")];
    await write((s) => { s["items.0.tags"] = ["x", "y", "z"]; });
    seen.push(texts(root, "li").join(","));
    await write((s) => { s["items.0.tags.1"] = "B"; });
    seen.push(texts(root, "li").join(","));
    expect(seen).toEqual(["a,b", "x,y,z", "x,B,z"]);
  });

  it("対照: 外側から入れ子で描く（行の要素で包む）", async () => {
    const { root, write, read } = await page(`<ul><template data-wcs="for: groups"><li><template data-wcs="for: .items"><i>{{ .v }}</i></template></li></template></ul>`, state());
    await write((s) => { s["groups.0.items.1.v"] = 9; });
    expect(texts(root, "i")).toEqual(["1", "9"]);
    expect(read("groups.0.items.1.v")).toBe(9);
  });

  it("対照: 外側から入れ子で描く（Issue の HTML そのまま — 行のテンプレートの中身が内側の template だけ）", async () => {
    let error: unknown;
    let root: ShadowRoot | undefined;
    try {
      ({ root } = await page(`<ul><template data-wcs="for: groups"><template data-wcs="for: .items"><li>{{ .v }}</li></template></template></ul>`, state()));
    } catch (e) {
      error = e;
    }
    expect(String(error ?? "")).toBe("");
    expect(texts(root!, "li")).toEqual(["1", "2"]);
  });
});

// ---------------------------------------------------------------- #364

describe("#364 行の中で子のパスを描く for が無くても、要素の書き込み・$postUpdate が子のパスとそれを読む getter に届く", () => {
  describe("形 A（同じオブジェクトをその場で書き換えて知らせる）", () => {
    it.each<[string, string, (this: any) => void]>([
      ["要素へ同じオブジェクトを書く", "", function (this: any) { const it = this["items.0"]; it.name = "z"; this["items.0"] = it; }],
      ["$postUpdate(\"items.0\")", "", function (this: any) { const it = this["items.0"]; it.name = "z"; this.$postUpdate("items.0"); }],
      ["$postUpdate(\"items\")", "", function (this: any) { const it = this["items.0"]; it.name = "z"; this.$postUpdate("items"); }],
      ["$resolve(\"items.*\", [0], it)", "", function (this: any) { const it = this["items.0"]; it.name = "z"; this.$resolve("items.*", [0], it); }],
      ["行の中で .name を描かない for を足す", `<ul><template data-wcs="for: items"><li>row</li></template></ul>`, function (this: any) { const it = this["items.0"]; it.name = "z"; this["items.0"] = it; }],
    ])("%s", async (_name, extra, rename) => {
      const { root, read } = await page(`<p>{{ items.0.name }}</p><i class="f">{{ first }}</i><i class="all">{{ all }}</i><button data-wcs="onclick: rename">r</button>${extra}`, {
        items: [{ name: "a" }, { name: "b" }],
        get first() { return (this as any)["items.0.name"]; },
        get all() { return (this as any).$getAll("items.*.name", []).join(","); },
        rename,
      });
      expect(root.querySelector("p")!.textContent).toBe("a");
      await click(root.querySelector("button")!);
      expect(read("items.0.name")).toBe("z");
      expect(root.querySelector("p")!.textContent).toBe("z");
      expect(root.querySelector(".f")!.textContent).toBe("z");
      expect(root.querySelector(".all")!.textContent).toBe("z,b");
    });

    it("対照: リストでないオブジェクト", async () => {
      const { root, read } = await page(`<p>{{ user.name }}</p><button data-wcs="onclick: rename">r</button>`, {
        user: { name: "a" },
        rename(this: any) { const u = this.user; u.name = "z"; this.user = u; },
      });
      await click(root.querySelector("button")!);
      expect(read("user.name")).toBe("z");
      expect(root.querySelector("p")!.textContent).toBe("z");
    });

    it("参考: 知らせないその場の書き換えは描き直さない（上の形が「知らせ」を確かめていることの確認）", async () => {
      const { root, write, read } = await page(`<p>{{ items.0.name }}</p>`, { items: [{ name: "a" }, { name: "b" }] });
      await write((s) => { const it = s["items.0"]; it.name = "z"; });
      expect(read("items.0.name")).toBe("z");
      expect(root.querySelector("p")!.textContent).toBe("a");
    });
  });

  describe("形 B（新しいオブジェクトに差し替える）", () => {
    it.each<[string, string]>([
      ["{{ all }} が先", `<p class="all">{{ all }}</p><p class="first">{{ first }}</p>`],
      ["{{ all }} が先・行の中で .name を描かない for", `<p class="all">{{ all }}</p><p class="first">{{ first }}</p><ul><template data-wcs="for: items"><li>row</li></template></ul>`],
      ["対照: {{ first }} が先", `<p class="first">{{ first }}</p><p class="all">{{ all }}</p>`],
    ])("%s", async (_name, html) => {
      const { root, write, read } = await page(html, {
        items: [{ name: "a" }, { name: "b" }],
        get all() { return (this as any).$getAll("items.*.name", []).join(","); },
        get first() { return (this as any)["items.0.name"]; },
      });
      expect(root.querySelector(".first")!.textContent).toBe("a");
      await write((s) => { s["items.0"] = { name: "z" }; });
      expect(root.querySelector(".all")!.textContent).toBe("z,b");
      expect(read("items.0.name")).toBe("z");
      expect(read("first")).toBe("z");
      expect(root.querySelector(".first")!.textContent).toBe("z");
    });

    it("行マウントの形（x-row の firstTag）", async () => {
      const tag = component(`<i>{{ firstTag }}</i><button data-wcs="onclick: ren">r</button>`, () => ({
        get firstTag() { return (this as any)["tags.0.t"]; },
        ren(this: any) { this["tags.0"] = { t: this["tags.0.t"] + "!" }; },
      }));
      const { root, write } = await page(`<b>{{ allTags }}</b><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template>`, {
        users: [{ tags: [{ t: "x" }, { t: "y" }] }, { tags: [{ t: "p" }] }],
        get allTags() { return (this as any).$getAll("users.*.tags.*.t", []).join(","); },
      });
      const rows = () => Array.from(root.querySelectorAll(tag)) as any[];
      const firstTags = () => rows().map((c) => c.shadowRoot.querySelector("i").textContent);
      expect(root.querySelector("b")!.textContent).toBe("x,y,p");
      expect(firstTags()).toEqual(["x", "p"]);
      await click(rows()[0].shadowRoot.querySelector("button"));
      expect(root.querySelector("b")!.textContent).toBe("x!,y,p");
      expect(firstTags()).toEqual(["x!", "p"]);
      // the component's public surface
      rows()[0].state.ren();
      await flush();
      await flush();
      expect(root.querySelector("b")!.textContent).toBe("x!!,y,p");
      expect(firstTags()).toEqual(["x!!", "p"]);
      // the host's element write
      await write((s) => { s["users.1.tags.0"] = { t: "P" }; });
      expect(root.querySelector("b")!.textContent).toBe("x!!,y,P");
      expect(firstTags()).toEqual(["x!!", "P"]);
    });
  });
});

// ---------------------------------------------------------------- #365

describe("#365 同じオブジェクトをリストの 2 つの行に置いても、片方の行への葉の書き込みがもう片方の行に届く", () => {
  const state = () => {
    const o = { name: "a" };
    return { items: [o, o, { name: "c" }], rename(this: any) { this["items.0.name"] = "z"; } };
  };

  // 4.0 の既知の制限（F26）: 同じオブジェクトを 1 つの一覧の 2 つの行に置くと、片方の行への書き込みはもう片方の行の束縛に届かない。it.fails で症状を残す
  it.fails("Issue の手順（for で描く）", async () => {
    const { root, write, read } = await page(`<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>`, state());
    expect(texts(root, "li")).toEqual(["a", "a", "c"]);
    await write((s) => { s.rename(); });
    expect(read("items.0.name")).toBe("z");
    expect(read("items.1.name")).toBe("z");
    const seen = [texts(root, "li").join(",")];
    // a later write elsewhere does not repair row 1 either
    await write((s) => { s["items.2.name"] = "C"; });
    seen.push(texts(root, "li").join(","));
    expect(seen).toEqual(["z,z,c", "z,z,C"]);
  });

  // 4.0 の既知の制限（F26）: 同じオブジェクトを 1 つの一覧の 2 つの行に置くと、片方の行への書き込みはもう片方の行の束縛に届かない。it.fails で症状を残す
  it.fails("for で描き、行の中で読む getter（items.*.label）", async () => {
    const { root, write } = await page(`<ul><template data-wcs="for: items"><li>{{ .label }}</li></template></ul>`,
      { ...state(), get "items.*.label"() { return `[${(this as any)["items.*.name"]}]`; } });
    await write((s) => { s.rename(); });
    expect(texts(root, "li")).toEqual(["[z]", "[z]", "[c]"]);
  });

  it("for を描かず添字のパスを描く", async () => {
    const { root, write, read } = await page(`<p>{{ items.0.name }}</p><p>{{ items.1.name }}</p>`, state());
    await write((s) => { s.rename(); });
    expect(texts(root, "p")).toEqual(["z", "z"]);
    expect(read("items.1.name")).toBe("z");
  });

  it("何も描かず、先に items.1.name を読んでから書く", async () => {
    const { write, read } = await page("", state());
    expect(read("items.1.name")).toBe("a");
    await write((s) => { s.rename(); });
    expect(read("items.1.name")).toBe("z");
  });

  it("$getAll の getter", async () => {
    const { root, write } = await page(`<p>{{ all }}</p>`, { ...state(), get all() { return (this as any).$getAll("items.*.name", []).join("/"); } });
    expect(root.querySelector("p")!.textContent).toBe("a/a/c");
    await write((s) => { s.rename(); });
    expect(root.querySelector("p")!.textContent).toBe("z/z/c");
  });
});

// ---------------------------------------------------------------- #366

describe("#366 $eq の path に数値の添字を書いても、要素の差し替えと葉の書き込みに追従する", () => {
  const base = () => ({
    items: [{ v: "a" }, { v: "c" }],
    sel: { id: "a" },
    get isB() { return (this as any).$eq("items.0.v", "b") ? "Y" : "n"; },
    get selB() { return (this as any).$eq("sel.id", "b") ? "Y" : "n"; },
  });

  it.each<[string, string]>([
    ["Issue の HTML", ""],
    ["行の中で .v を描く for を足す", `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`],
    ["行の中で .v を描かない for を足す", `<ul><template data-wcs="for: items"><li>row</li></template></ul>`],
    ["対照: {{ items.0.v }} を足す", `<p class="v">{{ items.0.v }}</p>`],
  ])("%s", async (_name, extra) => {
    const { root, write, read } = await page(`<p class="isB">{{ isB }}</p><p class="selB">{{ selB }}</p>${extra}`, base());
    const shown = () => [root.querySelector(".isB")!.textContent, read("isB"), root.querySelector(".selB")!.textContent];
    expect(shown()).toEqual(["n", "n", "n"]);
    await write((s) => { s["items.0"] = { v: "b" }; });
    expect(shown()).toEqual(["Y", "Y", "n"]);
    await write((s) => { s["items.0"] = { v: "a" }; });
    expect(shown()).toEqual(["n", "n", "n"]);
    await write((s) => { s["items.0.v"] = "b"; });
    expect(shown()).toEqual(["Y", "Y", "n"]);
    await write((s) => { s["items.0.v"] = "a"; });
    expect(shown()).toEqual(["n", "n", "n"]);
    await write((s) => { s.sel = { id: "b" }; });
    expect(shown()).toEqual(["n", "n", "Y"]);
  });

  it("プリミティブの一覧（$eq(\"items.0\", \"b\")）", async () => {
    const { root, write, read } = await page(`<p>{{ isB }}</p>`, {
      items: ["a", "c"],
      get isB() { return (this as any).$eq("items.0", "b") ? "Y" : "n"; },
    });
    expect(root.querySelector("p")!.textContent).toBe("n");
    await write((s) => { s["items.0"] = "b"; });
    expect(root.querySelector("p")!.textContent).toBe("Y");
    expect(read("isB")).toBe("Y");
    await write((s) => { s["items.0"] = "a"; });
    expect(root.querySelector("p")!.textContent).toBe("n");
  });
});
