/**
 * regression-3x-index-path.test.ts — @wcstack/state 3.4.0 で直した数値添字のパスの修正（#324・#332・#388・#366）が、
 * 4.0 のエンジン（state-next）でも成り立つかを確かめる。
 *
 * 3.x の回帰テスト（packages/state/__tests__ の integration.directIndexUnrenderedList / markupIndexPath /
 * keyedNumericIndexPath と、修正時に書き換えた pathDiagnostics・proxy.apis.resolve・proxy.getListIndex・
 * integration.recursion* の #324 の部分）から、観測できる形（DOM の表示・状態の値・$watch の呼び出し・
 * console の警告とエラー）だけを移す。3.x の内部（ListIndex の台帳・getterPaths・elementPaths）には触れない。
 *
 * すでに state-next にある形は移さない（issues.test.ts の #324・#332、fixes.test.ts の F17、
 * fixes-diagnostics.test.ts の F17、issues2-paths.test.ts の #382・#388・F34、issues-lists.test.ts の #366）。
 * 4.0 で意図して変えた点は docs/migration-v4.md §3.4 に従う（要素の書き込みは位置の値を差し替える、
 * 数値添字の $watch のキーはその位置の値が変わったときだけ発火する）。
 */
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes, temporal, diagnostics } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes, diagnostics]);
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`regression-3x-index-path-page-${seq++}`);
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
  /** Reads through the readonly proxy with any expression. */
  const get = (fn: (s: any) => unknown) => {
    let v: unknown;
    el.createState("readonly", (s: any) => { v = fn(s); });
    return v;
  };
  return { root, el, write, read, get, host: h };
}

