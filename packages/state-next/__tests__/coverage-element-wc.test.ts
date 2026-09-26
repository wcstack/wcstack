/**
 * coverage-element-wc.test.ts — wiring to wc-bindable custom elements (src/dom/wc.ts):
 * declaration reading, late definition, echo suppression, input/output filters, initial
 * authority (`#init=` / `#sync=`), command / event tokens, spread and the attribute mirror.
 * The core alone (no diagnostics add-on): errors read as numbered messages.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady } from "../src/index";
import { isCustomTag } from "../src/dom/wc";
import { M } from "../src/messages";

// the core's own message (no diagnostics add-on here): [@wcstack/state] [wcs/<code>] #<number> <values>
const core = (id: M) => new RegExp(String.raw`^\[@wcstack/state\] (\[wcs/[\w-]+\] )?#${id}( |$)`);

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;
const nextTag = (): string => `cov-wc-${seq++}`;

beforeAll(() => {
  bootstrapState();
});

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`cov-wc-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
  };
  const read = (path: string): unknown => {
    let v: unknown;
    el.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  return { h, root, el, write, read };
}

/** The message the page's initialization fails with. */
async function failure(html: string, state: Record<string, any>): Promise<string> {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await page(html, state);
    return "(no error)";
  } catch (e) {
    return (e as Error).message;
  } finally {
    error.mockRestore();
  }
}

/** A two-way member `value` (declared in properties and inputs). */
function defineTwoWay(tag: string, initial: unknown = "own"): void {
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable", version: 1,
      properties: [{ name: "value", event: `${tag}:change` }],
      inputs: [{ name: "value" }],
    };
    value: unknown = initial;
  });
}

/** An output-only member `status` (declared in properties only). */
function defineOutput(tag: string, initial: unknown = "own"): void {
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
    status: unknown = initial;
  });
}

/** An element with `go` / `stop` commands that records the calls. */
function defineCommands(tag: string): void {
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [], commands: [{ name: "go" }, { name: "stop" }] };
    got: unknown[] = [];
    go(n: number): number {
      this.got.push(n);
      return n * 2;
    }
    stop(): void {
      this.got.push("stop");
    }
  });
}

describe("wc-bindable の宣言の読み取り", () => {
  it("properties の無い宣言は入力だけのメンバーとして扱い、状態の値を要素（と属性）に書く", async () => {
    const tag = nextTag();
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, inputs: [{ name: "label", attribute: "label" }] };
      label: unknown = "own";
    });
    const { root, write } = await page(`<${tag} data-wcs="label: title"></${tag}>`, { title: "hello" });
    const c = root.querySelector(tag) as any;
    expect(c.label).toBe("hello");
    expect(c.getAttribute("label")).toBe("hello");
    await write((s) => { s.title = "bye"; });
    expect(c.label).toBe("bye");
    expect(c.getAttribute("label")).toBe("bye");
  });

  it("commands の要素のうち name が文字列のものだけがコマンドになる（null・文字列・数値の name は無視）", async () => {
    const tag = nextTag();
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [], commands: [null, "go", { name: 1 }, { name: "run" }] };
      got: unknown[] = [];
      run(...args: unknown[]): string {
        this.got.push(args);
        return "ran";
      }
      go(): void {
        this.got.push("go");
      }
    });
    const { root, el } = await page(`<${tag} data-wcs="command.run: $command.t"></${tag}>`, { $commandTokens: ["t"] });
    let results: unknown;
    el.createState("writable", (s: any) => { results = s.$command.t.emit(1, 2); });
    expect(results).toEqual(["ran"]);
    expect((root.querySelector(tag) as any).got).toEqual([[1, 2]]);
    // "go" is a method of the class but a bare string in commands: not a declared command
    const message = await failure(`<${tag} data-wcs="command.go: $command.t"></${tag}>`, { $commandTokens: ["t"] });
    expect(message).toMatch(core(M.NoCommand));
    expect(message).toBe(`[@wcstack/state] [wcs/token-misconfigured] #1203 "${tag}" "go"`);
  });

  it("isCustomTag はタグ名にハイフンを含む要素だけを真とする", () => {
    expect(isCustomTag(document.createElement("x-foo"))).toBe(true);
    expect(isCustomTag(document.createElement("div"))).toBe(false);
  });
});

