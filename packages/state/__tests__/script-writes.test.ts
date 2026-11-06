import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, diagnostics, recursion, scopes, temporal } from "../src/index";

// docs/script-write-checks.md: what a getter, a setter or a method writes, said at run time

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([diagnostics, temporal, scopes, recursion]);
  bootstrapState();
});

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`script-writes-${seq++}`);
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
async function warnings(run: () => Promise<unknown> | unknown): Promise<string[]> {
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

/** Types `value` into `input` (a two-way binding writes it back). */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("getter の中の書き込み（wcs/getter-write）", () => {
  it("書いたパスと評価中の getter を名指して throw する（代入・$update・$setAll とも）", async () => {
    const { el } = await page(`<p>{{ count }}</p>`, {
      count: 0,
      items: [{ v: 1 }],
      get total() { this.count++; return 1; },
      get viaUpdate() { this.$update("items.*.v", [0], (v: number) => v + 1); return 1; },
      get viaSetAll() { this.$setAll("items.*.v", [], 0); return 1; },
    });
    expect(() => el.createState("writable", (s: any) => s.total)).toThrow(
      '[@wcstack/state] [wcs/getter-write] "count" is written while the getter "total" is evaluated: a getter only reads.',
    );
    expect(() => el.createState("writable", (s: any) => s.viaUpdate)).toThrow('"items.*.v" is written while the getter "viaUpdate" is evaluated');
    expect(() => el.createState("writable", (s: any) => s.viaSetAll)).toThrow('"items.*.v" is written while the getter "viaSetAll" is evaluated');
  });

  it("lint で検出できる code なので lint の案内が付く。getter が呼ぶメソッドの書き込みも、その getter を名指す", async () => {
    const { el } = await page(`<p>{{ count }}</p>`, {
      count: 0,
      bump() { this.count = 1; },
      get total() { this.bump(); return 1; },
    });
    expect(() => el.createState("writable", (s: any) => s.total)).toThrow(
      /"count" is written while the getter "total" is evaluated.* Validate statically: npx @wcstack\/lint <file>\.$/,
    );
  });

  it("readonly のコールバックの書き込みは、パスを名指して readonly と言う（getter ではない）", async () => {
    const { el } = await page(`<p>{{ count }}</p>`, { count: 0 });
    expect(() => el.createState("readonly", (s: any) => { s.count = 1; })).toThrow('[@wcstack/state] cannot write "count": this state is readonly.');
  });
});

describe("setter の無い getter への書き込み（wcs/path-readonly）", () => {
  it("スクリプトからの書き込みは lint と同じ code と直し方を添えて throw する", async () => {
    const { el } = await page(`<p>{{ total }}</p>`, { a: 1, get total() { return this.a * 2; } });
    expect(() => el.createState("writable", (s: any) => { s.total = 5; })).toThrow(
      '[@wcstack/state] [wcs/path-readonly] "total" is a getter without a setter Add a setter (set "total"(v) { … }) or write what the getter reads; bind a two-way binding one way with #ro. Validate statically: npx @wcstack/lint <file>.',
    );
  });
});

describe("書き合う setter（wcs/setter-cycle）", () => {
  it("自分のパスに書く setter を、スタックが溢れる前に名指して throw する", async () => {
    const { el } = await page(`<p>{{ count }}</p>`, {
      _count: 0,
      get count() { return this._count; },
      set count(v: number) { this.count = v; },
    });
    expect(() => el.createState("writable", (s: any) => { s.count = 1; })).toThrow(
      '[@wcstack/state] [wcs/setter-cycle] setters write each other without end: "count" -> "count". Writing a setter\'s own path calls it again',
    );
  });

  it("互いに書く setter は循環を名指す。throw の後も setter は普通に動く", async () => {
    const { el } = await page(`<p>{{ a }}|{{ b }}|{{ c }}</p>`, {
      x: 0,
      get a() { return this.x; },
      set a(v: number) { this.b = v; },
      get b() { return this.x; },
      set b(v: number) { this.a = v; },
      get c() { return this.x; },
      set c(v: number) { this.x = v; },
    });
    expect(() => el.createState("writable", (s: any) => { s.a = 1; })).toThrow('"a" -> "b" -> "a"');
    el.createState("writable", (s: any) => { s.c = 7; });
    await flush();
    let x = 0;
    el.createState("readonly", (s: any) => { x = s.x; });
    expect(x).toBe(7);
  });

  it("条件で止まる setter の入れ子は上限（64 段）より浅ければ黙って動く", async () => {
    const { el } = await page(`<p>{{ n }}</p>`, {
      store: 0,
      get n() { return this.store; },
      set n(v: number) { if (v > 0) this.n = v - 1; else this.store = 99; },
    });
    el.createState("writable", (s: any) => { s.n = 62; });
    let got = 0;
    el.createState("readonly", (s: any) => { got = s.store; });
    expect(got).toBe(99);
  });
});

describe("getter が読まないものを書く setter（wcs/setter-unobserved）", () => {
  it("双方向の入力が書き戻すと、setter ごとに 1 回、書いたパスを名指して警告する", async () => {
    const { root } = await page(`<input data-wcs="value: celsius"><p>{{ celsius }}</p>`, {
      f: 32,
      c: 0,
      get celsius() { return Math.round(((this.f - 32) * 5) / 9); },
      set celsius(v: number) { this.c = Number(v); },
    });
    const input = root.querySelector("input")!;
    const got = await warnings(async () => {
      type(input, "10");
      await flush();
      type(input, "20");
      await flush();
    });
    expect(got).toEqual([
      '[@wcstack/state] [wcs/setter-unobserved] the setter of "celsius" wrote "c", which its getter does not read: "celsius" keeps its value, and a two-way input goes back to it. Write what the getter reads. Validate statically: npx @wcstack/lint <file>.',
    ]);
  });

  it("getter が読むもの・その下・その上・getter を通して読むものを書く setter には黙る", async () => {
    const { el } = await page(`<p>{{ celsius }}|{{ name }}|{{ first }}|{{ label }}</p>`, {
      f: 32,
      user: { name: "a" },
      names: { first: "x" },
      base: 1,
      get celsius() { return ((this.f - 32) * 5) / 9; },
      set celsius(v: number) { this.f = (v * 9) / 5 + 32; },
      get name() { return this.user.name; },
      set name(v: string) { this["user.name"] = v; },
      get first() { return this["names.first"]; },
      set first(v: string) { this.names = { first: v }; },
      get doubled() { return this.base * 2; },
      get label() { return `#${this.doubled}`; },
      set label(v: string) { this.base = Number(v); },
    });
    const got = await warnings(async () => {
      el.createState("writable", (s: any) => {
        s.celsius = 100;
        s.name = "b";
        s.first = "y";
        s.label = "3";
      });
      await flush();
    });
    expect(got).toEqual([]);
  });

  it("何も書かない setter（値を捨てる）・getter の無い setter・まだ読まれていない getter には黙る", async () => {
    const { el } = await page(`<p>{{ saved }}</p>`, {
      store: 1,
      log: [] as number[],
      get saved() { return this.store; },
      set saved(v: number | null) { if (v != null) this.store = v; },
      set sink(v: number) { this.log = [...this.log, v]; },
      get unread() { return this.store; },
      set unread(v: number) { this.log = [v]; },
    });
    const got = await warnings(async () => {
      el.createState("writable", (s: any) => {
        s.saved = null;
        s.sink = 1;
        s.unread = 2;
      });
      await flush();
    });
    expect(got).toEqual([]);
  });

  it("setter が呼ぶ setter の書き込みは外側の setter のもの。その中の $postUpdate も書き込みに数える", async () => {
    const { el } = await page(`<p>{{ outer }}|{{ inner }}</p>`, {
      x: 0,
      y: 0,
      get outer() { return this.x; },
      set outer(v: number) { this.inner = v; },
      get inner() { return this.y; },
      set inner(v: number) { this.x = v; this.$postUpdate("outer"); },
    });
    const got = await warnings(async () => {
      el.createState("writable", (s: any) => { s.outer = 5; });
      await flush();
    });
    // inner's setter wrote x, which inner does not read; outer's reached x through it
    expect(got).toHaveLength(1);
    expect(got[0]).toContain('the setter of "inner" wrote "x", "outer"');
  });

  it("添字のパスの書き戻し（エンジン自身の setter）は setter の呼び出しに数えない", async () => {
    const { root, el } = await page(`<input data-wcs="value: items.0.v"><i>{{ items.0.v }}</i>`, { items: [{ v: "a" }] });
    const got = await warnings(async () => {
      type(root.querySelector("input")!, "b");
      await flush();
    });
    expect(got).toEqual([]);
    let v = "";
    el.createState("readonly", (s: any) => { v = s["items.0.v"]; });
    expect(v).toBe("b");
  });
});