/** A component whose `<wcs-state bind-component="state">` sits in its shadow root. */
function component(markup: string, state: () => Record<string, any>): string {
  const tag = `regression-3x-index-path-cmp-${seq++}`;
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
const text = (c: ParentNode, sel: string) => c.querySelector(sel)!.textContent;
/** Runs `fn`, returning what it threw (or `undefined`). */
const thrown = (fn: () => void): unknown => { try { fn(); return undefined; } catch (e) { return e; } };
/** console.error / console.warn の呼び出しを文字列にして集める。 */
function spyConsole(kind: "error" | "warn") {
  const calls: string[] = [];
  vi.spyOn(console, kind).mockImplementation((...a: unknown[]) => {
    calls.push(a.map((x) => (x instanceof Error ? `${x.message}` : String(x))).join(" "));
  });
  return calls;
}
/** console.error と console.warn をまとめて集める。 */
function spyBoth() {
  const errors = spyConsole("error");
  const warns = spyConsole("warn");
  return { errors, warns, all: () => [...errors, ...warns] };
}
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ================================================================ #324

describe("#324 for で描いていないリストの行を添字のパスで読み書きする（修正の形）", () => {
  it("要素がプリミティブのリストでも、要素のパス（items.0）で読み書きできる", async () => {
    const { el, get } = await page("", { items: [1, 2] });
    expect(thrown(() => el.createState("writable", (s: any) => { s["items.0"] += 1; }))).toBeUndefined();
    expect(get((s) => [...s.items])).toEqual([2, 2]);
    expect(thrown(() => el.createState("writable", (s: any) => { s["items.0"] = s.items[0] + 1; }))).toBeUndefined();
    expect(get((s) => [...s.items])).toEqual([3, 2]);
    expect(get((s) => s["items.0"])).toBe(3);
  });

  it("描いていないリストの要素のパス（items.0）の読みは要素そのもの、差し替えは位置の値になる", async () => {
    const { write, get } = await page(`<span>{{ items.length }}</span>`, { items: [{ v: 1 }, { v: 2 }] });
    await write((s) => { s["items.0.v"] = 5; });
    expect(get((s) => s["items.0"])).toEqual({ v: 5 });
    await write((s) => { s["items.1"] = { v: 9 }; });
    expect(get((s) => s["items.1.v"])).toBe(9);
    expect(get((s) => s.$getAll("items.*.v", []))).toEqual([5, 9]);
  });

  it("対照: 両方を for で描くとき、添字のパスの書き込みが描画に届く", async () => {
    const { root, write, read } = await page(
      `<template data-wcs="for: groups"><template data-wcs="for: .items"><i class="v">{{ .v }}</i></template></template>`,
      { groups: [{ name: "g0", items: [{ v: 1 }, { v: 2 }] }, { name: "g1", items: [{ v: 3 }] }] },
    );
    expect(read("groups.0.items.0.v")).toBe(1);
    await write((s) => { s["groups.0.items.0.v"] = 5; });
    expect(texts(root, ".v")).toEqual(["5", "2", "3"]);
  });

  it("描いていないリストの行への書き込みが $watch（items.*.v）に届く", async () => {
    const log: unknown[][] = [];
    const { write } = await page("", {
      items: [{ v: 1 }, { v: 2 }],
      $watch: { "items.*.v"(cur: unknown, prev: unknown, i: unknown) { log.push([cur, prev, i]); } },
    });
    await write((s) => { s["items.0.v"] = 5; });
    expect(log).toEqual([[5, 1, 0]]);
  });

  it("走査を経ていないリストへの $resolve で読み書きできる（入れ子も）", async () => {
    const { el, get } = await page("", {
      items: [{ v: 1 }, { v: 2 }],
      groups: [{ name: "g0", items: [{ v: 1 }, { v: 2 }] }, { name: "g1", items: [{ v: 3 }] }],
    });
    expect(get((s) => s.$resolve("items.*.v", [1]))).toBe(2);
    expect(thrown(() => el.createState("writable", (s: any) => { s.$resolve("items.*.v", [0], 5); }))).toBeUndefined();
    expect(get((s) => s["items.0.v"])).toBe(5);
    expect(get((s) => s.$resolve("groups.*.items.*.v", [1, 0]))).toBe(3);
    el.createState("writable", (s: any) => { s.$resolve("groups.*.items.*.v", [1, 0], 33); });
    expect(get((s) => s["groups.1.items.0.v"])).toBe(33);
  });

  it("$postUpdate(\"items.0.v\") が投げず、データを直接変えた値を getter に読み直させる", async () => {
    const items = [{ v: 1 }, { v: 2 }];
    const { root, el } = await page(`<span class="f">{{ first }}</span>`, {
      items,
      get first() { return (this as any)["items.0.v"]; },
    });
    expect(text(root, ".f")).toBe("1");
    items[0].v = 9; // the proxy does not see it
    expect(thrown(() => el.createState("writable", (s: any) => { s.$postUpdate("items.0.v"); }))).toBeUndefined();
    await flush();
    await flush();
    expect(text(root, ".f")).toBe("9");
  });

  it("描いていないリストに添字で書いた後で for が描き始めると、書いた値で描き、その後の書き込み・$resolve・並べ替えに追従する", async () => {
    const { root, write } = await page(
      `<template data-wcs="if: show"><template data-wcs="for: items"><i class="v">{{ .v }}</i></template></template>`,
      { show: false, items: [{ v: 1 }, { v: 2 }] },
    );
    await write((s) => { s["items.0.v"] = 5; });
    await write((s) => { s.show = true; });
    expect(texts(root, ".v")).toEqual(["5", "2"]);
    await write((s) => { s["items.1.v"] = 6; s.$resolve("items.*.v", [0], 7); });
    expect(texts(root, ".v")).toEqual(["7", "6"]);
    await write((s) => { s.items = [...s.items].reverse(); });
    expect(texts(root, ".v")).toEqual(["6", "7"]);
    await write((s) => { s["items.0.v"] = 60; });
    expect(texts(root, ".v")).toEqual(["60", "7"]);
  });

  it("入れ子: groups を描いたまま groups.*.items を後から描くと、先に書いた値で描く", async () => {
    const { root, write } = await page(
      `<template data-wcs="for: groups"><b>{{ .name }}</b><template data-wcs="if: show"><template data-wcs="for: .items"><i class="v">{{ .v }}</i></template></template></template>`,
      { show: false, groups: [{ name: "g0", items: [{ v: 1 }, { v: 2 }] }, { name: "g1", items: [{ v: 3 }] }] },
    );
    await write((s) => { s["groups.1.items.0.v"] = 30; });
    await write((s) => { s.show = true; });
    expect(texts(root, ".v")).toEqual(["1", "2", "30"]);
    await write((s) => { s["groups.0.items.1.v"] = 20; });
    expect(texts(root, ".v")).toEqual(["1", "20", "30"]);
  });

  it("$getAll で読んだリストを中身の同じ写しに置き換えた後でも、添字の書き込みが $getAll と添字の読みに見える", async () => {
    const { write, get } = await page("", { items: [{ v: 1 }, { v: 2 }] });
    expect(get((s) => s.$getAll("items.*.v", []))).toEqual([1, 2]);
    await write((s) => { s.items = [...s.items]; });
    await write((s) => { s["items.0.v"] = 5; });
    expect(get((s) => s.$getAll("items.*.v", []))).toEqual([5, 2]);
    expect(get((s) => s["items.0.v"])).toBe(5);
  });

  it("配列を丸ごと置き換えた後でも添字で読み書きでき、$getAll と一致する", async () => {
    const { write, get } = await page("", { items: [{ v: 1 }, { v: 2 }] });
    await write((s) => { s["items.0.v"] = 5; });
    expect(get((s) => s.$getAll("items.*.v", []))).toEqual([5, 2]);
    await write((s) => { s.items = [{ v: 7 }, ...s.items]; });
    await write((s) => { s["items.2.v"] = 22; });
    expect(get((s) => s.items.map((x: any) => x.v))).toEqual([7, 5, 22]);
    expect(get((s) => [s["items.0.v"], s["items.1.v"], s["items.2.v"]])).toEqual([7, 5, 22]);
    expect(get((s) => s.$getAll("items.*.v", []))).toEqual([7, 5, 22]);
  });

  it("$setAll の後に置き換えた配列でも添字で読み書きできる", async () => {
    const { el, write, get } = await page("", { items: [{ v: 1 }, { v: 2 }] });
    let written = 0;
    el.createState("writable", (s: any) => { written = s.$setAll("items.*.v", [], 3); });
    expect(written).toBe(2);
    await write((s) => { s.items = [{ v: 10 }, { v: 20 }]; });
    expect(get((s) => s["items.0.v"])).toBe(10);
    await write((s) => { s["items.0.v"] = 11; });
    expect(get((s) => s.items[0].v)).toBe(11);
  });

  describe("最上位の getter が添字のパスを読む", () => {
    const state = () => ({ items: [{ v: 1 }, { v: 2 }], get first() { return (this as any)["items.0.v"]; } });

    it("for より前に置いた束縛が初期表示し、書き込み・$resolve・配列の置き換えに追従する（エラー無し）", async () => {
      const errors = spyConsole("error");
      const { root, write } = await page(
        `<span class="f">{{ first }}</span><template data-wcs="for: items"><i class="v">{{ .v }}</i></template>`,
        state(),
      );
      expect(text(root, ".f")).toBe("1");
      expect(texts(root, ".v")).toEqual(["1", "2"]);
      await write((s) => { s["items.0.v"] = 42; });
      expect(text(root, ".f")).toBe("42");
      expect(texts(root, ".v")).toEqual(["42", "2"]);
      await write((s) => { s.$resolve("items.*.v", [0], 43); });
      expect(text(root, ".f")).toBe("43");
      await write((s) => { s.items = [{ v: 100 }, ...s.items]; });
      expect(text(root, ".f")).toBe("100");
      expect(texts(root, ".v")).toEqual(["100", "43", "2"]);
      expect(errors).toEqual([]);
    });

    it("for が無くても表示し、書き込み・配列の置き換えに追従する", async () => {
      const { root, write } = await page(`<span class="f">{{ first }}</span>`, state());
      expect(text(root, ".f")).toBe("1");
      await write((s) => { s["items.0.v"] = 9; });
      expect(text(root, ".f")).toBe("9");
      await write((s) => { s.items = [{ v: 100 }]; });
      expect(text(root, ".f")).toBe("100");
      await write((s) => { s["items.0.v"] = 101; });
      expect(text(root, ".f")).toBe("101");
    });
  });

  describe("行が無い添字（描いていないリストでも）", () => {
    // 3.x は読みも書きも `ListIndex not found at index <i> of <list>` で投げる。4.0 は書き込みを `no row for "<行のパス>"`
    // で拒み（データは変わらない）、読みは行が無いので undefined を返す（state-next の設計: coverage-engine.test.ts の
    // 「範囲外の添字も行が無いので undefined」。docs/migration-v4.md §3.4 Smaller differences）
    it("範囲外の添字: 書き込み（直接・$resolve）は no row で投げてデータを変えず、読みは undefined", async () => {
      const { el, get } = await page("", { items: [{ v: 1 }, { v: 2 }] });
      const direct = thrown(() => el.createState("writable", (s: any) => { s["items.5.v"] = 1; }));
      const viaResolve = thrown(() => el.createState("writable", (s: any) => { s.$resolve("items.*.v", [5], 1); }));
      expect(errorMessage(direct)).toContain('no row for "items.*.v"');
      expect(errorMessage(viaResolve)).toContain('no row for "items.*.v"');
      expect(get((s) => s.items.map((x: any) => x.v))).toEqual([1, 2]);
      expect(get((s) => s["items.5.v"])).toBeUndefined();
      expect(get((s) => s.$resolve("items.*.v", [5]))).toBeUndefined();
    });

    it("配列でない値（null・文字列）と空配列は行が 1 つも無い: 書き込みは投げ、読みは undefined（文字列の 1 文字を返さない）", async () => {
      const { el, get } = await page("", { items: null, text: "abc", empty: [] as unknown[] });
      expect(errorMessage(thrown(() => el.createState("writable", (s: any) => { s["items.0.v"] = 1; })))).toContain('no row for "items.*.v"');
      expect(get((s) => s.items)).toBeNull();
      expect(get((s) => s["items.0.v"])).toBeUndefined();
      expect(get((s) => s.$resolve("items.*.v", [0]))).toBeUndefined();
      expect(get((s) => s["text.0"])).toBeUndefined();
      expect(get((s) => s["empty.0"])).toBeUndefined();
    });

    it("入れ子の段が配列でない（undefined）とき: 読みは undefined、書き込みは投げる", async () => {
      const { el, get } = await page("", { groups: [{ name: "g0" }] });
      expect(get((s) => s["groups.0.items.0.v"])).toBeUndefined();
      expect(get((s) => s.$resolve("groups.*.items.*.v", [0, 0]))).toBeUndefined();
      expect(errorMessage(thrown(() => el.createState("writable", (s: any) => { s["groups.0.items.0.v"] = 1; })))).toContain('no row for "groups.*.items.*.v"');
    });
  });

  describe("添字で触れた後にリストを写し替えても、後から描いた行の集計が葉の書き込みに追従する", () => {
    const MARKUP = `<template data-wcs="if: show"><template data-wcs="for: groups">`
      + `<b class="t">{{ .total }}</b>`
      + `<template data-wcs="for: .items"><i class="v">{{ .v }}</i></template></template></template>`;
    const init = () => ({
      show: false,
      groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }] }],
      get "groups.*.total"() { return (this as any).$getAll("groups.*.items.*.v").reduce((a: number, b: number) => a + b, 0); },
    });
    const touches: [string, (s: any) => void, number][] = [
      ["読むだけ", (s) => { void s["groups.0.items.0.v"]; }, 1],
      ["書き込み", (s) => { s["groups.0.items.0.v"] = 10; }, 10],
      ["$resolve の読み", (s) => { void s.$resolve("groups.*.items.*.v", [0, 0]); }, 1],
    ];
    const copies: [string, (s: any) => void][] = [
      ["map で写す", (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); }],
      ["slice で写す", (s) => { s.groups = [...s.groups]; }],
    ];
    const cases = touches.flatMap(([t, touch, first]) => copies.map(([c, copy]) => [`${t} → ${c}`, touch, copy, first] as const));

    it.each(cases)("%s → 表示 → 葉の書き込み", async (_label, touch, copy, first) => {
      const { root, el, write } = await page(MARKUP, init());
      el.createState("writable", touch);
      await write(copy);
      await write((s) => { s.show = true; });
      expect(texts(root, ".t")).toEqual([String(first + 2), "3"]);
      await write((s) => { s["groups.0.items.1.v"] = 50; });
      expect(texts(root, ".t")).toEqual([String(first + 50), "3"]);
      expect(texts(root, ".v")).toEqual([String(first), "50", "3"]);
    });
  });

  describe("走査を経ていない入れ子の木（3.x の integration.recursion* の #324 の部分）", () => {
    // 3 段の木（for も $getAll も無い）
    const tree = () => ({
      nodes: [
        { value: 1, children: [{ value: 10, children: [{ value: 100 }] }, { value: 20, children: [] }] },
        { value: 2, children: [] },
      ],
    });
    const DEEP = "nodes.*.children.*.children.*.value";
    const leaves = (get: (fn: (s: any) => unknown) => unknown) => get((s) => s.$getAll(DEEP, []));

    it("最初の操作が深い $resolve の書き込みでも書け、その後の $getAll が新しい値を返す", async () => {
      const { el, get } = await page("", tree());
      expect(thrown(() => el.createState("writable", (s: any) => { s.$resolve(DEEP, [0, 0, 0], 500); }))).toBeUndefined();
      await flush();
      expect(leaves(get)).toEqual([500]);
      expect(get((s) => s["nodes.0.children.0.children.0.value"])).toBe(500);
    });

    it("最初の操作が $resolve の読み（深さ 2・1 段）でも読め、続く $getAll と $resolve が同じ値を返す", async () => {
      const { get } = await page("", tree());
      expect(get((s) => s.$resolve("nodes.*.children.*.value", [0, 1]))).toBe(20);
      expect(get((s) => s.$resolve("nodes.*.value", [1]))).toBe(2);
      expect(get((s) => s.$getAll("nodes.*.children.*.value", []))).toEqual([10, 20]);
      expect(get((s) => s.$resolve("nodes.*.children.*.value", [0, 1]))).toBe(20);
    });

    it("$setAll で一方の枝だけ降りた後、降りなかった枝への $resolve も通る", async () => {
      const { el, get } = await page("", {
        nodes: [{ children: [{ value: 10 }, { value: 11 }] }, { children: [{ value: 20 }] }],
      });
      let count = 0;
      el.createState("writable", (s: any) => { count = s.$setAll("nodes.*.children.*.value", [0], -1); });
      expect(count).toBe(2);
      expect(get((s) => s.$resolve("nodes.*.children.*.value", [0, 1]))).toBe(-1);
      expect(get((s) => s.$resolve("nodes.*.children.*.value", [1, 0]))).toBe(20);
    });

    it("毎回新しい配列を返すリストの getter でも、最初の $getAll / $setAll が通る", async () => {
      // 3.x は state に後から defineProperty で入れたアクセサだった。4.0 では最初から宣言した getter で同じ形を作る
      const backing = [{ value: 1 }, { value: 2 }];
      const { el, get } = await page("", { title: "t", get nodes() { return backing.slice(); } });
      expect(get((s) => s.$getAll("nodes.*.value", []))).toEqual([1, 2]);
      let written = 0;
      el.createState("writable", (s: any) => { written = s.$setAll("nodes.*.value", [], 5); });
      expect(written).toBe(2);
      expect(backing.map((b) => b.value)).toEqual([5, 5]);
    });
  });
});

