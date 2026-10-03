/**
 * issues2-lists.test.ts — 現行 @wcstack/state 3.3 の Issue #376〜#381（リスト・行・配列の書き込み・
 * `$watch`・`$eqIndex`）を state-next で流す。各 Issue の「再現」「期待」の表の形を、期待を書いたテストとして置く。
 * 確かめる途中で見つけた F31（<select> の値）・F32（別のリストの *）・F35・F36（$postUpdate）も置く。F26 の系統（別の配列の 2 つの
 * 一覧に同じオブジェクトがある形）は 4.0 の既知の制限として it.fails で症状を残す。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes, ssr, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes, ssr]);
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`issues2-lists-page-${seq++}`);
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
  return { root, el, write, read, host: h };
}

/** Renders `html` as the server does (an orchestrated render, then the snapshot builder); its HTML. */
async function serverRender(html: string, state: Record<string, any>): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  try {
    const h = document.createElement(`issues2-server-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = html;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(root);
    const out = root.innerHTML;
    h.remove();
    return out;
  } finally {
    document.documentElement.removeAttribute("data-wcs-server");
  }
}

/** Loads the server's HTML and hydrates it. */
async function hydrate(html: string, state: Record<string, any>) {
  const h = document.createElement(`issues2-client-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
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

const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);
const click = async (n: Element) => { (n as HTMLElement).click(); await flush(); await flush(); };

/** Collects console.error while `fn` runs (the messages, joined). */
async function errorsOf(fn: () => Promise<void>): Promise<string[]> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await fn();
    return spy.mock.calls.map((c) => c.map((a) => String((a as Error)?.message ?? a)).join(" "));
  } finally {
    spy.mockRestore();
  }
}

// ---------------------------------------------------------------- #376

