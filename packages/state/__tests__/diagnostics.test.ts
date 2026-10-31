import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { bootstrapState, DirtyStrategy, Engine, getBindingsReady, installFeatures, diagnostics, recursion, scopes, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([diagnostics, temporal, scopes, recursion]);
  bootstrapState();
});

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`diag-test-${seq++}`);
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

/** The warnings `run` leads to (console.warn, first argument). */
async function warnings(run: () => Promise<unknown>): Promise<string[]> {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await run();
    await flush();
    return warn.mock.calls.map((c) => String(c[0]));
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
}

describe("束ねたパスが状態に無い（wcs/binding-path-missing）", () => {
  it("深いパスの誤字を 1 マクロタスク後に 1 回だけ、近い名前と lint への誘導付きで警告する", async () => {
    const got = await warnings(() => page(`<p>{{ user.nmae }}</p><i>{{ user.nmae }}</i>`, { user: { name: "a" } }));
    expect(got).toEqual([
      '[@wcstack/state] [wcs/binding-path-missing] Bound path "user.nmae" does not resolve on the state tree: "nmae" is not declared. Did you mean "name"? Updates to this path will be silently dropped. Validate statically: npx @wcstack/lint <file>.',
    ]);
  });

  it("for の中の相対パスはワイルドカードのパスで報告し、行の getter も近い名前の候補にする", async () => {
    const got = await warnings(() => page(`<ul><template data-wcs="for: items"><li>{{ .nmae }}|{{ .subtotl }}</li></template></ul>`, {
      items: [{ name: "a", price: 1 }],
      get "items.*.subtotal"() { return 1; },
    }));
    expect(got).toHaveLength(2);
    expect(got[0]).toContain('Bound path "items.*.nmae"');
    expect(got[1]).toContain('Did you mean "subtotal"?');
  });

  it("行の任意のフィールドは、最初の行に無くても、どれかの行にあれば警告しない（docs/seam-apps.md、ssr-news）", async () => {
    const got = await warnings(() => page(`<ul><template data-wcs="for: comments"><li data-wcs="class.pending: .pending|truthy">{{ .text }}</li></template></ul>`, {
      comments: [{ text: "from the server" }, { text: "mine", pending: true }],
    }));
    expect(got).toEqual([]);
    // どの行にも無ければ、従来どおり
    const none = await warnings(() => page(`<ul><template data-wcs="for: comments"><li data-wcs="class.pending: .pendng|truthy">{{ .text }}</li></template></ul>`, {
      comments: [{ text: "a" }, { text: "b", pending: true }],
    }));
    expect(none).toHaveLength(1);
    expect(none[0]).toContain('Bound path "comments.*.pendng"');
    expect(none[0]).toContain('Did you mean "pending"?');
    // 入れ子の行: 外のどれかの行の中の、どれかの行にあればよい
    const nested = await warnings(() => page(`<template data-wcs="for: groups"><template data-wcs="for: .items"><i>{{ .note }}</i></template></template>`, {
      groups: [{ items: [{ id: 1 }] }, { items: [] }, { items: [{ id: 2 }, { id: 3, note: "n" }] }],
    }));
    expect(nested).toEqual([]);
  });

  it("どの行にも無い行のフィールドは、近い名前が無ければ警告しない（任意のフィールド — ssr-news）。近い名前があれば警告する", async () => {
    // the server's comments carry no `pending` (only the page's own optimistic rows do)
    const optional = await warnings(() => page(`<ul><template data-wcs="for: comments"><li data-wcs="class.pending: .pending|truthy">{{ .text }}</li></template></ul>`, {
      comments: [{ id: 1, text: "a" }, { id: 2, text: "b" }],
    }));
    expect(optional).toEqual([]);
    const typo = await warnings(() => page(`<ul><template data-wcs="for: comments"><li>{{ .txet }}</li></template></ul>`, {
      comments: [{ id: 1, text: "a" }],
    }));
    expect(typo).toHaveLength(1);
    expect(typo[0]).toContain('Bound path "comments.*.txet"');
    expect(typo[0]).toContain('Did you mean "text"?');
    // a key outside a row is reported without a near name too
    const top = await warnings(() => page(`<p>{{ user.zzz }}</p>`, { user: { name: "a" } }));
    expect(top).toHaveLength(1);
  });

  it("$watch のキーは wcs/watch-path-missing（1 段のキーも）", async () => {
    const got = await warnings(() => page(``, { count: 0, $watch: { cout() {}, count() {} } }));
    expect(got).toHaveLength(1);
    expect(got[0]).toContain('[wcs/watch-path-missing] $watch path "cout"');
    expect(got[0]).toContain('Did you mean "count"?');
  });

  it("1 段のバインディングは警告しない（読みが core の [wcs/binding-path-missing] で失敗する）", async () => {
    const got = await warnings(() => page(`<p>{{ cout }}</p>`, { count: 0 }));
    expect(got).toEqual([]);
  });

  it("確かに無いと言えないパスでは黙る（null・空の配列・途中の getter・ドット付きの getter・行の getter・再帰の展開）", async () => {
    const got = await warnings(() => page(
      `<p>{{ none.x }}</p><p>{{ items.0.x }}</p><ul><template data-wcs="for: empty"><li>{{ .x }}</li></template></ul>`
      + `<p>{{ view.a.b }}</p><p>{{ user.full }}</p><ul><template data-wcs="for: nodes"><li>{{ .total }}</li></template></ul>`,
      {
        none: null, items: [], empty: [],
        get view() { return { a: { b: 1 } }; },
        user: { first: "a" },
        get "user.full"() { return "a b"; },
        nodes: [{ value: 1, children: [] }],
        $recursion: { "nodes.*": "children.*" },
        get "nodes.**.total"() { return (this as any)["nodes.**.value"]; },
      },
    ));
    expect(got).toEqual([]);
  });

  it("再セットで新しい状態に対してもう一度確かめる（戻した状態では黙る）", async () => {
    const { el } = await page(`<p>{{ user.name }}</p>`, { user: { name: "a" } });
    const first = await warnings(async () => { el.setInitialState({ user: { nick: "b" } }); });
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('"name" is not declared');
    const second = await warnings(async () => {
      el.setInitialState({ user: {} });
      el.setInitialState({ user: { name: "c" } });
    });
    expect(second).toEqual([]);
  });

  it("再セットで無くなったトップレベルのキーの下のパスと $watch は警告しない（宣言されたことの無いキーは警告する）", async () => {
    const { el } = await page(
      `<p>{{ obj.x }}</p><p>{{ ghost.z }}</p><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`,
      { obj: { x: 1 }, items: ["a"], b: 1 },
    );
    const got = await warnings(async () => {
      el.setInitialState({ $watch: { b() {}, "obj.y"() {} } });
      await flush();
    });
    // the dropped keys (obj, items, b) are declared; ghost never was
    expect(got).toHaveLength(1);
    expect(got[0]).toContain('[wcs/binding-path-missing] Bound path "ghost.z"');
  });

  it("マウントしたコンポーネントの中のマウントしたキーは黙る", async () => {
    const tag = `diag-cmp-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><p>{{ address.city }}</p>`;
      }
    });
    const got = await warnings(() => page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { address: { city: "x" } } }));
    expect(got).toEqual([]);
  });
});