describe("後から定義される要素", () => {
  it("マウント時に未定義の要素は触らず、定義された時点で配線して初期同期する（以後は双方向）", async () => {
    const tag = nextTag();
    const { root, read } = await page(`<${tag} data-wcs="value: v"></${tag}><p>{{ v }}</p>`, { v: "state" });
    const c = root.querySelector(tag) as any;
    expect(c.value).toBeUndefined();
    defineTwoWay(tag);
    await flush();
    expect(c.value).toBe("state");
    c.dispatchEvent(new CustomEvent(`${tag}:change`, { detail: "typed" }));
    await flush();
    expect(read("v")).toBe("typed");
    expect(root.querySelector("p")!.textContent).toBe("typed");
  });

  it("定義を待つ間にブロックが消えた要素は、定義されても配線しない（生きているブロックの要素だけが同期する）", async () => {
    const tag = nextTag();
    const html = `<template data-wcs="if: show"><${tag} data-wcs="status: st"></${tag}></template>`;
    const gone = await page(html, { show: true, st: "seed" });
    const live = await page(html, { show: true, st: "seed" });
    const orphan = gone.root.querySelector(tag) as any;
    await gone.write((s) => { s.show = false; });
    expect(gone.root.querySelector(tag)).toBeNull();
    defineOutput(tag, "element");
    await flush();
    // the orphan's block went away: it is neither upgraded nor read
    expect(orphan.status).toBeUndefined();
    expect(gone.read("st")).toBe("seed");
    // an output-only member of a live block seeds state from the element
    expect(live.read("st")).toBe("element");
  });
});

describe("要素 → 状態の書き戻し", () => {
  it("状態の書き込みで要素が同期的に返すイベント（同じ値）は書き戻さず、正規化して返した値は書き戻す", async () => {
    const tag = nextTag();
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = {
        protocol: "wc-bindable", version: 1,
        properties: [{ name: "value", event: `${tag}:change` }],
        inputs: [{ name: "value" }],
      };
      private v: unknown = 0;
      get value(): unknown {
        return this.v;
      }
      // the element announces every change, its own clamping included (at most 10)
      set value(x: unknown) {
        this.v = Math.min(Number(x), 10);
        this.dispatchEvent(new CustomEvent(`${tag}:change`, { detail: this.v }));
      }
    });
    const writes: unknown[] = [];
    const { root, write, read } = await page(`<${tag} data-wcs="value: v"></${tag}>`, {
      raw: 1,
      get v() { return (this as any).raw; },
      set v(x: unknown) { writes.push(x); (this as any).raw = x; },
    });
    const c = root.querySelector(tag) as any;
    expect(c.value).toBe(1);
    expect(writes).toEqual([]);
    await write((s) => { s.v = 5; });
    expect(c.value).toBe(5);
    expect(writes).toEqual([5]);
    await write((s) => { s.v = 50; });
    expect(writes).toEqual([5, 50, 10]);
    expect(read("v")).toBe(10);
    expect(c.value).toBe(10);
  });

  it("入力フィルタ（value|int）は要素の値を変換してから状態に書く", async () => {
    const tag = nextTag();
    defineTwoWay(tag, "0");
    const { root, read } = await page(`<${tag} data-wcs="value|int: n"></${tag}>`, { n: 1 });
    root.querySelector(tag)!.dispatchEvent(new CustomEvent(`${tag}:change`, { detail: "7" }));
    await flush();
    expect(read("n")).toBe(7);
  });

  it("出力フィルタのあるバインディングは、要素から来た値を状態に書き、要素には出力フィルタを通した値が返る", async () => {
    const tag = nextTag();
    defineTwoWay(tag, 0);
    const { root, read } = await page(`<${tag} data-wcs="value: n|mul(2)"></${tag}>`, { n: 1 });
    const c = root.querySelector(tag) as any;
    expect(c.value).toBe(2);
    c.value = 3;
    c.dispatchEvent(new CustomEvent(`${tag}:change`, { detail: 3 }));
    await flush();
    expect(read("n")).toBe(3);
    expect(c.value).toBe(6);
  });

  it("#ro の付いたバインディングは要素のイベントを状態に書かない", async () => {
    const tag = nextTag();
    defineTwoWay(tag);
    const { root, read } = await page(`<${tag} data-wcs="value#ro: v"></${tag}>`, { v: "state" });
    const c = root.querySelector(tag) as any;
    expect(c.value).toBe("state");
    c.dispatchEvent(new CustomEvent(`${tag}:change`, { detail: "typed" }));
    await flush();
    expect(read("v")).toBe("state");
  });
});

