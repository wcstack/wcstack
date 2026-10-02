/**
 * integration.elementWriteUnrenderedList.test.ts — `for` で描いていないリストの要素を、添字のパスで
 * 丸ごと差し替える（`this["items.0"] = { ...this["items.0"], name: "z" }`）（#333）。
 *
 * 旧挙動: 生データは新しい要素になるのに、その行の子のパス（`this["items.0.name"]`・
 * `$getAll("items.*.done", [])`・それを読む getter）が古い値を返し続けた。ワイルドカードを含むパスは
 * 行の listIndex ごとにキャッシュされる（isCacheable）が、要素の書き込みの依存ウォークは行
 * （`items.*`）から子（`items.*.name`）へ届かない — 静的な辺はバインドが張るので、行の中を描いて
 * いないリストには無い。`for` で描いていれば、要素の書き込みは入れ替えの経路を通り、差し替えた位置に
 * 新しい listIndex が付くので古いキャッシュに当たらなかった（#4 の同一性モデル）。vscode-wcs の
 * `wcs/array-index-assign` はこの書き方を勧めている。
 *
 * いまは通常の経路でも同じ同一性モデルに揃える（src/proxy/methods/setByAddress.ts の
 * renewReplacedRow）: 別の要素に替わった位置は新しい行になり、差し替えた行は退役する。
 * 対照（`for` で描く形）を並べ、振る舞いが揃っていることも固定する。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { getListIndexesByList } from "../src/list/listIndexesByList";
import { flush, makeMount, node, read, write } from "./helpers/recursionTestUtils";
import { clientLoad, serverRender } from "./helpers/ssrRoundTrip";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("element-write-host");

const txt = (root: ShadowRoot, selector: string) =>
  Array.from(root.querySelectorAll(selector)).map((n) => n.textContent);
const raw = (stateEl: any) => stateEl._state;
const flushTimes = async (n = 3) => {
  for (let i = 0; i < n; i++) await flush();
};
const getter = (state: any, path: string, get: (this: any) => unknown) =>
  Object.defineProperty(state, path, { get, enumerable: true, configurable: true });

/** console.error を集めながら走らせる（`for` の適用の失敗は console.error にだけ出る） */
const collectErrors = async (run: () => Promise<void>): Promise<unknown[][]> => {
  const errors: unknown[][] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args); });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return errors;
};

/** 行の中を何も描かない for（対照）。描くのは行の数だけ */
const forOf = (list: string) => `<ul><template data-wcs="for: ${list}"><li>row</li></template></ul>`;
const VARIANTS: [string, (list: string) => string][] = [
  ["for で描かない", () => ""],
  ["対照: for で描く", forOf],
];

// ---------------------------------------------------------------------------
// Issue の再現
// ---------------------------------------------------------------------------