describe("再帰の静的な検査（wcs/recursion-declaration-invalid）", () => {
  const make = (extra: Record<string, PropertyDescriptor>) =>
    new Engine(Object.defineProperties({ nodes: [], $recursion: { "nodes.*": "children.*" } }, extra), new DirtyStrategy());
  const getter = { get() { return 1; }, enumerable: true, configurable: true };

  it("構造そのものを名指しする族、深さだけ違う 2 つの族、展開と同じ名前の具体的なキーを拒む", () => {
    expect(() => make({ "nodes.**.children": getter })).toThrow("names the recursion structure itself");
    expect(() => make({ "nodes.**.x": getter, "nodes.**.children.*.x": getter })).toThrow("expand to the same concrete path at different depths");
    expect(() => make({ "nodes.**.x": getter, "nodes.*.children.*.x": getter })).toThrow("is already defined on the state");
    expect(() => make({ "nodes.**.x": getter, "nodes.**.y": getter })).not.toThrow();
  });
});

describe("番号付きのコアのメッセージの文面（src/messages.ts）", () => {
  it("コアが番号で投げたものを、以前と同じ文面で出す", async () => {
    const { raise, M, text } = await import("../src/messages");
    expect(() => raise(M.Readonly)).toThrow(/^\[@wcstack\/state\] This state is readonly\.$/);
    expect(text(M.IndexArityAtMost, ["$getAll", "m.*", 1, 2])).toBe('[wcs/index-arity] $getAll("m.*") takes at most 1 index(es), got 2.');
    expect(text(M.IndexParamRange, ["$129"])).toBe('[wcs/index-param-range] "$129": list index parameters run from $1 to $128.');
    expect(text(M.DrainNotSettled)).toBe("updates did not settle after 32 passes");
  });

  it("文面の後に助言が続く（did-you-mean と lint への誘導）", async () => {
    const { parseBindTextsForElement } = await import("../src/parser/parseBindTextsForElement");
    expect(() => parseBindTextsForElement("textContent: a|b(")).toThrow(
      /^\[@wcstack\/state\] \[wcs\/binding-syntax\] Invalid filter format: missing closing parenthesis in "b\("\..*lint/s,
    );
  });

  it("4.0 で外した旧名は、正式名を示す文面になる", async () => {
    const { text, M } = await import("../src/messages");
    expect(text(M.DeclarationRemoved, ["$updatedCallback", "$renderedCallback"])).toBe("[wcs/declaration-alias] $updatedCallback was removed: write $renderedCallback.");
    expect(text(M.ApiRemoved, ["$trackDependency", "$dependOn"])).toBe("[wcs/name-alias] $trackDependency was removed: write $dependOn.");
  });

  it("バインディングの失敗の console も文面になる", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await page(`<p>{{ bad }}</p>`, { get bad() { throw new Error("boom"); } });
    expect(err).toHaveBeenCalledWith('[@wcstack/state] binding "text: bad" failed to apply.', expect.any(Error), expect.any(Text));
    err.mockRestore();
  });

  it("名前のあるバインディングは書いたとおりの名前で呼び（textContent: iso、class.active: x）、要素を添える（docs/seam-apps.md、router-admin）", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = () => { throw new Error("boom"); };
    const { root } = await page(`<p class="t" data-wcs="textContent: iso"></p><p class="c" data-wcs="class.active: on"></p>`, { get iso() { return boom(); }, get on() { return boom(); } });
    expect(err).toHaveBeenCalledWith('[@wcstack/state] binding "textContent: iso" failed to apply.', expect.any(Error), root.querySelector(".t"));
    expect(err).toHaveBeenCalledWith('[@wcstack/state] binding "class.active: on" failed to apply.', expect.any(Error), root.querySelector(".c"));
    err.mockRestore();
  });
});