describe("初期同期の権限（#init= / #sync=）", () => {
  it("init=auto は状態に値があれば状態が勝ち、undefined なら要素の値で状態を埋める", async () => {
    const tag = nextTag();
    defineTwoWay(tag, "element");
    const { root, read } = await page(
      `<${tag} class="filled" data-wcs="value#init=auto: filled"></${tag}><${tag} class="empty" data-wcs="value#init=auto: empty"></${tag}>`,
      { filled: "state", empty: undefined },
    );
    expect((root.querySelector(".filled") as any).value).toBe("state");
    expect(read("filled")).toBe("state");
    expect((root.querySelector(".empty") as any).value).toBe("element");
    expect(read("empty")).toBe("element");
  });

  it("出力専用メンバーは状態から書かれず、要素 → 状態は流れる", async () => {
    const tag = nextTag();
    defineOutput(tag, "element");
    const { root, read, write } = await page(`<${tag} data-wcs="status: st"></${tag}>`, { st: "state" });
    const c = root.querySelector(tag) as any;
    expect(read("st")).toBe("element");
    await write((s) => { s.st = "changed"; });
    expect(c.status).toBe("element");
    c.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: "emitted" }));
    await flush();
    expect(read("st")).toBe("emitted");
  });

  describe("3.3 と同じく、誤った #init= / #sync= と宣言に無いメンバーは初期化を失敗させる", () => {
    const out = nextTag();
    const both = nextTag();
    const input = nextTag();
    beforeAll(() => {
      defineOutput(out);
      defineTwoWay(both);
      customElements.define(input, class extends HTMLElement {
        static wcBindable = { protocol: "wc-bindable", version: 1, inputs: [{ name: "label" }] };
        label: unknown = "own";
      });
    });
    it.each<[string, M, string]>([
      [`<${out} data-wcs="status#init=auto: st"></${out}>`, M.InitIncompatible, '"auto" "status"'],
      [`<${out} data-wcs="status#init=state: st"></${out}>`, M.InitIncompatible, '"state" "status"'],
      [`<${input} data-wcs="label#init=element: st"></${input}>`, M.InitIncompatible, '"element" "label"'],
      [`<${input} data-wcs="label#init=auto: st"></${input}>`, M.InitIncompatible, '"auto" "label"'],
      [`<${input} data-wcs="label#sync=connect: st"></${input}>`, M.SyncConnectNeedsOutput, '"label"'],
      [`<${both} data-wcs="title: st"></${both}>`, M.MemberUndeclared, '"title"'],
      [`<button data-wcs="onclick#init=state: go"></button>`, M.EventInitNone, ""],
      [`<input data-wcs="value#foo=1: st">`, M.ModifierUnknown, '"foo" "foo=1"'],
      [`<input data-wcs="value#init=none,init=state: st">`, M.ModifierTwice, '"init"'],
      [`<input data-wcs="value#init=later: st">`, M.ModifierValue, '"init" "later"'],
      [`<input data-wcs="value#sync=later: st">`, M.ModifierValue, '"sync" "later"'],
      [`<input type="radio" value="a" data-wcs="radio#init=element: st">`, M.InitUnsupported, '"radio" "element"'],
      [`<input type="checkbox" value="a" data-wcs="checkbox#init=auto: arr">`, M.InitUnsupported, '"checkbox" "auto"'],
    ])("%s", async (html, id, values) => {
      const message = await failure(html, { st: "x", arr: [], go() {} });
      expect(message).toMatch(core(id));
      expect(message.replace(core(id), "")).toBe(values);
    });

    it("許される組み合わせは通る（両方向のメンバーの init=auto、イベントの init=none、ネイティブ要素の init=none）", async () => {
      const { root } = await page(
        `<${both} data-wcs="value#init=auto: st"></${both}><button data-wcs="onclick#init=none: go"></button><input data-wcs="value#init=none,sync=call: st">`,
        { st: "x", go() {} },
      );
      expect((root.querySelector(both) as any).value).toBe("x");
    });
  });

  it("init=none は初期同期をせず、次の変化から流れる", async () => {
    const tag = nextTag();
    defineTwoWay(tag, "element");
    const { root, read, write } = await page(`<${tag} data-wcs="value#init=none: n"></${tag}>`, { n: 1 });
    const c = root.querySelector(tag) as any;
    expect(c.value).toBe("element");
    expect(read("n")).toBe(1);
    await write((s) => { s.n = 2; });
    expect(c.value).toBe(2);
  });

  it("init=element に出力フィルタがあると、要素の値で状態を埋めたあと要素にはフィルタを通した値が返る", async () => {
    const tag = nextTag();
    defineTwoWay(tag, 4);
    const { root, read } = await page(`<${tag} data-wcs="value#init=element: n|mul(2)"></${tag}><p>{{ n }}</p>`, { n: 1 });
    expect(read("n")).toBe(4);
    expect(root.querySelector("p")!.textContent).toBe("4");
    expect((root.querySelector(tag) as any).value).toBe(8);
  });

  /** A two-way `value` that the element replaces with its persisted value when it connects. */
  function defineLoader(tag: string): void {
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = {
        protocol: "wc-bindable", version: 1,
        properties: [{ name: "value", event: `${tag}:change` }],
        inputs: [{ name: "value" }],
      };
      reads = 0;
      private v: unknown = "initial";
      get value(): unknown {
        this.reads++;
        return this.v;
      }
      set value(x: unknown) {
        this.v = x;
      }
      connectedCallback(): void {
        if (this.v === "initial") this.v = "persisted";
      }
    });
  }

  it("sync=connect は接続済みの要素ならその場で読み、行の中の要素は接続後の値を読む（sync=call は接続前の値）", async () => {
    const tag = nextTag();
    defineLoader(tag);
    const { read } = await page(
      `<${tag} data-wcs="value#init=element,sync=connect: top"></${tag}>`
      + `<template data-wcs="for: rows"><${tag} data-wcs="value#init=element,sync=connect: .connect; value#init=element: .call"></${tag}></template>`,
      { top: null, rows: [{ connect: null, call: null }] },
    );
    await flush();
    expect(read("top")).toBe("persisted");
    expect(read("rows.0.connect")).toBe("persisted");
    expect(read("rows.0.call")).toBe("initial");
  });

  it("sync=connect の読み取りを待つ間に行が消えたら、要素を読まない", async () => {
    const tag = nextTag();
    defineLoader(tag);
    const { root, el, read } = await page(
      `<template data-wcs="for: rows"><${tag} data-wcs="value#init=element,sync=connect: .snap"></${tag}></template>`,
      { rows: [] },
    );
    // a re-set applies synchronously: the row is built, then removed, before the deferred read runs
    el.setInitialState({ rows: [{ snap: null }] });
    const c = root.querySelector(tag) as any;
    expect(c).not.toBeNull();
    el.setInitialState({ rows: [] });
    expect(root.querySelector(tag)).toBeNull();
    await flush();
    expect(c.reads).toBe(0);
    expect(read("rows")).toEqual([]);
  });
});