describe("#376 行の中でトップレベルのリストを回す for: も描け、外側の一覧が消えない", () => {
  const html = `<ul><template data-wcs="for: g"><li>{{ .n }}:<template data-wcs="for: tags"><i>{{ . }}</i></template></li></template></ul>`;
  const state = () => ({ g: [{ n: "a" }, { n: "b" }], tags: ["x", "y"] });
  const lis = (root: ParentNode) => texts(root, "li").join(" ");

  it("Issue の形（CSR）: a:xy b:xy、tags の書き込みに追従する", async () => {
    let p!: Awaited<ReturnType<typeof page>>;
    const errors = await errorsOf(async () => {
      p = await page(html, state());
    });
    expect(errors).toEqual([]);
    const { root, write } = p;
    const seen = [lis(root)];
    await write((s) => { s.tags = ["x", "y", "z"]; });
    seen.push(lis(root));
    await write((s) => { s["tags.1"] = "Y"; });
    seen.push(lis(root));
    expect(seen).toEqual(["a:xy b:xy", "a:xyz b:xyz", "a:xYz b:xYz"]);
  });

  it("外側の行を足す・消す（最初に描いた行を消す）: 残った行と新しい行が tags に追従する", async () => {
    const { root, write } = await page(html, state());
    await write((s) => { s.g = [...s.g, { n: "c" }]; });
    expect(lis(root)).toBe("a:xy b:xy c:xy");
    // the first view of the tags list goes with row a
    await write((s) => { s.g = s.g.slice(1); });
    expect(lis(root)).toBe("b:xy c:xy");
    await write((s) => { s.tags = ["p"]; });
    expect(lis(root)).toBe("b:p c:p");
    await write((s) => { s.g = [{ n: "d" }, ...s.g]; });
    expect(lis(root)).toBe("d:p b:p c:p");
    await write((s) => { s.tags = ["q", "r"]; });
    expect(lis(root)).toBe("d:qr b:qr c:qr");
    await write((s) => { s.g = []; });
    expect(lis(root)).toBe("");
    await write((s) => { s.g = [{ n: "e" }]; });
    expect(lis(root)).toBe("e:qr");
  });

  it("Issue の形（enable-ssr ＋サーバー描画 → ハイドレーション）: a:xy b:xy、tags の書き込みに追従する", async () => {
    let out = "";
    let loaded!: Awaited<ReturnType<typeof hydrate>>;
    const errors = await errorsOf(async () => {
      out = await serverRender(`<wcs-state enable-ssr></wcs-state>${html}`, state());
      loaded = await hydrate(out, state());
    });
    expect(errors).toEqual([]);
    expect(out).toContain("<wcs-ssr");
    const { root, write } = loaded;
    expect(lis(root)).toBe("a:xy b:xy");
    await write((s) => { s.tags = ["x", "y", "z"]; });
    expect(lis(root)).toBe("a:xyz b:xyz");
    await write((s) => { s.g = [...s.g, { n: "c" }]; });
    expect(lis(root)).toBe("a:xyz b:xyz c:xyz");
  });

  it("回避策の形（行 getter で tags を返し for: .tagsHere）", async () => {
    const { root, write } = await page(
      `<ul><template data-wcs="for: g"><li>{{ .n }}:<template data-wcs="for: .tagsHere"><i>{{ . }}</i></template></li></template></ul>`,
      { ...state(), get "g.*.tagsHere"() { return (this as any).tags; } },
    );
    expect(lis(root)).toBe("a:xy b:xy");
    await write((s) => { s.tags = ["x", "y", "z"]; });
    expect(lis(root)).toBe("a:xyz b:xyz");
  });

  it("対照: 行の中で {{ tags.length }}", async () => {
    const { root } = await page(`<ul><template data-wcs="for: g"><li>{{ .n }}:{{ tags.length }}</li></template></ul>`, state());
    expect(lis(root)).toBe("a:2 b:2");
  });

  it("行ごとに同じ選択肢を出す <select>（for: rows の中の for: options）: 選択肢が出て、値が行の choice に合う・書き戻る", async () => {
    const { root, write, read } = await page(
      `<template data-wcs="for: rows"><p><select data-wcs="value: .choice"><template data-wcs="for: options"><option data-wcs="value: .v">{{ .label }}</option></template></select></p></template>`,
      {
        rows: [{ choice: "b" }, { choice: "c" }],
        options: [{ v: "a", label: "A" }, { v: "b", label: "B" }, { v: "c", label: "C" }],
      },
    );
    const selects = () => Array.from(root.querySelectorAll("select")) as HTMLSelectElement[];
    const initial = selects().map((s) => s.value);
    expect(selects().map((s) => Array.from(s.options).map((o) => o.value).join(""))).toEqual(["abc", "abc"]);
    const s1 = selects()[1];
    s1.value = "a";
    s1.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(read("rows.1.choice")).toBe("a");
    await write((s) => { s.options = [...s.options, { v: "d", label: "D" }]; });
    expect(selects().map((s) => Array.from(s.options).map((o) => o.value).join(""))).toEqual(["abcd", "abcd"]);
    await write((s) => { s["rows.0.choice"] = "d"; });
    expect(selects()[0].value).toBe("d");
    // the initial value (last: the options and the write-back above are checked first)
    expect(initial).toEqual(["b", "c"]);
  });

  it("（Issue の外）行の中の <select> が行の下の選択肢を回す（for: .opts）: 初期表示の値が .choice", async () => {
    const { root } = await page(
      `<template data-wcs="for: rows"><p><select data-wcs="value: .choice"><template data-wcs="for: .opts"><option data-wcs="value: .v">{{ .v }}</option></template></select></p></template>`,
      { rows: [{ choice: "b", opts: [{ v: "a" }, { v: "b" }, { v: "c" }] }, { choice: "c", opts: [{ v: "a" }, { v: "b" }, { v: "c" }] }] },
    );
    expect((Array.from(root.querySelectorAll("select")) as HTMLSelectElement[]).map((s) => s.value)).toEqual(["b", "c"]);
  });

  it("（Issue の外）ルートの <select> が for: options で選択肢を作る — 初期表示の値が choice", async () => {
    const { root, write } = await page(
      `<select data-wcs="value: choice"><template data-wcs="for: options"><option data-wcs="value: .v">{{ .v }}</option></template></select>`,
      { choice: "b", options: [{ v: "a" }, { v: "b" }, { v: "c" }] },
    );
    const sel = root.querySelector("select") as HTMLSelectElement;
    expect(sel.value).toBe("b");
    await write((s) => { s.choice = "c"; });
    expect(sel.value).toBe("c");
  });

  it("（Issue の外）ルートの <select> の選択肢を後から読み込む（空 → 3 つ）と、値が choice になる", async () => {
    const { root, write } = await page(
      `<select data-wcs="value: choice"><template data-wcs="for: options"><option data-wcs="value: .v">{{ .v }}</option></template></select>`,
      { choice: "b", options: [] as any[] },
    );
    await write((s) => { s.options = [{ v: "a" }, { v: "b" }, { v: "c" }]; });
    expect((root.querySelector("select") as HTMLSelectElement).value).toBe("b");
  });

  describe("F31: <select> の値は、中の for: / if: が選択肢を描いた後にも当たる", () => {
    const opts = `<template data-wcs="for: options"><option data-wcs="value: .v">{{ .v }}</option></template>`;
    const three = () => [{ v: "a" }, { v: "b" }, { v: "c" }];
    const sel = (root: ParentNode) => root.querySelector("select") as HTMLSelectElement;

    it("selectedIndex: の束縛（ルート・行の中）", async () => {
      const { root, write } = await page(
        `<select class="r" data-wcs="selectedIndex: idx">${opts}</select>` +
        `<template data-wcs="for: rows"><select class="w" data-wcs="selectedIndex: .i">${opts}</select></template>`,
        { idx: 2, options: three(), rows: [{ i: 1 }, { i: 0 }] },
      );
      const idx = () => (Array.from(root.querySelectorAll("select")) as HTMLSelectElement[]).map((s) => s.selectedIndex);
      expect(idx()).toEqual([2, 1, 0]);
      await write((s) => { s.idx = 1; s["rows.1.i"] = 2; });
      expect(idx()).toEqual([1, 1, 2]);
    });

    it("<optgroup> の中の for:", async () => {
      const { root } = await page(
        `<select data-wcs="value: choice"><optgroup label="g">${opts}</optgroup></select>`,
        { choice: "c", options: three() },
      );
      expect(sel(root).value).toBe("c");
    });

    it("中の if: が選択肢を出す", async () => {
      const { root, write } = await page(
        `<select data-wcs="value: choice"><option value="a">a</option><template data-wcs="if: more"><option value="b">b</option><option value="c">c</option></template></select>`,
        { choice: "c", more: false },
      );
      await write((s) => { s.more = true; });
      expect(sel(root).value).toBe("c");
    });

    it("選択肢と値を同じバッチで書く・選択肢を並べ替える・選んだ選択肢を消す", async () => {
      const { root, write, read } = await page(`<select data-wcs="value: choice">${opts}</select>`, { choice: "b", options: [] as any[] });
      await write((s) => { s.options = [{ v: "x" }, { v: "y" }, { v: "z" }]; s.choice = "z"; });
      expect(sel(root).value).toBe("z");
      await write((s) => { s.options = [{ v: "z" }, { v: "y" }, { v: "x" }]; });
      expect(sel(root).value).toBe("z");
      // the chosen option leaves: no option is selected (as a value no static option has), state keeps its value
      await write((s) => { s.options = [{ v: "x" }, { v: "y" }]; });
      expect([sel(root).selectedIndex, read("choice")]).toEqual([-1, "z"]);
      await write((s) => { s.options = [{ v: "x" }, { v: "y" }, { v: "z" }]; });
      expect(sel(root).value).toBe("z");
    });

    it("利用者が選んだ値は、選択肢が変わっても保たれる（書き戻した値が控えられる）", async () => {
      const { root, write, read } = await page(`<select data-wcs="value: choice">${opts}</select>`, { choice: "b", options: three() });
      sel(root).value = "c";
      sel(root).dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      expect(read("choice")).toBe("c");
      await write((s) => { s.options = [...s.options, { v: "d" }]; });
      expect(sel(root).value).toBe("c");
    });

    it("state に値が無い（undefined）ときは、要素の選択を変えない", async () => {
      const { root, write } = await page(`<select data-wcs="value: choice">${opts}</select>`, { options: three() });
      sel(root).value = "b";
      await write((s) => { s.options = [...s.options, { v: "d" }]; });
      expect(sel(root).value).toBe("b");
    });
  });

  // --- F32: 行の中の束縛の「*」は、その段の囲む for: の行。別のリストの行には解けず、計画を作る時点で誤りにする
  // （3.3 は束縛ごとに ListIndex not found で失敗する）
  it("F32: for: a の行の中の {{ b.*.y }}（別のルートのリストのワイルドカードのパス）は #1403 で誤りになる", async () => {
    await expect(page(`<ul><template data-wcs="for: a"><li>{{ b.*.y }}</li></template></ul>`, {
      a: [{ y: "A0" }, { y: "A1" }],
      b: [{ y: "B0" }, { y: "B1" }],
    })).rejects.toThrow('[@wcstack/state] [wcs/wildcard-rank] #1403 "b.*.y" "b" "a"');
  });

  it("F32: for: a の行の中の value: b.*.y も誤りになる（a のデータを壊さない）", async () => {
    await expect(page(`<template data-wcs="for: a"><input data-wcs="value: b.*.y"></template>`, {
      a: [{ y: "A0" }, { y: "A1" }],
      b: [{ y: "B0" }, { y: "B1" }],
    })).rejects.toThrow("#1403");
  });

  it("F32: 内側の行（tags の行）から外側の行の値 g.*.n を読むと誤り（tags の行は g の行ではない）", async () => {
    await expect(page(
      `<ul><template data-wcs="for: g"><li><template data-wcs="for: tags"><i>{{ g.*.n }}</i></template></li></template></ul>`,
      { g: [{ n: "a" }, { n: "b" }], tags: [{ n: "T1" }, { n: "T2" }] },
    )).rejects.toThrow('#1403 "g.*.n" "g" "tags"');
  });

  it("F32: 入れ子の段ごとに確かめる（外側の段が別のリスト・for: の右辺・if: の条件）", async () => {
    const st = () => ({ a: [{ items: [{ v: 1 }] }], b: [{ items: [{ v: 2 }], on: true }] });
    await expect(page(`<template data-wcs="for: a"><template data-wcs="for: .items"><i>{{ b.*.items.*.v }}</i></template></template>`, st()))
      .rejects.toThrow('#1403 "b.*.items.*.v" "b" "a"');
    await expect(page(`<template data-wcs="for: a"><template data-wcs="for: b.*.items"><i>{{ .v }}</i></template></template>`, st()))
      .rejects.toThrow('#1403 "b.*.items" "b" "a"');
    await expect(page(`<template data-wcs="for: a"><template data-wcs="if: b.*.on"><i>x</i></template></template>`, st()))
      .rejects.toThrow('#1403 "b.*.on" "b" "a"');
  });

  it("F32: 段が足りない形は #1401（囲む段の数を示す）。同じリストの段は、これまでどおり読める", async () => {
    await expect(page(`<template data-wcs="for: a"><i>{{ a.*.items.*.v }}</i></template>`, { a: [{ items: [{ v: 1 }] }] }))
      .rejects.toThrow('#1401 "a.*.items.*.v" 2 1');
    await expect(page(`<template data-wcs="if: on"><i>{{ a.*.v }}</i></template>`, { on: true, a: [{ v: 1 }] }))
      .rejects.toThrow('#1401 "a.*.v" 1 0');
    const { root } = await page(
      `<template data-wcs="for: a"><template data-wcs="for: .items"><i>{{ a.*.n }}{{ a.*.items.*.v }}{{ .v }}</i></template></template>`,
      { a: [{ n: "x", items: [{ v: 1 }, { v: 2 }] }] },
    );
    expect(texts(root, "i")).toEqual(["x11", "x22"]);
  });

  // 観察（挙動の記録。設計の判断が要る点）: 内側の行はルートのリスト tags の行で、親の行を持たない。
  // 3.3 の入れ子の for（行の下のリスト）の意味なら $1 は外側の g の添字・$2 は内側の添字（"0/0 0/1 1/0 1/1"）だが、
  // 4.0 では $1 が tags の添字、$2 は無い（空）
  it("（観察）内側の行の {{ $1 }}・{{ $2 }}: $1 は tags の添字、$2 は空", async () => {
    const { root } = await page(
      `<ul><template data-wcs="for: g"><li><template data-wcs="for: tags"><i>{{ $1 }}/{{ $2 }}</i></template></li></template></ul>`,
      state(),
    );
    expect(texts(root, "i").join(" ")).toBe("0/ 1/ 0/ 1/");
  });

  // 観察: 3.3 の入れ子の for なら (event, 外側, 内側) が渡るが、4.0 では (event, 内側) だけ（どの外側の行で押したかが分からない）
  it("（観察）内側の行のイベントハンドラの添字: (event, tags の添字) だけ", async () => {
    const got: number[][] = [];
    const { root } = await page(
      `<ul><template data-wcs="for: g"><li><template data-wcs="for: tags"><button data-wcs="onclick: pick">{{ . }}</button></template></li></template></ul>`,
      { ...state(), pick(_e: Event, ...idx: number[]) { got.push(idx); } },
    );
    await click(root.querySelectorAll("button")[3]);
    expect(got).toEqual([[1]]);
  });
});