describe("$postUpdate のパスが状態に無い（wcs/post-update-path-missing — 7GUIs の評価の Cells）", () => {
  it("行の中の打ち間違いは近い名前付きで 1 回だけ警告し、トップレベルのキーも見る。正しいパスでは黙る", async () => {
    const { el } = await page(`<template data-wcs="for: rows"><template data-wcs="for: .cells"><i>{{ .text }}</i></template></template>`, {
      rows: [{ cells: [{ text: "a" }, { text: "b" }] }],
      label: "x",
    });
    const got = await warnings(async () => {
      el.createState("writable", (s: any) => {
        s.$postUpdate("rows.0.cell.1.text");
        s.$postUpdate("rows.0.cell.0.text");
        s.$postUpdate("lable");
        s.$postUpdate("rows.0.cells.1.text");
        s.$postUpdate("label");
      });
      await flush();
    });
    expect(got).toHaveLength(2);
    expect(got[0]).toContain('[wcs/post-update-path-missing] $postUpdate path "rows.*.cell.*.text" does not resolve on the state tree: "cell" is not declared. Did you mean "cells"?');
    expect(got[1]).toContain('$postUpdate path "lable"');
    expect(got[0]).toContain('The call updates nothing.');
    expect(got[1]).toContain('Did you mean "label"?');
  });
});