// ================================================================ #332

describe("#332 マークアップの数値添字のパス（items.0.v）は、いまその位置にある行を読み、書き込みに追従する（修正の形）", () => {
  describe.each([
    ["for: で同じリストを描くとき", true],
    ["for: が無いとき", false],
  ])("位置の意味（%s）", (_label, withFor) => {
    it("並べ替え・先頭の削除・要素の入れ替えの後は、いまその位置にある値を表示する", async () => {
      const { root, write, get } = await page(
        `<i class="a">{{ items.0.v }}</i><i class="b">{{ items.1.v }}</i>`
        + (withFor ? `<template data-wcs="for: items"><li>{{ .v }}</li></template>` : ""),
        { items: [{ v: 1 }, { v: 2 }, { v: 3 }] },
      );
      const row = () => [text(root, ".a"), text(root, ".b")];
      await write((s) => { s.items = [...s.items].reverse(); });
      expect(row()).toEqual(["3", "2"]);
      await write((s) => { s.items = s.items.slice(1); });
      expect(row()).toEqual(["2", "1"]);
      // 要素の書き込みで入れ替える（4.0 は位置の値を差し替える — migration-v4 §3.4。値と表示は 3.x と同じ）
      await write((s) => {
        const first = s["items.0"];
        const second = s["items.1"];
        s["items.0"] = second;
        s["items.1"] = first;
      });
      expect(row()).toEqual(["1", "2"]);
      expect(get((s) => s.items.map((x: any) => x.v))).toEqual([1, 2]);
      // 入れ替えの後も、添字のパスの書き込みはいまその位置にある行に着地する
      await write((s) => { s["items.1.v"] = 9; });
      expect(row()).toEqual(["1", "9"]);
      expect(get((s) => s.items.map((x: any) => x.v))).toEqual([1, 9]);
      if (withFor) expect(texts(root, "li")).toEqual(["1", "9"]);
    });
  });

  it("空のリストの添字は空のまま投げず、行が入れば表示し、空に戻れば空に戻る（警告・エラー無し）", async () => {
    const c = spyBoth();
    const { root, write } = await page(`<i class="a">{{ items.0.v }}</i><i class="far">{{ items.5.v }}</i>`, { items: [] as any[] });
    expect(text(root, ".a")).toBe("");
    await write((s) => { s.items = [...s.items, { v: 3 }]; });
    expect(text(root, ".a")).toBe("3");
    expect(text(root, ".far")).toBe("");
    await write((s) => { s["items.0.v"] = 4; });
    expect(text(root, ".a")).toBe("4");
    await write((s) => { s.items = []; });
    expect(text(root, ".a")).toBe("");
    expect(c.all()).toEqual([]);
  });

  // 3.x #332 の修正の形。以前の 4.0 は先頭が数値のパスを parsePath（src/pattern.ts）が `*.total` ＋ 添字 2024 に
  // 読み替え、`*` の上にリストが無い（lists[1] が null）まま childList(null, null) を呼んで投げた（TypeError
  // (reading 'depth')）。ルートはリストでないので、先頭の数値の区切りは素のキーとして読む
  it("先頭が数値のパス（ルートの数値キー {{ 2024.total }}）は行として扱わず、素のキーとして読む", async () => {
    const c = spyBoth();
    const { root, write, read } = await page(`<i class="a">{{ 2024.total }}</i>`, { 2024: { total: 5 } });
    expect(text(root, ".a")).toBe("5");
    expect(read("2024.total")).toBe(5);
    await write((s) => { s["2024"] = { total: 6 }; });
    expect(text(root, ".a")).toBe("6");
    await write((s) => { s["2024.total"] = 7; });
    expect(text(root, ".a")).toBe("7");
    expect(c.all()).toEqual([]);
  });

  it("先頭が数値のキーの下の添字（{{ 2024.items.1.v }}）は、2 つ目からの数値の区切りを行として読み、書き込みに追従する", async () => {
    const c = spyBoth();
    const { root, write, read } = await page(
      `<i class="a">{{ 2024.items.1.v }}</i><template data-wcs="for: 2024.items"><li>{{ .v }}</li></template>`,
      { 2024: { items: [{ v: 1 }, { v: 2 }] } },
    );
    expect([text(root, ".a"), texts(root, "li")]).toEqual(["2", ["1", "2"]]);
    await write((s) => { s["2024.items.1.v"] = 9; });
    expect([text(root, ".a"), texts(root, "li")]).toEqual(["9", ["1", "9"]]);
    await write((s) => { s["2024.items"] = [{ v: 5 }, ...s["2024.items"]]; });
    expect([text(root, ".a"), texts(root, "li")]).toEqual(["1", ["5", "1", "9"]]);
    expect(read("2024.items.0.v")).toBe(5);
    expect(c.all()).toEqual([]);
  });

  it("数値の区切りが 2 つのパス（groups.0.items.1.v）もエラー無しで表示し、外側の並べ替えでいまの位置の値になる", async () => {
    const c = spyBoth();
    const { root, write } = await page(
      `<i class="a">{{ groups.0.items.1.v }}</i><i class="b">{{ groups.1.items.0.v }}</i>`,
      { groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }] }] },
    );
    const row = () => [text(root, ".a"), text(root, ".b")];
    expect(row()).toEqual(["2", "3"]);
    await write((s) => { s.groups = [...s.groups].reverse(); });
    // groups.0 は元の groups.1（items が 1 行）: .a の位置に行は無い
    expect(row()).toEqual(["", "1"]);
    expect(c.all()).toEqual([]);
  });

  it.each([
    ["for: groups.0.items と {{ groups.0.items.1.v }}", { groups: [{ items: [{ v: 1 }, { v: 2 }] }] },
      `<template data-wcs="for: groups.0.items"><li>{{ .v }}</li></template><i class="a">{{ groups.0.items.1.v }}</i>`,
      "groups.0.items", [{ v: 7 }, { v: 8 }], [["1", "2"], "2"], [["7", "8"], "8"]],
    ["for: items.0.tags と {{ items.0.tags.1 }}", { items: [{ tags: ["a", "b"] }] },
      `<template data-wcs="for: items.0.tags"><li>{{ . }}</li></template><i class="a">{{ items.0.tags.1 }}</i>`,
      "items.0.tags", ["x", "y", "z"], [["a", "b"], "b"], [["x", "y", "z"], "y"]],
  ] as [string, Record<string, any>, string, string, unknown[], unknown[], unknown[]][])(
    "数値のパスの for と、その行を 2 つ目の数値で指す束縛（%s）が同じページにあっても、エラー無しで表示し、リストの置き換えに追従する",
    async (_label, state, markup, listPath, next, before, after) => {
      const c = spyBoth();
      const { root, write } = await page(markup, structuredClone(state));
      const row = () => [texts(root, "li"), text(root, ".a")];
      expect(row()).toEqual(before);
      await write((s) => { s[listPath] = next; });
      expect(row()).toEqual(after);
      expect(c.all()).toEqual([]);
    },
  );

  it("for: groups.0.items の行へ 2 つ目の添字で書く（this[\"groups.0.items.1.v\"] = 9）と、書けて for の行に届く（3.x は [wcs/wildcard-rank] で投げた — 4.0 は投げない）", async () => {
    const errors = spyConsole("error");
    const { root, el, read } = await page(
      `<template data-wcs="for: groups.0.items"><li>{{ .v }}</li></template>`,
      { groups: [{ items: [{ v: 1 }, { v: 2 }] }] },
    );
    expect(thrown(() => el.createState("writable", (s: any) => { s["groups.0.items.1.v"] = 9; }))).toBeUndefined();
    await flush();
    await flush();
    expect(read("groups.0.items.1.v")).toBe(9);
    expect(texts(root, "li")).toEqual(["1", "9"]);
    expect(errors).toEqual([]);
  });

  it("プリミティブの要素（{{ tags.0 }}）も要素のパスの書き込みに追従する", async () => {
    const { root, write } = await page(`<i class="a">{{ tags.0 }}</i>`, { tags: ["x", "y"] });
    expect(text(root, ".a")).toBe("x");
    await write((s) => { s["tags.0"] = "z"; });
    expect(text(root, ".a")).toBe("z");
  });

  it("同じ値が並ぶプリミティブのリストでも、末尾の添字の束縛は書いた位置の値を表示する", async () => {
    const { root, write, read, get } = await page(`<i class="a">{{ scores.2 }}</i>`, { scores: [1, 1, 5] });
    await write((s) => { s["scores.2"] = 7; });
    expect(text(root, ".a")).toBe("7");
    expect(read("scores.2")).toBe(7);
    expect(get((s) => [...s.scores])).toEqual([1, 1, 7]);
  });

  describe("書き込みの入口", () => {
    it("双方向の束縛（value: items.0.v）の書き戻しが行 0 に着地し、同じ位置の束縛と for の行に届き、状態の書き込みが入力欄に戻る", async () => {
      const { root, write, read } = await page(
        `<input data-wcs="value: items.0.v"><i class="a">{{ items.0.v }}</i>`
        + `<template data-wcs="for: items"><li>{{ .v }}</li></template>`,
        { items: [{ v: "a" }, { v: "b" }] },
      );
      const input = root.querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("a");
      input.value = "typed";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
      await flush();
      expect(read("items.0.v")).toBe("typed");
      expect(text(root, ".a")).toBe("typed");
      expect(texts(root, "li")).toEqual(["typed", "b"]);
      await write((s) => { s["items.0.v"] = "fromState"; });
      expect(input.value).toBe("fromState");
      expect(text(root, ".a")).toBe("fromState");
    });

    it("for: の行の入力欄（value: .v）からの書き込みが、同じ位置の数値添字の束縛に届く", async () => {
      const { root, read } = await page(
        `<i class="a">{{ items.0.v }}</i><i class="b">{{ items.1.v }}</i>`
        + `<template data-wcs="for: items"><input data-wcs="value: .v"></template>`,
        { items: [{ v: "a" }, { v: "b" }] },
      );
      const second = root.querySelectorAll("input")[1] as HTMLInputElement;
      second.value = "typed";
      second.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
      await flush();
      expect(read("items.1.v")).toBe("typed");
      expect([text(root, ".a"), text(root, ".b")]).toEqual(["a", "typed"]);
    });

    it("$resolve に素のパス（items.0.v）で渡した書き込みも行 0 に着地し、for の行にも届く", async () => {
      const { root, write, read } = await page(
        `<i class="a">{{ items.0.v }}</i><template data-wcs="for: items"><li>{{ .v }}</li></template>`,
        { items: [{ v: 1 }, { v: 2 }] },
      );
      await write((s) => { s.$resolve("items.0.v", [], 7); });
      expect(read("items.0.v")).toBe(7);
      expect(text(root, ".a")).toBe("7");
      expect(texts(root, "li")).toEqual(["7", "2"]);
    });
  });

  describe("for の無い一覧で同じ要素が 2 か所に並んだ後も、位置の書き込みは書いた位置に着地する", () => {
    it("要素の複写 → 別の行の葉 → 複写した位置へ新しい要素（別バッチ）", async () => {
      const { root, write, get } = await page(`<i class="a">{{ items.0.v }}</i>`, { items: [{ v: 1 }, { v: 2 }, { v: 3 }] });
      await write((s) => { s["items.1"] = s["items.0"]; });
      await write((s) => { s["items.2.v"] = 30; });
      await write((s) => { s["items.1"] = { v: 20 }; });
      expect(get((s) => s.items.map((x: any) => x.v))).toEqual([1, 20, 30]);
      expect(text(root, ".a")).toBe("1");
    });

    it("$setAll で同じ要素を配った後に、末尾へ新しい要素", async () => {
      const { root, write, get } = await page(`<i class="a">{{ items.0.v }}</i>`, { items: [{ v: 1 }, { v: 2 }, { v: 3 }] });
      await write((s) => { s.$setAll("items.*", [], { v: 9 }); });
      await write((s) => { s["items.2"] = { v: 7 }; });
      expect(get((s) => s.items.map((x: any) => x.v))).toEqual([9, 9, 7]);
      expect(text(root, ".a")).toBe("9");
    });

    it("プリミティブの一覧（行の下を読む names.0.length）で同じ値が並んだ後", async () => {
      spyBoth();
      const { write, get } = await page(`<i class="a">{{ names.0.length }}</i>`, { names: ["a", "b", "c"] });
      await write((s) => { s["names.2"] = "a"; });
      await write((s) => { s["names.2"] = "z"; });
      await write((s) => { s["names.1"] = "q"; });
      expect(get((s) => [...s.names])).toEqual(["a", "q", "z"]);
    });
  });

  describe("state の形と作者のキー", () => {
    it("数値添字の束縛があっても、state のオブジェクトの形（キー・JSON）を変えない", async () => {
      const state = { items: [{ v: 1 }] };
      const { read } = await page(`<i>{{ items.0.v }}</i><template data-wcs="for: items"><li>{{ .v }}</li></template>`, state);
      expect(Object.getOwnPropertyNames(state)).toEqual(["items"]);
      expect(JSON.stringify(state)).toBe(`{"items":[{"v":1}]}`);
      expect(read("items.0.v")).toBe(1);
    });

    it("作者が同名のキー（get \"items.0.v\"）を宣言していれば、そちらを読む", async () => {
      const { root } = await page(`<i class="a">{{ items.0.v }}</i>`, {
        items: [{ v: 1 }],
        get "items.0.v"() { return "author"; },
      });
      expect(text(root, ".a")).toBe("author");
    });

    it.each(["freeze", "seal", "preventExtensions"] as const)("拡張できない state（Object.%s）でも、数値添字の束縛を表示する（エラー・警告無し）", async (kind) => {
      const c = spyBoth();
      const lock = Object[kind] as (o: Record<string, any>) => Record<string, any>;
      const state = lock({ items: [{ v: 1 }], title: "T" });
      const { root } = await page(`<i class="a">{{ items.0.v }}</i><i class="t">{{ title }}</i>`, state);
      expect([text(root, ".a"), text(root, ".t")]).toEqual(["1", "T"]);
      expect(c.all()).toEqual([]);
    });
  });

  it("数値添字のパスにマウントしたコンポーネント（state: users.0）: マウント先のキーは添字のパスの書き込みに追従し、私有キーはそのまま", async () => {
    const tag = component(`<b class="name">{{ name }}</b><b class="mode">{{ mode }}</b>`, () => ({ mode: "view" }));
    const { root, write } = await page(`<${tag} data-wcs="state: users.0"></${tag}>`, { users: [{ name: "Alice" }, { name: "Bob" }] });
    const card = root.querySelector(tag) as any;
    await getBindingsReady(card.shadowRoot);
    await flush();
    const cs = card.shadowRoot as ShadowRoot;
    expect([text(cs, ".name"), text(cs, ".mode")]).toEqual(["Alice", "view"]);
    await write((s) => { s["users.0.name"] = "Zed"; });
    expect([text(cs, ".name"), text(cs, ".mode")]).toEqual(["Zed", "view"]);
  });
});

