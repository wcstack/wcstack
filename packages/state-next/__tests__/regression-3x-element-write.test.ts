/**
 * regression-3x-element-write.test.ts — @wcstack/state 3.4.0 で直した、リストの要素の書き込み・行の下のキャッシュ・
 * 同じ配列を描く別名の一覧の不具合（#333・#364・#389・#362）の回帰テストの形を、4.0 のエンジン（state-next）で流す。
 *
 * 移したもの: 3.x の packages/state/__tests__ の integration.elementWriteUnrenderedList（#333 ほか）・
 * integration.elementWriteCachedChildren（#364）・integration.elementWriteRowCacheCost（#364 / #389 の振る舞いだけ）・
 * integration.listAliasWrite（#362）と、修正の時に書き換えた watch.wildcard（S13）・integration.stateGenerationReset・
 * integration.recursionKnownDefects（#364 の部分）。観測できる振る舞い（表示・状態の値・$watch の呼び出し・
 * console.error）だけを見る。3.x の内部（ListIndex・台帳・静的な辺・更新に積んだアドレスの数）と計時は移さない。
 *
 * 4.0 との違い（docs/migration-v4.md）: 要素の書き込みはその位置の値を差し替え、行は動かない（§3.4。3.x の「新しい行」
 * 「入れ替え」は無い — 状態の値と描いた文字が正しいことだけを見る）。$scan は無い（§3.1）。
 * issues.test.ts（#333）・issues-lists.test.ts（#362・#364）・fixes.test.ts（F24）にある形は繰り返さない。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, recursion, scopes, ssr, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
const flushTimes = async (n = 3) => {
  for (let i = 0; i < n; i++) await flush();
};
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes, ssr, recursion]);
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const host = document.createElement(`regr3x-elwrite-page-${seq++}`);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(host);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flushTimes(2);
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flushTimes();
  };
  const get = <T>(fn: (s: any) => T): T => {
    let v: T | undefined;
    el.createState("readonly", (s: any) => { v = fn(s); });
    return v as T;
  };
  return { host, root, el, write, get };
}

/** Renders `html` as the server does (an orchestrated render, then the snapshot builder); its HTML. */
async function serverRender(html: string, state: Record<string, any>): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  try {
    const h = document.createElement(`regr3x-elwrite-server-${seq++}`);
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
  const h = document.createElement(`regr3x-elwrite-client-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flushTimes(2);
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flushTimes();
  };
  return { root, write };
}

const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);
const text = (c: ParentNode, sel: string) => c.querySelector(sel)!.textContent;
const click = async (n: Element) => { (n as HTMLElement).click(); await flushTimes(); };

/** console.error を集めながら走らせる（一覧の適用の失敗は console.error にだけ出ることがある）。 */
async function collectErrors(run: () => Promise<void>): Promise<unknown[][]> {
  const errors: unknown[][] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args); });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return errors;
}

/** 行の中を何も描かない for（3.x の対照）。描くのは行の数だけ */
const forOf = (list: string) => `<ul><template data-wcs="for: ${list}"><li>row</li></template></ul>`;
const VARIANTS: [string, (list: string) => string][] = [
  ["for で描かない", () => ""],
  ["行の中を描かない for で描く", forOf],
];
/** 行で `.name`（または指定の項目）を描く for */
const forOver = (list: string, field = "name", cls = "r") =>
  `<ul><template data-wcs="for: ${list}"><li class="${cls}">{{ .${field} }}</li></template></ul>`;
const rows = (root: ParentNode, cls = "r") => texts(root, `.${cls}`).join(",");

const node = (value: number, children: any[] = []): any => ({ value, children });

// ================================================================ #333

describe("#333 for で描いていないリストの要素を差し替えても、行の下の読み・getter・集計が新しい要素を読む", () => {
  it("Issue の HTML に行の中を描かない for: items を足しても、rename・toggle の後の getter と直後の読みが新しい値", async () => {
    const { root, get } = await page(
      `<b class="d">{{ doneCount }}</b><b class="f">{{ firstName }}</b><i class="s">{{ seen }}</i>`
      + `<button class="rn" data-wcs="onclick: rename"></button><button class="tg" data-wcs="onclick: toggle"></button>${forOf("items")}`,
      {
        items: [{ name: "a", done: false }, { name: "b", done: false }],
        seen: "",
        get firstName() { return (this as any)["items.0.name"]; },
        get doneCount() { return (this as any).$getAll("items.*.done", []).filter(Boolean).length; },
        rename(this: any) {
          this["items.0"] = { ...this["items.0"], name: "z" };
          this.seen = this["items.0.name"];
        },
        toggle(this: any) { this["items.0"] = { ...this["items.0"], done: !this["items.0"].done }; },
      },
    );
    const shown = () => [".d", ".f", ".s"].map((s) => text(root, s));
    expect(shown()).toEqual(["0", "a", ""]);
    await click(root.querySelector(".rn")!);
    expect(shown()).toEqual(["0", "z", "z"]);
    await click(root.querySelector(".tg")!);
    expect(shown()).toEqual(["1", "z", "z"]);
    expect(get((s) => s["items.0"])).toEqual({ name: "z", done: true });
  });

  describe("差し替えた行の下の読み", () => {
    it.each(VARIANTS)("行 getter（items.*.label）を添字・$getAll で読んでも、新しい要素から計算する（%s）", async (_label, extra) => {
      const { get, write } = await page(extra("items"), {
        items: [{ name: "a" }, { name: "b" }],
        get "items.*.label"() { return String((this as any)["items.*.name"]).toUpperCase(); },
      });
      expect(get((s) => [s["items.0.label"], s.$getAll("items.*.label", [])])).toEqual(["A", ["A", "B"]]);
      await write((s) => { s["items.0"] = { ...s["items.0"], name: "z" }; });
      expect(get((s) => [s["items.0.label"], s.$getAll("items.*.label", [])])).toEqual(["Z", ["Z", "B"]]);
    });

    it.each(VARIANTS)("$resolve(\"items.*\", [i], 値)・$setAll(\"items.*\", [], fn) による要素の書き込みも、子のパスに届く（%s）", async (_label, extra) => {
      const { get, write } = await page(extra("items"), { items: [{ v: 1 }, { v: 2 }] });
      expect(get((s) => s.$getAll("items.*.v", []))).toEqual([1, 2]);
      await write((s) => { s.$resolve("items.*", [1], { v: 5 }); });
      expect(get((s) => [s.$getAll("items.*.v", []), s["items.1.v"]])).toEqual([[1, 5], 5]);
      await write((s) => { s.$setAll("items.*", [], (row: any) => ({ v: row.v * 10 })); });
      expect(get((s) => [s.$getAll("items.*.v", []), s["items.0.v"]])).toEqual([[10, 50], 10]);
    });

    // 3.x は「同じ要素の書き戻しは行を据え置き、別の要素なら新しい行」。4.0 はどちらも行（DOM）を据え置き、
    // 値だけが替わる（docs/migration-v4.md §3.4「Writing a list element replaces the value at that position」）
    it("4.0 の行の同一性: 同じ要素の書き戻しも別の要素への差し替えも、行の DOM を据え置いて値を描き直す（migration-v4 §3.4）", async () => {
      const { root, get, write } = await page(`<ul><template data-wcs="for: items"><li><span>{{ .v }}</span><input class="i"></li></template></ul>`,
        { items: [{ v: 1 }, { v: 2 }] });
      const lis = () => Array.from(root.querySelectorAll("li"));
      const [li0, li1] = lis();
      (li1.querySelector(".i") as HTMLInputElement).value = "typed";
      await write((s) => { s["items.0"] = s["items.0"]; });
      await write((s) => { s["items.1"] = { v: 3 }; });
      expect(texts(root, "span")).toEqual(["1", "3"]);
      expect(get((s) => s.$getAll("items.*.v", []))).toEqual([1, 3]);
      expect(lis()[0]).toBe(li0);
      expect(lis()[1]).toBe(li1);
      expect((lis()[1].querySelector(".i") as HTMLInputElement).value).toBe("typed");
    });
  });

  describe("入れ子のリスト", () => {
    const groupsState = () => ({
      groups: [{ name: "g0", items: [{ v: 1 }, { v: 2 }] }, { name: "g1", items: [{ v: 3 }] }],
      get "groups.*.sum"() { return (this as any).$getAll("groups.*.items.*.v").reduce((a: number, b: number) => a + b, 0); },
      get "groups.*.label"() { return String((this as any)["groups.*.name"]).toUpperCase(); },
    });
    const OUTER: [string, string][] = [
      ["groups も描かない", ""],
      ["groups だけを行の中を描かない for で描く", forOf("groups")],
    ];

    it.each(OUTER)("groups.1.items.0 = … の後、内側の子のパスと外側の行 getter の集計が新しい値を返す（%s）", async (_label, html) => {
      const { get, write } = await page(html, groupsState());
      expect(get((s) => s.$getAll("groups.*.sum", []))).toEqual([3, 3]);
      await write((s) => { s["groups.1.items.0"] = { v: 30 }; });
      expect(get((s) => [s.$getAll("groups.*.sum", []), s["groups.1.items.0.v"]])).toEqual([[3, 30], 30]);
    });

    it.each(OUTER)("外側の行を差し替えても（内側の配列は持ち越す）、その後の内側の葉の書き込みが行 getter の集計に届く（%s）", async (_label, html) => {
      const { get, write } = await page(html, groupsState());
      expect(get((s) => [s.$getAll("groups.*.sum", []), s.$getAll("groups.*.label", [])])).toEqual([[3, 3], ["G0", "G1"]]);
      await write((s) => { s["groups.0"] = { ...s["groups.0"], name: "h0" }; });
      expect(get((s) => [s["groups.0.label"], s.$getAll("groups.*.label", [])])).toEqual(["H0", ["H0", "G1"]]);
      expect(get((s) => s.$getAll("groups.*.sum", []))).toEqual([3, 3]);
      await write((s) => { s["groups.0.items.1.v"] = 20; });
      expect(get((s) => [s["groups.0.sum"], s.$getAll("groups.*.sum", [])])).toEqual([21, [21, 3]]);
    });

    it.each(VARIANTS)("$recursion の木: 描いていない子の行・根の行を差し替えても、合計が state と一致する（%s）", async (_label, extra) => {
      const { root, get, write } = await page(`<b class="g">{{ grand }}</b>${extra("nodes")}`, {
        nodes: [node(7, [node(70)]), node(8)],
        $recursion: { "nodes.*": "children.*" },
        get "nodes.**.total"() {
          const self = this as any;
          return self["nodes.**.value"] + self.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
        },
        get grand() { return (this as any).$getAll("nodes.*.total", []).reduce((a: number, b: number) => a + b, 0); },
      });
      expect(text(root, ".g")).toBe("85");
      await write((s) => { s.$resolve("nodes.*.children.*", [0, 0], node(71, [node(1)])); });
      expect(text(root, ".g")).toBe("87");
      expect(get((s) => s.$getAll("nodes.*.total", []))).toEqual([79, 8]);
      await write((s) => { s["nodes.0"] = { ...s["nodes.0"], value: 100 }; });
      expect(get((s) => s.$getAll("nodes.*.total", []))).toEqual([172, 8]);
      await write((s) => { s.$resolve("nodes.*.children.*.value", [0, 0], 72); });
      expect(text(root, ".g")).toBe("181");
      expect(get((s) => s.$getAll("nodes.*.total", []))).toEqual([173, 8]);
    });
  });

  describe("依存と通知", () => {
    it.each(VARIANTS)("$eq を読む行 getter: 差し替えた行も選択の変更に追従する（%s）", async (_label, extra) => {
      const { root, get, write } = await page(`<b class="c">{{ selCount }}</b>${extra("items")}`, {
        sel: 2,
        items: [{ id: 1 }, { id: 2 }],
        get "items.*.isSel"() { return (this as any).$eq("sel", (this as any)["items.*.id"]); },
        get selCount() { return (this as any).$getAll("items.*.isSel", []).filter(Boolean).length; },
      });
      expect(text(root, ".c")).toBe("1");
      await write((s) => { s["items.0"] = { id: 3 }; });
      await write((s) => { s.sel = 3; });
      expect(get((s) => s.$getAll("items.*.isSel", []))).toEqual([true, false]);
      expect(text(root, ".c")).toBe("1");
    });

    // 4.0 は行を据え置くが、上のオブジェクトを差し替えた書き込みの prev は 3.x と同じく undefined
    // （プリミティブを書いた位置だけが前の値を持つ — issues2-lists.test.ts の #380「オブジェクトの形」）
    it.each(VARIANTS)("$watch(\"items.*.name\") は要素の差し替えで新しい値で 1 回発火し、その後の葉の書き込みでも発火する（%s）", async (_label, extra) => {
      const log: unknown[] = [];
      const { write } = await page(extra("items"), {
        items: [{ name: "a" }, { name: "b" }],
        $watch: { "items.*.name"(cur: unknown, prev: unknown, i: unknown) { log.push([cur, prev, i]); } },
      });
      log.length = 0;
      await write((s) => { s["items.1"] = { name: "z" }; });
      expect(log).toEqual([["z", undefined, 1]]);
      log.length = 0;
      await write((s) => { s["items.1.name"] = "y"; });
      expect(log).toEqual([["y", "z", 1]]);
    });

    it.each(VARIANTS)("$watch(\"tags.*\") の prev: 同じバッチで同じ位置を 2 回書いても、バッチが始まる前の値（%s）", async (_label, extra) => {
      const log: unknown[] = [];
      const { write } = await page(extra("tags"), {
        tags: ["a", "b", "c"],
        $watch: { "tags.*"(cur: unknown, prev: unknown, i: unknown) { log.push([cur, prev, i]); } },
      });
      log.length = 0;
      await write((s) => { s["tags.1"] = "Q"; });
      expect(log).toEqual([["Q", "b", 1]]);
      log.length = 0;
      await write((s) => { s["tags.1"] = "R"; s["tags.1"] = "S"; });
      expect(log).toEqual([["S", "Q", 1]]);
    });
  });

  describe("同じ配列を別のパスの for が描く", () => {
    it("TodoMVC の形に行の追加を足す: 要素の差し替えの後に足した行も描き、絞り込みを往復しても行が合う", async () => {
      const errors = await collectErrors(async () => {
        const { root, write } = await page(
          `<b class="left">{{ left }}</b><ul><template data-wcs="for: shown"><li><span class="t">{{ .title }}:{{ .done }}</span>`
          + `<button class="tg" data-wcs="onclick: toggle">t</button></li></template></ul><button class="add" data-wcs="onclick: add">+</button>`,
          {
            filter: "all",
            todos: [{ title: "a", done: false }, { title: "b", done: false }],
            get shown() {
              const s = this as any;
              return s.filter === "all" ? s.todos : s.todos.filter((t: any) => t.done === (s.filter === "done"));
            },
            get left() { return (this as any).$getAll("todos.*.done", []).filter((d: boolean) => !d).length; },
            toggle(this: any) { const i = this.$1; this["todos." + i] = { ...this["todos." + i], done: !this["todos." + i].done }; },
            add(this: any) { this.todos = [...this.todos, { title: "n", done: false }]; },
          },
        );
        const shown = () => [text(root, ".left"), texts(root, ".t").join(",")];
        expect(shown()).toEqual(["2", "a:false,b:false"]);
        await click(root.querySelectorAll(".tg")[0]);
        expect(shown()).toEqual(["1", "a:true,b:false"]);
        await click(root.querySelector(".add")!);
        expect(shown()).toEqual(["2", "a:true,b:false,n:false"]);
        await click(root.querySelectorAll(".tg")[1]);
        await write((s) => { s.filter = "done"; });
        expect(shown()).toEqual(["1", "a:true,b:true"]);
        await write((s) => { s.filter = "all"; });
        expect(shown()).toEqual(["1", "a:true,b:true,n:false"]);
      });
      expect(errors).toEqual([]);
    });

    it("getter が配列をそのまま返す（for: view）: 要素の書き込みの後も、行の追加・削除を描く", async () => {
      const errors = await collectErrors(async () => {
        const { root, get, write } = await page(forOver("view"), {
          items: [{ name: "a" }, { name: "b" }],
          get view() { return (this as any).items; },
        });
        await write((s) => { s["items.0"] = { name: "z" }; });
        expect(get((s) => s["view.0.name"])).toBe("z");
        await write((s) => { s.items = [...s.items, { name: "n" }]; });
        expect(rows(root)).toBe("z,b,n");
        await write((s) => { s["items.1"] = { name: "y" }; });
        await write((s) => { s.items = s.items.slice(1); });
        expect(rows(root)).toBe("y,n");
      });
      expect(errors).toEqual([]);
    });

    it("同じ配列を 2 つのキーが持つ（for: b）: 描いていないキー a へ書いた後、b の要素の書き込み・要素の書き込みで値を入れ替えても描く", async () => {
      const errors = await collectErrors(async () => {
        const arr = [{ name: "a" }, { name: "b" }, { name: "c" }];
        const { root, get, write } = await page(forOver("b"), { a: arr, b: arr });
        await write((s) => { s["a.0"] = { name: "z" }; });
        await write((s) => { s["b.1"] = { name: "y" }; });
        expect(rows(root)).toBe("z,y,c");
        await write((s) => { const x = s["b.0"]; const y = s["b.2"]; s["b.0"] = y; s["b.2"] = x; });
        expect(rows(root)).toBe("c,y,z");
        expect(get((s) => s.b.map((o: any) => o.name))).toEqual(["c", "y", "z"]);
      });
      expect(errors).toEqual([]);
    });

    it.each<[string, (s: any) => void, string]>([
      ["別の要素を書く", (s) => { s["a.3"] = { name: "w" }; }, "q,p,r,w"],
      ["別の要素を書いてから元の要素へ戻す", (s) => { const o = s["a.3"]; s["a.3"] = { name: "w" }; s["a.3"] = o; }, "q,p,r,s"],
    ])("描いているキー b で値を入れ替えている途中に、描いていないキー a で要素に書く（%s）: 状態どおりに描き、その後の追加も描く", async (_label, writeA, drawn) => {
      const errors = await collectErrors(async () => {
        const arr = [{ name: "p" }, { name: "q" }, { name: "r" }, { name: "s" }];
        const { root, write } = await page(forOver("b"), { a: arr, b: arr });
        await write((s) => {
          const t = s["b.0"];
          s["b.0"] = s["b.1"];
          writeA(s);
          s["b.1"] = t;
        });
        expect(rows(root)).toBe(drawn);
        await write((s) => { s.b = [...s.b, { name: "n" }]; });
        expect(rows(root)).toBe(`${drawn},n`);
      });
      expect(errors).toEqual([]);
    });

    it("別の <wcs-state> が同じ配列を持つ: 描いていない側の要素の書き込みの後も、描いている側が追従する", async () => {
      const errors = await collectErrors(async () => {
        const arr = [{ name: "a" }, { name: "b" }];
        const A = await page(forOver("items"), { items: arr });
        const B = await page("", { items: arr });
        await B.write((s) => { s["items.0"] = { name: "z" }; });
        await A.write((s) => { s.items = [...s.items, { name: "n" }]; });
        expect(rows(A.root)).toBe("z,b,n");
        await A.write((s) => { s["items.1.name"] = "q"; });
        expect(rows(A.root)).toBe("z,q,n");
      });
      expect(errors).toEqual([]);
    });

    it("行 getter が内側の配列をそのまま返す（for: .shown）: 元のパスで要素を書いた後も、行の追加を描く", async () => {
      const errors = await collectErrors(async () => {
        const { root, write } = await page(
          `<template data-wcs="for: groups"><ul><template data-wcs="for: .shown"><li class="r">{{ .name }}</li></template></ul></template>`,
          {
            groups: [{ items: [{ name: "a" }, { name: "b" }] }],
            get "groups.*.shown"() { return (this as any)["groups.*.items"]; },
          },
        );
        await write((s) => { s["groups.0.items.0"] = { name: "z" }; });
        await write((s) => { s["groups.0.items"] = [...s["groups.0.items"], { name: "n" }]; });
        expect(rows(root)).toBe("z,b,n");
      });
      expect(errors).toEqual([]);
    });
  });

  describe("同じバッチで一覧の代入と要素の書き込みを混ぜる（別名の for）", () => {
    it("配列を写して同じバッチで要素に書く: 写す前の配列を持つ別のキーの行は、写しへの書き込みで変わらない", async () => {
      const errors = await collectErrors(async () => {
        const arr = [{ name: "a" }, { name: "b" }];
        const { root, get, write } = await page(forOver("visible") + `<ol>${forOver("other", "name", "o")}</ol>`, {
          items: arr,
          other: arr,
          get visible() { return (this as any).items; },
        });
        expect(get((s) => s.$getAll("items.*.name", []))).toEqual(["a", "b"]);
        await write((s) => {
          s["items.1"] = { name: "y" };
          s.items = s.items.slice();
          s["items.0"] = { name: "z" };
        });
        expect(rows(root)).toBe("z,y");
        await write((s) => { s.items = s.items.slice(); s["items.1"] = { name: "w" }; });
        await write((s) => { s.items = [...s.items, { name: "n" }]; s.other = [...s.other]; });
        expect(rows(root)).toBe("z,w,n");
        expect(rows(root, "o")).toBe("a,y");
      });
      expect(errors).toEqual([]);
    });

    it.each<[string, (s: any) => void, string, string]>([
      ["行を足してから行 0 を差し替える", (s) => { s.items = [...s.items, { id: 4 }]; s["items.0"] = { id: 99 }; }, "99,2,3,4", "4,3,2,99"],
      ["同じ中身の写しで置き換えてから行 1 を差し替える", (s) => { s.items = [...s.items]; s["items.1"] = { id: 99 }; }, "1,99,3", "3,99,1"],
    ])("同じバッチで一覧を置き換えてから要素に書く（for: view・%s）", async (_label, batch, drawn, reversed) => {
      const errors = await collectErrors(async () => {
        const { root, write } = await page(forOver("view", "id"), {
          items: [{ id: 1 }, { id: 2 }, { id: 3 }],
          get view() { return (this as any).items; },
        });
        await write(batch);
        expect(rows(root)).toBe(drawn);
        await write((s) => { s.items = [...s.items].reverse(); });
        expect(rows(root)).toBe(reversed);
        await write((s) => { s.items = [{ id: 7 }, { id: 8 }]; });
        expect(rows(root)).toBe("7,8");
      });
      expect(errors).toEqual([]);
    });

    it("要素を差し替えた配列を同じバッチで別のキーへ代入し、そのキーの $getAll を読んでから要素に書く", async () => {
      const errors = await collectErrors(async () => {
        const { root, get, write } = await page(forOver("other", "v"), { items: [{ v: 1 }, { v: 2 }], other: [] });
        let mid: unknown;
        await write((s) => {
          s["items.0"] = { v: 10 };
          s.other = s.items;
          mid = s.$getAll("other.*.v", []);
          s["items.1"] = { v: 20 };
        });
        expect(mid).toEqual([10, 2]);
        expect(rows(root)).toBe("10,20");
        expect(get((s) => [s.$getAll("other.*.v", []), s.$getAll("items.*.v", [])])).toEqual([[10, 20], [10, 20]]);
      });
      expect(errors).toEqual([]);
    });

    it("別の要素を書いてから元の要素へ戻した配列を写しで配り直しても、for: b が状態どおりに描く", async () => {
      const errors = await collectErrors(async () => {
        const init = [{ v: 1 }, { v: 2 }, { v: 3 }];
        const { root, get, write } = await page(forOver("b", "v"), { a: init, b: init, get view() { return (this as any).a; } });
        const refresh = (s: any) => { const n = [...s.b]; s.a = n; s.b = n; };
        expect(get((s) => s.$getAll("view.*.v", []))).toEqual([1, 2, 3]);
        await write(refresh);
        await write((s) => { const o = s["a.1"]; s["a.1"] = { v: 20 }; s["a.1"] = o; });
        await write(refresh);
        let mid: unknown;
        await write((s) => {
          mid = s.$getAll("view.*.v", []);
          s["a.2"] = { v: 30 };
        });
        expect(mid).toEqual([1, 2, 3]);
        await write(refresh);
        expect(rows(root)).toBe("1,2,30");
      });
      expect(errors).toEqual([]);
    });

    it("一覧を置き換えてから $setAll(\"items.*\", [], fn) を 2 回続けても、for: view が描く", async () => {
      const errors = await collectErrors(async () => {
        const { root, get, write } = await page(forOver("view", "v"), {
          items: [{ v: 1 }, { v: 2 }, { v: 3 }],
          get view() { return (this as any).items; },
        });
        expect(get((s) => s.$getAll("items.*.v", []))).toEqual([1, 2, 3]);
        await write((s) => {
          s.items = s.items.map((o: any) => ({ ...o }));
          s.$setAll("items.*", [], (o: any) => ({ v: o.v * 10 }));
          s.$setAll("items.*", [], (o: any) => ({ v: o.v + 1 }));
        });
        expect(rows(root)).toBe("11,21,31");
        await write((s) => {
          s.$setAll("items.*", [], (o: any) => ({ v: o.v + 1 }));
          s.$setAll("items.*", [], (o: any) => ({ v: o.v * 2 }));
        });
        await write((s) => { s.items = [...s.items, { v: 0 }]; });
        expect(rows(root)).toBe("24,44,64,0");
      });
      expect(errors).toEqual([]);
    });

    it("$eqIndex の行 getter: 選んだ位置を 1 バッチで何度差し替えても追従する", async () => {
      const { root, get, write } = await page(`<b class="c">{{ curName }}</b>`, {
        sel: 1,
        items: [{ n: "a" }, { n: "b" }, { n: "c" }],
        get "items.*.current"() { return (this as any).$eqIndex("sel"); },
        get curName() {
          const self = this as any;
          const current = self.$getAll("items.*.current", []);
          return self.$getAll("items.*.n", []).filter((_: unknown, i: number) => current[i]).join("");
        },
      });
      expect(text(root, ".c")).toBe("b");
      let mid: unknown;
      await write((s) => {
        s["items.0"] = { n: "A" };
        s["items.1"] = { n: "B" };
        mid = s.curName;
        s["items.1"] = { n: "BB" };
        s["items.2"] = { n: "C" };
      });
      expect(mid).toBe("B");
      expect(text(root, ".c")).toBe("BB");
      expect(get((s) => s.$getAll("items.*.current", []))).toEqual([false, true, false]);
      await write((s) => { s.sel = 2; });
      expect(text(root, ".c")).toBe("C");
    });
  });

  it("SSR のハイドレーションの後も、配列をそのまま返す getter の for: visible が、要素の書き込みと行の追加を描く", async () => {
    const make = () => ({ items: [{ name: "a" }, { name: "b" }], get visible() { return (this as any).items; } });
    const markup = `<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: visible"><li>{{ .name }}</li></template></ul>`;
    const errors = await collectErrors(async () => {
      const out = await serverRender(markup, make());
      expect(out).toContain("<wcs-ssr");
      const { root, write } = await hydrate(out, make());
      const shown = () => texts(root, "li").join(",");
      expect(shown()).toBe("a,b");
      await write((s) => { s["visible.0"] = { name: "z" }; });
      expect(shown()).toBe("z,b");
      await write((s) => { s["items.1"] = { name: "y" }; });
      await write((s) => { s.items = [...s.items, { name: "n" }]; });
      expect(shown()).toBe("z,y,n");
    });
    expect(errors).toEqual([]);
  });
});