describe("getter が読んだパスが状態に無い（wcs/read-path-missing — 確定申告の下書きツールの評価）", () => {
  it("ワイルドカード getter の行のフィールドと $getAll のパスの打ち間違いを、読んだ getter の名前と近い名前付きで 1 回だけ警告する", async () => {
    const got = await warnings(() => page(`<template data-wcs="for: deps"><i>{{ .status }}</i></template><p>{{ total }}|{{ total2 }}</p>`, {
      deps: [{ kind: "a", income: 1 }, { kind: "b", income: 2 }],
      items: [{ amount: 1 }, { amount: 2 }],
      get "deps.*.status"() { return `${this["deps.*.kind"]}:${this["deps.*.incom"]}`; },
      get total() { return this.$getAll("items.*.amout", []).length; },
      get total2() { return this.$getAll("items.*.amout", []).length; },
    }));
    expect(got).toHaveLength(2);
    expect(got[0]).toBe('[@wcstack/state] [wcs/read-path-missing] Path "deps.*.incom" read by the getter "deps.*.status" does not resolve on the state tree: "incom" is not declared. Did you mean "income"? The getter reads undefined. Validate statically: npx @wcstack/lint <file>.');
    expect(got[1]).toContain('[wcs/read-path-missing] Path "items.*.amout" read by the getter "total" does not resolve on the state tree: "amout" is not declared. Did you mean "amount"? The getter reads undefined.');
  });

  it("行の無い一覧に後から足した行で getter が読んだパスも、行が描かれたあとに警告する", async () => {
    const { el } = await page(`<template data-wcs="for: deps"><i>{{ .status }}</i></template>`, {
      deps: [] as any[],
      get "deps.*.status"() { return this["deps.*.incom"] ?? 0; },
    });
    const got = await warnings(async () => {
      el.createState("writable", (s: any) => { s.deps = s.deps.concat({ income: 1 }); });
      await flush();
      await flush();
    });
    expect(got).toHaveLength(1);
    expect(got[0]).toContain('Path "deps.*.incom" read by the getter "deps.*.status"');
  });

  it("近い名前の無い任意のキー・正しいパス・束ねたパスと同じパスには黙り、宣言に無いトップレベルのキーはコアのエラーだけにする", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const got = await warnings(() => page(`<p>{{ a }}|{{ b }}|{{ form.nmae }}|{{ c }}</p><template data-wcs="for: items"><i>{{ .note }}</i></template>`, {
      opts: {},
      form: { name: "x" },
      items: [{ amount: 1 }],
      get a() { return this["opts.flag"] ?? false; },
      get b() { return this["form.nmae"] ?? this["form.name"]; },
      get "items.*.note"() { return this["items.*.pending"] ? "…" : String(this["items.*.amount"]); },
      get c() { return this.totl; },
    }));
    err.mockRestore();
    expect(got.filter((w) => w.includes("read-path-missing"))).toEqual([]);
    // the bound path is reported as a binding's, once
    expect(got.filter((w) => w.includes('"form.nmae"'))).toHaveLength(1);
    expect(got.find((w) => w.includes('"form.nmae"'))).toContain("[wcs/binding-path-missing]");
  });
});

