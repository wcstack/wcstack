/**
 * coverage-engine.test.ts — the engine's less travelled paths, through the public proxy and
 * the DOM it renders. No add-on is installed here: messages are the core's numbered form.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { Engine, mount, DirtyStrategy } from "../src/index";
import { M } from "../src/messages";

const flush = () => new Promise((r) => setTimeout(r, 0));

// the core's own message (no diagnostics add-on here): [@wcstack/state] [wcs/<code>] #<number> <values>
const core = (id: M) => new RegExp(String.raw`^\[@wcstack/state\] (\[wcs/[\w-]+\] )?#${id}( |$)`);

function setup(html: string, state: Record<string, any>): Engine {
  document.body.innerHTML = html;
  const engine = new Engine(state, new DirtyStrategy());
  mount(engine, document);
  return engine;
}

const texts = (sel: string) => Array.from(document.querySelectorAll(sel)).map((n) => n.textContent);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("プロキシの入口", () => {
  it("シンボルのキーは状態オブジェクトにそのまま読み書きされる", () => {
    const sym = Symbol("meta");
    const e = setup("", { a: 1 });
    e.proxy[sym as any] = "tagged";
    expect(e.proxy[sym as any]).toBe("tagged");
    expect(e.target[sym as any]).toBe("tagged");
  });

  it("add-on の無い未知の $ 名は undefined", () => {
    const e = setup("", { a: 1 });
    expect(e.proxy.$unknownApi).toBeUndefined();
  });

  it("$stateElement はエンジンの要素を返す（直接作ったエンジンでは null）", () => {
    const e = setup("", { who(this: any) { return this.$stateElement; } });
    expect(e.proxy.who()).toBeNull();
    const marker = document.createElement("div");
    e.element = marker;
    expect(e.proxy.who()).toBe(marker);
  });
});

describe("accessor の登録", () => {
  it("派生クラスの getter が基底クラスの同名 getter より優先される", async () => {
    class Base {
      n = 2;
      get label(): string { return "base"; }
    }
    class Derived extends Base {
      override get label(): string { return `derived ${(this as any).n}`; }
    }
    const e = setup(`<p>{{ label }}</p>`, new Derived() as any);
    expect(texts("p")).toEqual(["derived 2"]);
    e.proxy.n = 3;
    await flush();
    expect(texts("p")).toEqual(["derived 3"]);
  });

  it("setter だけの accessor は書き込みを setter に渡し、読みは undefined", async () => {
    const state: Record<string, any> = {
      stored: 0,
      set doubled(v: number) { (this as any).stored = v * 2; },
    };
    const e = setup(`<p>{{ stored }}</p>`, state);
    e.proxy.doubled = 3;
    await flush();
    expect(texts("p")).toEqual(["6"]);
    expect(e.proxy.doubled).toBeUndefined();
  });
});

describe("配列でない値のリスト", () => {
  it("null・undefined・文字列・数値は空のリストとして描画され、配列になると行が出る", async () => {
    const e = setup(`<ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`, { items: null });
    expect(texts("li")).toEqual([]);
    e.proxy.items = undefined;
    await flush();
    expect(texts("li")).toEqual([]);
    e.proxy.items = "abc";
    await flush();
    expect(texts("li")).toEqual([]);
    e.proxy.items = ["a", "b"];
    await flush();
    expect(texts("li")).toEqual(["a", "b"]);
    e.proxy.items = 0;
    await flush();
    expect(texts("li")).toEqual([]);
  });
});

describe("同じ値が並ぶリストの差分（行の再利用）", () => {
  const html = `<ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`;
  const lis = () => Array.from(document.querySelectorAll("li"));

  it("重複した値の行は前から順に再利用され、余った重複行だけが消える", async () => {
    const e = setup(html, { items: [1, 1, 1, 2] });
    const before = lis();
    e.proxy.items = [2, 1, 1, 3];
    await flush();
    const after = lis();
    expect(after.map((l) => l.textContent)).toEqual(["2", "1", "1", "3"]);
    expect(after[0]).toBe(before[3]);
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
    expect(before.includes(after[3])).toBe(false);
    expect(before[2].isConnected).toBe(false);
  });

  it("重複した値の行をすべて使い切る並べ替えでは、どの行も作り直されない", async () => {
    const e = setup(html, { items: [1, 1, 2] });
    const before = lis();
    e.proxy.items = [2, 1, 1];
    await flush();
    const after = lis();
    expect(after.map((l) => l.textContent)).toEqual(["2", "1", "1"]);
    expect(after).toEqual([before[2], before[0], before[1]]);
  });
});

describe("添字と * が混ざったパス", () => {
  const state = () => ({
    groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }] }],
    get "groups.*.first"() { return (this as any)["groups.*.items.0.v"]; },
  });

  it("行の getter の中では * が自分の行の添字になり、添字の部分はそのまま使われる", async () => {
    const e = setup(`<ul><template data-wcs="for: groups"><li>{{ .first }}</li></template></ul>`, state());
    expect(texts("li")).toEqual(["1", "3"]);
    e.proxy["groups.1.items.0.v"] = 30;
    await flush();
    expect(texts("li")).toEqual(["1", "30"]);
  });

  it("行の外では * の行が無く、範囲外の添字も行が無いので undefined", () => {
    const e = setup("", state());
    expect(e.proxy["groups.*.items.0.v"]).toBeUndefined();
    expect(e.proxy["groups.5.items.0.v"]).toBeUndefined();
    expect(e.proxy["groups.0.items.1.v"]).toBe(2);
  });
});

describe("getter の下のパス", () => {
  it("getter が null を返すとき、その下のパスは undefined（表示は空）", async () => {
    const e = setup(`<p>{{ user.name }}</p>`, {
      on: false,
      get user() { return (this as any).on ? { name: "Al" } : null; },
    });
    expect(texts("p")).toEqual([""]);
    expect(e.proxy["user.name"]).toBeUndefined();
    e.proxy.on = true;
    await flush();
    expect(texts("p")).toEqual(["Al"]);
  });
});

describe("getter の入れ子の深さ（wcs/getter-depth-exceeded）", () => {
  function chain(n: number): Record<string, any> {
    const state: Record<string, any> = {};
    Object.defineProperty(state, "g0", { get() { return 0; }, enumerable: true, configurable: true });
    for (let i = 1; i <= n; i++) {
      Object.defineProperty(state, `g${i}`, { get(this: any) { return this[`g${i - 1}`] + 1; }, enumerable: true, configurable: true });
    }
    return state;
  }

  it("128 段までは評価でき、129 段目で投げる", () => {
    const e = setup("", chain(128));
    expect(() => e.proxy.g128).toThrow(core(M.GetterDepth));
    // the failed chain is evaluated again from scratch
    expect(e.proxy.g127).toBe(127);
  });
});

describe("依存の手動操作（$untracked / $dependOn / $postUpdate）", () => {
  it("$untracked はメソッドから呼んでもただ fn の値を返す", () => {
    const e = setup("", { count: 4, twice(this: any) { return this.$untracked(() => this.count * 2); } });
    expect(e.proxy.twice()).toBe(8);
  });

  it("$dependOn は getter に依存を足し、$untracked の中やメソッドからでは何も足さない", async () => {
    const e = setup(`<p class="a">{{ view }}</p><p class="b">{{ quiet }}</p>`, {
      a: 1,
      rev: 0,
      rev2: 0,
      get view() {
        const s = this as any;
        s.$dependOn("rev");
        return s.$untracked(() => s.a) * 10;
      },
      get quiet() {
        const s = this as any;
        s.$untracked(() => s.$dependOn("rev2"));
        return s.$untracked(() => s.a);
      },
      poke(this: any) { return this.$dependOn("rev"); },
    });
    expect(texts("p")).toEqual(["10", "1"]);
    e.proxy.a = 2;
    await flush();
    expect(texts("p")).toEqual(["10", "1"]);
    e.proxy.rev = 1;
    await flush();
    expect(texts("p")).toEqual(["20", "1"]);
    e.proxy.rev2 = 1;
    await flush();
    expect(texts("p")).toEqual(["20", "1"]);
    expect(e.proxy.poke()).toBeUndefined();
  });

  it("$postUpdate はその場で変えたオブジェクトのパスを描画し直す", async () => {
    const e = setup(`<p>{{ user.name }}</p>`, {
      user: { name: "A" },
      mutate(this: any) { this.user.name = "B"; },
      announce(this: any) { this.$postUpdate("user.name"); },
    });
    e.proxy.mutate();
    await flush();
    expect(texts("p")).toEqual(["A"]);
    e.proxy.announce();
    await flush();
    expect(texts("p")).toEqual(["B"]);
  });

  it("行の外の getter で $1 を読むと undefined", () => {
    const e = setup(`<p>{{ pos }}</p>`, { get pos() { return (this as any).$1; } });
    expect(e.proxy.pos).toBeUndefined();
    expect(texts("p")).toEqual([""]);
  });
});

describe("$eq / $eqPath", () => {
  it("NaN のキーは NaN の値と等しい（Map のキーと同じ比較）", async () => {
    const e = setup(`<p>{{ isNaNSel }}</p>`, {
      x: NaN,
      get isNaNSel() { return (this as any).$eq("x", NaN); },
    });
    expect(texts("p")).toEqual(["true"]);
    e.proxy.x = 1;
    await flush();
    expect(texts("p")).toEqual(["false"]);
    e.proxy.x = NaN;
    await flush();
    expect(texts("p")).toEqual(["true"]);
  });

  it("$eqPath のキーのパスがトップレベルでも比較できる", async () => {
    const e = setup(`<p>{{ match }}</p>`, {
      selected: "a",
      current: "a",
      get match() { return (this as any).$eqPath("selected", "current"); },
    });
    expect(texts("p")).toEqual(["true"]);
    e.proxy.selected = "b";
    await flush();
    expect(texts("p")).toEqual(["false"]);
    e.proxy.selected = "a";
    await flush();
    expect(texts("p")).toEqual(["true"]);
  });

  it("メソッドから呼んだ $eq は比較の結果だけを返す", () => {
    const e = setup("", { mode: "edit", isEdit(this: any) { return this.$eq("mode", "edit"); } });
    expect(e.proxy.isEdit()).toBe(true);
    e.proxy.mode = "view";
    expect(e.proxy.isEdit()).toBe(false);
    expect(e.pattern("mode").eqSubs).toBeNull();
  });

  it("getter や行のパスを比べる $eq は普通の依存に戻り、選択は正しく追従する", async () => {
    const e = setup(`<ul><template data-wcs="for: items"><li>{{ .isCur }}/{{ .isTwo }}</li></template></ul>`, {
      idx: 0,
      items: [{ v: 1 }, { v: 2 }],
      get current() { const s = this as any; return s.items[s.idx]; },
      get "items.*.isCur"() { const s = this as any; return s.$eq("current", s["items.*"]); },
      get "items.*.isTwo"() { return (this as any).$eq("items.*.v", 2); },
    });
    expect(texts("li")).toEqual(["true/false", "false/true"]);
    e.proxy.idx = 1;
    await flush();
    expect(texts("li")).toEqual(["false/false", "true/true"]);
    e.proxy["items.0.v"] = 2;
    await flush();
    expect(texts("li")).toEqual(["false/true", "true/true"]);
  });

  it("キーが変わった購読は古いキーから外れ、新しいキーで反応する", async () => {
    const e = setup(`<p class="w">{{ isWanted }}</p><p class="o">{{ isOne }}</p>`, {
      role: "admin",
      want: "admin",
      other: 1,
      get isWanted() { const s = this as any; return s.$eq("role", s.want); },
      get isOne() { return (this as any).$eq("other", 1); },
    });
    expect(texts("p")).toEqual(["true", "true"]);
    e.proxy.want = "user";
    await flush();
    expect(texts("p")).toEqual(["false", "true"]);
    expect(e.pattern("role").eqSubs!.get("admin")!.size).toBe(0);
    expect(e.pattern("role").eqSubs!.get("user")!.size).toBe(1);
    e.proxy.role = "user";
    await flush();
    expect(texts("p")).toEqual(["true", "true"]);
    e.proxy.other = 2;
    await flush();
    expect(texts("p")).toEqual(["true", "false"]);
  });

  it("$eq の上のオブジェクトを null にしても、置き直しても選択が追従する", async () => {
    const e = setup(`<p>{{ isAdmin }}</p>`, {
      user: { role: "admin" } as { role: string } | null,
      get isAdmin() { return (this as any).$eq("user.role", "admin"); },
    });
    expect(texts("p")).toEqual(["true"]);
    e.proxy.user = null;
    await flush();
    expect(texts("p")).toEqual(["false"]);
    e.proxy.user = { role: "admin" };
    await flush();
    expect(texts("p")).toEqual(["true"]);
  });

  it("消えた行で評価された購読は、そのキーへの書き込みで捨てられる", async () => {
    let peeked: unknown = "unset";
    const e = setup(`<ul><template data-wcs="for: items"><li data-wcs="onclick: removeAndPeek">{{ .sel }}</li></template></ul>`, {
      selectedId: 2,
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      get "items.*.sel"() { const s = this as any; return s.$eq("selectedId", s["items.*.id"]); },
      get "items.*.peek"() { const s = this as any; return s.$eq("selectedId", s["items.*.id"]); },
      removeAndPeek(this: any, _e: Event, i: number) {
        this.items = this.items.filter((_: unknown, k: number) => k !== i);
        // the handler's row is gone: this evaluates (and subscribes) on the removed row
        peeked = this["items.*.peek"];
      },
    });
    expect(texts("li")).toEqual(["false", "true", "false"]);
    (document.querySelector("li") as HTMLElement).click();
    await flush();
    expect(peeked).toBe(false);
    expect(texts("li")).toEqual(["true", "false"]);
    const subs = e.pattern("selectedId").eqSubs!;
    expect(subs.get(1)!.size).toBe(1);
    e.proxy.selectedId = 1;
    await flush();
    expect(subs.get(1)!.size).toBe(0);
    expect(texts("li")).toEqual(["false", "false"]);
    e.proxy.selectedId = 3;
    await flush();
    expect(texts("li")).toEqual(["false", "true"]);
  });
});

describe("$eqIndex", () => {
  const html = `<ul><template data-wcs="for: items"><li data-wcs="onclick: check">{{ .cur }}</li></template></ul>`;
  const base = (checked: unknown[] = [], sel: number | null = 0) => ({
    sel,
    items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    get "items.*.cur"() { return (this as any).$eqIndex("sel"); },
    check(this: any) { checked.push(this.$eqIndex("sel")); },
    outside(this: any) { return this.$eqIndex("sel"); },
    tooDeep(this: any) { return this.$eqIndex("sel", 2); },
  });

  it("行の外で呼ぶと投げる。行の深さより深い level も投げる", () => {
    const e = setup("", base());
    expect(() => e.proxy.outside()).toThrow(core(M.EqIndexNoRow));
    const row = e.rootList(e.pattern("items")).rows[0];
    expect(() => e.invoke("tooDeep", new Event("click"), row)).toThrow(core(M.EqIndexNoRow));
  });

  it("行のハンドラから呼ぶと、自分の行が選ばれているかを返す", () => {
    const checked: unknown[] = [];
    setup(html, base(checked, 1));
    const lis = document.querySelectorAll("li");
    (lis[0] as HTMLElement).click();
    (lis[1] as HTMLElement).click();
    expect(checked).toEqual([false, true]);
  });

  it("範囲外の添字を選ぶと、どの行も選ばれず、戻すと選ばれる", async () => {
    const e = setup(html, base());
    expect(texts("li")).toEqual(["true", "false", "false"]);
    e.proxy.sel = 5;
    await flush();
    expect(texts("li")).toEqual(["false", "false", "false"]);
    e.proxy.sel = 1;
    await flush();
    expect(texts("li")).toEqual(["false", "true", "false"]);
  });

  it("行の追加では選ばれた位置の行が変わらなければそのまま、範囲外だった位置に行が来ればその行が選ばれる", async () => {
    const e = setup(html, base());
    e.proxy.items = [...e.proxy.items, { id: 4 }];
    await flush();
    expect(texts("li")).toEqual(["true", "false", "false", "false"]);
    e.proxy.sel = 4;
    await flush();
    expect(texts("li")).toEqual(["false", "false", "false", "false"]);
    e.proxy.items = [...e.proxy.items, { id: 5 }];
    await flush();
    expect(texts("li")).toEqual(["false", "false", "false", "false", "true"]);
  });
});

describe("書き込みの失敗", () => {
  it("行の無い行パスへの書き込みは投げる", () => {
    const e = setup("", { items: [{ v: 1 }] });
    expect(() => { e.proxy["items.*.v"] = 2; }).toThrow(core(M.NoRow));
    expect(() => { e.proxy["items.9.v"] = 2; }).toThrow(core(M.NoRow));
  });

  it("親が null のパスへの書き込みは投げる", () => {
    const e = setup("", { user: null, items: [null] });
    expect(() => { e.proxy["user.name"] = "x"; }).toThrow(core(M.ParentNotObject));
    expect(() => { e.proxy["items.0.v"] = 1; }).toThrow(core(M.ParentNotObject));
  });

  it("関数でない名前のハンドラ呼び出しは投げる", () => {
    const e = setup("", { count: 1, user: { name: "x" } });
    expect(() => e.invoke("count", new Event("click"), null)).toThrow(core(M.NotAMethod));
    expect(() => e.invoke("user.name", new Event("click"), null)).toThrow(core(M.NotAMethod));
  });
});

describe("要素の書き込みと入れ子のリスト", () => {
  it("行の値の置き換えは行を残したまま、その下の入れ子のリストを新しい値に合わせる", async () => {
    const e = setup(`<div><template data-wcs="for: groups"><section>{{ .name }}:<template data-wcs="for: .items"><i>{{ .v }}</i></template></section></template></div>`, {
      groups: [{ name: "a", items: [{ v: 1 }, { v: 2 }] }, { name: "b", items: [{ v: 3 }] }],
    });
    const section0 = document.querySelector("section");
    expect(texts("i")).toEqual(["1", "2", "3"]);
    e.proxy["groups.0"] = { name: "x", items: [{ v: 9 }] };
    await flush();
    expect(texts("i")).toEqual(["9", "3"]);
    expect(document.querySelector("section")).toBe(section0);
    expect(section0!.firstChild!.textContent).toBe("x");
  });
});

describe("委譲されたイベント", () => {
  it("内側のハンドラが伝播を止めると、外側のルート要素のハンドラは呼ばれない", () => {
    const calls: string[] = [];
    let stop = true;
    setup(`<div data-wcs="onclick: outer"><button data-wcs="onclick: inner">x</button></div>`, {
      outer() { calls.push("outer"); },
      inner(ev: Event) {
        calls.push("inner");
        if (stop) ev.stopPropagation();
      },
    });
    (document.querySelector("button") as HTMLElement).click();
    expect(calls).toEqual(["inner"]);
    stop = false;
    (document.querySelector("button") as HTMLElement).click();
    expect(calls).toEqual(["inner", "inner", "outer"]);
  });
});

describe("再設定（reset）", () => {
  it("同じ配列を持つ新しい状態では入れ子の行も残り、新しい getter で描画し直される", async () => {
    const groups = [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }] }];
    const e = setup(`<div><template data-wcs="for: groups"><section><template data-wcs="for: .items"><i>{{ .label }}</i></template></section></template></div>`, {
      groups,
      get "groups.*.items.*.label"() { return `v${(this as any)["groups.*.items.*.v"]}`; },
    });
    const before = Array.from(document.querySelectorAll("i"));
    expect(texts("i")).toEqual(["v1", "v2", "v3"]);
    e.reset({
      groups,
      get "groups.*.items.*.label"() { return `n${(this as any)["groups.*.items.*.v"] * 100}`; },
    });
    expect(texts("i")).toEqual(["n100", "n200", "n300"]);
    expect(Array.from(document.querySelectorAll("i"))).toEqual(before);
  });
});

describe("同じリストの二つ目以降の for", () => {
  it("スロットを持たない二つ目の描画は行の書き込みで変わらず、描画前の行への書き込みも両方に反映される", async () => {
    const e = setup(`<ul class="a"><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>
      <ol class="b"><template data-wcs="for: items"><li data-wcs="onclick: noop">*</li></template></ol>`, {
      items: [{ v: 1 }, { v: 2 }],
      noop() {},
    });
    e.proxy["items.0.v"] = 5;
    await flush();
    expect(texts(".a li")).toEqual(["5", "2"]);
    expect(texts(".b li")).toEqual(["*", "*"]);
    e.proxy.items = [...e.proxy.items, { v: 3 }];
    // the new row is written before any view rendered it
    e.proxy["items.2.v"] = 7;
    await flush();
    expect(texts(".a li")).toEqual(["5", "2", "7"]);
    expect(texts(".b li")).toEqual(["*", "*", "*"]);
  });

  it("行の中に同じリストの for があっても、縮めたときに消えた内側の描画は更新されない", async () => {
    const e = setup(`<ul class="a"><template data-wcs="for: items"><li>{{ . }}</li></template></ul>
      <div class="b"><template data-wcs="for: items"><section><template data-wcs="for: items"><i>{{ . }}</i></template></section></template></div>`, {
      items: ["x", "y", "z"],
    });
    expect(texts(".a li")).toEqual(["x", "y", "z"]);
    expect(document.querySelectorAll("section").length).toBe(3);
    expect(texts("i")).toEqual(["x", "y", "z", "x", "y", "z", "x", "y", "z"]);
    e.proxy.items = ["x"];
    await flush();
    expect(texts(".a li")).toEqual(["x"]);
    expect(document.querySelectorAll("section").length).toBe(1);
    expect(texts("i")).toEqual(["x"]);
    e.proxy.items = ["x", "w"];
    await flush();
    expect(texts("i")).toEqual(["x", "w", "x", "w"]);
  });
});

describe("出力だけのカスタム要素のバインディング（行の中の if）", () => {
  let seq = 0;
  function outElement(): string {
    const tag = `cov-out-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "value", event: "cov-change" }] };
      value = "init";
    });
    return tag;
  }

  it("ルートの条件で消える枝の要素は、行が残っていても外れ、戻すとまた値を送る", async () => {
    const tag = outElement();
    const e = setup(`<ul><template data-wcs="for: items"><li><template data-wcs="if: show"><${tag} data-wcs="value: .v"></${tag}></template></li></template></ul>`, {
      show: true,
      items: [{ v: "" }],
    });
    expect(e.proxy["items.0.v"]).toBe("init");
    document.querySelector(tag)!.dispatchEvent(new CustomEvent("cov-change", { detail: "typed" }));
    expect(e.proxy["items.0.v"]).toBe("typed");
    e.proxy.show = false;
    await flush();
    expect(document.querySelector(tag)).toBeNull();
    expect(e.proxy["items.0.v"]).toBe("typed");
    e.proxy.show = true;
    await flush();
    expect(document.querySelector(tag)).not.toBeNull();
    expect(e.proxy["items.0.v"]).toBe("init");
  });

  it("行の条件で消える枝でも同じ（行には条件のバインディングだけが残る）", async () => {
    const tag = outElement();
    const e = setup(`<ul><template data-wcs="for: items"><li><template data-wcs="if: .show"><${tag} data-wcs="value: .v"></${tag}></template></li></template></ul>`, {
      items: [{ v: "", show: true }],
    });
    expect(e.proxy["items.0.v"]).toBe("init");
    e.proxy["items.0.show"] = false;
    await flush();
    expect(document.querySelector(tag)).toBeNull();
    e.proxy["items.0.show"] = true;
    await flush();
    document.querySelector(tag)!.dispatchEvent(new CustomEvent("cov-change", { detail: "again" }));
    expect(e.proxy["items.0.v"]).toBe("again");
  });
});

describe("落ち着かない更新（MAX_DRAIN_PASSES）", () => {
  it("描画のたびに書き込む要素は 32 回で打ち切られてエラーになり、その後の書き込みは普通に描画される", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = `<div id="d" data-wcs="foo: n"></div>
      <ul class="data"><template data-wcs="for: arr"><li>{{ . }}</li></template></ul>
      <ol class="derived"><template data-wcs="for: rows"><li>{{ . }}</li></template></ol>
      <p>{{ n }}</p>`;
    const d = document.getElementById("d") as any;
    let e!: Engine;
    let stop = false;
    let shown: unknown;
    // an element property whose setter writes state back: every apply produces more work
    Object.defineProperty(d, "foo", {
      get() { return shown; },
      set(v: number) {
        shown = v;
        if (stop) return;
        e.proxy.n = v + 1;
        e.proxy.arr = [v];
      },
      configurable: true,
    });
    e = new Engine({ n: 0, arr: [] as number[], get rows() { return [(this as any).n]; } }, new DirtyStrategy());
    mount(e, document);
    await flush();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(core(M.DrainNotSettled)));
    stop = true;
    e.proxy.n = 100;
    e.proxy.arr = [100];
    await flush();
    expect(texts("p")).toEqual(["100"]);
    expect(texts(".data li")).toEqual(["100"]);
    expect(shown).toBe(100);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("描画されていないリストの失敗", () => {
  it("getter のリストの同期が失敗すると、for の失敗として node: null で報告される", async () => {
    const reports: unknown[][] = [];
    const e = setup("", {
      n: 1,
      get items() {
        if ((this as any).n > 1) throw new Error("boom");
        return [{ v: 1 }];
      },
      values(this: any) { return this.$getAll("items.*.v", []); },
      $errorCallback(error: Error, info: unknown) { reports.push([error.message, info]); },
    });
    expect(e.proxy.values()).toEqual([1]);
    e.proxy.n = 2;
    await flush();
    expect(reports).toEqual([["boom", { path: "items", bindingType: "for", node: null }]]);
  });
});

describe("view-transition の arbiter", () => {
  const RUNNER_KEY = Symbol.for("wcstack.transition-runner");
  afterEach(() => {
    delete (globalThis as any)[RUNNER_KEY];
  });

  it("run が reject しても反映は済み、失敗は console.error に出る", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = setup(`<p>{{ n }}</p>`, { n: 1 });
    const failure = new Error("arbiter failed");
    (globalThis as any)[RUNNER_KEY] = {
      protocol: "wcs-transition-runner", version: 1, naming: "manual", namingLimit: 100,
      accepts: (source: string) => source === "state",
      run(mutate: () => void) {
        mutate();
        return Promise.reject(failure);
      },
    };
    e.proxy.n = 2;
    await flush();
    expect(texts("p")).toEqual(["2"]);
    expect(error).toHaveBeenCalledWith(failure);
  });
});

describe("$getAll / $setAll / $resolve", () => {
  const state = () => ({
    count: 1,
    items: [{ v: 1 }, { v: 2 }],
    m: [[1, 2], [3, 4]],
    a: [{ x: 1 }],
    b: [{ v: 1 }],
    get "a.*.bs"() { return (this as any).$getAll("b.*.v"); },
    get badWrite() { return (this as any).$setAll("items.*.v", [], 0); },
    all(this: any) { return this.$getAll("items.*.v"); },
  });

  it("$getAll はトップレベルのパスでも配列で返し、行の外で添字を省くとすべての行", () => {
    const e = setup("", state());
    expect(e.proxy.$getAll("count")).toEqual([1]);
    expect(e.proxy.all()).toEqual([1, 2]);
    expect(e.proxy.$getAll("items.*.v", [99])).toEqual([]);
  });

  it("$getAll は別のリストの行の中で添字を省くと投げる", () => {
    const e = setup("", state());
    expect(() => e.proxy.$resolve("a.*.bs", [0])).toThrow(core(M.GetAllNoCommonLevel));
  });

  it("$setAll はトップレベルのパスにも書け、書いた数を返す", async () => {
    const e = setup(`<p>{{ count }}</p>`, state());
    expect(e.proxy.$setAll("count", [], 5)).toBe(1);
    await flush();
    expect(texts("p")).toEqual(["5"]);
  });

  it("$setAll の誤用は投げる（添字が配列でない・getter の中・spread の長さ違い）", () => {
    const e = setup("", state());
    expect(() => e.proxy.$setAll("items.*.v", undefined, 1)).toThrow(core(M.SetAllNeedsIndexes));
    expect(() => e.proxy.badWrite).toThrow(core(M.Readonly));
    expect(() => e.proxy.$setAll("items.*.v", [], [1], { spread: true })).toThrow(core(M.SetAllSpreadLength));
    expect(() => e.proxy.$setAll("items.*.v", [], 1, { spread: true })).toThrow(core(M.SetAllSpreadLength));
    expect(e.proxy.$getAll("items.*.v", [])).toEqual([1, 2]);
  });

  it("$resolve は添字を省くとトップレベルを読み、行の無い添字では undefined", () => {
    const e = setup("", state());
    expect(e.proxy.$resolve("count")).toBe(1);
    expect(e.proxy.$resolve("items.*.v", [99])).toBeUndefined();
    expect(e.proxy.$resolve("m.*.*", [99, 0])).toBeUndefined();
    expect(e.proxy.$resolve("m.*.*", [1, 1])).toBe(4);
  });
});

describe("DirtyStrategy の無効化", () => {
  it("描画されていない行の getter も $eqIndex の付け替えで正しく読める", () => {
    const e = setup("", {
      sel: 0,
      items: [{ v: 1 }, { v: 2 }, { v: 3 }],
      get "items.*.cur"() { return (this as any).$eqIndex("sel"); },
      get "items.*.dbl"() { return (this as any)["items.*.v"] * 2; },
    });
    const s = e.proxy;
    expect(s.$resolve("items.*.cur", [0])).toBe(true);
    // row 1 gets a cache (for dbl) where cur was never evaluated; row 2 has no cache at all
    expect(s.$resolve("items.*.dbl", [1])).toBe(4);
    s.sel = 2;
    s.sel = 1;
    expect([0, 1, 2].map((i) => s.$resolve("items.*.cur", [i]))).toEqual([false, true, false]);
  });

  it("行の getter を行の外から読むと undefined", () => {
    const e = setup("", { items: [{ v: 1 }], get "items.*.dbl"() { return (this as any)["items.*.v"] * 2; } });
    expect(e.proxy["items.*.dbl"]).toBeUndefined();
  });

  it("入れ子の行の getter は、作られていない入れ子のリストを飛ばしてトップレベルの変更を受ける", () => {
    const e = setup("", {
      factor: 2,
      groups: [{ items: [{ v: 1 }] }, { items: [{ v: 5 }] }],
      get "groups.*.items.*.scaled"() { const s = this as any; return s["groups.*.items.*.v"] * s.factor; },
    });
    const s = e.proxy;
    expect(s.$resolve("groups.*.items.*.scaled", [0, 0])).toBe(2);
    // only group 0 has its nested list so far
    expect(e.rootList(e.pattern("groups")).rows[1].children).toBeNull();
    s.factor = 3;
    expect(s.$resolve("groups.*.items.*.scaled", [0, 0])).toBe(3);
    expect(s.$resolve("groups.*.items.*.scaled", [1, 0])).toBe(15);
  });
});
