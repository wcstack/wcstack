/**
 * issues2-paths.test.ts — 現行 @wcstack/state 3.3 の Issue #382・#383・#388・#389・#390
 * （数値添字のパスの読み書き・`*` と数値添字の混ざったパス・数値添字の `for:` の診断・
 * 要素の書き込みと入れ子の一覧の性能）を state-next で流す。各 Issue の「期待」を確かめる。
 * F37（#388 の診断）も置く。まだ直していない F34（数値キーのオブジェクト）は it.fails で症状を残す。
 * 性能（#389・#390）の計測は bench/issues2.perf.test.ts（単体テストには #390 の正しさだけを置く）。
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
  const h = document.createElement(`issues2-paths-page-${seq++}`);
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
/** 計測値と参考の値を、テストの成否によらず出す（vitest は通ったテストの console.log を出さないことがある）。 */
const log = (...a: unknown[]) => { process.stdout.write(`${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}\n`); };

// ---------------------------------------------------------------- #382

describe("#382 数値添字のパスのスクリプト側の読み書き・$watch のキー", () => {
  describe("1. $watch(\"items.0.v\") が添字の書き込みで発火する", () => {
    const run = async (markup: string) => {
      const calls: unknown[][] = [];
      const { write, root } = await page(markup, {
        items: [{ v: 1 }, { v: 2 }],
        $watch: { "items.0.v"(cur: unknown, prev: unknown) { calls.push([cur, prev]); } },
      });
      const step = async (fn: (s: any) => void) => { calls.length = 0; await write(fn); return calls.slice(); };
      return { step, root, calls };
    };

    it.each([
      ["マークアップは {{ items.length }} だけ", `<p>{{ items.length }}</p>`],
      ["for: items で {{ .v }} を描く", `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`],
      ["対照: {{ items.0.v }} を描く", `<p>{{ items.0.v }}</p>`],
    ])("%s", async (_name, markup) => {
      const { step } = await run(markup);
      expect(await step((s) => { s["items.0.v"] = 5; })).toEqual([[5, 1]]);
      expect(await step((s) => { s["items.0"] = { v: 6 }; })).toEqual([[6, 5]]);
      expect(await step((s) => { s.items = [{ v: 7 }]; })).toEqual([[7, 6]]);
    });

    it("（参考）ほかの行の書き込み・並べ替え・行の追加での発火", async () => {
      const { step } = await run(`<p>{{ items.length }}</p>`);
      const other = await step((s) => { s["items.1.v"] = 3; });
      const reorder = await step((s) => { s.items = [s["items.1"], s["items.0"]]; });
      log("#382-1 参考: items.1.v への書き込みで", JSON.stringify(other), "／ 並べ替えで", JSON.stringify(reorder));
      // 並べ替えで位置 0 の値は 1 → 3 に変わる
      expect(reorder).toEqual([[3, 1]]);
    });

    it("まだ無い行のキー（items.2.v）は、行が入ったとき発火する", async () => {
      const calls: unknown[][] = [];
      const { write } = await page(`<p>{{ items.length }}</p>`, {
        items: [{ v: 1 }],
        $watch: { "items.2.v"(cur: unknown, prev: unknown) { calls.push([cur, prev]); } },
      });
      await write((s) => { s.items = [...s.items, { v: 2 }, { v: 3 }]; });
      expect(calls).toEqual([[3, undefined]]);
    });
  });

  // F34（まだ直していない）: スクリプト側の読み・書き・$eq は、数値の段を一覧の添字として解く。it.fails で症状を残す
  describe("2. 数値のキーを持つオブジェクト（sales.2024.total）", () => {
    const state = () => ({
      sales: { 2024: { total: 10 } } as Record<number, { total: number }>,
      get t() { return (this as any)["sales.2024.total"]; },
      get hit() { return (this as any).$eq("sales.2024.total", 11) ? "Y" : "n"; },
      get hit10() { return (this as any).$eq("sales.2024.total", 10) ? "Y" : "n"; },
    });
    const markup = `<p class="lit">{{ sales.2024.total }}</p><p class="t">{{ t }}</p><p class="hit">{{ hit }}</p><p class="hit10">{{ hit10 }}</p>`;

    it("{{ sales.2024.total }} は 10", async () => {
      const { root } = await page(markup, state());
      expect(text(root, ".lit")).toBe("10");
    });

    it.fails("{{ t }}（getter の中の this[\"sales.2024.total\"]）は 10", async () => {
      const errors = spyConsole("error");
      const { root } = await page(markup, state());
      expect(errors).toEqual([]);
      expect(text(root, ".t")).toBe("10");
    });

    it.fails("スクリプトの読み s[\"sales.2024.total\"] は 10", async () => {
      const { read } = await page(markup, state());
      expect(read("sales.2024.total")).toBe(10);
    });

    it.fails("スクリプトの書き込み s[\"sales.2024.total\"] = 11 は書ける（{{ sales.2024.total }} を描いていても）", async () => {
      const { el, root } = await page(markup, state());
      const e = thrown(() => el.createState("writable", (s: any) => { s["sales.2024.total"] = 11; }));
      await flush(); await flush();
      expect(e).toBeUndefined();
      expect(text(root, ".lit")).toBe("11");
    });

    it("$watch: { \"sales.2024.total\" } は接続時に投げない", async () => {
      const errors = spyConsole("error");
      const calls: unknown[][] = [];
      const { write } = await page(`<p>x</p>`, {
        sales: { 2024: { total: 10 } },
        $watch: { "sales.2024.total"(cur: unknown, prev: unknown) { calls.push([cur, prev]); } },
      });
      expect(errors).toEqual([]);
      await write((s) => { s.sales = { 2024: { total: 12 } }; });
      expect(calls).toEqual([[12, 10]]);
    });

    it.fails("get hit() の $eq(\"sales.2024.total\", 11) は n、書き込みの後は Y", async () => {
      const errors = spyConsole("error");
      const { root, write } = await page(markup, state());
      expect(errors).toEqual([]);
      expect(text(root, ".hit")).toBe("n");
      await write((s) => { s.sales = { 2024: { total: 11 } }; });
      expect(text(root, ".hit")).toBe("Y");
    });

    it.fails("（Issue の表に無い対照）$eq(\"sales.2024.total\", 10) は Y", async () => {
      const { root } = await page(markup, state());
      expect(text(root, ".hit10")).toBe("Y");
    });

    it.fails("（Issue の表に無い形）双方向の束縛 value: sales.2024.total の書き戻し", async () => {
      const errors = spyConsole("error");
      const { root, read } = await page(`<input data-wcs="value: sales.2024.total"><p class="lit">{{ sales.2024.total }}</p>`, { sales: { 2024: { total: 10 } } });
      const input = root.querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("10");
      input.value = "11";
      const e = thrown(() => input.dispatchEvent(new Event("input", { bubbles: true })));
      await flush(); await flush();
      log("#382-2 双方向の書き戻し: 例外", e === undefined ? "なし" : String((e as Error).message), "console.error", errors, "sales", read("sales"));
      expect(e).toBeUndefined();
      expect(errors).toEqual([]);
      expect(text(root, ".lit")).toBe("11");
    });
  });

  describe("3. 空の一覧で this[\"items.0.v\"]", () => {
    it("{{ first }} は (none)、要素が入ると 1", async () => {
      const errors = spyConsole("error");
      const { root, write } = await page(`<p class="f">{{ first }}</p><p class="b">{{ isB }}</p><p class="l">{{ items.0.v }}</p>`, {
        items: [] as { v: unknown }[],
        get first() { return (this as any)["items.0.v"] ?? "(none)"; },
        get isB() { return (this as any).$eq("items.0.v", "b") ? "Y" : "n"; },
      });
      expect(errors).toEqual([]);
      expect(text(root, ".f")).toBe("(none)");
      expect(text(root, ".b")).toBe("n");
      expect(text(root, ".l")).toBe("");
      await write((s) => { s.items = [{ v: 1 }]; });
      expect(text(root, ".f")).toBe("1");
      await write((s) => { s["items.0.v"] = "b"; });
      expect(text(root, ".b")).toBe("Y");
      expect(text(root, ".l")).toBe("b");
    });
  });
});