// ================================================================ #332 / #388 の存在の診断

/** `[wcs/binding-path-missing]` の警告のうち、束縛のパス `path` についてのもの。 */
const missingAbout = (warns: string[], path: string) =>
  warns.filter((w) => w.includes("binding-path-missing") && w.includes(`Bound path "${path}"`));
const missingAll = (warns: string[]) => warns.filter((w) => w.includes("binding-path-missing"));

describe("#332 数値添字の束縛の存在の診断（いまその位置にある行のパスとして調べる）", () => {
  it("空のリスト・まだ行の無い位置の添字（users.0.name・items.5.v・empty.0.v）は警告しない", async () => {
    const warns = spyConsole("warn");
    const { root } = await page(
      `<i class="u">{{ users.0.name }}</i><i class="far">{{ items.5.v }}</i><i class="e">{{ empty.0.v }}</i>`,
      { users: [] as any[], items: [{ v: 1 }], empty: [] as any[] },
    );
    await flush();
    expect([text(root, ".u"), text(root, ".far"), text(root, ".e")]).toEqual(["", "", ""]);
    expect(missingAll(warns)).toEqual([]);
  });

  it.each([
    // 数値のキーを持つオブジェクト（親が配列でない）は素のキーとして調べる
    ["sales.2024.totl", { sales: { 2024: { total: 5 } } }, "totl"],
    ["sales.2025.total", { sales: { 2024: { total: 5 } } }, "2025"],
    // 負の添字は行になりえない
    ["items.-1.v", { items: [{ v: 1 }] }, "-1"],
  ] as [string, Record<string, any>, string][])("行として読まない数値の区切り（%s）は報告する", async (path, state, segment) => {
    const warns = spyConsole("warn");
    await page(`<i>{{ ${path} }}</i>`, state);
    await flush();
    const w = missingAbout(warns, path);
    expect(w.length).toBe(1);
    expect(w[0]).toContain(`"${segment}" is not declared`);
  });

  it("ルートの数値キーの下の for:（for: 2024.items）の行の打ち間違い（.list.0.nmae）も、数値でないキーの下と同じく報告する", async () => {
    const warns = spyConsole("warn");
    const rows = () => [{ list: [{ name: "a" }] }];
    const { root } = await page(
      `<template data-wcs="for: 2024.items"><i>{{ .list.0.name }}{{ .list.0.nmae }}</i></template>`
      + `<template data-wcs="for: y.items"><b>{{ .list.0.nmae }}</b></template>`,
      { 2024: { items: rows() }, y: { items: rows() } },
    );
    await flush();
    expect(texts(root, "i")).toEqual(["a"]);
    for (const path of ["2024.items.*.list.0.nmae", "y.items.*.list.0.nmae"]) {
      const w = missingAbout(warns, path);
      expect(w.length, path).toBe(1);
      expect(w[0]).toContain(`"nmae" is not declared. Did you mean "name"?`);
    }
    expect(missingAll(warns).length).toBe(2);
  });
});

