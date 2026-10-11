/**
 * pattern-sweep.test.ts — patterns a path built from data made (`this["users." + id]`) do not stay
 * for good: a root getter's sources follow what it read last (Engine.prune), and after a drain the
 * patterns that hold nothing leave the table (Engine.sweep). No add-on is installed here.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { Engine, mount, DirtyStrategy } from "../src/index";
import { parsePath } from "../src/pattern";

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(html: string, state: Record<string, any>): Engine {
  document.body.innerHTML = html;
  const engine = new Engine(state, new DirtyStrategy());
  mount(engine, document);
  return engine;
}

const paths = (e: Engine) => [...e.patterns.all()].map((p) => p.path).sort();
const sources = (e: Engine, path: string) => e.patterns.peek(path)!.sources.map((p) => p.path).sort();
const text = (sel = "p") => document.querySelector(sel)!.textContent;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("動的なキーのパターンの回収", () => {
  it("ルートの getter が dict.<キー> を読む: キーを替え続けても、パターンと依存は今のキーの分だけ", async () => {
    let calls = 0;
    const e = setup(`<p>{{ view }}</p>`, {
      dict: { k0: 0 }, cur: "k0",
      get view() { calls++; const s = this as any; return s["dict." + s.cur]; },
    });
    await flush();
    for (let i = 1; i <= 50; i++) {
      e.proxy["dict.k" + i] = i;
      e.proxy.cur = "k" + i;
      await flush();
    }
    expect(text()).toBe("50");
    expect(paths(e)).toEqual(["cur", "dict", "dict.k50", "view"]);
    expect(sources(e, "view")).toEqual(["cur", "dict.k50"]);
    expect(Object.keys(e.target.dict)).toHaveLength(51);
    // 今のキーへの書き込みは届き、前のキーへの書き込みは getter を評価し直さない
    e.proxy["dict.k50"] = 500;
    await flush();
    expect(text()).toBe("500");
    const before = calls;
    e.proxy["dict.k3"] = 33;
    await flush();
    expect(calls).toBe(before);
    expect(text()).toBe("500");
    // 前のキーへ戻ると、パターンは作り直されて描かれる
    e.proxy.cur = "k3";
    await flush();
    expect(text()).toBe("33");
    expect(paths(e)).toEqual(["cur", "dict", "dict.k3", "view"]);
  });

  it("コードから書いただけの dict.<キー> は、drain の後に残らない（データは残る）", async () => {
    const e = setup(`<p>{{ n }}</p>`, { n: 0, log: {} });
    await flush();
    for (let i = 0; i < 100; i++) e.proxy["log.e" + i] = i;
    await flush();
    expect(paths(e)).toEqual(["log", "n"]);
    expect(Object.keys(e.target.log)).toHaveLength(100);
    expect(e.proxy["log.e7"]).toBe(7);
  });

  it("入れ子のキーは、子から順に何段でも回収される", async () => {
    const e = setup(`<p>{{ n }}</p>`, { n: 0, tmp: { x: { y: {} } } });
    await flush();
    e.proxy["tmp.x.y.z"] = 1;
    await flush();
    expect(paths(e)).toEqual(["n", "tmp"]);
    expect(e.target.tmp.x.y.z).toBe(1);
  });

  it("$resolve で読み書きした動的なパスも回収される", async () => {
    const e = setup(`<p>{{ n }}</p>`, { n: 0, dict: {} });
    await flush();
    for (let i = 0; i < 20; i++) e.proxy.$resolve("dict.k" + i, [], i);
    expect(e.proxy.$resolve("dict.k7", [])).toBe(7);
    e.proxy.n = 1;
    await flush();
    expect(paths(e)).toEqual(["dict", "n"]);
  });

  it("バインドされたパス・一覧・トップレベルのキーは回収されない", async () => {
    const e = setup(`<p>{{ dict.k1 }}</p><ul><template data-wcs="for: groups.g1"><li>{{ . }}</li></template></ul>`, {
      dict: { k1: "one", k2: "two" }, groups: { g1: ["a", "b"] }, cur: "k1",
      get view() { const s = this as any; return s["dict." + s.cur]; },
    });
    await flush();
    expect(e.proxy.view).toBe("one");
    e.proxy.cur = "k2";
    expect(e.proxy.view).toBe("two");
    e.proxy.fresh = 1;
    await flush();
    const ps = paths(e);
    expect(ps).toContain("dict.k1");
    expect(ps).toContain("groups.g1");
    expect(ps).toContain("fresh");
    expect(ps).toContain("dict.k2");
    expect(text("p")).toBe("one");
    expect(Array.from(document.querySelectorAll("li")).map((l) => l.textContent)).toEqual(["a", "b"]);
  });

  it("同じ drain の間に作られて剪定されたパターン（候補に 2 度載る）も 1 度だけ回収される", async () => {
    const e = setup(`<p>{{ n }}</p>`, {
      n: 0, dict: { k1: 1, k2: 2 }, cur: "k1",
      // cur を 2 度読む（評価の中の 2 度目の読み取りは記録し直さない）
      get view() { const s = this as any; return s["dict." + s.cur] + (s.cur ? 0 : 0); },
    });
    await flush();
    expect(e.proxy.view).toBe(1);
    e.proxy.cur = "k2";
    expect(e.proxy.view).toBe(2);
    expect(sources(e, "view")).toEqual(["cur", "dict.k2"]);
    await flush();
    expect(paths(e)).toEqual(["cur", "dict", "dict.k2", "n", "view"]);
  });

  it("投げた評価では剪定しない: 前に読んだキーは、評価が通るまで依存に残る", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const e = setup(`<p>{{ view }}</p>`, {
      dict: { k1: 1, k2: 2 }, cur: "k1", boom: false,
      get view() { const s = this as any; const v = s["dict." + s.cur]; if (s.boom) throw new Error("boom"); return v; },
    });
    await flush();
    expect(text()).toBe("1");
    e.proxy.boom = true;
    e.proxy.cur = "k2";
    await flush();
    expect(console.error).toHaveBeenCalled();
    expect(sources(e, "view")).toEqual(["boom", "cur", "dict.k1", "dict.k2"]);
    expect(paths(e)).toContain("dict.k1");
    e.proxy.boom = false;
    await flush();
    expect(text()).toBe("2");
    expect(sources(e, "view")).toEqual(["boom", "cur", "dict.k2"]);
    expect(paths(e)).not.toContain("dict.k1");
  });

  it("配列を持つ source は、今回読まなくても依存に残る（共有した要素への書き込みが getter の一覧に届く: F26）", async () => {
    const e = setup(`<p>{{ n }}</p>`, {
      n: 0, tab: "a", a: [1, 2], b: [3], label: "x",
      get evens() { return (this as any).a.filter((v: number) => v % 2 === 0); },
      get current() { const s = this as any; return s.tab === "a" ? [s.evens, s.label] : s.b; },
    });
    await flush();
    expect(e.proxy.current).toEqual([[2], "x"]);
    e.proxy.tab = "b";
    expect(e.proxy.current).toEqual([3]);
    // evens（配列を返す getter）は残り、label（配列でない）は外れる
    expect(sources(e, "current")).toEqual(["b", "evens", "tab"]);
  });

  it("getter の下のパス（getter が返したオブジェクトの中）は、読まなくなれば外れて回収される", async () => {
    const e = setup(`<p>{{ n }}</p>`, {
      n: 0, tab: "x",
      get obj() { return { name: "nm" }; },
      get view() { const s = this as any; return s.tab === "x" ? s["obj.name"] : 0; },
    });
    await flush();
    expect(e.proxy.view).toBe("nm");
    expect(sources(e, "view")).toEqual(["obj", "obj.name", "tab"]);
    e.proxy.tab = "y";
    expect(e.proxy.view).toBe(0);
    expect(sources(e, "view")).toEqual(["tab"]);
    await flush();
    expect(paths(e)).not.toContain("obj.name");
    expect(paths(e)).toContain("obj");
  });

  it("オブジェクトの数値のキー（users.<id>.name、添字のパスのアクセサ）も、読まなくなれば回収される", async () => {
    const e = setup(`<p>{{ view }}</p>`, {
      users: { 7: { name: "seven" }, 8: { name: "eight" } }, id: 7,
      get view() { const s = this as any; return s["users." + s.id + ".name"]; },
    });
    await flush();
    expect(text()).toBe("seven");
    e.proxy.id = 8;
    await flush();
    expect(text()).toBe("eight");
    expect(paths(e)).toEqual(["id", "users", "users.8", "users.8.name", "view"]);
    e.proxy["users.8.name"] = "EIGHT";
    await flush();
    expect(text()).toBe("EIGHT");
  });

  it("行の中の添字のパスのアクセサ（キャッシュの枠を持つ）は回収しない", async () => {
    const e = setup(`<ul><template data-wcs="for: groups"><li>{{ .label }}</li></template></ul>`, {
      sel: 1,
      groups: [{ byId: { 1: { name: "a1" }, 2: { name: "a2" } } }],
      get "groups.*.label"() { const s = this as any; return s["groups.*.byId." + s.sel + ".name"]; },
    });
    await flush();
    expect(text("li")).toBe("a1");
    e.proxy.sel = 2;
    await flush();
    expect(text("li")).toBe("a2");
    // 行の getter の source は行をまたぐ和集合のまま（剪定はルートの getter だけ）: 前のキーも残る
    expect(paths(e)).toContain("groups.*.byId.1.name");
    expect(paths(e)).toContain("groups.*.byId.2.name");
  });

  it("$eq の source は、動的なパスでも回収しない", async () => {
    const e = setup(`<p>{{ hit }}</p>`, {
      dict: { k1: 1, k2: 2 }, cur: "k1",
      get hit() { const s = this as any; return s.$eq("dict." + s.cur, 2); },
    });
    await flush();
    expect(text()).toBe("false");
    e.proxy.cur = "k2";
    await flush();
    expect(text()).toBe("true");
    expect(paths(e)).toContain("dict.k1");
    expect(paths(e)).toContain("dict.k2");
    e.proxy["dict.k2"] = 3;
    await flush();
    expect(text()).toBe("false");
  });
});

describe("parsePath の控え", () => {
  it("控えの上限を超えても、同じパスは同じ結果を返す", () => {
    const first = parsePath("cache.probe");
    expect(parsePath("cache.probe")).toBe(first);
    for (let i = 0; i < 5000; i++) expect(parsePath(`cache.k${i}`).pattern).toBe(`cache.k${i}`);
    const again = parsePath("cache.probe");
    expect(again).toEqual(first);
    expect(parsePath("cache.probe")).toBe(again);
  });
});