// ---------------------------------------------------------------- #383

describe("#383 行 getter の中で * と数値添字の混ざったパスを読む", () => {
  const groups = () => [{ name: "g0", sel: [{ id: "a" }] }, { name: "g1", sel: [{ id: "b" }] }];
  const markup = `<template data-wcs="for: groups"><p>{{ .name }}:{{ .isA }}</p></template>`;
  const shown = (root: ParentNode) => texts(root, "p").join(",");

  it.each<[string, () => unknown]>([
    ["this[\"groups.*.sel.0.id\"]", function (this: any) { return this["groups.*.sel.0.id"] === "a" ? "Y" : "n"; }],
    ["this.$eq(\"groups.*.sel.0.id\", \"a\")", function (this: any) { return this.$eq("groups.*.sel.0.id", "a") ? "Y" : "n"; }],
    ["回避策 1: $resolve", function (this: any) { return this.$resolve("groups.*.sel.*.id", [this.$1, 0]) === "a" ? "Y" : "n"; }],
  ])("%s: g0:Y,g1:n、書き込みに追従する", async (_name, fn) => {
    const errors = spyConsole("error");
    const state: Record<string, any> = { groups: groups() };
    Object.defineProperty(state, "groups.*.isA", { get: fn, enumerable: true, configurable: true });
    const { root, write } = await page(markup, state);
    expect(errors).toEqual([]);
    expect(shown(root)).toBe("g0:Y,g1:n");
    await write((s) => { s["groups.1.sel.0.id"] = "a"; });
    expect(shown(root)).toBe("g0:Y,g1:Y");
    await write((s) => { s["groups.0.sel.0"] = { id: "z" }; });
    expect(shown(root)).toBe("g0:n,g1:Y");
    await write((s) => { s["groups.0.sel"] = [{ id: "a" }, { id: "q" }]; });
    expect(shown(root)).toBe("g0:Y,g1:Y");
    await write((s) => { s["groups.1.sel.0.id"] = "b"; });
    expect(shown(root)).toBe("g0:Y,g1:n");
    await write((s) => { s.groups = [s["groups.1"], s["groups.0"]]; });
    expect(shown(root)).toBe("g1:n,g0:Y");
    await write((s) => { s.groups = [...s.groups, { name: "g2", sel: [{ id: "a" }] }]; });
    expect(shown(root)).toBe("g1:n,g0:Y,g2:Y");
    expect(errors).toEqual([]);
  });

  it("回避策 2: this[\"groups.*.sel\"][0].id は読める（葉の依存は張られない）", async () => {
    const errors = spyConsole("error");
    const state: Record<string, any> = { groups: groups() };
    Object.defineProperty(state, "groups.*.isA", {
      get(this: any) { return this["groups.*.sel"][0].id === "a" ? "Y" : "n"; }, enumerable: true, configurable: true,
    });
    const { root, write } = await page(markup, state);
    expect(shown(root)).toBe("g0:Y,g1:n");
    await write((s) => { s["groups.1.sel.0.id"] = "a"; });
    log("#383 回避策 2: 葉の書き込みの後", shown(root));
    await write((s) => { s["groups.1.sel"] = [{ id: "a" }]; });
    expect(shown(root)).toBe("g0:Y,g1:Y");
    expect(errors).toEqual([]);
  });

  it("対照: 行の束縛 {{ .sel.0.id }} とスクリプトの読み s[\"groups.1.sel.0.id\"]", async () => {
    const { root, read } = await page(`<template data-wcs="for: groups"><p>{{ .name }}:{{ .sel.0.id }}</p></template>`, { groups: groups() });
    expect(shown(root)).toBe("g0:a,g1:b");
    expect(read("groups.1.sel.0.id")).toBe("b");
  });

  it("（参考）行の外（ルートの getter）の this[\"groups.*.sel.0.id\"]", async () => {
    const errors = spyConsole("error");
    const { root } = await page(`<p class="x">{{ x }}</p>`, {
      groups: groups(),
      get x() { return String((this as any)["groups.*.sel.0.id"]); },
    });
    log("#383 参考: ルートの getter の this[\"groups.*.sel.0.id\"] →", JSON.stringify(text(root, ".x")), "errors:", JSON.stringify(errors));
    const other = await page(`<p class="x">{{ x }}</p>`, {
      items: [{ v: 1 }],
      get x() { return String((this as any)["items.*.v"]); },
    });
    log("#383 参考: ルートの getter の this[\"items.*.v\"] →", JSON.stringify(text(other.root, ".x")), "errors:", JSON.stringify(errors));
  });
});

