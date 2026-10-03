/**
 * issues-misc.test.ts — 現行 @wcstack/state 3.3 の Issue #352 / #353 / #354 / #357 / #367 / #368
 * （コンポーネント・要素の定義の時機・スコープ付き registry・更新のループ・$watch の上限）を state-next で流す。
 * 各 Issue の「期待」を確かめる（state-next でも起きていて、まだ直していないものは it.fails で残す）。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes]);
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`tmp-misc-page-${seq++}`);
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
  return { root, el, write, read };
}

/** A component whose `<wcs-state bind-component="state">` sits in its shadow root. */
function component(markup: string, state: () => Record<string, any>): string {
  const tag = `tmp-misc-cmp-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    state = state();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${markup}`;
    }
  });
  return tag;
}

const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);
const messagesOf = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((x) => x.map((a) => String((a as Error)?.message ?? a)).join(" "));
/** Observations printed for the report (vitest shows them under the test). */
const note = (label: string, o: unknown) => console.log(`[obs] ${label}: ${JSON.stringify(o)}`);

// ---------------------------------------------------------------- #352

describe("#352 未定義の要素への束縛の定義待ちの間に、要素を DOM から外して戻しても、定義の後に値が入る", () => {
  /** x-late: 入力 name を受けて hello <name> と表示し、出力 status を持つ wc-bindable の要素。 */
  const defineLate = (tag: string) => customElements.define(tag, class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }], inputs: [{ name: "name" }] };
    n: unknown;
    set name(v: unknown) { this.n = v; this.textContent = `hello ${v}`; }
    get name(): unknown { return this.n; }
    get status(): string { return "ok"; }
  });

  const forms: [string, string, string][] = [
    ["spread（行 ...: . / ルート ...: one）", "...: .", "...: one"],
    ["プロパティの束縛（行 name: .name / ルート name: one.name）", "name: .name", "name: one.name"],
  ];
  const moves = ["外さない（対照）", "ul と div をいったん外して戻す", "要素そのものをいったん外して戻す"] as const;
  const cases = forms.flatMap(([f, rowB, rootB]) => moves.map((m) => [`${f} / ${m}`, rowB, rootB, m] as const));

  it.each(cases)("%s", async (name, rowB, rootB, move) => {
    const tag = `tmp-late-${seq++}`;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { root, write } = await page(
        `<ul id="late"><template data-wcs="for: late"><li><${tag} data-wcs="${rowB}"></${tag}></li></template></ul>`
        + `<div id="rootlate"><${tag} data-wcs="${rootB}"></${tag}></div>`,
        { late: [{ name: "a" }, { name: "b" }], one: { name: "z" } },
      );
      const rows = () => texts(root, `#late ${tag}`);
      const rootText = () => texts(root, `#rootlate ${tag}`);
      const obs: Record<string, unknown> = { loaded: [rows(), rootText()] };
      expect(rows()).toEqual(["", ""]);
      expect(rootText()).toEqual([""]);
      if (move === "ul と div をいったん外して戻す") {
        const park = document.createElement("div"); // not in the document: the nodes are disconnected
        const ul = root.querySelector("#late")!;
        const div = root.querySelector("#rootlate")!;
        park.append(ul, div);
        expect(ul.isConnected).toBe(false);
        await sleep(20);
        root.append(ul, div);
      } else if (move === "要素そのものをいったん外して戻す") {
        const park = document.createElement("div");
        const els = Array.from(root.querySelectorAll(tag));
        const places = els.map((e) => [e.parentNode!, e.nextSibling] as const);
        park.append(...els);
        expect(els.every((e) => !e.isConnected)).toBe(true);
        await sleep(20);
        els.forEach((e, i) => places[i][0].insertBefore(e, places[i][1]));
      }
      await sleep(20);
      defineLate(tag);
      await flush();
      await flush();
      obs.defined = [rows(), rootText()];
      await write((s) => { s["late.0.name"] = "A"; s["one.name"] = "Z"; });
      obs.written = [rows(), rootText()];
      await write((s) => { s.late = [...s.late, { name: "new" }]; });
      obs.added = [rows(), rootText()];
      const added = root.querySelectorAll(`#late ${tag}`)[2] as any;
      // happy-dom: a row cloned from a plan fragment made before the definition is not upgraded by
      // cloneNode / customElements.upgrade (a no-op there); it is upgraded only on insertion, after
      // the binding has set `name` as an own property of the plain element
      obs.addedRowElement = { upgraded: added.constructor !== HTMLElement, ownName: Object.prototype.hasOwnProperty.call(added, "name"), name: added.name };
      note(name, { ...obs, errors: messagesOf(error), warns: messagesOf(warn) });
      expect(obs.defined).toEqual([["hello a", "hello b"], ["hello z"]]);
      expect(obs.written).toEqual([["hello A", "hello b"], ["hello Z"]]);
      // the row added after the definition: "hello new" in a browser; in happy-dom the element's own
      // `name` property (set before its upgrade) hides the class setter (see the test below), so
      // the check is that the binding delivered the value to the element
      expect((obs.added as string[][])[0].slice(0, 2)).toEqual(["hello A", "hello b"]);
      expect((obs.added as string[][])[1]).toEqual(["hello Z"]);
      expect(added.name).toBe("new");
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it("（参考・happy-dom の癖）定義前に importNode した要素を、定義の後に cloneNode しても、文書に入るまでアップグレードされない", () => {
    const tag = `tmp-clone-${seq++}`;
    const t = document.createElement("template");
    t.innerHTML = `<${tag}></${tag}>`;
    const frag = document.importNode(t.content, true);
    class Cls extends HTMLElement {}
    customElements.define(tag, Cls);
    const clone = frag.cloneNode(true) as DocumentFragment;
    const el = clone.firstChild as Element;
    customElements.upgrade(el);
    const beforeInsert = el instanceof Cls;
    document.body.appendChild(clone);
    const afterInsert = el instanceof Cls;
    el.remove();
    note("#352 happy-dom clone", { beforeInsert, afterInsert });
    // a browser upgrades the clone when cloneNode returns (DOM "clone a node" enqueues the upgrade)
    expect(beforeInsert).toBe(false);
    expect(afterInsert).toBe(true);
  });
});