// ---------------------------------------------------------------- #377

describe("#377 元の配列を返す getter のパスを通した書き込みが、元のパス・$getAll・同じ配列のほかの for に届く", () => {
  const todos = () => [{ title: "a", done: false }, { title: "b", done: false }];
  const todoState = (extra: Record<string, any> = {}) => ({
    filter: "all",
    todos: todos(),
    get shown() {
      const self = this as any;
      return self.filter === "all" ? self.todos : self.todos.filter((t: any) => t.done === (self.filter === "done"));
    },
    get left(): number { return (this as any).$getAll("todos.*.done", []).filter((d: boolean) => !d).length; },
    ...extra,
  });
  const html = `<b>{{ left }}</b><ul class="shown"><template data-wcs="for: shown"><li><input type="checkbox" data-wcs="checked: .done"><span>{{ .title }}:{{ .done }}</span></li></template></ul>`;
  const htmlBoth = `${html}<ul class="todos"><template data-wcs="for: todos"><li><span>{{ .title }}:{{ .done }}</span></li></template></ul>`;
  const rowsOf = (root: ParentNode, cls: string) => texts(root, `ul.${cls} span`).join(",");
  const raw = (read: (p: string) => unknown) => (read("todos") as any[]).map((t) => `${t.title}:${t.done}`).join(",");

  /** `{{ left }}` | s.left | s["todos.0.done"] | for: shown | raw todos */
  const snap = (root: ParentNode, read: (p: string) => unknown) =>
    `${root.querySelector("b")!.textContent} | ${read("left")} | ${read("todos.0.done")} | ${rowsOf(root, "shown")} | ${raw(read)}`;

  it("Issue の手順（1 行目の checkbox を入れる → filter = active）", async () => {
    const { root, write, read } = await page(html, todoState());
    const seen = [snap(root, read)];
    const box = root.querySelector("input") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await flush();
    seen.push(snap(root, read));
    await write((s) => { s.filter = "active"; });
    seen.push(snap(root, read));
    expect(seen).toEqual([
      "2 | 2 | false | a:false,b:false | a:false,b:false",
      "1 | 1 | true | a:true,b:false | a:true,b:false",
      "1 | 1 | true | b:false | a:true,b:false",
    ]);
  });

  it("同じ結果になる形: checkbox の代わりに s[\"shown.0.done\"] = true", async () => {
    const { root, write, read } = await page(html, todoState());
    await write((s) => { s["shown.0.done"] = true; });
    expect(snap(root, read)).toBe("1 | 1 | true | a:true,b:false | a:true,b:false");
    await write((s) => { s.filter = "active"; });
    expect(snap(root, read)).toBe("1 | 1 | true | b:false | a:true,b:false");
  });

  it("同じ結果になる形: for: todos も描き、s[\"shown.0.done\"] = true", async () => {
    const { root, write, read } = await page(htmlBoth, todoState());
    await write((s) => { s["shown.0.done"] = true; });
    expect(rowsOf(root, "todos")).toBe("a:true,b:false");
    expect(read("todos.0.done")).toBe(true);
    expect(root.querySelector("b")!.textContent).toBe("1");
  });

  it("同じ結果になる形: 要素の差し替え s[\"shown.0\"] = { title: \"A\", done: true }", async () => {
    const { root, write, read } = await page(htmlBoth, todoState());
    await write((s) => { s["shown.0"] = { title: "A", done: true }; });
    expect(rowsOf(root, "todos")).toBe("A:true,b:false");
    expect(rowsOf(root, "shown")).toBe("A:true,b:false");
    expect(root.querySelector("b")!.textContent).toBe("1");
    expect(read("left")).toBe(1);
    expect(read("todos.0.done")).toBe(true);
  });

  it("対照: 元のパスへの書き込み s[\"todos.0.done\"] = true", async () => {
    const { root, write } = await page(htmlBoth, todoState());
    await write((s) => { s["todos.0.done"] = true; });
    expect(root.querySelector("b")!.textContent).toBe("1");
    expect(rowsOf(root, "todos")).toBe("a:true,b:false");
    expect(rowsOf(root, "shown")).toBe("a:true,b:false");
  });

  // --- 同じ根と推定している別の形（もう片方のパスの for: の行）
  const two = (a: string, b: string) =>
    `<ul class="${a}"><template data-wcs="for: ${a}"><li><span>{{ .title }}:{{ .done }}</span></li></template></ul>` +
    `<ul class="${b}"><template data-wcs="for: ${b}"><li><span>{{ .title }}:{{ .done }}</span></li></template></ul>`;

  it("別の形: get shown() { return this.todos } と $postUpdate(\"todos.0.done\")", async () => {
    const { root, write, read } = await page(two("todos", "shown"), { todos: todos(), get shown() { return (this as any).todos; } });
    await write((s) => { s.todos[0].done = true; s.$postUpdate("todos.0.done"); });
    expect(read("shown.0.done")).toBe(true);
    expect(rowsOf(root, "todos")).toBe("a:true,b:false");
    expect(rowsOf(root, "shown")).toBe("a:true,b:false");
  });

  it("別の形: get shown() { return this.todos } と $postUpdate(\"todos.1\")", async () => {
    const { root, write } = await page(two("todos", "shown"), { todos: todos(), get shown() { return (this as any).todos; } });
    await write((s) => { s.todos[1].done = true; s.$postUpdate("todos.1"); });
    expect(rowsOf(root, "todos")).toBe("a:false,b:true");
    expect(rowsOf(root, "shown")).toBe("a:false,b:true");
  });

  it("別の形（参考）: $postUpdate(\"shown.0.done\")（getter のパスの側から知らせる）", async () => {
    const { root, write } = await page(two("todos", "shown"), { todos: todos(), get shown() { return (this as any).todos; } });
    await write((s) => { s.todos[0].done = true; s.$postUpdate("shown.0.done"); });
    expect(rowsOf(root, "shown")).toBe("a:true,b:false");
    expect(rowsOf(root, "todos")).toBe("a:true,b:false");
  });

  it("別の形: getter の連鎖（a → shown）", async () => {
    const { root, write } = await page(two("todos", "shown"), {
      todos: todos(),
      get a() { return (this as any).todos; },
      get shown() { return (this as any).a; },
    });
    await write((s) => { s["todos.0.done"] = true; });
    expect(rowsOf(root, "shown")).toBe("a:true,b:false");
    await write((s) => { s["todos.1"] = { title: "B", done: true }; });
    expect(rowsOf(root, "shown")).toBe("a:true,B:true");
    expect(rowsOf(root, "todos")).toBe("a:true,B:true");
  });

  it("別の形: 同じ配列を持つ普通のキー（todos: arr, copy: arr）", async () => {
    const arr = todos();
    const { root, write } = await page(two("todos", "copy"), { todos: arr, copy: arr });
    await write((s) => { s["todos.0.done"] = true; });
    expect(rowsOf(root, "copy")).toBe("a:true,b:false");
    await write((s) => { s["todos.1"] = { title: "B", done: true }; });
    expect(rowsOf(root, "copy")).toBe("a:true,B:true");
  });

  it("別の形: 後から同じ配列を代入（s.copy = s.todos の後）", async () => {
    const { root, write } = await page(two("todos", "copy"), { todos: todos(), copy: [] });
    await write((s) => { s.copy = s.todos; });
    expect(rowsOf(root, "copy")).toBe("a:false,b:false");
    await write((s) => { s["todos.0.done"] = true; });
    expect(rowsOf(root, "copy")).toBe("a:true,b:false");
    await write((s) => { s["copy.1.done"] = true; });
    expect(rowsOf(root, "todos")).toBe("a:true,b:true");
  });

  // README（Arrays）はその場の push を「検出されない」とする（契約外）。挙動を記録するだけ
  it("（Issue の外・観察）配列をその場で push して $postUpdate(\"todos\") で知らせても for: todos は描き直されない（配列の同一性で同期する）", async () => {
    const { root, write } = await page(two("todos", "shown"), { todos: todos(), get shown() { return (this as any).todos; } });
    await write((s) => { s.todos.push({ title: "c", done: false }); s.$postUpdate("todos"); });
    expect(rowsOf(root, "todos")).toBe("a:false,b:false");
    expect(rowsOf(root, "shown")).toBe("a:false,b:false");
  });

  it("（Issue の外）行の値をその場で書き換えて $postUpdate(\"todos\")（リストのパス）で知らせると、for: todos の行が描き直される", async () => {
    const { root, write } = await page(two("todos", "shown"), { todos: todos(), get shown() { return (this as any).todos; } });
    await write((s) => { s.todos[0].done = true; s.$postUpdate("todos"); });
    expect(rowsOf(root, "todos")).toBe("a:true,b:false");
    // the list over the same array (the getter returning it) too
    expect(rowsOf(root, "shown")).toBe("a:true,b:false");
  });

  describe("F35: $postUpdate は、その場で変わった値を、下の一覧の行の束縛まで届ける", () => {
    const nested = `<template data-wcs="for: groups"><section>{{ .name }}:<template data-wcs="for: .items"><i>{{ .v }}</i></template>|{{ .items.length }}</section></template>`;
    const groups = () => [{ name: "g0", items: [{ v: 1 }, { v: 2 }] }, { name: "g1", items: [{ v: 3 }] }];
    const shown = (root: ParentNode) => texts(root, "section").join(" ");

    it("入れ子の一覧の行（$postUpdate(\"groups\")）", async () => {
      const { root, write } = await page(nested, { groups: groups() });
      await write((s) => { s.groups[1].items[0].v = 30; s.groups[0].name = "G0"; s.$postUpdate("groups"); });
      expect(shown(root)).toBe("G0:12|2 g1:30|1");
    });

    it("行の下の一覧のパス（$postUpdate(\"groups.0.items\")）は、その行の一覧だけを描き直す", async () => {
      const { root, write } = await page(nested, { groups: groups() });
      await write((s) => { s.groups[0].items[1].v = 20; s.groups[1].items[0].v = 30; s.$postUpdate("groups.0.items"); });
      expect(shown(root)).toBe("g0:120|2 g1:3|1");
    });

    it("入れ子の配列をその場で差し替えても、下の一覧を同期する（書き込みと同じ）", async () => {
      const { root, write } = await page(nested, { groups: groups() });
      await write((s) => { s.groups[0].items = [{ v: 7 }]; s.$postUpdate("groups.0"); });
      expect(shown(root)).toBe("g0:7|1 g1:3|1");
    });

    it("要素のパス（$postUpdate(\"todos.1\")）: 配列の要素をその場で差し替えた形も、行が今の要素を持つ", async () => {
      const { root, write, read } = await page(two("todos", "shown"), { todos: todos(), get shown() { return (this as any).todos; } });
      await write((s) => { s.todos[1] = { title: "B", done: true }; s.$postUpdate("todos.1"); });
      expect([rowsOf(root, "todos"), rowsOf(root, "shown"), read("todos.1.title")]).toEqual(["a:false,B:true", "a:false,B:true", "B"]);
    });

    it("行の getter と $getAll の getter も新しい値を読む", async () => {
      const { root, write } = await page(
        `<b>{{ left }}</b><template data-wcs="for: todos"><i>{{ .label }}</i></template>`,
        {
          todos: todos(),
          get left() { return (this as any).$getAll("todos.*.done", []).filter((d: boolean) => !d).length; },
          get "todos.*.label"() { return `${(this as any)["todos.*.title"]}${(this as any)["todos.*.done"] ? "!" : ""}`; },
        },
      );
      await write((s) => { s.todos[0].done = true; s.$postUpdate("todos"); });
      expect([root.querySelector("b")!.textContent, texts(root, "i").join(",")]).toEqual(["1", "a!,b"]);
    });
  });

  // Issue が #365 の系統として扱う形（絞り込みが写しを返すとき、写しの行の checkbox を入れる）
  it.fails("参考（#365 の系統）: filter = active（写し）で 1 行目の checkbox を入れると left と todos.0.done が新しくなる", async () => {
    const { root, write, read } = await page(htmlBoth, todoState());
    await write((s) => { s.filter = "active"; });
    const box = root.querySelector("ul.shown input") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await flush();
    expect(read("todos.0.done")).toBe(true);
    // `left`・for: todos の行・for: shown（active の絞り込みから入れた行が抜ける）
    expect([root.querySelector("b")!.textContent, read("left"), rowsOf(root, "todos"), rowsOf(root, "shown")])
      .toEqual(["1", 1, "a:true,b:false", "b:false"]);
  });
});

