/**
 * relative-paths.test.ts — スクリプトの相対パス（`this[".name"]`）と、1 つのアクセサを複数のパスに宣言する
 * カンマ列挙のキー（`get "users.*.fullname,employees.*.fullname"()`）。4.22。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, diagnostics, DirtyStrategy, Engine, getBindingsReady, installFeatures, recursion, scopes, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes, recursion, diagnostics]);
  bootstrapState();
});

/** A page (a shadow root) with `<wcs-state>` elements over `states` (in document order; the first is the root). */
async function page(html: string, ...states: Record<string, any>[]) {
  const h = document.createElement(`rel-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html.includes("<wcs-state") ? html : `<wcs-state></wcs-state>${html}`;
  const els = Array.from(root.querySelectorAll("wcs-state")) as any[];
  els.forEach((el, i) => el.setInitialState(states[i]));
  document.body.appendChild(h);
  const el = els[0];
  await Promise.all(els.map((e) => e.connectedCallbackPromise));
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

const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);
const people = () => [{ first: "Ada", last: "Lovelace", active: true }, { first: "Alan", last: "Turing", active: false }];
const staff = () => [{ first: "Edsger", last: "Dijkstra" }];
/** `get` / `set` of a full name over the row's `first` and `last`, written with relative paths only. */
const FULL = {
  get(this: any) { return `${this[".first"]} ${this[".last"]}`; },
  set(this: any, v: string) { [this[".first"], this[".last"]] = v.split(" "); },
  enumerable: true,
  configurable: true,
};
const USERS = `<ul><template data-wcs="for: users"><li>{{ .full }}</li></template></ul>`;
const STAFF = `<ol><template data-wcs="for: employees"><li>{{ .full }}</li></template></ol>`;

describe("行のアクセサの中の相対パス", () => {
  it("getter の `.name` は、その行の `<リスト>.*.name` を読む（依存も同じパスに付く）", async () => {
    const { root, write } = await page(USERS, Object.defineProperty({ users: people() }, "users.*.full", FULL));
    expect(texts(root, "li")).toEqual(["Ada Lovelace", "Alan Turing"]);
    await write((s) => { s["users.0.first"] = "Grace"; });
    expect(texts(root, "li")).toEqual(["Grace Lovelace", "Alan Turing"]);
  });

  it("setter の `.name` は、書かれた行の `<リスト>.*.name` に書く", async () => {
    const state = Object.defineProperty({ users: people() }, "users.*.full", FULL);
    const { root, write } = await page(USERS, state);
    await write((s) => { s["users.1.full"] = "Kurt Goedel"; });
    expect(state.users[1]).toMatchObject({ first: "Kurt", last: "Goedel" });
    expect(texts(root, "li")).toEqual(["Ada Lovelace", "Kurt Goedel"]);
  });

  it("`.` はその行の要素そのもの（プリミティブの配列）", async () => {
    const { root, write } = await page(`<template data-wcs="for: tags"><b>{{ .upper }}</b></template>`, {
      tags: ["a", "b"],
      get "tags.*.upper"() { return (this as any)["."].toUpperCase(); },
    });
    expect(texts(root, "b")).toEqual(["A", "B"]);
    await write((s) => { s["tags.1"] = "z"; });
    expect(texts(root, "b")).toEqual(["A", "Z"]);
  });

  it("入れ子のリストでは、いちばん内側の行が基準になる（外側の行は絶対パスで読む）", async () => {
    const { root } = await page(
      `<template data-wcs="for: regions"><template data-wcs="for: .states"><i>{{ .label }}</i></template></template>`,
      {
        regions: [{ name: "R1", states: [{ name: "s1" }, { name: "s2" }] }, { name: "R2", states: [{ name: "s3" }] }],
        get "regions.*.states.*.label"() { return `${(this as any)["regions.*.name"]}/${(this as any)[".name"]}`; },
      },
    );
    expect(texts(root, "i")).toEqual(["R1/s1", "R1/s2", "R2/s3"]);
  });

  it("相対パスの中の明示の添字は、行の下のリストの位置を指す", async () => {
    const { root, write } = await page(`<template data-wcs="for: orders"><u>{{ .head }}</u></template>`, {
      orders: [{ lines: [{ amount: 1 }, { amount: 2 }] }, { lines: [{ amount: 10 }] }],
      get "orders.*.head"() { return (this as any)[".lines.0.amount"]; },
    });
    expect(texts(root, "u")).toEqual(["1", "10"]);
    await write((s) => { s["orders.1.lines.0.amount"] = 40; });
    expect(texts(root, "u")).toEqual(["1", "40"]);
  });

  it("添字を省いた $getAll は、相対パスを行の下で展開する", async () => {
    const { root, write } = await page(`<template data-wcs="for: orders"><u>{{ .total }}</u></template>`, {
      orders: [{ lines: [{ amount: 1 }, { amount: 2 }] }, { lines: [{ amount: 10 }] }],
      get "orders.*.total"() { return (this as any).$getAll(".lines.*.amount").reduce((a: number, b: number) => a + b, 0); },
    });
    expect(texts(root, "u")).toEqual(["3", "10"]);
    await write((s) => { s["orders.1.lines.0.amount"] = 40; });
    expect(texts(root, "u")).toEqual(["3", "40"]);
  });

  it("$getAll の添字の数の誤りは、展開したパスで報告される", () => {
    const engine = new Engine({
      orders: [{ lines: [{ amount: 1 }] }],
      get "orders.*.bad"() { return (this as any).$getAll(".lines.*.amount", [0, 0, 0]); },
    }, new DirtyStrategy());
    expect(() => engine.proxy["orders.0.bad"]).toThrow('"orders.*.lines.*.amount"');
  });

  it("$eq・$dependOn・$postUpdate も相対パスを取る", async () => {
    const state = {
      users: [{ role: "admin", tags: ["a"] }, { role: "user", tags: [] as string[] }],
      get "users.*.isAdmin"() { return (this as any).$eq(".role", "admin"); },
      get "users.*.count"() {
        (this as any).$dependOn(".tags");
        return (this as any).$untracked(() => (this as any)[".tags"].length);
      },
      add(this: any) {
        this[".tags"].push("x");
        this.$postUpdate(".tags");
      },
    };
    const { root, write } = await page(
      `<template data-wcs="for: users"><p>{{ .isAdmin }}:{{ .count }}</p><button data-wcs="onclick: add">+</button></template>`,
      state,
    );
    expect(texts(root, "p")).toEqual(["true:1", "false:0"]);
    root.querySelectorAll("button")[1].dispatchEvent(new Event("click", { bubbles: true }));
    await flush();
    await flush();
    expect(texts(root, "p")).toEqual(["true:1", "false:1"]);
    await write((s) => { s["users.1.role"] = "admin"; });
    expect(texts(root, "p")).toEqual(["true:1", "true:1"]);
  });

  it("同じ相対パスでも、行のリストごとに別のパスになる", async () => {
    const { root } = await page(`${USERS}${STAFF}`, Object.defineProperties({ users: people(), employees: staff() }, {
      "users.*.full": FULL,
      "employees.*.full": { get(this: any) { return this[".last"]; }, enumerable: true, configurable: true },
    }));
    expect(texts(root, "ul li")).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(texts(root, "ol li")).toEqual(["Dijkstra"]);
  });

  it("状態を置き換えた（setInitialState）後も、相対パスは新しい状態の行を読む", async () => {
    const { root, el } = await page(USERS, Object.defineProperty({ users: people() }, "users.*.full", FULL));
    el.setInitialState(Object.defineProperty({ users: staff() }, "users.*.full", FULL));
    await flush();
    await flush();
    expect(texts(root, "li")).toEqual(["Edsger Dijkstra"]);
  });
});

describe("行から呼ばれたメソッドの中の相対パス", () => {
  it("行の中のイベントで呼ばれたメソッドは、その行を読み書きする", async () => {
    const state = {
      users: people(),
      picked: "",
      pick(this: any) {
        this.picked = this[".first"];
        this[".active"] = true;
      },
    };
    const { root } = await page(`<template data-wcs="for: users"><button data-wcs="onclick: pick">x</button></template>`, state);
    root.querySelectorAll("button")[1].dispatchEvent(new Event("click", { bubbles: true }));
    await flush();
    expect(state.picked).toBe("Alan");
    expect(state.users[1].active).toBe(true);
  });

  it("$setAll の mapper と $update の関数は、書く行で相対パスを読む", async () => {
    const state = { users: people().map((u) => ({ ...u, label: "" })) };
    const { write } = await page(`<p>{{ users.length }}</p>`, state);
    await write((s) => { s.$setAll("users.*.label", [], function (this: any) { return this[".first"]; }); });
    expect(state.users.map((u) => u.label)).toEqual(["Ada", "Alan"]);
    await write((s) => { s.$update("users.*.label", [1], function (this: any) { return this[".last"]; }); });
    expect(state.users[1].label).toBe("Turing");
  });
});

describe("行の無いところの相対パス", () => {
  it("ルートの getter の中の相対パスは #1402 で失敗する（バインディングの失敗として届く）", async () => {
    const failures: string[] = [];
    await page(`<p>{{ first }}</p>`, {
      users: people(),
      get first() { return (this as any)[".first"]; },
      $errorCallback(e: Error) { failures.push(e.message); },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('[wcs/wildcard-rank] ".first" is relative');
    expect(failures[0]).toContain("in script, a row");
  });

  it("行の外から呼んだメソッドの読み・書き・$getAll も #1402 で失敗する", async () => {
    const { write } = await page(`<p>{{ users.length }}</p>`, { users: people() });
    await expect(write((s) => s[".first"])).rejects.toThrow('".first" is relative');
    await expect(write((s) => { s[".first"] = "x"; })).rejects.toThrow('".first" is relative');
    await expect(write((s) => s.$getAll(".lines.*.amount"))).rejects.toThrow('".lines.*.amount" is relative');
  });
});

describe("添字を引数で受ける API（$resolve・$setAll・$update）", () => {
  it("相対パスを取らない: 行の中から呼んでも展開されず、例外になる", async () => {
    const thrown: string[] = [];
    const attempt = (fn: () => unknown) => {
      try {
        fn();
        thrown.push("no error");
      } catch (e) {
        thrown.push((e as Error).message);
      }
    };
    const state = {
      users: people(),
      probe(this: any) {
        attempt(() => this.$resolve(".first", [0]));
        attempt(() => this.$update(".first", [0], "x"));
        attempt(() => this.$setAll(".first", [], "x"));
      },
    };
    const { root } = await page(`<template data-wcs="for: users"><button data-wcs="onclick: probe">x</button></template>`, state);
    root.querySelector("button")!.dispatchEvent(new Event("click", { bubbles: true }));
    await flush();
    expect(thrown).toHaveLength(3);
    expect(thrown.every((m) => m !== "no error")).toBe(true);
    expect(state.users.map((u) => u.first)).toEqual(["Ada", "Alan"]);
  });
});

describe("再帰とボリュームの中の相対パス", () => {
  it("再帰 getter の中の `.name` は、評価している深さのノードを読む", async () => {
    const { root } = await page(
      `<template data-wcs="for: nodes"><i>{{ .label }}</i><template data-wcs="for: .children"><i>{{ .label }}</i></template></template>`,
      {
        nodes: [{ name: "a", children: [{ name: "a1", children: [] }] }, { name: "b", children: [] }],
        $recursion: { "nodes.*": "children.*" },
        get "nodes.**.label"() { return `<${(this as any)[".name"]}>`; },
      },
    );
    expect(texts(root, "i")).toEqual(["<a>", "<a1>", "<b>"]);
  });

  it("ボリュームのアクセサの中の相対パスは、マウントパスの下の行を読み書きする", async () => {
    const volume = Object.defineProperty({
      items: [{ price: 2, qty: 3 }, { price: 5, qty: 1 }],
      get total() { return (this as any).$getAll("items.*.subtotal", []).reduce((a: number, b: number) => a + b, 0); },
    }, "items.*.subtotal", {
      get(this: any) { return this[".price"] * this[".qty"]; },
      set(this: any, v: number) { this[".qty"] = v / this[".price"]; },
      enumerable: true,
      configurable: true,
    });
    const { root, write } = await page(
      `<wcs-state></wcs-state><wcs-state mount="cart"></wcs-state><template data-wcs="for: cart.items"><b>{{ .subtotal }}</b></template><p>{{ cart.total }}</p>`,
      {},
      volume,
    );
    expect(texts(root, "b")).toEqual(["6", "5"]);
    expect(root.querySelector("p")!.textContent).toBe("11");
    await write((s) => { s["cart.items.0.subtotal"] = 20; });
    expect(texts(root, "b")).toEqual(["20", "5"]);
    expect(root.querySelector("p")!.textContent).toBe("25");
  });
});

describe("1 つのアクセサを複数のパスに宣言する（カンマ列挙のキー）", () => {
  it("列挙したパスのそれぞれが、同じ getter / setter を持つ", async () => {
    const state = Object.defineProperty({ users: people(), employees: staff() }, "users.*.full,employees.*.full", FULL);
    const { root, write, read } = await page(`${USERS}${STAFF}`, state);
    expect(texts(root, "ul li")).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(texts(root, "ol li")).toEqual(["Edsger Dijkstra"]);
    await write((s) => { s["employees.0.full"] = "Tony Hoare"; });
    expect(state.employees[0]).toEqual({ first: "Tony", last: "Hoare" });
    expect(texts(root, "ul li")).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(texts(root, "ol li")).toEqual(["Tony Hoare"]);
    // (the key itself is not a path)
    expect(read("users.0.full")).toBe("Ada Lovelace");
  });

  it("絞り込んだ写し（getter のリスト）の行も、元のリストと同じアクセサを持てる", async () => {
    const state = Object.defineProperties({ users: people() }, {
      "users.*.full,shown.*.full": FULL,
      shown: { get(this: any) { return this.users.filter((u: any) => u.active); }, enumerable: true, configurable: true },
    });
    const { root, write } = await page(`<ul><template data-wcs="for: shown"><li>{{ .full }}</li></template></ul>`, state);
    expect(texts(root, "li")).toEqual(["Ada Lovelace"]);
    await write((s) => { s["users.0.first"] = "Grace"; });
    expect(texts(root, "li")).toEqual(["Grace Lovelace"]);
    // (a write into an object the getter's array holds evaluates the getter again: the row leaves)
    await write((s) => { s["users.0.active"] = false; });
    expect(texts(root, "li")).toEqual([]);
  });

  it("列挙していないリストの行には、そのアクセサは無い", async () => {
    const { root } = await page(`${USERS}${STAFF}`, Object.defineProperty({ users: people(), employees: staff() }, "users.*.full", FULL));
    expect(texts(root, "ul li")).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(texts(root, "ol li")).toEqual([""]);
  });

  it("3 つ以上のパスも、クラスの状態のアクセサも列挙できる", async () => {
    class Lists {
      a = [{ v: 1 }];
      b = [{ v: 2 }];
      c = [{ v: 3 }];
      get "a.*.twice,b.*.twice,c.*.twice"() { return (this as any)[".v"] * 2; }
    }
    const { read } = await page(`<p>{{ a.length }}</p>`, new Lists());
    expect([read("a.0.twice"), read("b.0.twice"), read("c.0.twice")]).toEqual([2, 4, 6]);
  });

  it("列挙したキーの本体で絶対パスを使うと、ほかのリストの行では行が無い（undefined）— diagnostics が 1 回警告する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const state = () => ({
        users: people(),
        employees: staff(),
        get "users.*.full,employees.*.full"() { return String((this as any)["users.*.first"]); },
      });
      const { root, el } = await page(`${USERS}${STAFF}`, state());
      expect(texts(root, "ul li")).toEqual(["Ada", "Alan"]);
      expect(texts(root, "ol li")).toEqual(["undefined"]);
      const told = () => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[wcs/accessor-list-path]"));
      expect(told()).toEqual([
        '[@wcstack/state] [wcs/accessor-list-path] The accessor "users.*.full,employees.*.full" names "users.*.first" by its full path, and it is also declared for "employees.*.full": at its rows that path has no row, so a read gives undefined and a write throws. Write it relative to the row: this[".first"]. Validate statically: npx @wcstack/lint <file>.',
      ]);
      // (the same accessor declared again by a re-set is not told again; another object's is)
      const again = state();
      el.setInitialState(again);
      el.setInitialState(again);
      await flush();
      expect(told()).toHaveLength(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("同じリストの 2 つの名前・外側の行・添字を渡す $getAll・setter だけの絶対パスの有無を見分ける", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await page(`<p>{{ users.length }}</p>`, {
        users: people(),
        employees: staff(),
        regions: [{ name: "r", states: [{ name: "s" }], towns: [{ name: "t" }] }],
        // two names in one list: the full path has its row at both
        get "users.*.full,users.*.display"() { return (this as any)["users.*.first"]; },
        // the row above both lists
        get "regions.*.states.*.label,regions.*.towns.*.label"() { return (this as any)["regions.*.name"] + (this as any)[".name"]; },
        // $getAll names its rows itself
        get "users.*.count,employees.*.count"() { return (this as any).$getAll("users.*.first", []).length; },
        // only the setter names one list's rows
        get "users.*.nick,employees.*.nick"() { return (this as any)[".first"]; },
        set "users.*.nick,employees.*.nick"(v: string) { (this as any)["employees.*.first"] = v; },
        // a setter with no getter
        set "users.*.alias,employees.*.alias"(v: string) { (this as any)["users.*.last"] = v; },
      });
      const told = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[wcs/accessor-list-path]"));
      expect(told).toHaveLength(2);
      expect(told[0]).toContain('The accessor "users.*.nick,employees.*.nick" names "employees.*.first" by its full path, and it is also declared for "users.*.nick"');
      expect(told[1]).toContain('The accessor "users.*.alias,employees.*.alias" names "users.*.last" by its full path');
    } finally {
      warn.mockRestore();
    }
  });

  it("ボリュームの列挙したキーは、どのパスもマウントパスの下に宣言される", async () => {
    const volume = Object.defineProperty({ users: people(), employees: staff() }, "users.*.full,employees.*.full", FULL);
    const { root, read } = await page(
      `<wcs-state></wcs-state><wcs-state mount="org"></wcs-state><template data-wcs="for: org.users"><li>{{ .full }}</li></template><template data-wcs="for: org.employees"><em>{{ .full }}</em></template>`,
      {},
      volume,
    );
    expect(texts(root, "li")).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(texts(root, "em")).toEqual(["Edsger Dijkstra"]);
    expect(read("org.employees.0.full")).toBe("Edsger Dijkstra");
  });

  it("マウントしたコンポーネントは、列挙したキーのうち `*` の無いパスをそれぞれ公開する", async () => {
    const tag = `rel-cmp-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state = { get "double,twice"() { return (this as any).n * 2; } };
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><span>{{ double }}</span>`;
      }
    });
    const { root, write } = await page(`<${tag} data-wcs="state: box"></${tag}><p>{{ box.double }}/{{ box.twice }}</p>`, { box: { n: 5 } });
    for (let i = 0; i < 4; i++) await flush();
    expect(root.querySelector("p")!.textContent).toBe("10/10");
    await write((s) => { s["box.n"] = 7; });
    expect(root.querySelector("p")!.textContent).toBe("14/14");
  });
});

describe("カンマ列挙のキーの書き方の誤り", () => {
  const init = async (state: Record<string, any>): Promise<string> => {
    const h = document.createElement(`rel-bad-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ users.length }}</p>`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    return el.connectedCallbackPromise.then(() => "initialized", (e: Error) => e.message);
  };

  it("カンマの後の空白は初期化を失敗させる（diagnostics）", async () => {
    const message = await init(Object.defineProperty({ users: people(), employees: staff() }, "users.*.full, employees.*.full", FULL));
    expect(message).toContain("[wcs/accessor-list-syntax]");
    expect(message).toContain('"users.*.full, employees.*.full"');
  });

  it("空の項目（末尾のカンマ）も初期化を失敗させる", async () => {
    expect(await init(Object.defineProperty({ users: people() }, "users.*.full,", FULL))).toContain("[wcs/accessor-list-syntax]");
  });

  it("アクセサでないキーのカンマと空白は見ない", async () => {
    expect(await init({ users: people(), "a, b": 1 })).toBe("initialized");
  });

  it("再帰のキー（`**`）は列挙できない", () => {
    expect(() => new Engine({
      nodes: [],
      $recursion: { "nodes.*": "children.*" },
      get "nodes.**.a,nodes.**.b"() { return 1; },
    }, new DirtyStrategy())).toThrow("[wcs/recursion-anchor]");
  });
});