// ---------------------------------------------------------------- #388

describe("#388 数値添字のパスの for: の行の中の存在しないパスの診断", () => {
  const state = () => ({
    groups: [{ items: [{ name: "a", n: 1 }, { name: "b", n: 2 }] }],
    items: [{ name: "a" }],
    get "groups.*.items.*.double"() { return (this as any)["groups.*.items.*.n"] * 2; },
  });
  const run = async (markup: string) => {
    const warns = spyConsole("warn");
    const { root } = await page(markup, state());
    await flush(); await flush();
    return { warns, root, shown: texts(root, "i").join("") };
  };
  const about = (warns: string[], path: string) => warns.filter((w) => w.includes(`"${path}"`));

  it("for: groups.0.items の {{ .nmae }} は警告する（Did you mean \"name\"）", async () => {
    const { warns, shown } = await run(`<template data-wcs="for: groups.0.items"><i>{{ .nmae }},</i></template>`);
    expect(shown).toBe(",,");
    const w = about(warns, "groups.0.items.*.nmae");
    expect(w.length).toBe(1);
    expect(w[0]).toContain("binding-path-missing");
    expect(w[0]).toContain("\"nmae\" is not declared");
    expect(w[0]).toContain("name");
    log("#388 .nmae の警告:", w[0]);
  });

  it("F37: for: groups.0.items の {{ .double }}（行 getter は groups.*.items.* に宣言）は、どこに効く getter かを添えて警告する", async () => {
    const { warns, shown } = await run(`<template data-wcs="for: groups.0.items"><i>{{ .double }},</i></template>`);
    expect(shown).toBe(",,");
    expect(about(warns, "groups.0.items.*.double")).toEqual([
      '[@wcstack/state] [wcs/binding-path-missing] Bound path "groups.0.items.*.double" does not resolve on the state tree: "double" is not declared.'
      + ' The getter "groups.*.items.*.double" is declared for the rows of for: groups → for: .items; a list named by an index has rows of its own.'
      + " Updates to this path will be silently dropped. Validate statically: npx @wcstack/lint <file>.",
    ]);
  });

  it("F37: 数値添字の後ろに * が無いパス（{{ groups.0.items.0.double }}）は、これまでどおり getter として読み、警告しない", async () => {
    const { warns, root } = await run(`<p>{{ groups.0.items.1.double }}</p>`);
    expect(root.querySelector("p")!.textContent).toBe("4");
    expect(warns.filter((w) => w.includes("wcs/"))).toEqual([]);
  });

  it.each([
    ["for: items の {{ .nmae }}", `<template data-wcs="for: items"><i>{{ .nmae }},</i></template>`, "items.*.nmae"],
    ["for: groups → for: .items の {{ .nmae }}", `<template data-wcs="for: groups"><template data-wcs="for: .items"><i>{{ .nmae }},</i></template></template>`, "groups.*.items.*.nmae"],
    ["for を使わない {{ groups.0.items.0.nmae }}", `<i>{{ groups.0.items.0.nmae }}</i>`, "groups.0.items.0.nmae"],
  ])("対照（警告する）: %s", async (_name, markup, path) => {
    const { warns } = await run(markup);
    expect(about(warns, path).length).toBe(1);
  });

  it("対照（警告しない）: for: groups.0.items の {{ .name }}", async () => {
    const { warns, shown } = await run(`<template data-wcs="for: groups.0.items"><i>{{ .name }},</i></template>`);
    expect(shown).toBe("a,b,");
    expect(warns.filter((w) => w.includes("wcs/"))).toEqual([]);
  });
});

// ---------------------------------------------------------------- #390

describe("#390 外側の行の位置が変わる更新（費用は bench/issues2.perf.test.ts）", () => {
  it("入れ子の {{ $1 }} は外側の並べ替えに追従する（#360 の正しさ）", async () => {
    const { root, write } = await page(`<div id="host"><template data-wcs="for: rows"><div><template data-wcs="for: .it"><i>{{ $1 }}.{{ $2 }}</i></template></div></template></div>`, {
      rows: [{ it: [1, 2] }, { it: [3] }],
    });
    expect(texts(root, "i")).toEqual(["0.0", "0.1", "1.0"]);
    await write((s) => { s.rows = [{ it: [9] }, ...s.rows]; });
    expect(texts(root, "i")).toEqual(["0.0", "1.0", "1.1", "2.0"]);
    await write((s) => { s.rows = s.rows.slice(2); });
    expect(texts(root, "i")).toEqual(["0.0"]);
  });
});