// ---------------------------------------------------------------- #378

describe("#378 for で描くリストの配列を別のキーへ退避し、元のキーに絞り込んだ配列を代入しても、退避したキーの添字のパスが正しい要素を指す", () => {
  const html = `<ul class="items"><template data-wcs="for: items"><li>{{ .n }}</li></template></ul>`;
  const state = () => ({
    items: [{ n: "a" }, { n: "b" }, { n: "c" }, { n: "d" }],
    backup: [] as any[],
    removeA(this: any) {
      this.backup = this.items;
      this.items = this.items.filter((x: any) => x.n !== "a");
    },
  });
  const backupReads = (read: (p: string) => unknown) => [0, 1, 2, 3].map((i) => read(`backup.${i}.n`));
  const rawBackup = (read: (p: string) => unknown) => (read("backup") as any[]).map((x) => x.n).join(",");

  it("Issue の手順（removeA() の後の読みと書き込み）", async () => {
    const { root, write, read } = await page(html, state());
    await write((s) => { s.removeA(); });
    expect(texts(root, "ul.items li").join(",")).toBe("b,c,d");
    expect(backupReads(read)).toEqual(["a", "b", "c", "d"]);
    await write((s) => { s["backup.1.n"] = "X"; });
    expect(rawBackup(read)).toBe("a,X,c,d");
    expect(texts(root, "ul.items li").join(",")).toBe("b,c,d");
  });

  it("同じ結果になる形: 退避と代入を別々のバッチで書く", async () => {
    const { write, read } = await page(html, state());
    await write((s) => { s.backup = s.items; });
    await write((s) => { s.items = s.items.filter((x: any) => x.n !== "a"); });
    expect(backupReads(read)).toEqual(["a", "b", "c", "d"]);
    await write((s) => { s["backup.1.n"] = "X"; });
    expect(rawBackup(read)).toBe("a,X,c,d");
  });

  it("対照: for: backup も描く", async () => {
    const { root, write, read } = await page(`${html}<ul class="backup"><template data-wcs="for: backup"><li>{{ .n }}</li></template></ul>`, state());
    await write((s) => { s.removeA(); });
    expect(backupReads(read)).toEqual(["a", "b", "c", "d"]);
    expect(texts(root, "ul.backup li").join(",")).toBe("a,b,c,d");
    await write((s) => { s["backup.1.n"] = "X"; });
    expect(texts(root, "ul.backup li").join(",")).toBe("a,X,c,d");
    expect(rawBackup(read)).toBe("a,X,c,d");
  });

  it.fails("参考（#365 の系統）: for: backup も描き、s[\"backup.1.n\"] = \"X\" が同じオブジェクトを持つ for: items の行にも出る", async () => {
    const { root, write } = await page(`${html}<ul class="backup"><template data-wcs="for: backup"><li>{{ .n }}</li></template></ul>`, state());
    await write((s) => { s.removeA(); });
    await write((s) => { s["backup.1.n"] = "X"; });
    expect(texts(root, "ul.items li").join(",")).toBe("X,c,d");
  });

  it("対照: 別々のバッチの間に backup の要素を読んでおく", async () => {
    const { write, read } = await page(html, state());
    await write((s) => { s.backup = s.items; });
    expect(backupReads(read)).toEqual(["a", "b", "c", "d"]);
    await write((s) => { s.items = s.items.filter((x: any) => x.n !== "a"); });
    expect(backupReads(read)).toEqual(["a", "b", "c", "d"]);
  });

  // Issue が #365 の系統とした形: 別の配列に同じオブジェクトがあり、片方の行への葉の書き込みがもう片方の for の行に届くか
  it.fails("参考（#365 の系統）: その後の s[\"backup.2.n\"] = \"Y\" が backup[2] に着地し、同じオブジェクトを持つ for: items の行にも出る", async () => {
    const { root, write, read } = await page(html, state());
    await write((s) => { s.backup = s.items; });
    backupReads(read);
    await write((s) => { s.items = s.items.filter((x: any) => x.n !== "a"); });
    await write((s) => { s["backup.2.n"] = "Y"; });
    expect(rawBackup(read)).toBe("a,b,Y,d");
    expect(texts(root, "ul.items li").join(",")).toBe("b,Y,d");
  });

  it("対照: 元に戻す s.items = s.backup", async () => {
    const { root, write, read } = await page(html, state());
    await write((s) => { s.removeA(); });
    await write((s) => { s.items = s.backup; });
    expect(texts(root, "ul.items li").join(",")).toBe("a,b,c,d");
    expect(backupReads(read)).toEqual(["a", "b", "c", "d"]);
    expect([0, 1, 2, 3].map((i) => read(`items.${i}.n`))).toEqual(["a", "b", "c", "d"]);
  });

  it("for を描かない形: removeA() の後の読み", async () => {
    const { write, read } = await page(`<p>{{ items.length }}</p>`, state());
    await write((s) => { s.removeA(); });
    expect(backupReads(read)).toEqual(["a", "b", "c", "d"]);
  });
});