describe("Issue の再現", () => {
  it.each(VARIANTS)("rename の後は firstName / seen が新しい名前、toggle の後は doneCount が 1（%s）", async (_label, extra) => {
    const { host, stateEl, shadowRoot } = await mount({
      items: [{ name: "a", done: false }, { name: "b", done: false }],
      seen: "",
      get firstName() { return (this as any)["items.0.name"]; },
      get doneCount() { return (this as any).$getAll("items.*.done", []).filter(Boolean).length; },
      rename(this: any) {
        this["items.0"] = { ...this["items.0"], name: "z" };
        this.seen = this["items.0.name"]; // 差し替えの直後に読む
      },
      toggle(this: any) { this["items.0"] = { ...this["items.0"], done: !this["items.0"].done }; },
    }, `<b class="d">{{ doneCount }}</b><b class="f">{{ firstName }}</b><i class="s">{{ seen }}</i>` +
      `<button class="r" data-wcs="onclick: rename">rename</button>` +
      `<button class="t" data-wcs="onclick: toggle">toggle</button>` + extra("items"));
    const shown = () => [...txt(shadowRoot, ".d"), ...txt(shadowRoot, ".f"), ...txt(shadowRoot, ".s")];
    expect(shown()).toEqual(["0", "a", ""]);

    (shadowRoot.querySelector(".r") as HTMLButtonElement).click();
    await flushTimes(2);
    expect(raw(stateEl).items[0]).toEqual({ name: "z", done: false });
    expect(shown()).toEqual(["0", "z", "z"]); // 旧（for なし）: ["0", "a", "a"]
    expect(read(stateEl, (s) => s["items.0.name"])).toBe("z"); // 旧（for なし）: "a"

    (shadowRoot.querySelector(".t") as HTMLButtonElement).click();
    await flushTimes(2);
    expect(raw(stateEl).items[0]).toEqual({ name: "z", done: true });
    expect(shown()).toEqual(["1", "z", "z"]); // 旧（for なし）: ["0", "a", "a"]
    expect(read(stateEl, (s) => s["items.0.done"])).toBe(true); // 旧（for なし）: false
    host.remove();
  });

  it("createState だけの最小形: 差し替えた行の子のパスと $getAll が新しい値を返す", async () => {
    const { host, stateEl } = await mount({ items: [{ v: 1 }, { v: 2 }] });
    expect(read(stateEl, (s) => s.$getAll("items.*.v", []))).toEqual([1, 2]);
    write(stateEl, (s) => { s["items.1"] = { v: 77 }; });
    expect(read(stateEl, (s) => s["items.1.v"])).toBe(77); // 旧: 2
    expect(read(stateEl, (s) => s.$getAll("items.*.v", []))).toEqual([1, 77]); // 旧: [1, 2]
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 行の下の読み
// ---------------------------------------------------------------------------

describe("差し替えた行の下の読み", () => {
  it.each(VARIANTS)("行 getter を直接添字・$getAll で読んでも、新しい要素から計算する（%s）", async (_label, extra) => {
    const state: any = { items: [{ name: "a" }, { name: "b" }] };
    getter(state, "items.*.label", function (this: any) { return this["items.*.name"].toUpperCase(); });
    const { host, stateEl } = await mount(state, extra("items"));
    expect(read(stateEl, (s) => [s["items.0.label"], s.$getAll("items.*.label", [])])).toEqual(["A", ["A", "B"]]);

    write(stateEl, (s) => { s["items.0"] = { ...s["items.0"], name: "z" }; });
    await flush();
    // 旧（for なし）: ["A", ["A", "B"]]
    expect(read(stateEl, (s) => [s["items.0.label"], s.$getAll("items.*.label", [])])).toEqual(["Z", ["Z", "B"]]);
    host.remove();
  });

  it.each(VARIANTS)("$resolve / $setAll による要素の書き込みも、子のパスに届く（%s）", async (_label, extra) => {
    const { host, stateEl } = await mount({ items: [{ v: 1 }, { v: 2 }] }, extra("items"));
    expect(read(stateEl, (s) => s.$getAll("items.*.v", []))).toEqual([1, 2]);

    write(stateEl, (s) => { s.$resolve("items.*", [1], { v: 5 }); });
    await flush();
    expect(read(stateEl, (s) => [s.$getAll("items.*.v", []), s["items.1.v"]])).toEqual([[1, 5], 5]); // 旧（for なし）: [[1, 2], 2]

    write(stateEl, (s) => { s.$setAll("items.*", [], (row: any) => ({ v: row.v * 10 })); });
    await flush();
    expect(read(stateEl, (s) => [s.$getAll("items.*.v", []), s["items.0.v"]])).toEqual([[10, 50], 10]); // 旧（for なし）: [[1, 2], 1]
    host.remove();
  });

  it("行の一部だけを変える書き込み（items.0.name）は今までどおり届き、行を作り直さない", async () => {
    const { host, stateEl } = await mount({ items: [{ name: "a" }, { name: "b" }] });
    expect(read(stateEl, (s) => s.$getAll("items.*.name", []))).toEqual(["a", "b"]);
    const rows = [...getListIndexesByList(raw(stateEl).items)!];

    write(stateEl, (s) => { s["items.0.name"] = "z"; });
    expect(read(stateEl, (s) => [s["items.0.name"], s.$getAll("items.*.name", [])])).toEqual(["z", ["z", "b"]]);
    expect(getListIndexesByList(raw(stateEl).items)).toEqual(rows);
    expect(getListIndexesByList(raw(stateEl).items)![0]).toBe(rows[0]);
    host.remove();
  });

  it.each(VARIANTS)("同じ要素を書き戻しても行は据え置き、別の要素なら新しい行になる（%s）", async (_label, extra) => {
    const { host, stateEl } = await mount({ items: [{ v: 1 }, { v: 2 }] }, extra("items"));
    expect(read(stateEl, (s) => s.$getAll("items.*.v", []))).toEqual([1, 2]);
    const [row0, row1] = getListIndexesByList(raw(stateEl).items)!;

    write(stateEl, (s) => { s["items.0"] = s["items.0"]; });
    await flush();
    expect(getListIndexesByList(raw(stateEl).items)![0]).toBe(row0);

    write(stateEl, (s) => { s["items.1"] = { v: 3 }; });
    await flush();
    const after = getListIndexesByList(raw(stateEl).items)!;
    expect(after[0]).toBe(row0);
    expect(after[1]).not.toBe(row1);
    expect(after[1].index).toBe(1);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 入れ子
// ---------------------------------------------------------------------------

describe("入れ子のリスト", () => {
  const groupsState = () => {
    const state: any = { groups: [{ name: "g0", items: [{ v: 1 }, { v: 2 }] }, { name: "g1", items: [{ v: 3 }] }] };
    getter(state, "groups.*.sum", function (this: any) {
      return this.$getAll("groups.*.items.*.v").reduce((a: number, b: number) => a + b, 0);
    });
    getter(state, "groups.*.label", function (this: any) { return this["groups.*.name"].toUpperCase(); });
    return state;
  };
  const OUTER: [string, string][] = [
    ["groups も描かない", ""],
    ["groups だけを for で描く", forOf("groups")],
  ];

  it.each(OUTER)("groups.1.items.0 = … の後、内側の子のパスと外側の行 getter の集計が新しい値を返す（%s）", async (_label, html) => {
    const { host, stateEl } = await mount(groupsState(), html);
    expect(read(stateEl, (s) => s.$getAll("groups.*.sum", []))).toEqual([3, 3]);

    write(stateEl, (s) => { s["groups.1.items.0"] = { v: 30 }; });
    await flush();
    // 旧: [[3, 3], 3]（groups を for で描いていても、内側を描いていなければ同じ）
    expect(read(stateEl, (s) => [s.$getAll("groups.*.sum", []), s["groups.1.items.0.v"]])).toEqual([[3, 30], 30]);
    host.remove();
  });

  it.each(OUTER)("外側の行を差し替えても、持ち越した内側のリストへの後の書き込みが行 getter の集計に届く（%s）", async (_label, html) => {
    const { host, stateEl } = await mount(groupsState(), html);
    expect(read(stateEl, (s) => [s.$getAll("groups.*.sum", []), s.$getAll("groups.*.label", [])])).toEqual([[3, 3], ["G0", "G1"]]);

    // items の配列は参照ごと持ち越す
    write(stateEl, (s) => { s["groups.0"] = { ...s["groups.0"], name: "h0" }; });
    await flush();
    expect(read(stateEl, (s) => [s["groups.0.label"], s.$getAll("groups.*.label", [])])).toEqual(["H0", ["H0", "G1"]]); // 旧（groups も描かない）: ["G0", …]
    // 新しい行の集計をキャッシュに載せておく
    expect(read(stateEl, (s) => s.$getAll("groups.*.sum", []))).toEqual([3, 3]);

    // 差し替えた行を退役させないと、内側の行集合が古い行にぶら下がったまま残り、
    // この書き込みが古い行の集計しか無効にしない（#256 と同じ構図）
    write(stateEl, (s) => { s["groups.0.items.1.v"] = 20; });
    await flush();
    expect(read(stateEl, (s) => [s["groups.0.sum"], s.$getAll("groups.*.sum", [])])).toEqual([21, [21, 3]]);
    host.remove();
  });

  it.each(VARIANTS)("再帰の集計: 描いていない子の行・根の行を差し替えても、合計が state と一致する（%s）", async (_label, extra) => {
    const state: any = { nodes: [node(7, [node(70)]), node(8)], $recursion: { "nodes.*": "children.*" } };
    getter(state, "nodes.**.total", function (this: any) {
      return this["nodes.**.value"] +
        this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
    });
    getter(state, "grand", function (this: any) {
      return this.$getAll("nodes.*.total", []).reduce((a: number, b: number) => a + b, 0);
    });
    const { host, stateEl, shadowRoot } = await mount(state, `<b class="g">{{ grand }}</b>` + extra("nodes"));
    expect(txt(shadowRoot, ".g")).toEqual(["85"]);

    write(stateEl, (s) => { s.$resolve("nodes.*.children.*", [0, 0], node(71, [node(1)])); });
    await flush();
    expect(txt(shadowRoot, ".g")).toEqual(["87"]); // 旧: ["85"]（nodes を for で描いていても）
    expect(read(stateEl, (s) => s.$getAll("nodes.*.total", []))).toEqual([79, 8]);

    write(stateEl, (s) => { s["nodes.0"] = { ...s["nodes.0"], value: 100 }; });
    await flush();
    expect(read(stateEl, (s) => s.$getAll("nodes.*.total", []))).toEqual([172, 8]);

    write(stateEl, (s) => { s.$resolve("nodes.*.children.*.value", [0, 0], 72); });
    await flush();
    expect(txt(shadowRoot, ".g")).toEqual(["181"]);
    expect(read(stateEl, (s) => s.$getAll("nodes.*.total", []))).toEqual([173, 8]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 依存と通知
// ---------------------------------------------------------------------------

describe("依存と通知", () => {
  it.each(VARIANTS)("$eq を読む行 getter: 差し替えた行も選択の変更に追従する（%s）", async (_label, extra) => {
    const state: any = { sel: 2, items: [{ id: 1 }, { id: 2 }] };
    getter(state, "items.*.isSel", function (this: any) { return this.$eq("sel", this["items.*.id"]); });
    getter(state, "selCount", function (this: any) {
      return this.$getAll("items.*.isSel", []).filter(Boolean).length;
    });
    const { host, stateEl, shadowRoot } = await mount(state, `<b class="c">{{ selCount }}</b>` + extra("items"));
    expect(txt(shadowRoot, ".c")).toEqual(["1"]);

    write(stateEl, (s) => { s["items.0"] = { id: 3 }; });
    await flushTimes();
    write(stateEl, (s) => { s.sel = 3; });
    await flushTimes();
    expect(read(stateEl, (s) => s.$getAll("items.*.isSel", []))).toEqual([true, false]); // 旧（for なし）: [false, false]
    expect(txt(shadowRoot, ".c")).toEqual(["1"]); // 旧（for なし）: ["0"]
    host.remove();
  });

  it.each(VARIANTS)("$watch(\"items.*.name\") は差し替えた行の新しい値で 1 回発火し、その後の葉の書き込みでも発火する（%s）", async (_label, extra) => {
    const log: unknown[] = [];
    const { host, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }],
      $watch: { "items.*.name"(cur: unknown, prev: unknown, i: unknown) { log.push([cur, prev, i]); } },
    }, extra("items"));
    await flushTimes();
    log.length = 0;

    write(stateEl, (s) => { s["items.1"] = { name: "z" }; });
    await flushTimes();
    expect(log).toEqual([["z", undefined, 1]]);

    log.length = 0;
    write(stateEl, (s) => { s["items.1.name"] = "y"; });
    await flushTimes();
    expect(log).toEqual([["y", "z", 1]]);
    host.remove();
  });

  it.each(VARIANTS)("$watch(\"tags.*\") の prev: 同じバッチで同じ位置を 2 回書いても、バッチが始まる前の値（%s）", async (_label, extra) => {
    const log: unknown[] = [];
    const { host, stateEl } = await mount({
      tags: ["a", "b", "c"],
      $watch: { "tags.*"(cur: unknown, prev: unknown, i: unknown) { log.push([cur, prev, i]); } },
    }, extra("tags"));
    await flushTimes();
    log.length = 0;

    write(stateEl, (s) => { s["tags.1"] = "Q"; });
    await flushTimes();
    expect(log).toEqual([["Q", "b", 1]]);

    log.length = 0;
    write(stateEl, (s) => {
      s["tags.1"] = "R";
      s["tags.1"] = "S";
    });
    await flushTimes();
    // 差し替えた行の prev を新しい行へ引き継がないと、1 回目の値 "R" が prev になる
    expect(log).toEqual([["S", "Q", 1]]);
    host.remove();
  });

  it.each(VARIANTS)("$scan: 同じ job で行の葉に書いてから行を差し替えると、新しい行として 1 回畳む（%s）", async (_label, extra) => {
    const { host, stateEl } = await mount({
      items: [{ qty: 1 }, { qty: 2 }],
      $scan: {
        log: {
          from: "items.*.qty",
          initial: [],
          fold: (acc: string[], cur: unknown, prev: unknown, index: number) => [...acc, `${index}:${prev}->${cur}`],
        },
      },
    }, extra("items"));
    await flushTimes();

    write(stateEl, (s) => {
      s["items.1.qty"] = 5;
      s["items.1"] = { qty: 7 };
    });
    await flushTimes();
    // 旧（for なし）: ["1:2->7"]（差し替える前の行の葉の着地が、その位置の新しい値を読んでいた）
    expect(read(stateEl, (s) => s.log)).toEqual(["1:undefined->7"]);

    write(stateEl, (s) => { s["items.1.qty"] = 8; });
    await flushTimes();
    expect(read(stateEl, (s) => s.log)).toEqual(["1:undefined->7", "1:7->8"]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 同じ配列を別のパスの for が描く
// ---------------------------------------------------------------------------

/**
 * 要素の書き込みは台帳（配列 → 行）を差し替える。配列そのものを別のパスの `for` が描いていると
 * （配列をそのまま返す getter・同じ配列を持つ別のキーや state）、その `for` は差し替えを知らないまま、
 * 描いていない新しい行を描いたつもりで差分を取り、`Content not found for ListIndex` で投げ続けた
 * （以後の行の追加・削除も描かない）。書き込む前の並びの写しに前の台帳を持たせ、描画の基準をそこへ
 * 移す（入れ替えの経路の notifySwappedList と同じ）。
 */
describe("同じ配列を別のパスの for が描く", () => {
  const rows = (root: ShadowRoot) => txt(root, ".r").join(",");
  const forOver = (list: string) => `<ul><template data-wcs="for: ${list}"><li class="r">{{ .name }}</li></template></ul>`;

  it("TodoMVC の形（getter が元の配列を返し、行のボタンが元のパスへ書く）: for が壊れず、次の描画で新しい行を描く", async () => {
    const errors = await collectErrors(async () => {
      const { host, stateEl, shadowRoot } = await mount({
        filter: "all",
        todos: [{ title: "a", done: false }, { title: "b", done: false }],
        get shown() {
          const s = this as any;
          return s.filter === "all" ? s.todos : s.todos.filter((t: any) => t.done === (s.filter === "done"));
        },
        get left() { return (this as any).$getAll("todos.*.done", []).filter((d: boolean) => !d).length; },
        toggle(this: any) { const i = this.$1; this["todos." + i] = { ...this["todos." + i], done: !this["todos." + i].done }; },
        add(this: any) { this.todos = [...this.todos, { title: "n", done: false }]; },
      }, `<b class="left">{{ left }}</b><ul><template data-wcs="for: shown"><li><span class="t">{{ .title }}:{{ .done }}</span>` +
        `<button class="tg" data-wcs="onclick: toggle">t</button></li></template></ul><button class="add" data-wcs="onclick: add">+</button>`);
      const shown = () => [txt(shadowRoot, ".left").join(""), txt(shadowRoot, ".t").join(",")];
      expect(shown()).toEqual(["2", "a:false,b:false"]);

      (shadowRoot.querySelectorAll(".tg")[0] as HTMLButtonElement).click();
      await flushTimes();
      // 書いた行はすぐに描き直される（#362。旧: 次にリストを描くまで "a:false,b:false" のまま）
      expect(shown()).toEqual(["1", "a:true,b:false"]);
      (shadowRoot.querySelector(".add") as HTMLButtonElement).click();
      await flushTimes();
      // 旧: 行は "a:false,b:false" のまま（追加した行も描かない）
      expect(shown()).toEqual(["2", "a:true,b:false,n:false"]);

      (shadowRoot.querySelectorAll(".tg")[1] as HTMLButtonElement).click();
      await flushTimes();
      write(stateEl, (s) => { s.filter = "done"; });
      await flushTimes();
      expect(shown()).toEqual(["1", "a:true,b:true"]);
      write(stateEl, (s) => { s.filter = "all"; });
      await flushTimes();
      expect(shown()).toEqual(["1", "a:true,b:true,n:false"]);
      host.remove();
    });
    // 旧: `Content not found for ListIndex: 0 at path "shown"`
    expect(errors).toEqual([]);
  });

  it("getter が配列をそのまま返す（for: view）: 要素の書き込みの後も、行の追加・削除を描く", async () => {
    const errors = await collectErrors(async () => {
      const { host, stateEl, shadowRoot } = await mount({
        items: [{ name: "a" }, { name: "b" }],
        get view() { return (this as any).items; },
      }, forOver("view"));
      write(stateEl, (s) => { s["items.0"] = { name: "z" }; });
      await flushTimes();
      expect(read(stateEl, (s) => s["view.0.name"])).toBe("z");
      write(stateEl, (s) => { s.items = [...s.items, { name: "n" }]; });
      await flushTimes();
      expect(rows(shadowRoot)).toBe("z,b,n"); // 旧: "a,b"
      write(stateEl, (s) => { s["items.1"] = { name: "y" }; });
      write(stateEl, (s) => { s.items = s.items.slice(1); });
      await flushTimes();
      expect(rows(shadowRoot)).toBe("y,n"); // 旧: "a,b"
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it("同じ配列を 2 つのキーが持つ: 描いていないキーへ書いた後、描いているキーの要素の書き込み・入れ替えも描く", async () => {
    const errors = await collectErrors(async () => {
      const arr = [{ name: "a" }, { name: "b" }, { name: "c" }];
      const { host, stateEl, shadowRoot } = await mount({ a: arr, b: arr }, forOver("b"));
      write(stateEl, (s) => { s["a.0"] = { name: "z" }; });
      await flushTimes();
      write(stateEl, (s) => { s["b.1"] = { name: "y" }; });
      await flushTimes();
      expect(rows(shadowRoot)).toBe("z,y,c"); // 旧: "a,b,c"
      write(stateEl, (s) => { const x = s["b.0"]; const y = s["b.2"]; s["b.0"] = y; s["b.2"] = x; });
      await flushTimes();
      expect(rows(shadowRoot)).toBe("c,y,z"); // 旧: "a,b,c"
      expect(raw(stateEl).b.map((o: any) => o.name)).toEqual(["c", "y", "z"]);
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it.each([
    ["別の要素を書く", (s: any) => { s["a.3"] = { name: "w" }; }, "q,p,r,w"],
    ["別の要素を書いてから元の要素へ戻す", (s: any) => { const o = s["a.3"]; s["a.3"] = { name: "w" }; s["a.3"] = o; }, "q,p,r,s"],
  ])("描いているキーで入れ替えている途中に、描いていないキーで要素に書く（%s）: 入れ替える前の並びから描く", async (_label, writeA, drawn) => {
    const errors = await collectErrors(async () => {
      const arr = [{ name: "p" }, { name: "q" }, { name: "r" }, { name: "s" }];
      const { host, stateEl, shadowRoot } = await mount({ a: arr, b: arr }, forOver("b"));
      write(stateEl, (s) => {
        const t = s["b.0"];
        s["b.0"] = s["b.1"];
        writeA(s);
        s["b.1"] = t;
      });
      await flushTimes();
      // 描画の基準を入れ替えの途中の配列（p の位置に q が 2 つ）で取ると、行が 1 つ余計に描かれた
      expect(rows(shadowRoot)).toBe(drawn);
      write(stateEl, (s) => { s.b = [...s.b, { name: "n" }]; });
      await flushTimes();
      expect(rows(shadowRoot)).toBe(`${drawn},n`);
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it("別の state ツリーが同じ配列を持つ: 描いていない側の要素の書き込みの後も、描いている側が追従する", async () => {
    const errors = await collectErrors(async () => {
      const arr = [{ name: "a" }, { name: "b" }];
      const A = await mount({ items: arr }, forOver("items"));
      const B = await mount({ items: arr });
      write(B.stateEl, (s) => { s["items.0"] = { name: "z" }; });
      await flushTimes();
      write(A.stateEl, (s) => { s.items = [...s.items, { name: "n" }]; });
      await flushTimes();
      expect(rows(A.shadowRoot)).toBe("z,b,n"); // 旧: "a,b"
      write(A.stateEl, (s) => { s["items.1.name"] = "q"; });
      await flushTimes();
      expect(rows(A.shadowRoot)).toBe("z,q,n");
      A.host.remove();
      B.host.remove();
    });
    expect(errors).toEqual([]);
  });

  it("行 getter が内側の配列をそのまま返す（for: .shown）: 元のパスで書いた後も、行の追加を描く", async () => {
    const errors = await collectErrors(async () => {
      const { host, stateEl, shadowRoot } = await mount({
        groups: [{ items: [{ name: "a" }, { name: "b" }] }],
        get "groups.*.shown"() { return (this as any)["groups.*.items"]; },
      }, `<template data-wcs="for: groups"><ul><template data-wcs="for: .shown"><li class="r">{{ .name }}</li></template></ul></template>`);
      write(stateEl, (s) => { s["groups.0.items.0"] = { name: "z" }; });
      await flushTimes();
      write(stateEl, (s) => { s["groups.0.items"] = [...s["groups.0.items"], { name: "n" }]; });
      await flushTimes();
      expect(rows(shadowRoot)).toBe("z,b,n"); // 旧: "a,b"
      host.remove();
    });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 台帳の写し
// ---------------------------------------------------------------------------

/**
 * 台帳の配列は、それを持つ別の持ち手（差分のキャッシュ・別の配列の台帳・入れ替え・`$eqIndex` の監視）が
 * いる間はその場で書き換えない（#335 と同じ壊れ方になる）。要素の書き込みのたびに丸写しすると、1 バッチで
 * n 要素を書く `$setAll("items.*", …)` が O(n²) になるので、要素の書き込みが写した台帳は、誰も持って
 * いない間だけその場で書き換える（listIndexesByList.ts の isOwnedListIndexes）。
 */
describe("台帳の写し", () => {
  const ledger = (stateEl: any) => getListIndexesByList(raw(stateEl).items)!;
  const forOver = (list: string, field: string) =>
    `<ul><template data-wcs="for: ${list}"><li class="r">{{ .${field} }}</li></template></ul>`;
  const rows = (root: ShadowRoot) => txt(root, ".r").join(",");

  it("1 バッチの要素の書き込みは台帳を 1 回だけ写し、差分が持った台帳は書き換えない", async () => {
    const { host, stateEl } = await mount({ items: [{ v: 1 }, { v: 2 }, { v: 3 }] });
    expect(read(stateEl, (s) => s.$getAll("items.*.v", []))).toEqual([1, 2, 3]);
    const first = ledger(stateEl);
    const firstRows = [...first];
    const seen: unknown[] = [];
    write(stateEl, (s) => {
      for (let i = 0; i < 3; i++) {
        s["items." + i] = { v: 10 * (i + 1) };
        seen.push(ledger(stateEl));
      }
    });
    expect(seen[0]).not.toBe(first);
    expect(seen[1]).toBe(seen[0]); // 旧: 書き込みごとに写した
    expect(seen[2]).toBe(seen[0]);
    expect(first).toEqual(firstRows); // 差分（$getAll）が持つ台帳はそのまま

    // $getAll の差分が台帳を持ったので、次の書き込みはまた写す
    expect(read(stateEl, (s) => s.$getAll("items.*.v", []))).toEqual([10, 20, 30]);
    const second = ledger(stateEl);
    const secondRows = [...second];
    write(stateEl, (s) => { s["items.1"] = { v: 5 }; });
    expect(ledger(stateEl)).not.toBe(second);
    expect(second).toEqual(secondRows);
    expect(read(stateEl, (s) => s.$getAll("items.*.v", []))).toEqual([10, 5, 30]);
    host.remove();
  });

  it("配列を写して同じバッチで要素に書く（別名の for）: 写す前の配列の行は書き換わらない", async () => {
    const errors = await collectErrors(async () => {
      const arr = [{ name: "a" }, { name: "b" }];
      const { host, stateEl, shadowRoot } = await mount({
        items: arr, other: arr,
        get visible() { return (this as any).items; },
      }, forOver("visible", "name") + `<ol>${forOver("other", "name").replace(/class="r"/, 'class="o"')}</ol>`);
      expect(read(stateEl, (s) => s.$getAll("items.*.name", []))).toEqual(["a", "b"]);
      const arrRow0 = getListIndexesByList(arr)![0];

      write(stateEl, (s) => {
        s["items.1"] = { name: "y" };
        s.items = s.items.slice();
        s["items.0"] = { name: "z" };
      });
      await flushTimes();
      expect(rows(shadowRoot)).toBe("z,y");
      // 写しの要素の書き込みが、写す前の配列（other が持つ）の台帳を書き換えない
      expect(getListIndexesByList(arr)![0]).toBe(arrRow0);

      write(stateEl, (s) => { s.items = s.items.slice(); s["items.1"] = { name: "w" }; });
      write(stateEl, (s) => { s.items = [...s.items, { name: "n" }]; s.other = [...s.other]; });
      await flushTimes();
      expect(rows(shadowRoot)).toBe("z,w,n");
      expect(txt(shadowRoot, ".o").join(",")).toBe("a,y");
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it.each([
    ["行を足してから行 0 を差し替える", (s: any) => { s.items = [...s.items, { id: 4 }]; s["items.0"] = { id: 99 }; }, "99,2,3,4", "4,3,2,99"],
    ["同じ中身の写しで置き換えてから行 1 を差し替える", (s: any) => { s.items = [...s.items]; s["items.1"] = { id: 99 }; }, "1,99,3", "3,99,1"],
  ])("同じバッチで一覧を置き換えてから要素に書く（別名の for・%s）", async (_label, batch, drawn, reversed) => {
    const errors = await collectErrors(async () => {
      const { host, stateEl, shadowRoot } = await mount({
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
        get view() { return (this as any).items; },
      }, forOver("view", "id"));
      write(stateEl, batch);
      await flushTimes();
      expect(rows(shadowRoot)).toBe(drawn);
      write(stateEl, (s) => { s.items = [...s.items].reverse(); });
      await flushTimes();
      expect(rows(shadowRoot)).toBe(reversed);
      write(stateEl, (s) => { s.items = [{ id: 7 }, { id: 8 }]; });
      await flushTimes();
      expect(rows(shadowRoot)).toBe("7,8");
      host.remove();
    });
    expect(errors).toEqual([]);
  });
});

describe("台帳の写し: 持ち手ができた後の書き込み", () => {
  const forOver = (list: string) => `<ul><template data-wcs="for: ${list}"><li class="r">{{ .v }}</li></template></ul>`;
  const rows = (root: ShadowRoot) => txt(root, ".r").join(",");

  it("差し替えの後に同じ配列を別のキーへ代入し、その差分ができた後で要素に書く", async () => {
    const errors = await collectErrors(async () => {
      const { host, stateEl, shadowRoot } = await mount({ items: [{ v: 1 }, { v: 2 }], other: [] }, forOver("other"));
      write(stateEl, (s) => {
        s["items.0"] = { v: 10 };
        s.other = s.items;
        expect(s.$getAll("other.*.v", [])).toEqual([10, 2]);
        s["items.1"] = { v: 20 };
      });
      await flushTimes();
      // 差分（[] → 配列）が持った台帳をその場で書き換えると、キャッシュした差分に無い行を描こうとして投げる
      expect(rows(shadowRoot)).toBe("10,20");
      expect(read(stateEl, (s) => [s.$getAll("other.*.v", []), s.$getAll("items.*.v", [])])).toEqual([[10, 20], [10, 20]]);
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it("別の要素を書いてから元の要素へ戻した配列と同じ中身の、前の配列との差分が、前の配列の行を戻さない", async () => {
    const errors = await collectErrors(async () => {
      const init = [{ v: 1 }, { v: 2 }, { v: 3 }];
      const { host, stateEl, shadowRoot } = await mount({ a: init, b: init, get view() { return (this as any).a; } }, forOver("b"));
      const refresh = (s: any) => { const n = [...s.b]; s.a = n; s.b = n; };
      // view の差分の基準は最初の配列
      expect(read(stateEl, (s) => s.$getAll("view.*.v", []))).toEqual([1, 2, 3]);
      write(stateEl, refresh);
      await flushTimes();
      // 同じ要素へ戻しても位置 1 は新しい行（前の行は退役）。写しに置き換えて for: b にその行を描かせる
      write(stateEl, (s) => { const o = s["a.1"]; s["a.1"] = { v: 20 }; s["a.1"] = o; });
      write(stateEl, refresh);
      await flushTimes();
      write(stateEl, (s) => {
        // 最初の配列（中身は同じ）との差分。前の配列の台帳（退役した行を含む）を被せると、次の差分で
        // for: b が描いていない行を描こうとして投げた
        expect(s.$getAll("view.*.v", [])).toEqual([1, 2, 3]);
        s["a.2"] = { v: 30 };
      });
      write(stateEl, refresh);
      await flushTimes();
      expect(rows(shadowRoot)).toBe("1,2,30");
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it("一覧を置き換えてから $setAll を 2 回続けても、別名の for が描く", async () => {
    const errors = await collectErrors(async () => {
      const { host, stateEl, shadowRoot } = await mount({
        items: [{ v: 1 }, { v: 2 }, { v: 3 }],
        get view() { return (this as any).items; },
      }, forOver("view"));
      expect(read(stateEl, (s) => s.$getAll("items.*.v", []))).toEqual([1, 2, 3]);
      write(stateEl, (s) => {
        s.items = s.items.map((o: any) => ({ ...o }));
        s.$setAll("items.*", [], (o: any) => ({ v: o.v * 10 }));
        s.$setAll("items.*", [], (o: any) => ({ v: o.v + 1 }));
      });
      await flushTimes();
      expect(rows(shadowRoot)).toBe("11,21,31");
      write(stateEl, (s) => {
        s.$setAll("items.*", [], (o: any) => ({ v: o.v + 1 }));
        s.$setAll("items.*", [], (o: any) => ({ v: o.v * 2 }));
      });
      write(stateEl, (s) => { s.items = [...s.items, { v: 0 }]; });
      await flushTimes();
      expect(rows(shadowRoot)).toBe("24,44,64,0");
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it("$eqIndex: 監視の付いた台帳は写してから差し替え、選んだ位置を 1 バッチで何度書いても追従する", async () => {
    const state: any = { sel: 1, items: [{ n: "a" }, { n: "b" }, { n: "c" }] };
    getter(state, "items.*.current", function (this: any) { return this.$eqIndex("sel"); });
    getter(state, "curName", function (this: any) {
      const current = this.$getAll("items.*.current", []);
      return this.$getAll("items.*.n", []).filter((_: unknown, i: number) => current[i]).join("");
    });
    const { host, stateEl, shadowRoot } = await mount(state, `<b class="c">{{ curName }}</b>`);
    expect(txt(shadowRoot, ".c")).toEqual(["b"]);

    write(stateEl, (s) => {
      s["items.0"] = { n: "A" };
      s["items.1"] = { n: "B" };
      expect(s.curName).toBe("B"); // 差し替えた台帳に監視が付く
      s["items.1"] = { n: "BB" };
      s["items.2"] = { n: "C" };
    });
    await flushTimes();
    expect(txt(shadowRoot, ".c")).toEqual(["BB"]);
    expect(read(stateEl, (s) => s.$getAll("items.*.current", []))).toEqual([false, true, false]);
    write(stateEl, (s) => { s.sel = 2; });
    await flushTimes();
    expect(txt(shadowRoot, ".c")).toEqual(["C"]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// SSR のハイドレーションの後
// ---------------------------------------------------------------------------

describe("SSR のハイドレーションの後", () => {
  it("getter が配列をそのまま返す for を、元のパスへの要素の書き込みの後も描く", async () => {
    const make = () => ({ items: [{ name: "a" }, { name: "b" }], get visible() { return (this as any).items; } });
    const markup = `<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: visible"><li>{{ .name }}</li></template></ul>`;
    const errors = await collectErrors(async () => {
      const html = await serverRender(markup, make);
      const el = await clientLoad(html, make);
      const shown = () => Array.from(document.querySelectorAll("li")).map((n) => n.textContent).join(",");
      expect(shown()).toBe("a,b");
      write(el, (s) => { s["visible.0"] = { name: "z" }; });
      await flushTimes();
      expect(shown()).toBe("z,b");
      write(el, (s) => { s["items.1"] = { name: "y" }; });
      write(el, (s) => { s.items = [...s.items, { name: "n" }]; });
      await flushTimes();
      expect(shown()).toBe("z,y,n"); // 旧: "z,b"
      document.body.innerHTML = "";
    });
    expect(errors).toEqual([]);
  });
});