// ---------------------------------------------------------------- #353

/**
 * The runaway guard of the issue's reproductions: `tick()` throws once it is called more than
 * `cap` times, and records how many macrotasks ran by then (0 = the loop never yielded).
 */
function runaway(cap = 5000) {
  const p = { evals: 0, macrotasks: 0, macrotasksAtCap: -1, capped: false, msToCap: -1 };
  const t0 = Date.now();
  const timer = setInterval(() => { p.macrotasks++; }, 0);
  const tick = () => {
    if (++p.evals > cap) {
      if (!p.capped) {
        p.capped = true;
        p.macrotasksAtCap = p.macrotasks;
        p.msToCap = Date.now() - t0;
      }
      throw new Error(`runaway-evals (cap ${cap})`);
    }
  };
  return { p, tick, stop: () => clearInterval(timer) };
}

/** x-out: 出力 status を持つ要素。初期値と、connectedCallback の microtask で出す値を選べる。 */
function defineOut(opts: { initial: "distinct" | "same"; emit: "microtask" | "none" }): string {
  const tag = `tmp-out-${seq++}`;
  let c = 0;
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
    _i = ++c;
    _v = opts.initial === "distinct" ? `m${this._i}` : "m";
    get status(): string { return this._v; }
    connectedCallback() {
      if (opts.emit !== "microtask") return;
      queueMicrotask(() => {
        this._v = `e${this._i}`;
        this.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: this._v }));
      });
    }
  });
  return tag;
}