// ---------------------------------------------------------------- #379

describe("#379 2 つの外側の行が同じ内側の配列を持つとき、内側の要素の差し替えが両方の行に出る", () => {
  const html = `<template data-wcs="for: groups"><div><template data-wcs="for: .items"><span>{{ .v }}</span></template>|</div></template>`;
  const state = () => {
    const inner = [{ v: "a" }, { v: "b" }];
    return { groups: [{ items: inner }, { items: inner }] };
  };
  /** outer row 0 / outer row 1 */
  const shown = (root: ParentNode) => Array.from(root.querySelectorAll("div")).map((d) => texts(d, "span").join(",")).join(" / ");

  it("Issue の手順", async () => {
    const { root, write, read } = await page(html, state());
    const seen = [shown(root)];
    await write((s) => { s["groups.0.items.1"] = { v: "B" }; });
    seen.push(shown(root));
    expect([read("groups.0.items.1.v"), read("groups.1.items.1.v")]).toEqual(["B", "B"]);
    await write((s) => { s["groups.1.items.0"] = { v: "A" }; });
    seen.push(shown(root));
    await write((s) => { s["groups.0.items.1.v"] = "Q"; });
    seen.push(shown(root));
    expect(seen).toEqual(["a,b / a,b", "a,B / a,B", "A,B / A,B", "A,Q / A,Q"]);
  });

  it("行の中のボタンから書く（外側の行 0 の 2 行目のボタン）", async () => {
    const { root } = await page(
      `<template data-wcs="for: groups"><div><template data-wcs="for: .items"><span>{{ .v }}</span><button data-wcs="onclick: rep">r</button></template>|</div></template>`,
      { ...state(), rep(this: any) { this["groups.*.items.*"] = { v: String(this["groups.*.items.*.v"]).toUpperCase() }; } },
    );
    await click(root.querySelectorAll("div")[0].querySelectorAll("button")[1]);
    expect(shown(root)).toBe("a,B / a,B");
  });

  it("同じ結果になる形: 行 1 を通して最初に書く", async () => {
    const { root, write } = await page(html, state());
    await write((s) => { s["groups.1.items.1"] = { v: "B" }; });
    expect(shown(root)).toBe("a,B / a,B");
  });

  it("同じ結果になる形: 行の getter で内側の配列をそのまま返す（for: .shown）", async () => {
    const { root, write } = await page(
      `<template data-wcs="for: groups"><div><template data-wcs="for: .shown"><span>{{ .v }}</span></template>|</div></template>`,
      { ...state(), get "groups.*.shown"() { return (this as any)["groups.*.items"]; } },
    );
    await write((s) => { s["groups.0.items.1"] = { v: "B" }; });
    expect(shown(root)).toBe("a,B / a,B");
    await write((s) => { s["groups.1.items.0.v"] = "P"; });
    expect(shown(root)).toBe("P,B / P,B");
  });

  it("対照: 葉の書き込みだけ", async () => {
    const { root, write } = await page(html, state());
    await write((s) => { s["groups.0.items.1.v"] = "Q"; });
    expect(shown(root)).toBe("a,Q / a,Q");
    await write((s) => { s["groups.1.items.0.v"] = "P"; });
    expect(shown(root)).toBe("P,Q / P,Q");
  });

  it("v3.3.0 からある別の壊れ方: 行 1 を通して差し替えた後に外側の一覧を写しても失敗しない", async () => {
    let p!: Awaited<ReturnType<typeof page>>;
    const errors = await errorsOf(async () => {
      p = await page(html, state());
      await p.write((s) => { s["groups.1.items.1"] = { v: "B" }; });
      await p.write((s) => { s.groups = [...s.groups]; });
    });
    expect(errors).toEqual([]);
    expect(shown(p.root)).toBe("a,B / a,B");
    await p.write((s) => { s["groups.0.items.0"] = { v: "A" }; });
    expect(shown(p.root)).toBe("A,B / A,B");
  });

  it("外側の行を足す（同じ内側の配列を持つ 3 つ目の行）と、その後の差し替えが 3 行すべてに出る", async () => {
    const { root, write } = await page(html, state());
    await write((s) => { s.groups = [...s.groups, { items: s["groups.0.items"] }]; });
    expect(shown(root)).toBe("a,b / a,b / a,b");
    await write((s) => { s["groups.2.items.1"] = { v: "B" }; });
    expect(shown(root)).toBe("a,B / a,B / a,B");
    await write((s) => { s["groups.0.items"] = [...s["groups.0.items"], { v: "c" }]; });
    // a new array for row 0 only (rows 1 and 2 keep the old one)
    expect(shown(root)).toBe("a,B,c / a,B / a,B");
    await write((s) => { s["groups.1.items.0"] = { v: "A" }; });
    expect(shown(root)).toBe("a,B,c / A,B / A,B");
  });
});