describe("#388 数値添字のパスの for: の行の存在の診断（修正の形）", () => {
  it("同じページの #332 の形（行 getter・行の無い位置・空のリスト）は黙ったまま、数値のキーのオブジェクトの打ち間違いと、その下の for: の行の打ち間違いは報告する", async () => {
    const warns = spyConsole("warn");
    const { root } = await page(
      `<i class="d">{{ items.0.double }}</i><i class="far">{{ items.5.v }}</i><i class="e">{{ empty.0.v }}</i>`
      + `<i class="t">{{ sales.2024.totl }}</i>`
      + `<template data-wcs="for: sales.2024.items"><b>{{ .nmae }}</b></template>`,
      {
        items: [{ v: 1 }], empty: [] as any[], sales: { 2024: { total: 5, items: [{ name: "a" }] } },
        get "items.*.double"() { return (this as any)["items.*.v"] * 2; },
      },
    );
    await flush();
    expect([text(root, ".d"), text(root, ".far"), text(root, ".e"), text(root, ".t")]).toEqual(["2", "", "", ""]);
    const all = missingAll(warns);
    expect(all.length).toBe(2);
    const totl = missingAbout(warns, "sales.2024.totl");
    expect(totl.length).toBe(1);
    expect(totl[0]).toContain(`"totl" is not declared. Did you mean "total"?`);
    const nmae = missingAbout(warns, "sales.2024.items.*.nmae");
    expect(nmae.length).toBe(1);
    expect(nmae[0]).toContain(`"nmae" is not declared. Did you mean "name"?`);
  });

  it("行 getter（items.*.sub）の戻り値を for: items.0.sub で描く行は報告しない", async () => {
    const warns = spyConsole("warn");
    const { root } = await page(
      `<template data-wcs="for: items.0.sub"><i class="x">{{ .x }}</i></template>`,
      {
        items: [{ subRaw: [{ x: 1 }, { x: 2 }] }],
        get "items.*.sub"() { return (this as any)["items.*.subRaw"]; },
      },
    );
    await flush();
    expect(texts(root, ".x")).toEqual(["1", "2"]);
    expect(missingAll(warns)).toEqual([]);
  });

  // 3.x #388 の修正の形。作者が数値添字のパスの名前で宣言した getter（get "groups.0.items"()）は、診断も
  // その getter を読むパスとして扱い、判定不能として黙る（src/features/diagnostics.ts の wildcardForm()）。
  // 以前は groups.*.items に読み替えてデータの groups[0].items の行を辿り、正しいパス（.title）を誤報した
  it("作者が宣言した同名の getter（get \"groups.0.items\"()）の行は、getter の戻り値を描き、その行のパスを報告しない", async () => {
    const warns = spyConsole("warn");
    const { root } = await page(
      `<template data-wcs="for: groups.0.items"><i class="p">{{ .title }}</i></template>`,
      {
        groups: [{ items: [{ name: "a" }] }], picked: [{ title: "z" }],
        get "groups.0.items"() { return (this as any).picked; },
      },
    );
    await flush();
    expect(texts(root, ".p")).toEqual(["z"]);
    expect(missingAll(warns)).toEqual([]);
  });

  it("state を再セットすると、新しい state でも行の打ち間違いを報告し直す", async () => {
    const warns = spyConsole("warn");
    const state = () => ({ groups: [{ items: [{ name: "a" }, { name: "b" }] }] });
    const { el } = await page(`<template data-wcs="for: groups.0.items"><i>{{ .nmae }}</i></template>`, state());
    await flush();
    expect(missingAbout(warns, "groups.0.items.*.nmae").length).toBe(1);
    el.setInitialState(state());
    await flush();
    await flush();
    const w = missingAbout(warns, "groups.0.items.*.nmae");
    expect(w.length).toBe(2);
    for (const m of w) expect(m).toContain(`"nmae" is not declared. Did you mean "name"?`);
  });

  it("did-you-mean は for: のパスの打ち間違い（for: users.0.frends）に、打ち間違えた名前そのものではなく正しい名前を提案する", async () => {
    const warns = spyConsole("warn");
    await page(`<template data-wcs="for: users.0.frends"><i>{{ .name }}</i></template>`, { users: [{ friends: [{ name: "f" }] }] });
    await flush();
    const all = missingAll(warns);
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((w) => w.includes(`"frends" is not declared. Did you mean "friends"?`))).toBe(true);
    expect(all.join("\n")).not.toContain(`Did you mean "frends"?`);
  });

  it("数値のキーのオブジェクトで、別の束縛の打ち間違い（sales.2024.totl）を提案しない", async () => {
    const warns = spyConsole("warn");
    await page(`<i>{{ sales.2024.totl }}</i><i>{{ sales.2024.totla }}</i>`, { sales: { 2024: { total: 5 } } });
    await flush();
    const a = missingAbout(warns, "sales.2024.totl");
    const b = missingAbout(warns, "sales.2024.totla");
    expect([a.length, b.length]).toEqual([1, 1]);
    expect(a[0]).toContain(`"totl" is not declared. Did you mean "total"?`);
    expect(b[0]).toContain(`"totla" is not declared. Did you mean "total"?`);
  });

  it("for: items.0.tags の行の打ち間違い（.lable）も報告する", async () => {
    const warns = spyConsole("warn");
    const { root } = await page(
      `<template data-wcs="for: items.0.tags"><i>{{ .label }}</i><b>{{ .lable }}</b></template>`,
      { items: [{ tags: [{ label: "x" }, { label: "y" }] }] },
    );
    await flush();
    expect(texts(root, "i")).toEqual(["x", "y"]);
    const all = missingAll(warns);
    expect(all.length).toBe(1);
    expect(missingAbout(warns, "items.0.tags.*.lable")[0]).toContain(`"lable" is not declared. Did you mean "label"?`);
  });

  it("2 つの添字のパスの打ち間違い（groups.0.items.1.nmae）も、同じページに for: groups.0.items があっても報告する", async () => {
    const warns = spyConsole("warn");
    await page(
      `<template data-wcs="for: groups.0.items"><i>{{ .name }}</i></template><b>{{ groups.0.items.1.nmae }}</b>`,
      { groups: [{ items: [{ name: "a" }, { name: "b" }] }] },
    );
    await flush();
    const w = missingAbout(warns, "groups.0.items.1.nmae");
    expect(w.length).toBe(1);
    expect(w[0]).toContain(`"nmae" is not declared`);
  });
});