// ================================================================ #364

describe("#364 要素の書き戻し・$postUpdate・差し替えが、キャッシュに載った行の下の値とそれを読む getter に届く", () => {
  const NOTIFY: [string, (s: any) => void][] = [
    ["同じオブジェクトの再代入", (s) => { const it = s["items.0"]; it.name = "z"; s["items.0"] = it; }],
    ["$postUpdate(\"items.0\")", (s) => { s["items.0"].name = "z"; s.$postUpdate("items.0"); }],
    ["$postUpdate(\"items\")", (s) => { s["items.0"].name = "z"; s.$postUpdate("items"); }],
    ["$resolve(\"items.*\", [0], it)", (s) => { const it = s["items.0"]; it.name = "z"; s.$resolve("items.*", [0], it); }],
  ];
  const NO_NAME_FOR = `<ul><template data-wcs="for: items"><li>row</li></template></ul>`;
  const NAME_FOR = `<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>`;
  // 「for で描かない」4 形と「行の中で .name を描かない for」の同じオブジェクトの再代入は issues-lists.test.ts の #364 にある
  const CASES: [string, string, (s: any) => void][] = [
    ...NOTIFY.slice(1).map(([n, f]): [string, string, (s: any) => void] => [`${n}・行の中で .name を描かない for`, NO_NAME_FOR, f]),
    ...NOTIFY.map(([n, f]): [string, string, (s: any) => void] => [`${n}・対照: 行の中で .name を描く for`, NAME_FOR, f]),
  ];

  describe("形 A: 同じオブジェクトをその場で書き換えて知らせる", () => {
    it.each(CASES)("%s: 添字の読み・表示・getter・$getAll が新しい値になる", async (_label, extra, notify) => {
      const { root, get, write } = await page(`<p class="p">{{ items.0.name }}</p><b class="f">{{ first }}</b><i class="a">{{ all }}</i>${extra}`, {
        items: [{ name: "a" }, { name: "b" }],
        get first() { return (this as any)["items.0.name"]; },
        get all() { return (this as any).$getAll("items.*.name", []).join(","); },
      });
      const shown = () => [".p", ".f", ".a"].map((s) => text(root, s));
      expect(shown()).toEqual(["a", "a", "a,b"]);
      await write(notify);
      expect(get((s) => s["items.0.name"])).toBe("z");
      expect(shown()).toEqual(["z", "z", "z,b"]);
    });

    it("対照: リストでないオブジェクトは、同じオブジェクトの再代入・$postUpdate で新しい値になる", async () => {
      const { root, write } = await page(`<p class="p">{{ user.name }}</p>`, { user: { name: "a" } });
      await write((s) => { const u = s.user; u.name = "z"; s.user = u; });
      expect(text(root, ".p")).toBe("z");
      await write((s) => { s.user.name = "y"; s.$postUpdate("user"); });
      expect(text(root, ".p")).toBe("y");
    });

    it("葉を書いてキャッシュに載せた子のパスにも、その後の同じオブジェクトの再代入が届く", async () => {
      const { get, write } = await page("", { items: [{ name: "a" }, { name: "b" }] });
      await write((s) => { s["items.0.name"] = "q"; });
      await write((s) => { const it = s["items.0"]; it.name = "z"; s["items.0"] = it; });
      expect(get((s) => s["items.0.name"])).toBe("z");
    });

    it("入れ子のリスト: 外側の要素を同じオブジェクトで知らせると、内側の行の値も読み直す（内側の配列ごと替えても）", async () => {
      const { get, write } = await page("", { groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }] }] });
      expect(get((s) => [s.$getAll("groups.*.items.*.v", []), s["groups.0.items.1.v"]])).toEqual([[1, 2, 3], 2]);
      await write((s) => { const g = s["groups.0"]; g.items[1].v = 20; s["groups.0"] = g; });
      expect(get((s) => [s.$getAll("groups.*.items.*.v", []), s["groups.0.items.1.v"]])).toEqual([[1, 20, 3], 20]);
      await write((s) => { const g = s["groups.1"]; g.items = [{ v: 30 }, { v: 31 }]; s.$postUpdate("groups.1"); });
      expect(get((s) => s.$getAll("groups.*.items.*.v", []))).toEqual([1, 20, 30, 31]);
    });

    it("行のある配列を代入し直すと getter が新しい値を読む（$setAll が書いた行・その場で書き換えて同じ配列 / 写し・前の配列へ戻した行）", async () => {
      const { root, get, write } = await page(`<b class="f">{{ first }}</b>`, {
        items: [{ name: "a" }, { name: "b" }],
        get first() { return (this as any)["items.0.name"]; },
      });
      await write((s) => { s.$setAll("items.*.name", [], ["x", "y"], { spread: true }); });
      expect(text(root, ".f")).toBe("x");
      await write((s) => { const a = s.items; a[0].name = "m"; s.items = a; });
      expect([text(root, ".f"), get((s) => s["items.0.name"])]).toEqual(["m", "m"]);
      await write((s) => { const a = s.items; a[0].name = "n"; s.items = [...a]; });
      expect([text(root, ".f"), get((s) => s["items.0.name"])]).toEqual(["n", "n"]);
      const other = [{ name: "c" }, { name: "d" }];
      const back = get((s) => s.items);
      await write((s) => { s.items = other; });
      expect(text(root, ".f")).toBe("c");
      await write((s) => { s.items = back; });
      expect(text(root, ".f")).toBe("n");
      await write((s) => { const a = s.items; a[0].name = "z"; s.items = a; });
      expect([text(root, ".f"), get((s) => s["items.0.name"])]).toEqual(["z", "z"]);
    });

    it("描いていないリストのリフレッシュ綴り（その場で書き換えて同じ要素の写しを代入）が、$getAll の getter に届く", async () => {
      const { root, write } = await page(`<i class="a">{{ all }}</i>`, {
        items: [{ name: "a" }, { name: "b" }],
        get all() { return (this as any).$getAll("items.*.name", []).join(","); },
      });
      await write((s) => { const arr = s.items; arr[1].name = "y"; s.items = [...arr]; });
      expect(text(root, ".a")).toBe("a,y");
    });
  });

  describe("形 B: 新しいオブジェクトに差し替える", () => {
    // 「for で描かない」「行の中で .name を描かない for」「first が先」は issues-lists.test.ts の #364 にある
    it("$getAll の getter が先に評価され、行の中で .name を描く for がある（対照）: first が新しい値", async () => {
      const { root, get } = await page(
        `<p class="a">{{ all }}</p><p class="f">{{ first }}</p><button class="rn" data-wcs="onclick: rename">r</button>${NAME_FOR}`,
        {
          items: [{ name: "a" }, { name: "b" }],
          get all() { return (this as any).$getAll("items.*.name", []).join(","); },
          get first() { return (this as any)["items.0.name"]; },
          rename(this: any) { this["items.0"] = { name: "z" }; },
        },
      );
      expect(text(root, ".f")).toBe("a");
      await click(root.querySelector(".rn")!);
      expect(text(root, ".a")).toBe("z,b");
      expect(get((s) => s.first)).toBe("z");
      expect(text(root, ".f")).toBe("z");
    });
  });

  describe("for も $listKeys も無いリストの行 $watch", () => {
    // 3.x の README の約束（「for も $listKeys も無いリストの行 $watch は、これらでは発火しない」）は、行 $watch が
    // headless でない 3.x の制限から来る。4.0 の行 $watch は for が無くても値の変化で発火する（temporal.test.ts の
    // 「for の無い入れ子の行も、書き込みと新しい行で発火する」）。4.0 の文書（migration-v4）はこの約束をしていない
    it("値の変わらない代入（同じ配列・中身の同じ写し）と $postUpdate(\"items\") では発火せず、行のパスへの書き込みでは発火する", async () => {
      const calls: string[] = [];
      const { root, write } = await page(`<p class="t">{{ total }}</p>`, {
        items: [{ price: 1 }, { price: 2 }],
        get total() { return (this as any).$getAll("items.*.price", []).reduce((a: number, b: number) => a + b, 0); },
        $watch: { "items.*.price"(cur: unknown, prev: unknown, index: number) { calls.push(`${index}:${prev}->${cur}`); } },
      });
      for (const step of [
        (s: any) => { s.items = s.items; },
        (s: any) => { s.items = [...s.items]; },
        (s: any) => { s.$postUpdate("items"); },
      ]) {
        await write(step);
      }
      expect(calls).toEqual([]);
      expect(text(root, ".t")).toBe("3");
      await write((s) => { s["items.1.price"] = 5; });
      expect(calls).toEqual(["1:2->5"]);
      expect(text(root, ".t")).toBe("6");
    });

    // 3.x の README の約束どおり、その場の書き換えを知らせる 3 形（同じ配列・写し・$postUpdate）では行 $watch は
    // 発火しない（据え置いた行は読み直すだけ）。4.0 では新しいオブジェクトの配列の代入で、入ってきた行が発火する
    // （prev は undefined。3.x は for が無いので発火しない）
    it("その場で書き換えて同じ配列・写しを代入、$postUpdate(\"items\")、中身の違う配列の代入: getter は新しい値を読み、行 $watch は入ってきた行だけで発火する", async () => {
      const calls: string[] = [];
      const { root, write } = await page(`<b class="t">{{ total }}</b>`, {
        items: [{ price: 1 }, { price: 2 }],
        get total() { return (this as any).$getAll("items.*.price", []).reduce((a: number, b: number) => a + b, 0); },
        $watch: { "items.*.price"(cur: unknown, prev: unknown, index: number) { calls.push(`${index}:${prev}->${cur}`); } },
      });
      const STEPS: [(s: any) => void, string][] = [
        [(s) => { s.items[0].price = 10; s.items = s.items; }, "12"],
        [(s) => { s.items[1].price = 20; s.items = [...s.items]; }, "30"],
        [(s) => { s.items[0].price = 30; s.$postUpdate("items"); }, "50"],
        [(s) => { s.items = [{ price: 1 }, { price: 5 }]; }, "6"],
      ];
      const seen: string[] = [];
      for (const [step] of STEPS) {
        await write(step);
        seen.push(text(root, ".t")!);
      }
      expect(seen).toEqual(STEPS.map(([, t]) => t));
      expect(calls).toEqual(["0:undefined->1", "1:undefined->5"]);
    });

    it("行の値をキャッシュに載せた描いていないリストに、中身の違う長い配列を代入しても、新しい行を読める", async () => {
      const { get, write } = await page("", { items: [{ v: 1 }, { v: 2 }] });
      expect(get((s) => s["items.1.v"])).toBe(2);
      await write((s) => { s.items = [{ v: 3 }, { v: 4 }, { v: 5 }]; });
      expect(get((s) => [s["items.2.v"], s.$getAll("items.*.v", [])])).toEqual([5, [3, 4, 5]]);
    });
  });

  describe("再帰の集計（3.x の recursionKnownDefects の #364 の部分）", () => {
    const baseAt = (d: number) => "nodes.*" + ".children.*".repeat(d);
    /** total = 自分の value ＋直下の子の total を深さ `depth` まで手で展開する（内側の $getAll は添字を省く＝直下の子だけ） */
    const unrollTotals = (state: any, depth: number): any => {
      for (let d = 0; d <= depth; d++) {
        const base = baseAt(d);
        Object.defineProperty(state, base + ".total", {
          get(this: any) {
            return this[base + ".value"] + this.$getAll(base + ".children.*.total").reduce((a: number, b: number) => a + b, 0);
          },
          enumerable: true,
          configurable: true,
        });
      }
      Object.defineProperty(state, "grandTotal", {
        get(this: any) { return this.$getAll("nodes.*.total", []).reduce((a: number, b: number) => a + b, 0); },
        enumerable: true,
        configurable: true,
      });
      return state;
    };
    /** nodes[0] = 1 + (10+100) + 20 = 131 / nodes[1] = 2 / grandTotal = 133 */
    const forest = () => unrollTotals({ nodes: [node(1, [node(10, [node(100)]), node(20)]), node(2)] }, 2);
    const deepLeaf = (s: any) => s.$getAll("nodes.*.children.*.children.*.value", []);
    const tree = (withValues: boolean) => {
      const v = (d: number) => (withValues ? `<span class="v${d}">{{ .value }}</span>` : "");
      return `<div><template data-wcs="for: nodes"><div><span class="t0">{{ .total }}</span>${v(0)}`
        + `<template data-wcs="for: nodes.*.children"><div><span class="t1">{{ .total }}</span>${v(1)}`
        + `<template data-wcs="for: nodes.*.children.*.children"><div><span class="t2">{{ .total }}</span>${v(2)}</div>`
        + `</template></div></template></div></template></div><span class="gt">{{ grandTotal }}</span>`;
    };
    const deepMutateAndCopy = (s: any) => {
      const arr = s.nodes;
      arr[0].children[0].children[0].value = 500;
      s.nodes = [...arr];
    };

    it.each<[string, boolean]>([
      ["対照: 葉の value も描くテンプレート", true],
      ["集計（.total）だけを描くテンプレート", false],
    ])("その場の深い変異＋写しの代入（構造変化なし）が集計に届く（%s）", async (_label, withValues) => {
      const { root, get, write } = await page(tree(withValues), forest());
      expect(text(root, ".gt")).toBe("133");
      await write(deepMutateAndCopy);
      expect(text(root, ".gt")).toBe("533");
      expect(texts(root, ".t0")).toEqual(["531", "2"]);
      expect(get(deepLeaf)).toEqual([500]);
    });

    it("同じ綴りが、for が 1 つも無い state でも集計に届く", async () => {
      const { get, write } = await page("", forest());
      expect(get((s) => s.grandTotal)).toBe(133);
      await write(deepMutateAndCopy);
      expect(get((s) => s.grandTotal)).toBe(533);
    });

    // 3.x の defineTreeAccessor（読んだ後に getter を足す）は 4.0 に無い。行 getter を最初から宣言した形で、
    // 「リストを描いていない木のリストの置換・行の下のリストの差し替えが投げず、集計が新しい木に追従する」を見る
    it("描いていない木: 行 getter が読んだリストの置換・$resolve による子のリストの差し替えが投げず、集計が新しい木に追従する", async () => {
      const lazyTree = () => unrollTotals({ title: "t", nodes: [node(1, [node(2, [node(3)])])] }, 2);
      const html = `<div>{{ title }}</div>`;
      const totalsAt = (d: number) => (s: any) => s.$getAll(baseAt(d) + ".total", []);
      const errors = await collectErrors(async () => {
        const a = await page(html, lazyTree());
        expect(a.get(totalsAt(0))).toEqual([6]);
        await a.write((s) => { s.nodes = [node(7, [node(8)])]; });
        expect(a.get(totalsAt(0))).toEqual([15]);
        expect(a.get(totalsAt(1))).toEqual([8]);

        const b = await page(html, lazyTree());
        expect(b.get(totalsAt(0))).toEqual([6]);
        await b.write((s) => { s.$resolve("nodes.*.children", [0], [node(5)]); });
        expect(b.get(totalsAt(0))).toEqual([6]);
        expect(b.get(totalsAt(1))).toEqual([5]);
      });
      expect(errors).toEqual([]);
    });
  });

  describe("再セットの後のリストの書き込み（3.x の stateGenerationReset の #364 の部分）", () => {
    const rowGetterState = (names: string[]): any => ({
      items: names.map((name) => ({ name })),
      get "items.*.upper"() { return String((this as any)["items.*.name"]).toUpperCase(); },
    });
    const ROW_HTML = `<ul><template data-wcs="for: items"><li class="u">{{ .upper }}</li></template></ul>`;

    it("投げた再セットの後も、全リストの書き込みが投げず、行 getter が新しいリストに追従する", async () => {
      const { root, el, get, write } = await page(ROW_HTML, rowGetterState(["a", "b"]));
      expect(texts(root, ".u")).toEqual(["A", "B"]);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(() => el.setInitialState(Object.assign(rowGetterState(["x", "y"]), { $streams: { s: { source: 1 } } }))).toThrow();
        let thrown: unknown;
        try {
          el.createState("writable", (s: any) => { s.items = [{ name: "p" }, { name: "q" }]; });
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeUndefined();
        await flushTimes();
        expect(get((s) => s.$getAll("items.*.upper", []))).toEqual(["P", "Q"]);
        expect(texts(root, ".u")).toEqual(["P", "Q"]);
        await write((s) => { s.$resolve("items.*.name", [0], "leaf"); });
        expect(texts(root, ".u")).toEqual(["LEAF", "Q"]);
      } finally {
        error.mockRestore();
      }
    });

    it("バインドの無いリストでも、再セットの直後に読まずに書いた長さの違う構造書き込みの結果が正しい", async () => {
      const { el, get, write } = await page("", { items: [{ n: 1 }, { n: 2 }] });
      expect(get((s) => s.$getAll("items.*.n", []))).toEqual([1, 2]);
      el.setInitialState({ items: [{ n: 9 }, { n: 8 }, { n: 7 }] });
      await write((s) => { s.items = [{ n: 5 }]; });
      expect(get((s) => s.$getAll("items.*.n", []))).toEqual([5]);
    });
  });
});