// ---------------------------------------------------------------- #380

describe("#380 for で描くリストの入れ替えでも、$watch(\"items.*\") の prev はその位置のバッチ開始時の値", () => {
  const setup = (seen: unknown[][], html = `<ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`) =>
    page(html, {
      items: ["a", "b", "c"],
      $watch: { "items.*"(cur: unknown, prev: unknown, i: number) { seen.push([cur, prev, i]); } },
    });
  const byIndex = (seen: unknown[][]) => [...seen].sort((a, b) => (a[a.length - 1] as number) - (b[b.length - 1] as number));

  it("1 バッチで入れ替える（プリミティブ）", async () => {
    const seen: unknown[][] = [];
    const { root, write } = await setup(seen);
    await write((s) => { const t = s["items.0"]; s["items.0"] = s["items.2"]; s["items.2"] = t; });
    expect(texts(root, "li").join(",")).toBe("c,b,a");
    expect(byIndex(seen)).toEqual([["c", "a", 0], ["a", "c", 2]]);
  });

  it("2 バッチ（揃えるバッチで 2 つ書く・2 → 1 の順）", async () => {
    const seen: unknown[][] = [];
    const { root, write } = await setup(seen);
    await write((s) => { s["items.0"] = "c"; });
    expect(texts(root, "li").join(",")).toBe("c,b,c");
    expect(seen).toEqual([["c", "a", 0]]);
    seen.length = 0;
    await write((s) => { s["items.2"] = "b"; s["items.1"] = "a"; });
    expect(texts(root, "li").join(",")).toBe("c,a,b");
    expect(byIndex(seen)).toEqual([["a", "b", 1], ["b", "c", 2]]);
  });

  it("2 バッチ（揃えるバッチで 2 つ書く・1 → 2 の順）", async () => {
    const seen: unknown[][] = [];
    const { root, write } = await setup(seen);
    await write((s) => { s["items.0"] = "c"; });
    seen.length = 0;
    await write((s) => { s["items.1"] = "a"; s["items.2"] = "b"; });
    expect(texts(root, "li").join(",")).toBe("c,a,b");
    expect(byIndex(seen)).toEqual([["a", "b", 1], ["b", "c", 2]]);
  });

  it("オブジェクトの形（2 バッチ）: 書いた位置だけ呼ばれる", async () => {
    const A = { id: "A" };
    const B = { id: "B" };
    const C = { id: "C" };
    const seen: unknown[][] = [];
    const { root, write } = await page(`<ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>`, {
      items: [A, B, C],
      $watch: { "items.*"(cur: any, prev: unknown, i: number) { seen.push([cur.id, prev, i]); } },
    });
    await write((s) => { s["items.0"] = C; });
    expect(seen).toEqual([["C", undefined, 0]]);
    seen.length = 0;
    await write((s) => { s["items.2"] = B; s["items.1"] = A; });
    expect(texts(root, "li").join(",")).toBe("C,A,B");
    expect(byIndex(seen)).toEqual([["A", undefined, 1], ["B", undefined, 2]]);
  });

  it("対照: for を描かない 1 バッチの入れ替え", async () => {
    const seen: unknown[][] = [];
    const { write } = await setup(seen, `<p>{{ items.length }}</p>`);
    await write((s) => { const t = s["items.0"]; s["items.0"] = s["items.2"]; s["items.2"] = t; });
    expect(byIndex(seen)).toEqual([["c", "a", 0], ["a", "c", 2]]);
  });

  it("対照: オブジェクトを 1 バッチで入れ替える", async () => {
    const A = { id: "A" };
    const B = { id: "B" };
    const C = { id: "C" };
    const seen: unknown[][] = [];
    const { write } = await page(`<ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>`, {
      items: [A, B, C],
      $watch: { "items.*"(cur: any, _prev: unknown, i: number) { seen.push([cur.id, i]); } },
    });
    await write((s) => { const t = s["items.0"]; s["items.0"] = s["items.2"]; s["items.2"] = t; });
    expect(byIndex(seen)).toEqual([["C", 0], ["A", 2]]);
  });
});