describe("宣言していないキーへの書き込み（wcs/write-path-missing — 7GUIs の評価の CRUD）", () => {
  it("近い宣言済みのキーがあればキーごとに 1 回警告し、近い名前の無い新しいキーと宣言済みのキーには黙る", async () => {
    const { el } = await page(`<p>{{ selectedId }}</p>`, { selectedId: null, count: 0 });
    const got = await warnings(async () => {
      el.createState("writable", (s: any) => {
        s.selectedID = 1;
        s.selectedID = 2;
        s.somethingNew = 3;
        s.selectedId = 4;
        s.count = 5;
      });
      await flush();
    });
    expect(got).toEqual([
      '[@wcstack/state] [wcs/write-path-missing] "selectedID" is not declared: writing it creates a new key. Did you mean "selectedId"? Validate statically: npx @wcstack/lint <file>.',
    ]);
  });

  it("ボリュームが接ぎ木するマウントのパス（とその途中のキー）は、近い名前があっても黙る", async () => {
    const tag = `diag-vol-${seq++}`;
    const h = document.createElement(tag);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><wcs-state mount="card"></wcs-state><wcs-state mount="shopp.cart"></wcs-state><p>{{ cart }}</p>`;
    const [rootEl, card, shop] = Array.from(root.querySelectorAll("wcs-state")) as any[];
    rootEl.setInitialState({ cart: 1, shop: 2 });
    card.setInitialState({ n: 1 });
    shop.setInitialState({ n: 2 });
    const got = await warnings(async () => {
      document.body.appendChild(h);
      await rootEl.connectedCallbackPromise;
      await card.connectedCallbackPromise;
      await shop.connectedCallbackPromise;
      await getBindingsReady(root);
      await flush();
    });
    expect(got.filter((w) => w.includes("write-path-missing"))).toEqual([]);
  });
});

describe("購読者のいないコマンドの emit（wcs/command-token-unbound — 7GUIs の評価の Timer・Cells、著者の決定）", () => {
  it("描かれる前の if: の枝の受け手への emit は、トークンごとに 1 回警告する。受け手がいれば黙る", async () => {
    const { el } = await page(`<template data-wcs="if: editing"><input data-wcs="command.focus: $command.focusIt"></template>`, {
      editing: false,
      $commandTokens: ["focusIt"],
    });
    const before = await warnings(async () => {
      el.createState("writable", (s: any) => {
        s.$command.focusIt.emit();
        s.$command.focusIt.emit();
      });
    });
    expect(before).toEqual([
      '[@wcstack/state] [wcs/command-token-unbound] "$command.focusIt" was emitted with no subscriber and is lost: its element is not defined or rendered yet (emit from $renderedCallback), or no command. binding takes it. Validate statically: npx @wcstack/lint <file>.',
    ]);
    el.createState("writable", (s: any) => { s.editing = true; });
    await flush();
    const after = await warnings(async () => {
      el.createState("writable", (s: any) => { s.$command.focusIt.emit(); });
    });
    expect(after).toEqual([]);
  });

  it("再セットで増えたトークンも見る（残ったトークンは警告を繰り返さない）", async () => {
    const { el } = await page(``, { $commandTokens: ["a"] });
    const got = await warnings(async () => {
      el.createState("writable", (s: any) => { s.$command.a.emit(); });
      el.setInitialState({ $commandTokens: ["a", "b"] });
      el.createState("writable", (s: any) => {
        s.$command.a.emit();
        s.$command.b.emit();
      });
    });
    expect(got.map((w) => /"\$command\.(\w+)"/.exec(w)?.[1])).toEqual(["a", "b"]);
  });
});

describe("委譲されたハンドラの throw と event.currentTarget（wcs/delegated-current-target — 7GUIs の評価の Circle Drawer、著者の決定）", () => {
  const clickIn = async (root: ShadowRoot, selector: string) => {
    (root.querySelector(selector) as HTMLElement).click();
    await flush();
  };

  it("currentTarget を読むハンドラが throw すると、エラーの後にハンドラごとに 1 回、#direct を案内する（async のハンドラも）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { root } = await page(`<button class="a" data-wcs="onclick: place">a</button><button class="b" data-wcs="onclick: later">b</button>`, {
        place(e: Event) { (e.currentTarget as any).getBoundingClientRect(); },
        async later(e: Event) { await 0; (e.currentTarget as any).getBoundingClientRect(); },
      });
      await clickIn(root, ".a");
      await clickIn(root, ".a");
      await clickIn(root, ".b");
      expect(error).toHaveBeenCalledTimes(3);
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
        '[@wcstack/state] [wcs/delegated-current-target] "place" reads event.currentTarget, the root for a delegated onclick:. Write onclick#direct:, or use event.target.closest(…). Validate statically: npx @wcstack/lint <file>.',
        expect.stringContaining('"later" reads event.currentTarget'),
      ]);
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it("currentTarget を読まないハンドラの throw・#direct のハンドラには案内しない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let rect: unknown = null;
      const { root } = await page(`<button class="a" data-wcs="onclick: boom">a</button><button class="b" data-wcs="onclick#direct: place">b</button>`, {
        boom() { throw new Error("boom"); },
        place(e: Event) { rect = (e.currentTarget as any).getBoundingClientRect(); },
      });
      await clickIn(root, ".a");
      await clickIn(root, ".b");
      expect(error).toHaveBeenCalledTimes(1);
      expect(rect).not.toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });
});

describe("this を使う $on のハンドラ（wcs/on-handler-this — docs/seam-apps.md、family-ledger）", () => {
  it("宣言のときに、this を使うハンドラごとに 1 回、イベントの前に知らせる", async () => {
    const got = await warnings(() => page(`<p>{{ n }}</p>`, {
      n: 0,
      $eventTokens: ["a", "b", "c"],
      $on: {
        a(this: any) { this.n = 1; },
        b: function (this: any) { const state = this; state.n = 2; },
        c(state: any) { state.n = 3; },
      },
    }));
    expect(got).toEqual([
      '[@wcstack/state] [wcs/on-handler-this] The $on handler "a" uses this. A $on handler is called as a(state, event): this is undefined there, so it throws when the event arrives — write a(state, event) { state.x = … }. Validate statically: npx @wcstack/lint <file>.',
      expect.stringContaining('The $on handler "b" uses this.'),
    ]);
  });

  it("文字列の中の this という語は数えない。同じハンドラを持つ状態をもう一度置いても言い直さない", async () => {
    const handler = (state: any) => { state.msg = "this is fine"; };
    const got = await warnings(async () => {
      await page(`<p>{{ msg }}</p>`, { msg: "", $eventTokens: ["a"], $on: { a: handler } });
    });
    expect(got).toEqual([]);
    const twice = function (this: any) { this.msg = "x"; };
    const again = await warnings(async () => {
      await page(`<p>{{ msg }}</p>`, { msg: "", $eventTokens: ["a"], $on: { a: twice } });
      await page(`<p>{{ msg }}</p>`, { msg: "", $eventTokens: ["a"], $on: { a: twice } });
    });
    expect(again).toHaveLength(1);
  });
});

describe("ルートの <wcs-state> が 2 つ（wcs/second-root — docs/seam-apps.md、family-ledger）", () => {
  it("先に状態がそろった方がルートを取る。両方を名指して 1 回知らせ、文書で先の方は #47 で拒まれる", async () => {
    const reported: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { reported.push(a.map(String).join(" ")); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const h = document.createElement(`diag-test-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><wcs-state json='{"a":"from json"}'></wcs-state><p>{{ a }}</p>`;
      document.body.appendChild(h);
      await flush();
      const first = root.querySelector("wcs-state") as any;
      first.setInitialState({ a: "the page's" });
      await first.connectedCallbackPromise.catch(() => {});
      await flush();
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
        '[@wcstack/state] [wcs/second-root] 2 root <wcs-state> elements share one root, and there is one state tree per root: <wcs-state json> takes it — its state was ready first, whatever the order in the document — and <wcs-state> is refused (#47). Keep one, and graft the others with <wcs-state mount="path">. Validate statically: npx @wcstack/lint <file>.',
      ]);
      expect(reported.join("\n")).toContain("a second <wcs-state> on the same root");
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it("ボリューム（mount=）と bind-component は数えない", async () => {
    const got = await warnings(async () => {
      const h = document.createElement(`diag-test-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state json='{"a":1}'></wcs-state><wcs-state mount="m" json='{"x":1}'></wcs-state><p>{{ a }}{{ m.x }}</p>`;
      document.body.appendChild(h);
      const el = root.querySelector("wcs-state") as any;
      await el.connectedCallbackPromise;
      await getBindingsReady(root);
      await flush();
    });
    expect(got.filter((w) => w.includes("second-root"))).toEqual([]);
  });
});

describe("要素が書いたオブジェクトの下のパス（docs/seam-apps.md、city-library — router の searchParams）", () => {
  class ParamsOut extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "params", event: "params-out:changed" }] };
    params: Record<string, string> = { q: "a" };
    connectedCallback() { this.dispatchEvent(new CustomEvent("params-out:changed", { detail: this.params })); }
  }
  beforeAll(() => { if (!customElements.get("params-out")) customElements.define("params-out", ParamsOut); });

  it("要素が書いたオブジェクトに無いキーは報告しない — 形は要素が決める（URL のクエリ）", async () => {
    const got = await warnings(() => page(`<params-out data-wcs="params: query"></params-out><p>{{ query.next }}</p>`, { query: { q: "" } }));
    expect(got).toEqual([]);
  });

  it("要素が書かないオブジェクトの下の誤字は今までどおり報告する", async () => {
    const got = await warnings(() => page(`<p>{{ form.nmae }}</p>`, { form: { name: "" } }));
    expect(got).toEqual([expect.stringContaining('Bound path "form.nmae" does not resolve')]);
  });
});

describe("空のオブジェクトの種（docs/seam-apps.md、family-ledger の取り込み）", () => {
  it("{} を種にしたキーの下の束縛は警告しない — 後で代入する種で、null の種と同じ（4.9 の lint は代入を読む）", async () => {
    const got = await warnings(() => page(`<p>{{ fieldErrors.date }}</p><i>{{ form.errors.amount }}</i>`, {
      fieldErrors: {},
      form: { errors: {} },
      fail() { this.fieldErrors = { date: "bad" }; },
    }));
    expect(got).toEqual([]);
  });

  it("キーのあるオブジェクトの下の誤字は今までどおり警告する", async () => {
    const got = await warnings(() => page(`<p>{{ fieldErrors.dat }}</p>`, { fieldErrors: { date: "" } }));
    expect(got).toEqual([expect.stringContaining('Bound path "fieldErrors.dat" does not resolve')]);
  });
});

describe("束ねた要素が定義されないまま（wcs/element-undefined — docs/seam-apps.md、homeroom）", () => {
  /** page() without the macrotask flushes: setTimeout is faked in these tests. */
  async function bound(html: string, state: Record<string, any>) {
    const h = document.createElement(`diag-test-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state>${html}`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    return { root, el };
  }
  let warn: MockInstance<typeof console.warn>;
  const said = () => warn.mock.calls.map((c) => String(c[0])).filter((w) => w.includes("element-undefined"));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    warn.mockRestore();
  });

  it("ページの読み込みから 5 秒たっても定義されない要素を、タグごとに 1 回知らせる。attr.* はすぐに当たり、textContent: は定義を待つ", async () => {
    const { root } = await bound(`<hr-cat-badge data-wcs="attr.cat: cat; textContent: label"></hr-cat-badge><hr-cat-badge data-wcs="textContent: label"></hr-cat-badge>`, { cat: "a", label: "Alpha" });
    const badge = root.querySelector("hr-cat-badge")!;
    expect(badge.getAttribute("cat")).toBe("a");
    expect(badge.textContent).toBe("");
    await vi.advanceTimersByTimeAsync(4999);
    expect(said()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(said()).toEqual([
      "[@wcstack/state] [wcs/element-undefined] <hr-cat-badge> is not defined 5 s after the page was ready; its bindings wait for it (property bindings, textContent: included, spreads, commands, event tokens — attr.*, class.*, style.* and on*: apply at once). Load the script that defines it.",
    ]);
    // 別のルートの同じタグは言い直さない
    await bound(`<hr-cat-badge data-wcs="title: label"></hr-cat-badge>`, { label: "x" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(said()).toHaveLength(1);
  });

  it("wcstack のタグには、それを定義するパッケージ（の /auto）を読み込むよう言う。パッケージの名前は推測しない（wcs-ws は @wcstack/websocket — lint が言う）", async () => {
    await bound(
      `<wcs-upload data-wcs="...: upload"></wcs-upload><wcs-ws data-wcs="command.send: $command.send"></wcs-ws>`
      + `<wcs-link data-wcs="eventToken.click: go"></wcs-link><wcs-upload-header data-wcs="value: token"></wcs-upload-header>`,
      { upload: {}, token: "t", $commandTokens: ["send"], $eventTokens: ["go"] },
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(said().map((w) => /<([\w-]+)>/.exec(w)![1])).toEqual(["wcs-upload", "wcs-ws", "wcs-link", "wcs-upload-header"]);
    for (const w of said()) expect(w).toMatch(/\. Load the wcstack package that defines it \(its \/auto\)\.$/);
    // (no package named after the "[@wcstack/state]" prefix)
    expect(said().map((w) => w.slice("[@wcstack/state] ".length)).join("\n")).not.toContain("@wcstack/");
  });

  it("すぐに当たる束縛だけの要素・束縛の無い要素・data-wcs-ignore の中・定義された要素・その要素のレジストリが定義するタグは知らせない", async () => {
    customElements.define("diag-defined-el", class extends HTMLElement {});
    const { root } = await bound(
      `<only-at-once data-wcs="attr.x: a; class.on: b; style.color: c; onclick: f; html: h; innerHTML: h; radio: a"></only-at-once>`
      // (the page walk's parser: a ";" inside a quoted filter argument does not end the binding)
      + `<quoted-el data-wcs="class.on: a|eq('x;textContent: y')"></quoted-el>`
      + `<no-bindings></no-bindings><div data-wcs-ignore><ignored-el data-wcs="textContent: a"></ignored-el></div>`
      + `<diag-defined-el data-wcs="title: a"></diag-defined-el><scoped-el></scoped-el><unparsable-el></unparsable-el>`,
      { a: "a", b: true, c: "red", h: "<b>h</b>", f() {} },
    );
    // a scoped registry (attachShadow({ customElementRegistry })) that defines it: state waits there, not on the global one
    const scoped = root.querySelector("scoped-el")!;
    scoped.setAttribute("data-wcs", "textContent: a");
    Object.defineProperty(scoped, "customElementRegistry", { value: { get: () => class extends HTMLElement {} } });
    // a data-wcs that does not parse failed the page walk: nothing of it was bound (written here after the walk)
    root.querySelector("unparsable-el")!.setAttribute("data-wcs", "textContent");
    await vi.advanceTimersByTimeAsync(5000);
    expect(said()).toEqual([]);
  });

  it("for: の行・if: の枝の中の要素も見る（行の要素から data-wcs は外れている — 計画から探す）", async () => {
    await bound(
      `<ul><template data-wcs="for: items"><li><row-chip data-wcs="textContent: .name"></row-chip></li></template></ul>`
      + `<ol><template data-wcs="for: items"><li data-wcs="textContent: .name"></li></template></ol>`
      + `<template data-wcs="if: show"><section><template data-wcs="for: items"><nested-chip data-wcs="title: .name"></nested-chip></template></section></template>`
      + `<template data-wcs="if: show"><p></p></template><template data-wcs="else:"><hidden-chip data-wcs="title: label"></hidden-chip></template>`
      + `<template data-wcs="for: items"><event-chip data-wcs="onclick: f"></event-chip></template>`
      + `<template data-wcs="for: others"><template data-wcs="if: .on"><if-chip data-wcs="title: .name"></if-chip></template></template>`
      // (a list no for: renders: an index path's)
      + `<p>{{ picks.0.name }}</p>`,
      { items: [{ name: "a" }], others: [{ on: true, name: "b" }], picks: [{ name: "p" }], show: true, label: "l", f() {} },
    );
    await vi.advanceTimersByTimeAsync(5000);
    // (the else branch is not rendered; an event is attached at once)
    expect(said().map((w) => /<([\w-]+)>/.exec(w)![1])).toEqual(["row-chip", "nested-chip", "if-chip"]);
  });

  it("見る前に外した状態は見ない（タイマーは状態を弱くしか持たない — 外した状態を生かさない: e2e/tests/state-address-gc.spec.ts）", async () => {
    const { root } = await bound(`<gone-chip data-wcs="textContent: a"></gone-chip>`, { a: "a" });
    (root.host as Element).remove();
    await vi.advanceTimersByTimeAsync(5000);
    expect(said()).toEqual([]);
  });

  it("ページの読み込みの前につながった状態は、load の 5 秒後に見る。サーバーの描画では見ない", async () => {
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });
    try {
      await bound(`<late-chip data-wcs="textContent: a"></late-chip>`, { a: "a" });
    } finally {
      delete (document as any).readyState;
    }
    expect(document.readyState).toBe("complete");
    await vi.advanceTimersByTimeAsync(10000);
    expect(said()).toEqual([]);
    window.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(said()).toEqual([expect.stringContaining("<late-chip> is not defined 5 s after the page was ready")]);
    document.documentElement.setAttribute("data-wcs-server", "");
    try {
      await bound(`<server-chip data-wcs="textContent: a"></server-chip>`, { a: "a" });
    } finally {
      document.documentElement.removeAttribute("data-wcs-server");
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(said()).toHaveLength(1);
  });
});

describe("for: が配列でない値を回す（wcs/binding-type-expectation — docs/seam-apps.md、homeroom）", () => {
  it("最初の値が数・文字列・オブジェクトなら、リストのパスごとに 1 回知らせる（行の中のリストも）。null・undefined・空の配列は黙る", async () => {
    const got = await warnings(() => page(
      `<ul><template data-wcs="for: count"><li>{{ . }}</li></template></ul><ul><template data-wcs="for: count"><li>{{ . }}</li></template></ul>`
      + `<template data-wcs="for: groups"><template data-wcs="for: .items"><i>{{ . }}</i></template></template>`
      + `<template data-wcs="for: page"><b>{{ . }}</b></template>`
      + `<template data-wcs="for: none"><b>{{ . }}</b></template><template data-wcs="for: nothing"><b>{{ . }}</b></template><template data-wcs="for: empty"><b>{{ . }}</b></template>`,
      { count: 3, groups: [{ items: "abc" }, { items: "def" }], page: { items: [1] }, none: null, nothing: undefined, empty: [] },
    ));
    expect(got).toEqual([
      '[@wcstack/state] [wcs/binding-type-expectation] "for: count" needs an array, not a number (3): it renders no rows (null and undefined render none on purpose). Validate statically: npx @wcstack/lint <file>.',
      expect.stringContaining('"for: groups.*.items" needs an array, not a string ("abc")'),
      expect.stringContaining('"for: page" needs an array, not an object'),
    ]);
  });

  it("後から書かれた値も見る: 配列を置き換えた値、null を置き換えた値（行の外のリスト）", async () => {
    const { el } = await page(
      `<template data-wcs="for: items"><b>{{ . }}</b></template><template data-wcs="for: later"><b>{{ . }}</b></template>`,
      { items: [1, 2], later: null },
    );
    const got = await warnings(async () => {
      el.createState("writable", (s: any) => { s.items = 5; s.later = { rows: [] }; });
      await flush();
      el.createState("writable", (s: any) => { s.items = 6; });
      await flush();
    });
    expect(got).toEqual([
      expect.stringContaining('"for: items" needs an array, not a number (5)'),
      expect.stringContaining('"for: later" needs an array, not an object'),
    ]);
  });

  it("for: の無いリスト（オブジェクトへの添字のパス）は知らせない。読めなくなったリストは束縛の失敗として報告されるだけ", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { el } = await page(`<p>{{ sales.2024.total }}</p><template data-wcs="for: rows"><b>{{ . }}</b></template>`, {
        sales: { 2024: { total: 10 } }, bad: false,
        get rows() { if (this.bad) throw new Error("boom"); return []; },
      });
      const got = await warnings(async () => {
        el.createState("writable", (s: any) => { s.bad = true; });
        await flush();
      });
      expect(got.filter((w) => w.includes("binding-type-expectation"))).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });
});