// ================================================================ #389

describe("#389 行の下を動的なキーで多く読んでも、要素の書き込みが行の下の値を正しく無効にする（振る舞いだけ。計時は移さない）", () => {
  const K = 200;
  const keys = (): Record<string, number> => {
    const m: Record<string, number> = {};
    for (let i = 0; i < K; i++) m["k" + i] = i;
    return m;
  };
  const VARIANTS389: [string, string][] = [
    ["for で描かない", "<p>x</p>"],
    ["行の中で子を描かない for", `<template data-wcs="for: items"><p>x</p></template>`],
  ];

  it.each(VARIANTS389)("行 0 の下のキーを多く読んだ後、同じオブジェクトの書き戻しで行 0 の下の値が新しくなり、行 1 はそのまま（%s）", async (_label, html) => {
    const { get, write } = await page(html, { items: [{ m: keys() }, { m: keys() }] });
    get((s) => { for (let i = 0; i < K; i++) s.$resolve("items.*.m.k" + i, [0]); return null; });
    await write((s) => { const o = s["items.0"]; o.m.k100 = -1; s["items.0"] = o; });
    expect(get((s) => [s.$resolve("items.*.m.k100", [0]), s.$resolve("items.*.m.k0", [0]), s["items.0.m.k100"]])).toEqual([-1, 0, -1]);
    expect(get((s) => s.$resolve("items.*.m.k100", [1]))).toBe(100);
  });

  it("getter が行の下を動的なキーで多く読んでいても、同じオブジェクトの書き戻し・新しいオブジェクトへの差し替えが getter に届く", async () => {
    const base = (K * (K - 1)) / 2;
    const { root, write } = await page(`<b>{{ sum }}</b>`, {
      items: [{ m: keys() }],
      get sum() {
        let total = 0;
        for (let i = 0; i < K; i++) total += (this as any).$resolve("items.*.m.k" + i, [0]);
        return total;
      },
    });
    expect(text(root, "b")).toBe(String(base));
    await write((s) => { const o = s["items.0"]; o.m.k1 = 1001; s["items.0"] = o; });
    expect(text(root, "b")).toBe(String(base + 1000));
    await write((s) => { s["items.0"] = { m: { ...keys(), k0: 5 } }; });
    expect(text(root, "b")).toBe(String(base + 5));
  });

  it.each(VARIANTS389)("途中の値の書き込み・$postUpdate の後、添字の読み・$getAll・キャッシュに当たった getter が新しい値になる（%s）", async (_label, html) => {
    const { root, get, write } = await page(`<b>{{ all }}</b><i>{{ g }}</i>${html}`, {
      items: [{ m: { k5: 1 }, name: "a" }, { m: { k5: 2 }, name: "b" }],
      get all() { return (this as any).$getAll("items.*.m.k5", []).join(","); },
      get g() { return (this as any)["items.0.m.k5"]; },
    });
    const shown = () => [text(root, "b"), text(root, "i")];
    expect(shown()).toEqual(["1,2", "1"]);
    await write((s) => { s["items.0.m"] = { k5: 99 }; });
    expect(get((s) => [s["items.0.m.k5"], s.$resolve("items.*.m.k5", [0])])).toEqual([99, 99]);
    expect(shown()).toEqual(["99,2", "99"]);
    await write((s) => { s["items.0.m"].k5 = 7; s.$postUpdate("items.0.m"); });
    expect(get((s) => s["items.0.m.k5"])).toBe(7);
    expect(shown()).toEqual(["7,2", "7"]);
  });

  it.each<[string, (s: any, mk: () => any) => void]>([
    ["push → reverse", (s, mk) => { s.items = [...s.items, mk()]; s.items = [...s.items].reverse(); }],
    ["push → 先頭を削除", (s, mk) => { s.items = [...s.items, mk()]; s.items = s.items.filter((_: any, i: number) => i !== 0); }],
  ])("1 つの更新でリストを 2 回代入しても、入れ子の for が別の行の要素を描かない（%s）", async (_label, op) => {
    let id = 0;
    const mk = () => { id++; return { name: "n" + id, m: { k: id }, tags: [{ v: id * 10 }, { v: id * 10 + 1 }] }; };
    const rowText = (it: any) => `${it.name}|${it.m.k}|${it.tags.map((t: any) => t.v).join("")}`;
    const { root, get, write } = await page(
      `<template data-wcs="for: items"><p>{{ .name }}|{{ .m.k }}|<template data-wcs="for: .tags"><u>{{ .v }}</u></template></p></template>`,
      { items: [mk(), mk(), mk()] },
    );
    await write((s) => op(s, mk));
    expect(texts(root, "p")).toEqual(get((s) => s.items.map(rowText)));
  });

  it.each(VARIANTS389)("途中の値を書いた後に要素の書き込みで値を入れ替えても、入れ子の行の読みが状態どおり（%s）", async (_label, html) => {
    const { get, write } = await page(html, {
      items: [{ m: { k: 1 }, tags: [{ v: 10 }, { v: 11 }] }, { m: { k: 2 }, tags: [{ v: 20 }, { v: 21 }] }, { m: { k: 3 }, tags: [{ v: 30 }, { v: 31 }] }],
    });
    get((s) => [s.$getAll("items.*.tags.*.v", []), s.$getAll("items.*.m.k", [])]);
    await write((s) => { s["items.0.m"] = { k: 50 }; });
    await write((s) => { const arr = s.items; const a = arr[2], b = arr[0]; s["items.2"] = b; s["items.0"] = a; });
    expect(get((s) => [s.$getAll("items.*.tags.*.v", []), s.$resolve("items.*.tags.*.v", [2, 0]), s.$getAll("items.*.m.k", [])]))
      .toEqual([[30, 31, 20, 21, 10, 11], 10, [3, 2, 50]]);
  });

  /** 途中の値（items.1.m）を書いてから、リストに行を 1 つ足す。行 getter の $watch の呼び出しを返す */
  const appendAfterMidWrite = async (html: string) => {
    const fired: unknown[] = [];
    const { get, write } = await page(`<b>{{ sum }}</b>${html}`, {
      items: [{ id: 1, m: { k: 1 } }, { id: 2, m: { k: 2 } }, { id: 3, m: { k: 3 } }],
      get sum() { return (this as any).$getAll("items.*.m.k", []).reduce((a: number, b: number) => a + b, 0); },
      get "items.*.label"() { return "L" + (this as any)["items.*.m.k"] + (this as any)["items.*.id"]; },
      $watch: { "items.*.label"(cur: unknown, prev: unknown, i: unknown) { fired.push([cur, prev, i]); } },
    });
    get((s) => s.$getAll("items.*.label", []));
    await write((s) => { s["items.1.m"] = { k: 7 }; });
    expect(get((s) => s.$getAll("items.*.label", []))).toEqual(["L11", "L72", "L33"]);
    expect(fired).toEqual([["L72", "L22", 1]]);
    fired.length = 0;
    await write((s) => { s.items = [...s.items, { id: 4, m: { k: 4 } }]; });
    expect(get((s) => [s.$getAll("items.*.label", []), s.sum])).toEqual([["L11", "L72", "L33", "L44"], 15]);
    return fired;
  };

  // 3.x では「for で描かない」行の $watch は発火しない（headless でない制限）。4.0 の行 $watch は for が無くても
  // 発火するので、どちらの形でも足した行が発火する
  it.each(VARIANTS389)("途中の値を書いた後にリストへ行を足すと、行 getter の値は状態どおりで、足した行の $watch が発火する（%s）", async (_label, html) => {
    expect(await appendAfterMidWrite(html)).toContainEqual(["L44", undefined, 3]);
  });

  // 3.x #389 の修正の形が 4.0 で再現しない: リストの代入で、同じオブジェクトのまま残った既存の行の行 getter が
  // 評価し直され、値が変わらないまま $watch が発火する（実測 [["L11","L11",0],["L72","L72",1],["L33","L33",2],["L44",undefined,3]] /
  // 期待 [["L44",undefined,3]]）。4.0 自身の src/temporal/watch.ts の冒頭の「whole-array assignment fires only for the rows
  // that entered the list (a row kept by identity did not change)」にも反する。途中の値の書き込みが無くても同じ
  for (const [label, html] of VARIANTS389) {
    it.fails(`途中の値を書いた後のリストへの行の追加で、残った行の行 getter の $watch は発火しない（${label}）`, async () => {
      expect(await appendAfterMidWrite(html)).toEqual([["L44", undefined, 3]]);
    });
  }
});