describe("#353 描画の連鎖の上限に掛からない形の無限ループも、上限で止まって報告され、ページが固まらない", () => {
  const listCase = async (label: string, tag: string, key: "mode" | "x", extra: Record<string, any>, kick = false) => {
    const { p, tick, stop } = runaway();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { write } = await page(`<ul><template data-wcs="for: view"><li><${tag} data-wcs="status: ${key}"></${tag}><span>{{ .m }}</span></li></template></ul>`, {
        mode: "init",
        rows: [{ k: 1 }, { k: 2 }],
        get view() {
          tick();
          const m = (this as any).mode;
          return (this as any).rows.map((r: object) => ({ ...r, m }));
        },
        ...extra,
      });
      const evalsBeforeKick = p.evals;
      if (kick) {
        p.macrotasks = 0; // count from the kick
        await write((s) => { s.mode = "kick"; });
      }
      await sleep(30);
      const messages = messagesOf(error);
      const distinct = [...new Set(messages.map((m) => m.slice(0, 90)))];
      note(label, { ...(kick ? { evalsBeforeKick } : {}), ...p, errorCount: messages.length, distinctErrors: distinct });
      // 期待: 作者の書いた打ち切り（cap）に達する前にエンジンが止め、報告し、その間にもマクロタスクが回る
      // （ループがそもそも起きなければ — getter の評価が数回で済めば — 報告は要らない）
      expect(p.capped).toBe(false);
      if (p.evals - evalsBeforeKick > 3) expect(messages.length).toBeGreaterThan(0);
      expect(p.macrotasks).toBeGreaterThan(0);
    } finally {
      stop();
      error.mockRestore();
    }
  };

  it("対照: 行の要素が値を同期に出す（connectedCallback が空）", async () => {
    await listCase("#353 対照（同期に出す）", defineOut({ initial: "distinct", emit: "none" }), "mode", {});
  });

  it("形 1: 行の要素が値を queueMicrotask で出す（Issue の要素そのまま: 初期値も要素ごとに違う）", async () => {
    await listCase("#353 形 1（microtask・初期値は要素ごと）", defineOut({ initial: "distinct", emit: "microtask" }), "mode", {});
  });

  it("形 1b: 行の要素が値を queueMicrotask で出す（初期値は全要素同じ \"m\"。同期の連鎖は起きず、microtask だけで回る形）", async () => {
    await listCase("#353 形 1b（microtask・初期値は同じ）", defineOut({ initial: "same", emit: "microtask" }), "mode", {});
  });

  it("形 2: 要素の出力 → x、$watch: { x(v) { this.mode = v } }、一覧の getter が mode を読む", async () => {
    await listCase("#353 形 2（$watch を挟む）", defineOut({ initial: "distinct", emit: "none" }), "x", {
      x: "",
      $watch: { x(this: any, v: unknown) { this.mode = v; } },
    });
  });

  it("形 2b: 形 2 の後に mode を 1 回書いて循環を始める（state-next の $watch は読み込み時の要素からの初期同期を見ないため）", async () => {
    await listCase("#353 形 2b（$watch を挟む・書き込みで開始）", defineOut({ initial: "distinct", emit: "none" }), "x", {
      x: "",
      $watch: { x(this: any, v: unknown) { this.mode = v; } },
    }, true);
  });

  it("形 3: $scan を挟む — state-next では $scan は廃止（宣言すると読み込みで失敗する）", async () => {
    const tag = defineOut({ initial: "distinct", emit: "none" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let failure: unknown = null;
      try {
        await page(`<ul><template data-wcs="for: view"><li><${tag} data-wcs="status: x"></${tag}></li></template></ul>`, {
          x: "",
          rows: [{ k: 1 }],
          $scan: { mode: { from: "x", initial: "init", fold: (_a: unknown, v: unknown) => v } },
          get view() { return (this as any).rows; },
        });
      } catch (e) {
        failure = e;
      }
      note("#353 形 3（$scan）", { failure: String((failure as Error)?.message ?? failure), errors: messagesOf(error) });
      expect(failure).not.toBeNull();
    } finally {
      error.mockRestore();
    }
  });

  const renderedCase = async (label: string, async: boolean) => {
    const { p, tick, stop } = runaway();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const state: Record<string, any> = async
        ? { n: 0, async $renderedCallback(this: any) { tick(); await null; this.n = this.n + 1; } }
        : { n: 0, $renderedCallback(this: any) { tick(); this.n = this.n + 1; } };
      const { write } = await page(`<p>{{ n }}</p><i>{{ kick }}</i>`, { ...state, kick: 0 });
      const evalsBeforeKick = p.evals;
      p.macrotasks = 0; // count from the kick
      // state-next は最初の描画では $renderedCallback を呼ばない: 書き込みで連鎖を始める
      await write((s) => { s.kick = 1; });
      await sleep(30);
      const messages = messagesOf(error);
      const distinct = [...new Set(messages.map((m) => m.slice(0, 90)))];
      note(label, { evalsBeforeKick, ...p, errorCount: messages.length, distinctErrors: distinct });
      expect(p.capped).toBe(false);
      expect(messages.length).toBeGreaterThan(0);
      expect(p.macrotasks).toBeGreaterThan(0);
    } finally {
      stop();
      error.mockRestore();
    }
  };

  it("対照: 同期の $renderedCallback() { this.n++ }", async () => {
    await renderedCase("#353 対照（同期の $renderedCallback）", false);
  });

  it("形 4: async $renderedCallback() { await null; this.n++ }", async () => {
    await renderedCase("#353 形 4（async $renderedCallback）", true);
  });
});