// ================================================================ #332 の $watch（4.0 で意図して変えた点）

describe("#332 $watch の数値添字のキー（items.0.v）は、その位置の値が変わったときだけ発火する（migration-v4 §3.4 Smaller differences）", () => {
  // 3.x（3.4 から）は添字の書き込み・要素の差し替えに加えて、一覧のどの行への書き込みでも（値が同じでも）発火する。
  // 4.0 はその位置の値が変わったときだけ。添字の書き込みと要素の差し替えでの発火は issues2-paths.test.ts の #382
  it("ほかの行への書き込みでは発火せず、並べ替えでその位置の値が変われば発火する", async () => {
    const calls: unknown[][] = [];
    const { write } = await page(`<i>{{ items.0.v }}</i>`, {
      items: [{ v: 1 }, { v: 2 }],
      $watch: { "items.0.v"(cur: unknown, prev: unknown) { calls.push([cur, prev]); } },
    });
    await write((s) => { s["items.1.v"] = 3; });
    expect(calls).toEqual([]);
    await write((s) => { s.items = [s["items.1"], s["items.0"]]; });
    expect(calls).toEqual([[3, 1]]);
  });
});

// ================================================================ #366

describe("#366 $eq / $eqPath / $eqIndex の path に数値の添字を書いても追従する（修正の形）", () => {
  // Issue の 4 形の要素の差し替え・葉の書き込みは issues-lists.test.ts の #366。ここでは一覧の置き換えと、その後の追従
  it.each<[string, string]>([
    ["for で描かない", ""],
    ["for で描く", `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`],
    ["対照: 同じ数値のパスの束縛がある", `<i>{{ items.0.v }}</i>`],
  ])("一覧の置き換えに追従し、置き換えた後も葉の書き込み・要素の差し替えに追従する（%s）", async (_name, extra) => {
    const { root, write, read } = await page(`<p class="b">{{ isB }}</p>${extra}`, {
      items: [{ v: "a" }, { v: "c" }],
      get isB() { return (this as any).$eq("items.0.v", "b") ? "Y" : "n"; },
    });
    const shown = () => text(root, ".b")! + read("isB");
    expect(shown()).toBe("nn");
    await write((s) => { s.items = [{ v: "b" }]; });
    expect(shown()).toBe("YY");
    await write((s) => { s["items.0.v"] = "a"; });
    expect(shown()).toBe("nn");
    await write((s) => { s["items.0"] = { v: "b" }; });
    expect(shown()).toBe("YY");
  });

  it("$eqPath / $eqIndex の path も同じく追従する", async () => {
    const { root, write } = await page(
      `<p class="p">{{ byPath }}</p><ul><template data-wcs="for: rows"><li class="r">{{ .cur }}</li></template></ul>`,
      {
        items: [{ v: "a" }, { v: 1 }],
        key: "b",
        rows: [{ id: 0 }, { id: 1 }],
        get byPath() { return (this as any).$eqPath("items.0.v", "key") ? "Y" : "n"; },
        get "rows.*.cur"() { return (this as any).$eqIndex("items.1.v") ? "Y" : "n"; },
      },
    );
    expect([texts(root, ".p"), texts(root, ".r")]).toEqual([["n"], ["n", "Y"]]);
    await write((s) => { s["items.0"] = { v: "b" }; s["items.1.v"] = 0; });
    expect([texts(root, ".p"), texts(root, ".r")]).toEqual([["Y"], ["Y", "n"]]);
  });

  /** `rows.*.on` は `$eqIndex(path)`。行の移動（並べ替え・先頭への挿入・削除）の後の表示を集める。 */
  const eqIndexMoves = async (extra: Record<string, any>, path: string) => {
    const state: any = { rows: ["a", "b", "c"] };
    Object.defineProperties(state, Object.getOwnPropertyDescriptors(extra));
    Object.defineProperty(state, "rows.*.on", {
      get(this: any) { return this.$eqIndex(path) ? "Y" : "n"; }, enumerable: true, configurable: true,
    });
    const { root, write } = await page(`<ul><template data-wcs="for: rows"><li class="r">{{ .on }}</li></template></ul>`, state);
    const seen = [texts(root, ".r").join("|")];
    for (const step of [
      (s: any) => { s.rows = ["c", "a", "b"]; },
      (s: any) => { s.rows = ["z", ...s.rows]; },
      (s: any) => { s.rows = s.rows.slice(1); },
      (s: any) => { s.rows = s.rows.slice(1); },
    ]) {
      await write(step);
      seen.push(texts(root, ".r").join("|"));
    }
    return seen;
  };
  const MOVED = ["Y|n|n", "Y|n|n", "Y|n|n|n", "Y|n|n", "Y|n"];

  // 3.x #366 の修正の形。追跡付きの読みに落ちた $eqIndex（path が数値の添字・getter）は、$1 の読みと同じく
  // getter を行の index に依存すると記録する（src/engine.ts の watchIndex）。以前は記録せず、位置だけが変わった行が
  // 前の答えのまま残った（["Y|n|n", "n|Y|n", "Y|n|Y|n", "n|Y|n", "Y|n"]）
  it.each([
    ["数値の添字の path（cur.0）", { cur: [0] }, "cur.0"],
    ["getter の path（curG）", { c: 0, get curG() { return (this as any).c; } }, "curG"],
  ] as [string, Record<string, any>, string][])("$eqIndex の答えが行の移動（並べ替え・先頭への挿入・削除）に追従する（%s）", async (_label, extra, path) => {
    expect(await eqIndexMoves(extra, path)).toEqual(MOVED);
  });

  it("getter の path の $eqIndex は、path の値の変化にも行の移動の後で追従する（curG）", async () => {
    const { root, write } = await page(`<ul><template data-wcs="for: rows"><li class="r">{{ .on }}</li></template></ul>`, {
      rows: ["a", "b", "c"], c: 0,
      get curG() { return (this as any).c; },
      get "rows.*.on"() { return (this as any).$eqIndex("curG") ? "Y" : "n"; },
    });
    await write((s) => { s.rows = ["c", "a", "b"]; });
    await write((s) => { s.c = 2; });
    expect(texts(root, ".r").join("|")).toBe("n|n|Y");
  });

  it("$eqIndex の答えが行の移動に追従する（対照: 普通の path（curIdx））", async () => {
    expect(await eqIndexMoves({ curIdx: 0 }, "curIdx")).toEqual(MOVED);
  });
});