describe("コマンドトークン（command.<method>:）", () => {
  it("wcBindable の無い要素への command. は wcs/token-misconfigured で初期化に失敗する", async () => {
    const tag = nextTag();
    customElements.define(tag, class extends HTMLElement {});
    const message = await failure(`<${tag} data-wcs="command.go: $command.t"></${tag}>`, { $commandTokens: ["t"] });
    expect(message).toMatch(core(M.NoBindable));
    expect(message).toBe(`[@wcstack/state] [wcs/token-misconfigured] #1202 "${tag}" "command.go"`);
  });

  it("要素が文書から外れた後の emit は要素を呼ばず、その購読を外す", async () => {
    const tag = nextTag();
    defineCommands(tag);
    const { root, el } = await page(`<${tag} data-wcs="command.go: $command.t"></${tag}>`, { $commandTokens: ["t"] });
    const c = root.querySelector(tag) as any;
    const emit = (n: number): unknown => {
      let r: unknown;
      el.createState("writable", (s: any) => { r = s.$command.t.emit(n); });
      return r;
    };
    const size = (): number => {
      let n = -1;
      el.createState("readonly", (s: any) => { n = s.$command.t.size; });
      return n;
    };
    expect(emit(1)).toEqual([2]);
    c.remove();
    expect(size()).toBe(1);
    expect(emit(2)).toEqual([undefined]);
    expect(c.got).toEqual([1]);
    expect(size()).toBe(0);
    expect(emit(3)).toEqual([]);
  });

  it("行の中のコマンドは行ごとに購読し、行が消えるとその場で購読を外す（1 要素に複数のコマンド）", async () => {
    const tag = nextTag();
    defineCommands(tag);
    const { root, el, write } = await page(
      `<template data-wcs="for: items"><${tag} data-wcs="command.go: $command.t; command.stop: $command.u"></${tag}></template>`,
      { $commandTokens: ["t", "u"], items: [1, 2] },
    );
    const size = (name: string): number => {
      let n = -1;
      el.createState("readonly", (s: any) => { n = s.$command[name].size; });
      return n;
    };
    expect([size("t"), size("u")]).toEqual([2, 2]);
    el.createState("writable", (s: any) => { s.$command.u.emit(); });
    expect(Array.from(root.querySelectorAll(tag)).map((c: any) => c.got)).toEqual([["stop"], ["stop"]]);
    await write((s) => { s.items = [1]; });
    expect(root.querySelectorAll(tag)).toHaveLength(1);
    expect([size("t"), size("u")]).toEqual([1, 1]);
  });
});