// ---------------------------------------------------------------- #354

describe("#354 32 段を超える有限の描画の連鎖に $watch を足しても、$watch の上限は誤って出ず、ハンドラは飛ばされない", () => {
  it.each([
    ["ハンドラが this.last = v と書く（Issue の HTML）", true],
    ["対照: ハンドラが書かない", false],
  ])("%s", async (label, handlerWrites) => {
    const w: number[] = [];
    let renders = 0;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, write } = await page(`<h1>{{ size }}</h1><p>{{ last }}</p><i>{{ kick }}</i>`, {
        size: 64,
        last: 0,
        kick: 0,
        $watch: { size(this: any, v: number) { w.push(v); if (handlerWrites) this.last = v; } },
        $renderedCallback(this: any) {
          if (++renders > 500) throw new Error("runaway-renders");
          if (this.size > 18) this.size = this.size - 1;
        },
      });
      const rendersBeforeKick = renders;
      // state-next は最初の描画では $renderedCallback を呼ばない: 関係の無いキーの書き込みで連鎖を始める
      if (renders === 0) await write((s) => { s.kick = 1; });
      await sleep(50);
      const messages = messagesOf(error);
      const expected: number[] = [];
      for (let v = w[0]; v >= 18; v--) expected.push(v);
      const missing = expected.filter((v) => !w.includes(v));
      note(`#354 ${label}`, { rendersBeforeKick, renders, watchCalls: w.length, first: w[0], last: w[w.length - 1], missing, h1: root.querySelector("h1")!.textContent, p: root.querySelector("p")!.textContent, errors: messages });
      expect(root.querySelector("h1")!.textContent).toBe("18");
      expect(messages).toEqual([]);
      expect(w[0]).toBe(63);
      expect(missing).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });
});

// ---------------------------------------------------------------- #357

// #357（スコープ付き CustomElementRegistry）: happy-dom は scoped registry を持たない（`new CustomElementRegistry()`
// が Illegal constructor、要素に `customElementRegistry` が無い）ので、ここでは確かめられない。
// Chromium の e2e（e2e/tests/state-scoped-registry.spec.ts、STATE=next）が確かめる（F29、2026-09-27 に修正）。

// ---------------------------------------------------------------- #367

describe("#367 行にマウントしたコンポーネントの async メソッドの await の間にホストの行が消えても、await の後の書き込みは別の行に着地しない", () => {
  const edits: [string, (s: any) => void, string[]][] = [
    ["Ben を消して同じバッチで Dan を足す", (s) => { s.users = [s.users[0], s.users[2], { name: "Dan" }]; }, ["Anna", "Cy", "Dan"]],
    ["Ben を同じ位置で Dan に差し替える", (s) => { s.users = [s.users[0], { name: "Dan" }, s.users[2]]; }, ["Anna", "Dan", "Cy"]],
    ["Ben を消すだけ", (s) => { s.users = [s.users[0], s.users[2]]; }, ["Anna", "Cy"]],
  ];
  const cases = ["state.name: .name", "state: ."].flatMap((wiring) =>
    (["ボタン（onclick: later）", "公開面（element.state.later()）"] as const).flatMap((via) =>
      edits.map(([e, fn, names]) => [`${wiring} / ${via} / ${e}`, wiring, via, fn, names] as const)));

  it.each(cases)("%s", async (label, wiring, via, edit, names) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const tag = component(
      `<span class="name">{{ name }}</span><span class="mode">{{ mode }}</span><button data-wcs="onclick: later">later</button>`,
      () => ({
        mode: "view",
        async later(this: any) {
          await gate;
          this.mode = "late";
          this.name = `${this.name}!`;
          return "done";
        },
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, write, read } = await page(`<template data-wcs="for: users"><${tag} data-wcs="${wiring}"></${tag}></template>`, {
        users: [{ name: "Anna" }, { name: "Ben" }, { name: "Cy" }],
      });
      const cards = () => Array.from(root.querySelectorAll(tag)) as any[];
      const shown = () => cards().map((c) => `${c.shadowRoot.querySelector(".name").textContent}/${c.shadowRoot.querySelector(".mode").textContent}`);
      expect(shown()).toEqual(["Anna/view", "Ben/view", "Cy/view"]);
      const ben = cards()[1];
      const benItem = (read("users") as any[])[1];
      let outcome = "pending";
      if (via === "ボタン（onclick: later）") {
        (ben.shadowRoot.querySelector("button") as HTMLElement).click();
      } else {
        ben.state.later().then((v: unknown) => { outcome = `resolved ${v}`; }, (e: unknown) => { outcome = `rejected ${(e as Error)?.message ?? e}`; });
      }
      await flush();
      await write(edit);
      const reused = cards().includes(ben);
      release();
      await flush();
      await flush();
      await flush();
      const users = (read("users") as any[]).map((u) => u.name);
      note(`#367 ${label}`, { users, shown: shown(), benElementReused: reused, benElementShown: `${ben.shadowRoot.querySelector(".name").textContent}/${ben.shadowRoot.querySelector(".mode").textContent}`, detachedBenItem: benItem.name, outcome, errors: messagesOf(error) });
      expect(users).toEqual(names);
      expect(shown()).toEqual(names.map((n) => `${n}/view`));
    } finally {
      error.mockRestore();
    }
  });
});

