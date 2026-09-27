/**
 * integration.listAliasWrite.test.ts — 元の配列をそのまま返す getter を `for:` で描いているとき、元のパスへの
 * 行の下への書き込み（要素の差し替え・葉の書き込み）で、getter の `for:` の行がすぐに描き直される（#362）。
 *
 * 旧挙動: TodoMVC の形（`get shown() { return this.filter === "all" ? this.todos : … }` と `for: shown`、行の
 * ボタンが `this["todos." + i]` へ書く）で、状態と `$getAll` の集計（残り件数）は書き換わるのに、行は次に
 * そのリストを描く（絞り込みを切り替える）まで古い値のままだった。行の台帳は配列ごとに 1 組なので 2 つの
 * パスの行は同じ listIndex だが、キャッシュ・依存・束縛はパスごとで、`todos.*.done` の依存ウォークは
 * `shown.*.done` に届かなかった。
 *
 * いまは書き込みの通知（src/proxy/methods/setByAddress.ts の notifyWrite）が、書いたパスの各段のリストを
 * 読んだ getter のうち `for:` で描くものを候補にし、同じ深さで値が同じ配列なら、その getter のパスの同じ行へ
 * も知らせる。要素の書き込みは行が新しくなるので、その getter の `for:` も描き直させる。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { flush, makeMount, read, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("list-alias-write-host");

const txt = (root: ParentNode, selector: string) =>
  Array.from(root.querySelectorAll(selector)).map((n) => n.textContent);
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

// ---------------------------------------------------------------------------
// Issue の再現（TodoMVC の形）
// ---------------------------------------------------------------------------

describe("Issue の再現（TodoMVC の形）", () => {
  const TOGGLES: [string, (self: any, i: number) => void][] = [
    ["要素の差し替え", (self, i) => { self["todos." + i] = { ...self["todos." + i], done: !self["todos." + i].done }; }],
    ["葉の書き込み", (self, i) => { self["todos." + i + ".done"] = !self["todos." + i + ".done"]; }],
  ];

  it.each(TOGGLES)("行のボタンが元のパスへ書くと、getter の for の行がすぐに描き直される（%s）", async (_label, toggle) => {
    const errors = await collectErrors(async () => {
      const { host, stateEl, shadowRoot } = await mount({
        filter: "all",
        todos: [{ title: "a", done: false }, { title: "b", done: false }],
        get shown() {
          const s = this as any;
          return s.filter === "all" ? s.todos : s.todos.filter((t: any) => t.done === (s.filter === "done"));
        },
        get left() { return (this as any).$getAll("todos.*.done", []).filter((d: boolean) => !d).length; },
        toggle(this: any) { toggle(this, this.$1); },
      }, `<b class="left">{{ left }}</b><ul><template data-wcs="for: shown"><li><span class="t">{{ .title }}:{{ .done }}</span>` +
        `<button class="tg" data-wcs="onclick: toggle">t</button></li></template></ul>`);
      const shown = () => [txt(shadowRoot, ".left").join(""), txt(shadowRoot, ".t").join(",")];
      expect(shown()).toEqual(["2", "a:false,b:false"]);

      (shadowRoot.querySelectorAll(".tg")[0] as HTMLButtonElement).click();
      await flushTimes();
      // 旧: ["1", "a:false,b:false"]（行は絞り込みを切り替えるまで古いまま）
      expect(shown()).toEqual(["1", "a:true,b:false"]);

      write(stateEl, (s) => { s.filter = "active"; });
      await flushTimes();
      expect(shown()).toEqual(["1", "b:false"]);
      write(stateEl, (s) => { s.filter = "all"; });
      await flushTimes();
      expect(shown()).toEqual(["1", "a:true,b:false"]);

      (shadowRoot.querySelectorAll(".tg")[1] as HTMLButtonElement).click();
      await flushTimes();
      expect(shown()).toEqual(["0", "a:true,b:true"]);
      (shadowRoot.querySelectorAll(".tg")[0] as HTMLButtonElement).click();
      await flushTimes();
      expect(shown()).toEqual(["1", "a:false,b:true"]);
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it("対照: 元のパスの for（for: todos）は、同じ書き込みですぐに描き直される", async () => {
    const { host, shadowRoot } = await mount({
      todos: [{ title: "a", done: false }, { title: "b", done: false }],
      toggle(this: any) { const i = this.$1; this["todos." + i] = { ...this["todos." + i], done: !this["todos." + i].done }; },
    }, `<ul><template data-wcs="for: todos"><li><span class="t">{{ .title }}:{{ .done }}</span>` +
      `<button class="tg" data-wcs="onclick: toggle">t</button></li></template></ul>`);
    (shadowRoot.querySelectorAll(".tg")[0] as HTMLButtonElement).click();
    await flushTimes();
    expect(txt(shadowRoot, ".t").join(",")).toBe("a:true,b:false");
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 別名の形
// ---------------------------------------------------------------------------

describe("別名の形", () => {
  const forOver = (list: string, cls: string) =>
    `<ul><template data-wcs="for: ${list}"><li class="${cls}">{{ .name }}</li></template></ul>`;

  it("元のパスの for と getter の for を並べる: 要素の差し替え（入れ替えの経路）の後、両方が新しい要素を描く", async () => {
    const errors = await collectErrors(async () => {
      const { host, stateEl, shadowRoot } = await mount({
        items: [{ name: "a" }, { name: "b" }],
        get visible() { return (this as any).items; },
      }, forOver("items", "i") + forOver("visible", "v"));
      const shown = () => [txt(shadowRoot, ".i").join(","), txt(shadowRoot, ".v").join(",")];
      write(stateEl, (s) => { s["items.0"] = { name: "z" }; });
      await flushTimes();
      expect(shown()).toEqual(["z,b", "z,b"]); // 旧: ["z,b", "a,b"]
      write(stateEl, (s) => { s["items.1.name"] = "y"; });
      await flushTimes();
      expect(shown()).toEqual(["z,y", "z,y"]); // 旧: ["z,y", "a,b"]
      write(stateEl, (s) => { s.items = [...s.items, { name: "n" }]; });
      await flushTimes();
      expect(shown()).toEqual(["z,y,n", "z,y,n"]);
      write(stateEl, (s) => { s["items.0"] = s.items[2]; s["items.2"] = s.items[1]; s["items.1"] = { name: "q" }; });
      await flushTimes();
      expect(shown()).toEqual(["n,q,y", "n,q,y"]);
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it("入れ子の内側の段: 行の getter が内側の配列を返す（for: .shown）と、内側の行への書き込みがその行へ届く", async () => {
    const errors = await collectErrors(async () => {
      const state: any = { groups: [{ items: [{ name: "a" }, { name: "b" }] }, { items: [{ name: "c" }] }] };
      getter(state, "groups.*.shown", function (this: any) { return this["groups.*.items"]; });
      const { host, stateEl, shadowRoot } = await mount(state,
        `<div><template data-wcs="for: groups"><ul><template data-wcs="for: .shown"><li class="r">{{ .name }}</li></template></ul></template></div>`);
      const rows = () => txt(shadowRoot, ".r").join(",");
      expect(rows()).toBe("a,b,c");
      write(stateEl, (s) => { s["groups.0.items.1.name"] = "B"; });
      await flushTimes();
      expect(rows()).toBe("a,B,c"); // 旧: "a,b,c"
      write(stateEl, (s) => { s["groups.1.items.0"] = { name: "C" }; });
      await flushTimes();
      expect(rows()).toBe("a,B,C"); // 旧: "a,B,c"
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it("入れ子の外側の段: 外側の配列を返す getter（for: view）の内側の for も、内側の行への書き込みを描く", async () => {
    const errors = await collectErrors(async () => {
      const { host, stateEl, shadowRoot } = await mount({
        groups: [{ items: [{ name: "a" }, { name: "b" }] }, { items: [{ name: "c" }] }],
        get view() { return (this as any).groups; },
      }, `<div><template data-wcs="for: view"><ul><template data-wcs="for: .items"><li class="r">{{ .name }}</li></template></ul></template></div>`);
      const rows = () => txt(shadowRoot, ".r").join(",");
      write(stateEl, (s) => { s["groups.0.items.1.name"] = "B"; });
      await flushTimes();
      expect(rows()).toBe("a,B,c"); // 旧: "a,b,c"
      write(stateEl, (s) => { s["groups.1.items.0"] = { name: "C" }; });
      await flushTimes();
      expect(rows()).toBe("a,B,C"); // 旧: "a,B,c"
      write(stateEl, (s) => { s["groups.0"] = { items: [{ name: "x" }] }; });
      await flushTimes();
      expect(rows()).toBe("x,C"); // 旧: "a,B,C"
      expect(read(stateEl, (s) => s["view.1.items.0.name"])).toBe("C");
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it("別の配列を返している間（絞り込み）は別名にしない: 元のパスへの書き込みで getter の行を書き換えない", async () => {
    const errors = await collectErrors(async () => {
      const { host, stateEl, shadowRoot } = await mount({
        all: true,
        items: [{ name: "a" }, { name: "b" }],
        get visible() { const s = this as any; return s.all ? s.items : s.items.slice(1); },
      }, forOver("visible", "v"));
      write(stateEl, (s) => { s.all = false; });
      await flushTimes();
      expect(txt(shadowRoot, ".v").join(",")).toBe("b");
      // `visible` は `items` の写し。写しの行 0（b）へ、元の行 0（a）の書き込みを向けない
      write(stateEl, (s) => { s["items.0.name"] = "z"; });
      await flushTimes();
      expect(txt(shadowRoot, ".v").join(",")).toBe("b");
      host.remove();
    });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 別名から写しへの切り替え（絞り込み）
// ---------------------------------------------------------------------------

/**
 * 元の配列をそのまま返していた getter が写しを返すようになると（TodoMVC の絞り込み all → done）、差分は写しの
 * 要素に元の配列の行を要素の同一性で貸し、写しの位置へ振り直していた。元の配列はまだ `todos` に居るので、
 * 元の配列の台帳の行の添字が狂い、数値添字の読み書きが別の要素に着地した（`todos.1.title` が `t0` を読み、
 * `todos.1.title = "X"` が `todos[0]` を書き換えた — 修正前から）。getter の値が替わったとき、前の配列が
 * getter の読んだパスにまだ居るなら、その行を貸さず退役もさせない（写しには新しい行を作る）。
 */
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
      getter(state, "left", function (this: any) { return this.$getAll("todos.*.done", []).filter((d: boolean) => !d).length; });
    }
    return state;
  };
  const titles = (stateEl: any) => read(stateEl, (s) => s.todos.map((t: any) => `${t.title}:${t.done}`).join(","));
  const SHOWN = `<ul><template data-wcs="for: shown"><li class="s">{{ .title }}:{{ .done }}</li></template></ul>`;
  const TODOS = `<ol><template data-wcs="for: todos"><li class="o">{{ .title }}:{{ .done }}</li></template></ol>`;
  const VARIANTS: [string, boolean, string][] = [
    ["for: shown だけ", false, SHOWN],
    ["for: shown ＋ $getAll の集計", true, SHOWN + `<b class="l">{{ left }}</b>`],
    ["for: shown ＋ for: todos", false, SHOWN + TODOS],
  ];

  it.each(VARIANTS)("all → done → active → all の間、元のパス・数値添字の読み書きが正しい要素に着地する（%s）", async (_label, withLeft, body) => {
    const errors = await collectErrors(async () => {
      const { host, stateEl, shadowRoot } = await mount(mkTodos(withLeft), body);
      const shown = () => txt(shadowRoot, ".s").join(",");
      write(stateEl, (s) => { s.filter = "done"; });
      await flushTimes();
      expect(shown()).toBe("t1:true,t3:true");
      // 旧: ["t0", "t1"]（行 1・3 が写しの位置 0・1 へ振り直された）
      expect(read(stateEl, (s) => [s["todos.1.title"], s["todos.3.title"], s["shown.0.title"], s["shown.1.title"]]))
        .toEqual(["t1", "t3", "t1", "t3"]);
      write(stateEl, (s) => { s["todos.1.title"] = "X"; });
      write(stateEl, (s) => { s["todos.3"] = { title: "Y", done: true }; });
      await flushTimes();
      // 旧: "X:false,Y:true,t2:false,t3:true"（todos[0] と todos[1] に着地した）
      expect(titles(stateEl)).toBe("t0:false,X:true,t2:false,Y:true");

      write(stateEl, (s) => { s.filter = "active"; });
      await flushTimes();
      expect(shown()).toBe("t0:false,t2:false");
      write(stateEl, (s) => { s["todos.2.done"] = true; });
      write(stateEl, (s) => { s["shown.0.title"] = "Z"; });
      await flushTimes();
      expect(titles(stateEl)).toBe("Z:false,X:true,t2:true,Y:true");

      write(stateEl, (s) => { s.filter = "all"; });
      await flushTimes();
      expect(shown()).toBe("Z:false,X:true,t2:true,Y:true");
      expect(read(stateEl, (s) => [0, 1, 2, 3].map((i) => s[`todos.${i}.title`]))).toEqual(["Z", "X", "t2", "Y"]);
      write(stateEl, (s) => { s["todos.1.done"] = false; });
      await flushTimes();
      expect(shown()).toBe("Z:false,X:false,t2:true,Y:true");
      if (withLeft) {
        expect(txt(shadowRoot, ".l").join("")).toBe("2");
      }
      if (body.includes("for: todos")) {
        // 行 0 は getter のパス（`shown.0.title`）から書いたので、元のパスの for には届かない（逆向きは対象外）
        expect(txt(shadowRoot, ".o").slice(1).join(",")).toBe("X:false,t2:true,Y:true");
      }
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it("getter が生きている 2 本の配列を切り替える: どちらの配列の数値添字の読み書きも正しい要素に着地する", async () => {
    const errors = await collectErrors(async () => {
      const { host, stateEl, shadowRoot } = await mount({
        tab: "a",
        a: [{ n: "a0" }, { n: "a1" }],
        b: [{ n: "b0" }],
        get current() { const s = this as any; return s.tab === "a" ? s.a : s.b; },
      }, `<ul><template data-wcs="for: current"><li class="c">{{ .n }}</li></template></ul>`);
      write(stateEl, (s) => { s.b = [s.a[1], ...s.b]; }); // 同じ要素を両方の配列に置く
      write(stateEl, (s) => { s.tab = "b"; });
      await flushTimes();
      expect(txt(shadowRoot, ".c").join(",")).toBe("a1,b0");
      // 旧: "a0"（a の行 1 が b の位置 0 へ振り直された）
      expect(read(stateEl, (s) => s["a.1.n"])).toBe("a1");
      write(stateEl, (s) => { s["a.1.n"] = "A1"; });
      write(stateEl, (s) => { s.tab = "a"; });
      await flushTimes();
      expect(read(stateEl, (s) => s.a.map((x: any) => x.n).join(","))).toBe("a0,A1");
      expect(txt(shadowRoot, ".c").join(",")).toBe("a0,A1");
      host.remove();
    });
    expect(errors).toEqual([]);
  });

  it("対照: 写しから写しへの切り替えは、これまでどおり残る要素の行（描いた DOM）を使い回す", async () => {
    const { host, stateEl, shadowRoot } = await mount({
      q: "",
      items: [{ name: "a" }, { name: "b" }, { name: "c" }],
      get visible() { const s = this as any; return s.items.filter((x: any) => x.name.includes(s.q)); },
    }, `<ul><template data-wcs="for: visible"><li class="v">{{ .name }}<input class="i"></li></template></ul>`);
    (shadowRoot.querySelectorAll(".i")[1] as HTMLInputElement).value = "typed";
    write(stateEl, (s) => { s.q = "b"; });
    await flushTimes();
    expect(txt(shadowRoot, ".v").join(",")).toBe("b");
    // 行 b の DOM（束縛していない入力の値）がそのまま残る
    expect((shadowRoot.querySelector(".i") as HTMLInputElement).value).toBe("typed");
    host.remove();
  });
});