describe("イベントトークン（eventToken.<property>:）", () => {
  /** Emits `created` (an output-only property) with a cancelable, bubbling event. */
  function defineNotifier(tag: string): void {
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "created", event: `${tag}:created` }] };
      created: unknown = null;
      fire(detail: unknown): CustomEvent {
        const e = new CustomEvent(`${tag}:created`, { detail, bubbles: true, cancelable: true });
        this.dispatchEvent(e);
        return e;
      }
    });
  }

  it("wcBindable の無い要素・宣言に無いプロパティへの eventToken. は初期化に失敗する", async () => {
    const plain = nextTag();
    customElements.define(plain, class extends HTMLElement {});
    const noBindable = await failure(`<${plain} data-wcs="eventToken.value: made"></${plain}>`, { $eventTokens: ["made"] });
    expect(noBindable).toBe(`[@wcstack/state] [wcs/token-misconfigured] #1202 "${plain}" "eventToken.value"`);
    const tag = nextTag();
    defineNotifier(tag);
    const noProperty = await failure(`<${tag} data-wcs="eventToken.nope: made"></${tag}>`, { $eventTokens: ["made"] });
    expect(noProperty).toMatch(core(M.NoProperty));
    expect(noProperty).toBe(`[@wcstack/state] [wcs/token-misconfigured] #1204 "${tag}" "nope"`);
  });

  it("#prevent・#stop はトークンを発火する前にイベントの既定動作と伝播を止める", async () => {
    const tag = nextTag();
    defineNotifier(tag);
    const got: unknown[] = [];
    const { root } = await page(
      `<div class="a"><${tag} data-wcs="eventToken.created#prevent,stop: made"></${tag}></div>`
      + `<div class="b"><${tag} data-wcs="eventToken.created: made"></${tag}></div>`,
      { $eventTokens: ["made"], $on: { made(_s: unknown, e: CustomEvent) { got.push(e.detail); } } },
    );
    const outer: string[] = [];
    for (const cls of ["a", "b"]) root.querySelector(`.${cls}`)!.addEventListener(`${tag}:created`, () => outer.push(cls));
    const stopped = (root.querySelector(`.a ${tag}`) as any).fire("x");
    const passed = (root.querySelector(`.b ${tag}`) as any).fire("y");
    expect(got).toEqual(["x", "y"]);
    expect(stopped.defaultPrevented).toBe(true);
    expect(passed.defaultPrevented).toBe(false);
    expect(outer).toEqual(["b"]);
  });

  it("宣言されていないトークン名は発火の時点で console.error に報告し、イベントの送り手には投げない", async () => {
    const tag = nextTag();
    defineNotifier(tag);
    const { root } = await page(`<${tag} data-wcs="eventToken.created: nosuch"></${tag}>`, { $eventTokens: ["made"] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => (root.querySelector(tag) as any).fire("x")).not.toThrow();
      expect(error).toHaveBeenCalledTimes(1);
      const reported = error.mock.calls[0][0] as Error;
      expect(reported.message).toMatch(core(M.EventTokenUndeclared));
      expect(reported.message).toBe('[@wcstack/state] [wcs/token-undeclared] #1301 "nosuch"');
    } finally {
      error.mockRestore();
    }
  });
});