// ---------------------------------------------------------------- #381

describe("#381 1 つのバッチで一覧を 2 回置き換えても、$eqIndex の行 getter が選択の位置に来た行で評価し直される", () => {
  const html = `<ul><template data-wcs="for: items"><li>{{ .id }}:{{ .current }}</li></template></ul>`;
  const eqIndexState = (ids: string[], sel: number) => ({
    items: ids.map((id) => ({ id })),
    selectedIndex: sel,
    get "items.*.current"() { return (this as any).$eqIndex("selectedIndex") ? "Y" : "-"; },
  });
  const dollarState = (ids: string[], sel: number) => ({
    items: ids.map((id) => ({ id })),
    selectedIndex: sel,
    get "items.*.current"() { const self = this as any; return self.$1 === self.selectedIndex ? "Y" : "-"; },
  });
  const lis = (root: ParentNode) => texts(root, "li").join(",");

  it("Issue の手順", async () => {
    const { root, write, read } = await page(html, eqIndexState(["a", "b", "c"], 0));
    expect([lis(root), read("items.0.current")]).toEqual(["a:Y,b:-,c:-", "Y"]);
    await write((s) => { s.items = s.items.slice(1); s.items = s.items.slice(1); });
    expect([lis(root), read("items.0.current")]).toEqual(["c:Y", "Y"]);
    await write((s) => { s.items = [...s.items, { id: "d" }]; });
    expect(lis(root)).toBe("c:Y,d:-");
    await write((s) => { s.selectedIndex = 1; });
    expect(lis(root)).toBe("c:-,d:Y");
    await write((s) => { s.selectedIndex = 0; });
    expect(lis(root)).toBe("c:Y,d:-");
  });

  it("対照: 2 つのバッチに分ける", async () => {
    const { root, write } = await page(html, eqIndexState(["a", "b", "c"], 0));
    await write((s) => { s.items = s.items.slice(1); });
    await write((s) => { s.items = s.items.slice(1); });
    expect(lis(root)).toBe("c:Y");
  });

  it("対照: $1 === selectedIndex の行 getter", async () => {
    const { root, write, read } = await page(html, dollarState(["a", "b", "c"], 0));
    await write((s) => { s.items = s.items.slice(1); s.items = s.items.slice(1); });
    expect([lis(root), read("items.0.current")]).toEqual(["c:Y", "Y"]);
  });

  const ops: [string, (a: any[]) => any[]][] = [
    // Issue の「2 番目を消す」は 0 始まりの添字 2 を消す（Issue の表の結果から）
    ["2 番目を消す", (a) => a.filter((_x, i) => i !== 2)],
    ["逆順", (a) => [...a].reverse()],
    ["先頭に足す", (a) => [{ id: "n" }, ...a]],
    ["先頭を消す", (a) => a.slice(1)],
    ["末尾に足す", (a) => [...a, { id: "m" }]],
  ];

  it.each<[string, string[], number, string, string, string]>([
    ["r0〜r3", ["r0", "r1", "r2", "r3"], 0, "2 番目を消す", "逆順", "r3:Y,r1:-,r0:-"],
    ["r0〜r3", ["r0", "r1", "r2", "r3"], 2, "逆順", "2 番目を消す", "r3:-,r2:-,r0:Y"],
    ["r0〜r3", ["r0", "r1", "r2", "r3"], 1, "先頭に足す", "逆順", "r3:-,r2:Y,r1:-,r0:-,n:-"],
    ["r0〜r4", ["r0", "r1", "r2", "r3", "r4"], 1, "2 番目を消す", "逆順", "r4:-,r3:Y,r1:-,r0:-"],
  ])("Issue のほかの組み合わせ: %s・%j・selectedIndex %i・%s → %s", async (_n, ids, sel, op1, op2, expected) => {
    const f1 = ops.find((o) => o[0] === op1)![1];
    const f2 = ops.find((o) => o[0] === op2)![1];
    const { root, write } = await page(html, eqIndexState(ids, sel));
    await write((s) => { s.items = f1(s.items); s.items = f2(s.items); });
    expect(lis(root)).toBe(expected);
  });

  it("総当たり（4 行・5 行、selectedIndex 0〜3、1 バッチに 2 つの置き換え）: 表示と読みが $1 の形と同じ・期待どおり", async () => {
    const bad: string[] = [];
    for (const ids of [["r0", "r1", "r2", "r3"], ["r0", "r1", "r2", "r3", "r4"]]) {
      for (let sel = 0; sel <= 3; sel++) {
        for (const [n1, f1] of ops) {
          for (const [n2, f2] of ops) {
            const { root, write, read, host } = await page(html, eqIndexState(ids, sel));
            let after: any[] = [];
            await write((s) => { s.items = f1(s.items); s.items = f2(s.items); after = s.items; });
            const expected = after.map((x: any, i: number) => `${x.id}:${i === sel ? "Y" : "-"}`).join(",");
            const got = lis(root);
            const reads = after.map((_x, i) => read(`items.${i}.current`)).join("");
            const expReads = after.map((_x, i) => (i === sel ? "Y" : "-")).join("");
            if (got !== expected || reads !== expReads) bad.push(`${ids.length} 行 sel=${sel} ${n1}→${n2}: ${got} / 期待 ${expected}`);
            host.remove();
          }
        }
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it("総当たり（1 バッチに 3 つの置き換え、4 行、selectedIndex 0〜2）", async () => {
    const bad: string[] = [];
    const ids = ["r0", "r1", "r2", "r3"];
    for (let sel = 0; sel <= 2; sel++) {
      for (const [n1, f1] of ops) {
        for (const [n2, f2] of ops) {
          for (const [n3, f3] of ops) {
            const { root, write, host } = await page(html, eqIndexState(ids, sel));
            let after: any[] = [];
            await write((s) => { s.items = f1(s.items); s.items = f2(s.items); s.items = f3(s.items); after = s.items; });
            const expected = after.map((x: any, i: number) => `${x.id}:${i === sel ? "Y" : "-"}`).join(",");
            const got = lis(root);
            if (got !== expected) bad.push(`sel=${sel} ${n1}→${n2}→${n3}: ${got} / 期待 ${expected}`);
            host.remove();
          }
        }
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it("入れ子の一覧の $eqIndex（level 2）: 1 バッチで内側を 2 回置き換える", async () => {
    const { root, write } = await page(
      `<template data-wcs="for: groups"><p><template data-wcs="for: .items"><i>{{ .id }}:{{ .current }}</i></template></p></template>`,
      {
        groups: [{ items: [{ id: "a" }, { id: "b" }, { id: "c" }] }],
        selectedIndex: 0,
        get "groups.*.items.*.current"() { return (this as any).$eqIndex("selectedIndex", 2) ? "Y" : "-"; },
      },
    );
    expect(texts(root, "i").join(",")).toBe("a:Y,b:-,c:-");
    await write((s) => { s["groups.0.items"] = s["groups.0.items"].slice(1); s["groups.0.items"] = s["groups.0.items"].slice(1); });
    expect(texts(root, "i").join(",")).toBe("c:Y");
  });
});