// ---------------------------------------------------------------- #368

describe("#368 for の行を消して足しても、マウントしたコンポーネントの $connectedCallback がツリーのキーを読める", () => {
  const steps: [string, ((s: any) => void)[], string[]][] = [
    ["Ben を消し、次のバッチで Dan を足す", [(s) => { s.users = [s.users[0], s.users[2]]; }, (s) => { s.users = [...s.users, { name: "Dan" }]; }], ["Anna/saw Anna", "Cy/saw Cy", "Dan/saw Dan"]],
    ["Ben を消して Dan を足すのを 1 つのバッチで", [(s) => { s.users = [s.users[0], s.users[2], { name: "Dan" }]; }], ["Anna/saw Anna", "Cy/saw Cy", "Dan/saw Dan"]],
    // state-next は行の Content を使い回さない: 要素が外れて戻る（再接続する）のは並べ替えで動かされたとき
    ["（追加）並べ替え: 動かした行の要素が外れて戻り、$connectedCallback が再び走る", [(s) => { s.users = [s.users[2], s.users[0], s.users[1]]; }], ["Cy/saw Cy", "Anna/saw Anna", "Ben/saw Ben"]],
  ];
  const cases = ["state: .", "state.name: .name"].flatMap((wiring) =>
    (["同期の $connectedCallback", "対照: async（await null の後に読む）"] as const).flatMap((cb) =>
      steps.map(([s, fns, final]) => [`${wiring} / ${cb} / ${s}`, wiring, cb, fns, final] as const)));

  it.each(cases)("%s", async (label, wiring, cb, fns, final) => {
    let calls = 0;
    const tag = component(`<span class="name">{{ name }}</span><span class="seen">{{ seen }}</span>`, () => (cb === "同期の $connectedCallback"
      ? { seen: "-", $connectedCallback(this: any) { calls++; this.seen = "saw " + this.name; } }
      : { seen: "-", async $connectedCallback(this: any) { calls++; await null; this.seen = "saw " + this.name; } }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, write } = await page(`<template data-wcs="for: users"><${tag} data-wcs="${wiring}"></${tag}></template>`, {
        users: [{ name: "Anna" }, { name: "Ben" }, { name: "Cy" }],
      });
      const cards = () => Array.from(root.querySelectorAll(tag)) as any[];
      const shown = () => cards().map((c) => `${c.shadowRoot.querySelector(".name").textContent}/${c.shadowRoot.querySelector(".seen").textContent}`);
      const initial = shown();
      const ben = cards()[1];
      for (const fn of fns) await write(fn);
      await flush();
      await flush();
      note(`#368 ${label}`, { initial, final: shown(), connectedCalls: calls, benElementStillShown: cards().includes(ben), errors: messagesOf(error) });
      expect(initial).toEqual(["Anna/saw Anna", "Ben/saw Ben", "Cy/saw Cy"]);
      expect(shown()).toEqual(final);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