describe("スプレッド（...:）", () => {
  /** A fetch-like element: two outputs, one input. */
  function defineFetch(tag: string): void {
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = {
        protocol: "wc-bindable", version: 1,
        properties: [{ name: "value", event: `${tag}:value` }, { name: "loading", event: `${tag}:loading` }],
        inputs: [{ name: "url" }],
      };
      value: unknown = null;
      loading = false;
      url = "";
      load(): void {
        this.value = `data from ${this.url}`;
        this.dispatchEvent(new CustomEvent(`${tag}:value`, { detail: this.value }));
      }
    });
  }

  it("wcBindable の無い要素へのスプレッドは wcs/spread-no-bindable で初期化に失敗する", async () => {
    const tag = nextTag();
    customElements.define(tag, class extends HTMLElement {});
    const message = await failure(`<${tag} data-wcs="...: obj"></${tag}>`, { obj: {} });
    expect(message).toMatch(core(M.SpreadNoBindable));
    expect(message).toBe(`[@wcstack/state] [wcs/spread-no-bindable] #1501 "${tag}" ${JSON.stringify('"...: obj"')}`);
  });

  it("for の中の `...: .` は行ごとにその行のオブジェクトへ展開する", async () => {
    const tag = nextTag();
    defineFetch(tag);
    const { root, read } = await page(`<template data-wcs="for: fetches"><${tag} data-wcs="...: ."></${tag}></template>`, {
      fetches: [{ url: "/a", value: null, loading: false }, { url: "/b", value: null, loading: false }],
    });
    const cs = Array.from(root.querySelectorAll(tag)) as any[];
    expect(cs.map((c) => c.url)).toEqual(["/a", "/b"]);
    cs[1].load();
    await flush();
    expect(read("fetches.1.value")).toBe("data from /b");
    expect(read("fetches.0.value")).toBeNull();
  });
});

describe("入力の属性ミラー", () => {
  it("JSON にできないオブジェクト（循環参照）は String(value) で属性に写す", async () => {
    const tag = nextTag();
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [], inputs: [{ name: "data", attribute: "data" }] };
      data: unknown = null;
    });
    const payload: Record<string, unknown> = { id: 1 };
    payload.self = payload;
    const { root, write } = await page(`<${tag} data-wcs="data: payload"></${tag}>`, { payload });
    const c = root.querySelector(tag) as any;
    expect(c.data).toBe(payload);
    expect(c.getAttribute("data")).toBe("[object Object]");
    await write((s) => { s.payload = { id: 2 }; });
    expect(c.getAttribute("data")).toBe('{"id":2}');
  });
});