// ================================================================ #362

describe("#362 元の配列をそのまま返す getter を for で描いても、元のパスへの書き込みで行がすぐに描き直される", () => {
  const TOGGLES: [string, (self: any, i: number) => void][] = [
    ["要素の差し替え", (self, i) => { self["todos." + i] = { ...self["todos." + i], done: !self["todos." + i].done }; }],
    ["葉の書き込み", (self, i) => { self["todos." + i + ".done"] = !self["todos." + i + ".done"]; }],
  ];

  // 最初の切り替えと絞り込みの往復は issues-lists.test.ts の #362 にある。ここでは往復の後の切り替えまで見る
  it.each(TOGGLES)("TodoMVC の形: all → active → all の後も、行のボタンが正しい行を切り替え、すぐに描き直される（%s）", async (_label, toggle) => {
    const errors = await collectErrors(async () => {
      const { root, write } = await page(
        `<b class="left">{{ left }}</b><ul><template data-wcs="for: shown"><li><span class="t">{{ .title }}:{{ .done }}</span>`
        + `<button class="tg" data-wcs="onclick: toggle">t</button></li></template></ul>`,
        {
          filter: "all",
          todos: [{ title: "a", done: false }, { title: "b", done: false }],
          get shown() {
            const s = this as any;
            return s.filter === "all" ? s.todos : s.todos.filter((t: any) => t.done === (s.filter === "done"));
          },
          get left() { return (this as any).$getAll("todos.*.done", []).filter((d: boolean) => !d).length; },
          toggle(this: any) { toggle(this, this.$1); },
        },
      );
      const shown = () => [text(root, ".left"), texts(root, ".t").join(",")];
      await click(root.querySelectorAll(".tg")[0]);
      expect(shown()).toEqual(["1", "a:true,b:false"]);
      await write((s) => { s.filter = "active"; });
      expect(shown()).toEqual(["1", "b:false"]);
      await write((s) => { s.filter = "all"; });
      expect(shown()).toEqual(["1", "a:true,b:false"]);
      await click(root.querySelectorAll(".tg")[1]);
      expect(shown()).toEqual(["0", "a:true,b:true"]);
      await click(root.querySelectorAll(".tg")[0]);
      expect(shown()).toEqual(["1", "a:false,b:true"]);
    });
    expect(errors).toEqual([]);
  });

  describe("別名の形", () => {
    // 要素の書き込みと葉の書き込みが getter の一覧に届くことは fixes.test.ts の F24 にある。ここでは行の追加と、
    // 1 バッチで複数の位置を書く形まで見る
    it("元のパスの for と getter の for を並べる: 要素・葉の書き込み、行の追加、1 バッチの複数の要素の書き込みの後、両方が状態どおり", async () => {
      const errors = await collectErrors(async () => {
        const { root, write } = await page(forOver("items", "name", "i") + forOver("visible", "name", "v"), {
          items: [{ name: "a" }, { name: "b" }],
          get visible() { return (this as any).items; },
        });
        const shown = () => [rows(root, "i"), rows(root, "v")];
        await write((s) => { s["items.0"] = { name: "z" }; });
        expect(shown()).toEqual(["z,b", "z,b"]);
        await write((s) => { s["items.1.name"] = "y"; });
        expect(shown()).toEqual(["z,y", "z,y"]);
        await write((s) => { s.items = [...s.items, { name: "n" }]; });
        expect(shown()).toEqual(["z,y,n", "z,y,n"]);
        await write((s) => { s["items.0"] = s.items[2]; s["items.2"] = s.items[1]; s["items.1"] = { name: "q" }; });
        expect(shown()).toEqual(["n,q,y", "n,q,y"]);
      });
      expect(errors).toEqual([]);
    });

    it("入れ子の内側の段: 行の getter が内側の配列を返す（for: .shown）と、内側の葉・要素の書き込みがその行へ届く", async () => {
      const errors = await collectErrors(async () => {
        const { root, write } = await page(
          `<div><template data-wcs="for: groups"><ul><template data-wcs="for: .shown"><li class="r">{{ .name }}</li></template></ul></template></div>`,
          {
            groups: [{ items: [{ name: "a" }, { name: "b" }] }, { items: [{ name: "c" }] }],
            get "groups.*.shown"() { return (this as any)["groups.*.items"]; },
          },
        );
        expect(rows(root)).toBe("a,b,c");
        await write((s) => { s["groups.0.items.1.name"] = "B"; });
        expect(rows(root)).toBe("a,B,c");
        await write((s) => { s["groups.1.items.0"] = { name: "C" }; });
        expect(rows(root)).toBe("a,B,C");
      });
      expect(errors).toEqual([]);
    });

    it("入れ子の外側の段: 外側の配列を返す getter（for: view）の内側の for も、内側の行・外側の行への書き込みを描く", async () => {
      const errors = await collectErrors(async () => {
        const { root, get, write } = await page(
          `<div><template data-wcs="for: view"><ul><template data-wcs="for: .items"><li class="r">{{ .name }}</li></template></ul></template></div>`,
          {
            groups: [{ items: [{ name: "a" }, { name: "b" }] }, { items: [{ name: "c" }] }],
            get view() { return (this as any).groups; },
          },
        );
        await write((s) => { s["groups.0.items.1.name"] = "B"; });
        expect(rows(root)).toBe("a,B,c");
        await write((s) => { s["groups.1.items.0"] = { name: "C" }; });
        expect(rows(root)).toBe("a,B,C");
        await write((s) => { s["groups.0"] = { items: [{ name: "x" }] }; });
        expect(rows(root)).toBe("x,C");
        expect(get((s) => s["view.1.items.0.name"])).toBe("C");
      });
      expect(errors).toEqual([]);
    });

    it("別の配列（写し）を返している間は別名にしない: 元のパスへの書き込みで getter の行を書き換えない", async () => {
      const errors = await collectErrors(async () => {
        const { root, write } = await page(forOver("visible", "name", "v"), {
          all: true,
          items: [{ name: "a" }, { name: "b" }],
          get visible() { const s = this as any; return s.all ? s.items : s.items.slice(1); },
        });
        await write((s) => { s.all = false; });
        expect(rows(root, "v")).toBe("b");
        await write((s) => { s["items.0.name"] = "z"; });
        expect(rows(root, "v")).toBe("b");
      });
      expect(errors).toEqual([]);
    });
  });

  describe("別名から写しへの切り替え（絞り込み）", () => {
    const mkTodos = (withLeft: boolean): any => {
      const state: any = {
        filter: "all",
        todos: [0, 1, 2, 3].map((i) => ({ title: "t" + i, done: i % 2 === 1 })),
        get shown() {
          const s = this as any;
          return s.filter === "all" ? s.todos : s.todos.filter((t: any) => t.done === (s.filter === "done"));
        },
      };
      if (withLeft) {
        Object.defineProperty(state, "left", {
          get(this: any) { return this.$getAll("todos.*.done", []).filter((d: boolean) => !d).length; },
          enumerable: true,
          configurable: true,
        });
      }
      return state;
    };
    const SHOWN = `<ul><template data-wcs="for: shown"><li class="s">{{ .title }}:{{ .done }}</li></template></ul>`;
    const TODOS = `<ol><template data-wcs="for: todos"><li class="o">{{ .title }}:{{ .done }}</li></template></ol>`;

    // 3.x のテストと同じく、active の間に todos.2.done = true（写しにも載る要素への元のパスからの書き込み）も書く。
    // 写しの行はその間は古いまま（F26 の系統）だが、all に戻ると描き直す（下の #362 の 2 つの形）
    it.each<[string, boolean, string]>([
      ["for: shown だけ", false, SHOWN],
      ["for: shown ＋ $getAll の集計", true, `${SHOWN}<b class="l">{{ left }}</b>`],
      ["for: shown ＋ for: todos", false, SHOWN + TODOS],
    ])("all → done → active → all の間、元のパス・数値添字の読み書きが正しい要素に着地する（%s）", async (_label, withLeft, body) => {
      const errors = await collectErrors(async () => {
        const { root, get, write } = await page(body, mkTodos(withLeft));
        const shown = () => texts(root, ".s").join(",");
        const titles = () => get((s) => s.todos.map((t: any) => `${t.title}:${t.done}`).join(","));
        await write((s) => { s.filter = "done"; });
        expect(shown()).toBe("t1:true,t3:true");
        expect(get((s) => [s["todos.1.title"], s["todos.3.title"], s["shown.0.title"], s["shown.1.title"]])).toEqual(["t1", "t3", "t1", "t3"]);
        await write((s) => { s["todos.1.title"] = "X"; });
        await write((s) => { s["todos.3"] = { title: "Y", done: true }; });
        expect(titles()).toBe("t0:false,X:true,t2:false,Y:true");

        await write((s) => { s.filter = "active"; });
        expect(shown()).toBe("t0:false,t2:false");
        await write((s) => { s["shown.0.title"] = "Z"; });
        expect(titles()).toBe("Z:false,X:true,t2:false,Y:true");
        await write((s) => { s["todos.2.done"] = true; });
        expect(titles()).toBe("Z:false,X:true,t2:true,Y:true");

        await write((s) => { s.filter = "all"; });
        expect(shown()).toBe("Z:false,X:true,t2:true,Y:true");
        expect(get((s) => [0, 1, 2, 3].map((i) => s[`todos.${i}.title`]))).toEqual(["Z", "X", "t2", "Y"]);
        await write((s) => { s["todos.1.done"] = false; });
        await write((s) => { s["todos.2.done"] = true; });
        expect(shown()).toBe("Z:false,X:false,t2:true,Y:true");
        if (withLeft) expect(text(root, ".l")).toBe("2");
        // 行 0 は写しを返す getter のパス（shown.0.title）から書いたので、元のパスの for には届かない。3.x も同じ
        // （3.x のテストも行 0 を外して比べる）。4.0 では F26 の系統（migration-v4 §5 の TodoMVC の絞り込みの形）
        if (body.includes("for: todos")) {
          expect(texts(root, ".o").slice(1).join(",")).toBe("X:false,t2:true,Y:true");
        }
      });
      expect(errors).toEqual([]);
    });

    // 3.x #362 の修正の形。getter が写し（active）を返している間に、写しにも載る要素へ元のパスから書く
    // （todos.2.done = true）と、写しの行は古いまま（F26 の系統 — migration-v4 §5「One object reachable from two
    // rows」。そのままの制限）。getter が元の配列に戻ると、その配列を前から持っていた一覧（todos）に合流するので、
    // 引き継いだ行を書かれたものとして描き直す（engine.ts sync()）。以前は "t0:false,t1:true,t2:false,t3:true" のままだった
    it("getter が写しを返している間に元のパスで写しの要素に書いても、getter が元の配列に戻ると行が新しい値を描く", async () => {
      const { root, get, write } = await page(SHOWN, mkTodos(false));
      await write((s) => { s.filter = "active"; });
      await write((s) => { s["todos.2.done"] = true; });
      await write((s) => { s.filter = "all"; });
      expect(get((s) => s["todos.2.done"])).toBe(true);
      expect(texts(root, ".s").join(",")).toBe("t0:false,t1:true,t2:true,t3:true");
    });

    it("getter が生きている 2 本の配列を切り替える（同じ要素を両方に置く）: どちらの配列の数値添字の読み書きも正しい要素に着地する", async () => {
      const errors = await collectErrors(async () => {
        const { root, get, write } = await page(`<ul><template data-wcs="for: current"><li class="c">{{ .n }}</li></template></ul>`, {
          tab: "a",
          a: [{ n: "a0" }, { n: "a1" }],
          b: [{ n: "b0" }],
          get current() { const s = this as any; return s.tab === "a" ? s.a : s.b; },
        });
        await write((s) => { s.b = [s.a[1], ...s.b]; });
        await write((s) => { s.tab = "b"; });
        expect(rows(root, "c")).toBe("a1,b0");
        expect(get((s) => [s["a.1.n"], s["b.0.n"], s["current.0.n"]])).toEqual(["a1", "a1", "a1"]);
        await write((s) => { s["a.1.n"] = "A1"; });
        await write((s) => { s.tab = "a"; });
        expect(get((s) => [s.a.map((x: any) => x.n).join(","), s.b.map((x: any) => x.n).join(",")])).toEqual(["a0,A1", "A1,b0"]);
        expect(rows(root, "c").split(",")[0]).toBe("a0");
        await write((s) => { s["a.0.n"] = "A0"; });
        expect(rows(root, "c").split(",")[0]).toBe("A0");
      });
      expect(errors).toEqual([]);
    });

    // 3.x #362 の修正の形。同じオブジェクトが 2 本の配列（a と、getter が返している b）に載る間に、a のパスで書くと、
    // b の行は古いまま（F26 の系統 — migration-v4 §5。そのままの制限）。getter が a に戻ると、a の一覧に合流するので、
    // 引き継いだ行を書かれたものとして描き直す。以前は "a0,a1" のままだった
    it("getter が生きている 2 本の配列を切り替える: 返していない方の配列のパスで共有の要素に書いた後、戻すと新しい値を描く", async () => {
      const { root, write } = await page(`<ul><template data-wcs="for: current"><li class="c">{{ .n }}</li></template></ul>`, {
        tab: "a",
        a: [{ n: "a0" }, { n: "a1" }],
        b: [{ n: "b0" }],
        get current() { const s = this as any; return s.tab === "a" ? s.a : s.b; },
      });
      await write((s) => { s.b = [s.a[1], ...s.b]; });
      await write((s) => { s.tab = "b"; });
      await write((s) => { s["a.1.n"] = "A1"; });
      await write((s) => { s.tab = "a"; });
      expect(rows(root, "c")).toBe("a0,A1");
    });

    it("元の配列に戻って描き直す行は、行 getter（shown.*.label）も評価し直し、描いた DOM（入力欄）は使い回す", async () => {
      const state = mkTodos(false);
      Object.defineProperty(state, "shown.*.label", {
        get(this: any) { return `${this["shown.*.title"]}!`; }, enumerable: true, configurable: true,
      });
      const { root, write } = await page(`<ul><template data-wcs="for: shown"><li class="s">{{ .label }}<input class="i"></li></template></ul>`, state);
      await write((s) => { s.filter = "active"; });
      (root.querySelectorAll(".i")[1] as HTMLInputElement).value = "typed";
      await write((s) => { s["todos.2.title"] = "Z"; });
      expect(texts(root, ".s").join(",")).toBe("t0!,t2!");
      await write((s) => { s.filter = "all"; });
      expect(texts(root, ".s").join(",")).toBe("t0!,t1!,Z!,t3!");
      expect((root.querySelectorAll(".i")[2] as HTMLInputElement).value).toBe("typed");
    });

    it("対照: いつも同じ配列を返す getter（for: shown）と for: todos は、配列の置き換えで引き継いだ行を描き直さない（一緒に配列を替えた一覧どうし）", async () => {
      const { root, el, write } = await page(SHOWN + TODOS, {
        filter: "all",
        todos: [0, 1, 2].map((i) => ({ title: "t" + i, done: false })),
        get shown() { const s = this as any; return s.filter === "all" ? s.todos : s.todos.slice(); },
      });
      // the rows of `shown` the engine shows again as if written (the engine's internal entry)
      const changed = vi.spyOn(el.engine, "changed");
      const rewritten = () => changed.mock.calls.filter(([p]) => (p as { path: string }).path === "shown.*").length;
      await write((s) => { s.todos = [...s.todos, { title: "t3", done: false }]; });
      expect(texts(root, ".s").join(",")).toBe("t0:false,t1:false,t2:false,t3:false");
      expect(texts(root, ".o").join(",")).toBe("t0:false,t1:false,t2:false,t3:false");
      expect(rewritten()).toBe(0);
      // back from a copy to the array for: todos has had all along: the kept rows are shown again
      await write((s) => { s.filter = "copy"; });
      await write((s) => { s.filter = "all"; });
      expect(rewritten()).toBe(4);
      changed.mockRestore();
    });

    it("対照: 写しから写しへの切り替えは、残る要素の行（描いた DOM）を使い回す", async () => {
      const { root, write } = await page(`<ul><template data-wcs="for: visible"><li class="v">{{ .name }}<input class="i"></li></template></ul>`, {
        q: "",
        items: [{ name: "a" }, { name: "b" }, { name: "c" }],
        get visible() { const s = this as any; return s.items.filter((x: any) => x.name.includes(s.q)); },
      });
      (root.querySelectorAll(".i")[1] as HTMLInputElement).value = "typed";
      await write((s) => { s.q = "b"; });
      expect(rows(root, "v")).toBe("b");
      expect((root.querySelector(".i") as HTMLInputElement).value).toBe("typed");
    });
  });
});
