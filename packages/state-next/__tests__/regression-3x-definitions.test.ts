/**
 * regression-3x-definitions.test.ts — @wcstack/state 3.4.0 で直した「行の初期同期」と
 * 「後から定義されるカスタム要素」の修正（#319 / #330 / #352 / #357）の回帰シナリオを state-next で流す。
 * 3.x の packages/state/__tests__ の integration.initialSyncForRow / spreadDeferredTemplate /
 * deferredDefinitionOrder / deferredDefinitionReconnect / scopedRegistryRows から、目に見える振る舞いだけを移した。
 * issues.test.ts（#319 / #330）と issues-misc.test.ts（#352）が既に流している形は繰り返さない。
 *
 * 後から定義される要素とスコープ付き registry は、3.x のテストと同じく要素の `customElementRegistry` の口で模す
 * （state-next も `el.customElementRegistry ?? customElements` で registry を引く — src/dom/wc.ts の registryOf）。
 * happy-dom には本物のスコープ付き registry が無い（実物は e2e/tests/state-scoped-registry.spec.ts）。
 * 模した registry の upgrade はプロトタイプの付け替えなので、要素のクラスはフィールド初期化子を持たない。
 * 4.0 では「state に無いパス」の警告（wcs/binding-path-missing）が diagnostics 追加機能にあるので、それも入れる。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, diagnostics, getBindingsReady, installFeatures, scopes } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;
const tagOf = (prefix: string): string => `regdef-${prefix}-${seq++}`;

beforeAll(() => {
  installFeatures([scopes, diagnostics]);
  bootstrapState();
});

afterEach(() => {
  delete (HTMLElement.prototype as any).customElementRegistry;
  vi.restoreAllMocks();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`; `attach` makes the shadow root. */
async function page(html: string, state: Record<string, any>, attach?: (host: Element) => ShadowRoot) {
  const h = document.createElement(tagOf("page"));
  const root = attach ? attach(h) : h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  const write = async (fn: (s: any) => void): Promise<void> => {
    el.createState("writable", fn);
    await flush();
    await flush();
  };
  const read = (path: string): any => {
    let v: unknown;
    el.createState("readonly", (s: any) => { v = s[path]; });
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  };
  return { host: h, root, el, write, read };
}

const texts = (c: ParentNode, sel: string): (string | null)[] => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);
const settle = async (): Promise<void> => {
  await flush();
  await flush();
};
const spyError = () => vi.spyOn(console, "error").mockImplementation(() => {});

// ---------------------------------------------------------------- 要素のクラス

/** 出力専用のメンバー status（初期値 "ready"）。定義済みで使う。 */
function defineOutputOnly(tag: string): void {
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
    status: unknown = "ready";
  });
}

/** 双方向のメンバー value（初期値 "persisted"）。setter はイベントを出す。定義済みで使う。 */
function defineTwoWay(tag: string): void {
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable", version: 1,
      properties: [{ name: "value", event: `${tag}:value-changed` }],
      inputs: [{ name: "value" }],
    };
    _value: unknown = "persisted";
    get value(): unknown { return this._value; }
    set value(v: unknown) {
      this._value = v;
      this.dispatchEvent(new CustomEvent(`${tag}:value-changed`, { detail: v }));
    }
  });
}

/** 後から定義される要素: 入力 name（hello <name> と表示、書かれた回数を sets に数える）、出力専用 status（"ready"）。 */
function greetClass(tag: string): CustomElementConstructor {
  return class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable", version: 1,
      properties: [{ name: "status", event: `${tag}:status` }],
      inputs: [{ name: "name" }],
    };
    set name(v: unknown) {
      (this as any)._n = v;
      (this as any).sets = ((this as any).sets ?? 0) + 1;
      this.textContent = `hello ${v}`;
    }
    get name(): unknown { return (this as any)._n; }
    get status(): unknown { return "ready"; }
  };
}

/**
 * name: 双方向（出力 ＋ 入力）、status: 出力専用、label: 入力専用。要素の値は EL-N / EL-S。
 * name と status への書き込み（state → 要素）を `writes` に記録する。
 */
function probeClass(tag: string, writes: string[]): CustomElementConstructor {
  return class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable", version: 1,
      properties: [{ name: "status", event: `${tag}:status` }, { name: "name", event: `${tag}:name` }],
      inputs: [{ name: "name" }, { name: "label" }],
    };
    set name(v: unknown) { writes.push(`name=${String(v)}`); (this as any)._n = v; this.textContent = `hello ${v}`; }
    get name(): unknown { return (this as any)._n ?? "EL-N"; }
    set status(v: unknown) { writes.push(`status=${String(v)}`); (this as any)._s = v; }
    get status(): unknown { return (this as any)._s ?? "EL-S"; }
    set label(v: unknown) { (this as any)._l = v; }
    get label(): unknown { return (this as any)._l; }
  };
}

// ---------------------------------------------------------------- registry の模型

/**
 * 1 つのタグだけ「後から定義される」registry（3.x の lateRegistry と同じ形）。文書の中で registry を引かれた
 * 要素は、定義の後なら upgrade する（ブラウザが差し込み時に upgrade するのを模す）。
 */
function lateRegistry(tag: string, cls: CustomElementConstructor) {
  let defined = false;
  let resolve!: (c: CustomElementConstructor) => void;
  const promise = new Promise<CustomElementConstructor>((r) => { resolve = r; });
  const registry = {
    get: (name: string) => (name === tag ? (defined ? cls : undefined) : customElements.get(name)),
    whenDefined: (name: string) => (name === tag ? promise : customElements.whenDefined(name)),
    upgrade: (root: Node) => {
      if (defined && (root as Element).localName === tag) Object.setPrototypeOf(root, cls.prototype);
    },
  };
  Object.defineProperty(HTMLElement.prototype, "customElementRegistry", {
    configurable: true,
    get(this: Element) {
      if (this.localName !== tag) return undefined;
      if (this.isConnected) registry.upgrade(this);
      return registry;
    },
  });
  return { define(): void { defined = true; resolve(cls); } };
}

/**
 * スコープ付き registry を持つ shadow root（3.x の scopedRegistry と同じく、Chromium 149 で測った振る舞いを模す）:
 * DocumentFragment の中の要素は global registry を返し（global はこのタグを定義しない）、スコープ付きの
 * shadow root に入るとその registry に付け替わって upgrade される。
 */
function scopedRegistry(tag: string, cls: CustomElementConstructor) {
  const scoped = {
    get: (name: string) => (name === tag ? cls : customElements.get(name)),
    whenDefined: (name: string) => (name === tag ? Promise.resolve(cls) : customElements.whenDefined(name)),
    upgrade: (root: Node) => {
      if ((root as Element).localName === tag) Object.setPrototypeOf(root, cls.prototype);
    },
  };
  let globalWaits = 0;
  const global = {
    get: (name: string) => (name === tag ? undefined : customElements.get(name)),
    whenDefined: (name: string) => {
      if (name !== tag) return customElements.whenDefined(name);
      globalWaits++;
      return new Promise<CustomElementConstructor>(() => {});
    },
    upgrade: () => {},
  };
  let scope: ShadowRoot | null = null;
  Object.defineProperty(HTMLElement.prototype, "customElementRegistry", {
    configurable: true,
    get(this: Element) {
      if (this.localName !== tag) return undefined;
      if (this.getRootNode() !== scope) return global;
      scoped.upgrade(this);
      return scoped;
    },
  });
  return {
    attach(host: Element): ShadowRoot {
      scope = host.attachShadow({ mode: "open" });
      return scope;
    },
    /** global registry で定義を待ち始めた回数（行の要素がこちらを待つのが #357 の欠陥） */
    globalWaits: () => globalWaits,
  };
}

// ---------------------------------------------------------------- #319

describe("#319 for の行の中の初期同期（要素から初期値を受け取るメンバー）", () => {
  // 既出（issues.test.ts #319）: 出力専用メンバーの最初の描画、#init=element の最初の描画、空の一覧に 1 行足す

  it("#init=auto は行ごとに、state に値のある行は state 側、無い行は要素側が勝つ", async () => {
    const tag = tagOf("store");
    defineTwoWay(tag);
    const error = spyError();
    const { root, read } = await page(
      `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="value#init=auto: .n"></${tag}></li></template></ul>`,
      { rows: [{ n: "a" }, { m: "b" }] },
    );
    expect(read("rows")).toEqual([{ n: "a" }, { m: "b", n: "persisted" }]);
    expect((Array.from(root.querySelectorAll(tag)) as any[]).map((el) => el.value)).toEqual(["a", "persisted"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("空の一覧に 2 行足し、さらに 1 行足しても描かれ、どの行の値も要素の値で初期化される", async () => {
    const tag = tagOf("output");
    defineOutputOnly(tag);
    const error = spyError();
    const { root, write, read } = await page(
      `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span>{{ .st }}</span></li></template></ul>`,
      { rows: [] },
    );
    await write((s) => { s.rows = [{ st: "seed" }, { st: "s2" }]; });
    expect(texts(root, "span")).toEqual(["ready", "ready"]);
    await write((s) => { s.rows = [...s.rows, { st: "s3" }]; });
    expect(texts(root, "span")).toEqual(["ready", "ready", "ready"]);
    expect(read("rows")).toEqual([{ st: "ready" }, { st: "ready" }, { st: "ready" }]);
    expect(error).not.toHaveBeenCalled();
  });

  it("描いた一覧を新しい行オブジェクトの配列で丸ごと置き換えても（再取得相当）一覧が消えない", async () => {
    const tag = tagOf("output");
    defineOutputOnly(tag);
    const error = spyError();
    const { root, write, read } = await page(
      `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span>{{ .st }}</span></li></template></ul>`,
      { rows: [{ st: "seed" }, { st: "s2" }] },
    );
    expect(root.querySelectorAll("li").length).toBe(2);
    await write((s) => { s.rows = [{ st: "x1" }, { st: "x2" }, { st: "x3" }]; });
    expect(root.querySelectorAll("li").length).toBe(3);
    expect(texts(root, "span")).toEqual(["ready", "ready", "ready"]);
    expect(read("rows")).toEqual([{ st: "ready" }, { st: "ready" }, { st: "ready" }]);
    expect(error).not.toHaveBeenCalled();
  });

  it("行の中の if: の中に置いた要素も、最初の描画で行ごとに初期化される", async () => {
    const tag = tagOf("output");
    defineOutputOnly(tag);
    const error = spyError();
    const { root, read } = await page(
      `<ul><template data-wcs="for: rows"><li><template data-wcs="if: .on"><${tag} data-wcs="status: .st"></${tag}></template><span>{{ .st }}</span></li></template></ul>`,
      { rows: [{ on: true, st: "seed" }, { on: true, st: "s2" }] },
    );
    expect(root.querySelectorAll(tag).length).toBe(2);
    expect(read("rows")).toEqual([{ on: true, st: "ready" }, { on: true, st: "ready" }]);
    expect(texts(root, "span")).toEqual(["ready", "ready"]);
    expect(error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- #330

const PEOPLE = () => ({ people: [{ name: "a" }, { name: "b" }] });
const forSpread = (tag: string, bind = "...: .") =>
  `<ul><template data-wcs="for: people"><li><${tag} data-wcs="${bind}"></${tag}></li></template></ul>`;

describe("#330 for / if のテンプレートの中の spread を、未定義の要素で定義まで遅らせる", () => {
  // 既出（issues.test.ts #330）: `...: .` / `...: people.*` / if の枝 / ルートの spread が、定義後に展開されて表示される

  it("for の行の `...: .`: 一覧は先に描かれ、定義後に行ごとに展開され、出力専用メンバーが state に入り、書き込みに追従する", async () => {
    const tag = tagOf("greet");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, write, read } = await page(forSpread(tag), PEOPLE());
    expect(root.querySelectorAll("li").length).toBe(2);
    expect(texts(root, tag)).toEqual(["", ""]);

    late.define();
    await settle();
    expect(texts(root, tag)).toEqual(["hello a", "hello b"]);
    expect(read("people")).toEqual([{ name: "a", status: "ready" }, { name: "b", status: "ready" }]);
    // 展開は一度きり
    expect((Array.from(root.querySelectorAll(tag)) as any[]).map((el) => el.sets)).toEqual([1, 1]);

    await write((s) => { s["people.1.name"] = "bb"; });
    expect(texts(root, tag)).toEqual(["hello a", "hello bb"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("for の行の `...: people.*`: 定義後に足した行も展開され、出力専用メンバーの値が入り、警告を出さない", async () => {
    const tag = tagOf("greet");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root, write, read } = await page(forSpread(tag, "...: people.*"), PEOPLE());
    expect(root.querySelectorAll("li").length).toBe(2);
    late.define();
    await settle();
    expect(texts(root, tag)).toEqual(["hello a", "hello b"]);

    await write((s) => { s.people = [...s.people, { name: "c" }]; });
    expect(texts(root, tag)).toEqual(["hello a", "hello b", "hello c"]);
    expect(read("people")).toEqual([
      { name: "a", status: "ready" }, { name: "b", status: "ready" }, { name: "c", status: "ready" },
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("if の枝の spread も定義後に展開され、出力専用メンバーの値が state に入る", async () => {
    const tag = tagOf("greet");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, read } = await page(
      `<div><template data-wcs="if: show"><${tag} data-wcs="...: one"></${tag}></template></div>`,
      { show: true, one: { name: "z" } },
    );
    expect(root.querySelectorAll(tag).length).toBe(1);
    late.define();
    await settle();
    expect(texts(root, tag)).toEqual(["hello z"]);
    expect(read("one")).toEqual({ name: "z", status: "ready" });
    expect(error).not.toHaveBeenCalled();
  });

  it("定義前に消えた行は定義後も展開しない（残った行だけが展開される）", async () => {
    const tag = tagOf("greet");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, write, read } = await page(forSpread(tag), PEOPLE());
    const removed = root.querySelector(tag) as any;

    await write((s) => { s.people = s.people.slice(1); });
    expect(texts(root, tag)).toEqual([""]);
    late.define();
    await settle();
    expect(texts(root, tag)).toEqual(["hello b"]);
    expect(removed.isConnected).toBe(false);
    expect(removed.name).toBeUndefined();
    expect(removed.textContent).toBe("");
    expect(read("people")).toEqual([{ name: "b", status: "ready" }]);
    expect(error).not.toHaveBeenCalled();
  });

  // 3.x の「プールへ戻した行の使い回し」の 3 形: state-next は行の Content を使い回さない（issues-misc.test.ts #368 の注記）ので、
  // 同じ要素であることは確かめず、消して足した後の値と書き込みへの追従だけを確かめる
  it("定義前に行を消して別の行を足すと、定義後は今の行の値で展開される", async () => {
    const tag = tagOf("greet");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, write, read } = await page(forSpread(tag), PEOPLE());
    await write((s) => { s.people = s.people.slice(1); });
    await write((s) => { s.people = [...s.people, { name: "c" }]; });
    expect(texts(root, tag)).toEqual(["", ""]);

    late.define();
    await settle();
    expect(texts(root, tag)).toEqual(["hello b", "hello c"]);
    expect(read("people")).toEqual([{ name: "b", status: "ready" }, { name: "c", status: "ready" }]);
    expect(error).not.toHaveBeenCalled();
  });

  it("定義前に行を消し、定義後に行を足すと、足した行も展開され、書き込みに追従する", async () => {
    const tag = tagOf("greet");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, write } = await page(forSpread(tag), PEOPLE());
    await write((s) => { s.people = s.people.slice(1); });
    late.define();
    await settle();
    expect(texts(root, tag)).toEqual(["hello b"]);

    await write((s) => { s.people = [...s.people, { name: "c" }]; });
    expect(texts(root, tag)).toEqual(["hello b", "hello c"]);
    expect((Array.from(root.querySelectorAll(tag)) as any[]).map((el) => el.sets)).toEqual([1, 1]);
    await write((s) => { s["people.1.name"] = "cc"; });
    expect(texts(root, tag)).toEqual(["hello b", "hello cc"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("定義前に if の枝が閉じたら展開せず、定義後に開き直すと展開される", async () => {
    const tag = tagOf("greet");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, write } = await page(
      `<div><template data-wcs="if: show"><${tag} data-wcs="...: one"></${tag}></template></div>`,
      { show: true, one: { name: "z" } },
    );
    const el = root.querySelector(tag) as any;
    await write((s) => { s.show = false; });
    late.define();
    await settle();
    expect(el.name).toBeUndefined();
    expect(el.textContent).toBe("");

    await write((s) => { s.show = true; });
    expect(texts(root, tag)).toEqual(["hello z"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("開いたままの if の枝を定義前に適用し直しても、定義後の展開は一度きり", async () => {
    const tag = tagOf("greet");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, write } = await page(
      `<div><template data-wcs="if: count"><${tag} data-wcs="...: one"></${tag}></template></div>`,
      { count: 1, one: { name: "z" } },
    );
    // 真 → 真: 枝は開いたまま
    await write((s) => { s.count = 2; });
    await write((s) => { s.count = 3; });
    const el = root.querySelector(tag) as any;
    const setter = vi.fn();
    Object.defineProperty(el, "name", { configurable: true, set: setter, get: () => undefined });
    late.define();
    await settle();
    expect(root.querySelector(tag)).toBe(el);
    expect(setter).toHaveBeenCalledTimes(1);
    expect(setter).toHaveBeenCalledWith("z");
    expect(error).not.toHaveBeenCalled();
  });

  it("spread と明示の束縛を併せた要素は、定義後の展開でも明示の束縛が勝つ", async () => {
    const tag = tagOf("greet");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root } = await page(forSpread(tag, "...: .; name: .nick"), {
      people: [{ name: "a", nick: "A" }, { name: "b", nick: "B" }],
    });
    expect(root.querySelectorAll("li").length).toBe(2);
    late.define();
    await settle();
    expect(texts(root, tag)).toEqual(["hello A", "hello B"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("展開した要素の添字の束縛（$1）も、行の添字が変わると当て直される", async () => {
    const tag = tagOf("greet");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, write } = await page(forSpread(tag, "...: .; attr.data-i: $1"), PEOPLE());
    late.define();
    await settle();
    const indexes = () => Array.from(root.querySelectorAll(tag)).map((el) => el.getAttribute("data-i"));
    expect(indexes()).toEqual(["0", "1"]);

    await write((s) => { s.people = [{ name: "z" }, ...s.people]; });
    expect(indexes()).toEqual(["0", "1", "2"]);
    await write((s) => { s.people = s.people.slice().reverse(); });
    expect(indexes()).toEqual(["0", "1", "2"]);
    expect(texts(root, tag)).toEqual(["hello b", "hello a", "hello z"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("祖先の下を binder でもう一度走査しても、行の展開は一度きりで、展開した行の要素のイベントが state に届く", async () => {
    const tag = tagOf("greet");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, read } = await page(
      `<div id="box">${forSpread(tag)}</div>`,
      { title: "T", ...PEOPLE() },
    );
    const p = document.createElement("p");
    p.setAttribute("data-wcs", "textContent: title");
    root.getElementById("box")!.append(p);
    (globalThis as any)[Symbol.for("wcstack.binder")].bind(p);
    await settle();
    expect(p.textContent).toBe("T");

    late.define();
    await settle();
    expect(texts(root, tag)).toEqual(["hello a", "hello b"]);
    expect((Array.from(root.querySelectorAll(tag)) as any[]).map((el) => el.sets)).toEqual([1, 1]);
    root.querySelectorAll(tag).forEach((el, i) => {
      el.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: `E${i}` }));
    });
    await settle();
    expect((read("people") as any[]).map((person) => person.status)).toEqual(["E0", "E1"]);
    expect(error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- #352

const LATE = () => ({ late: [{ name: "a" }, { name: "b" }], one: { name: "z" } });
const lateHtml = (tag: string, rowBind: string, rootBind: string) =>
  `<ul id="late"><template data-wcs="for: late"><li><${tag} data-wcs="${rowBind}"></${tag}></li></template></ul>`
  + `<div id="rootlate"><${tag} data-wcs="${rootBind}"></${tag}></div>`
  + `<div id="other"></div><div id="park"></div>`;

/** 要素をいったん文書の外（切り離した div）へ退避する。戻す関数を返す（タブ・パネルの DOM 退避の形）。 */
async function detach(el: Element): Promise<() => Promise<void>> {
  const parent = el.parentNode!;
  const next = el.nextSibling;
  document.createElement("div").append(el);
  await settle();
  return async () => {
    parent.insertBefore(el, next);
    await settle();
  };
}

describe("#352 定義待ちの間に外して戻した要素にも、定義の後に値が入る", () => {
  // 既出（issues-misc.test.ts #352）: spread / プロパティの束縛（行・ルート）を、ul・div や要素そのものを外して
  // 同じ場所へ戻してから定義する形（定義後の値・書き込み・足した行）

  it("同じツリーの別の場所へ時間をおいて移しても、定義後に値が入る", async () => {
    const tag = tagOf("late");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root } = await page(lateHtml(tag, "...: .", "name: one.name"), LATE());
    const other = root.getElementById("other")!;
    const list = root.getElementById("late")!;
    const rootBox = root.getElementById("rootlate")!;
    await detach(list);
    await detach(rootBox);
    other.append(list, rootBox);
    await settle();

    late.define();
    await settle();
    expect(texts(other, `#late ${tag}`)).toEqual(["hello a", "hello b"]);
    expect(texts(other, `#rootlate ${tag}`)).toEqual(["hello z"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("外したまま定義し、その後に戻すと値が入り、書き込みに追従する", async () => {
    const tag = tagOf("late");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, write } = await page(lateHtml(tag, "...: .", "name: one.name"), LATE());
    const restoreList = await detach(root.getElementById("late")!);
    const restoreRoot = await detach(root.getElementById("rootlate")!);
    late.define();
    await settle();
    // (#late の次の兄弟は #rootlate: 後に外したほうから戻す)
    await restoreRoot();
    await restoreList();
    expect(texts(root, `#late ${tag}`)).toEqual(["hello a", "hello b"]);
    expect(texts(root, `#rootlate ${tag}`)).toEqual(["hello z"]);

    await write((s) => { s["late.0.name"] = "A"; s["one.name"] = "Z"; });
    expect(texts(root, `#late ${tag}`)).toEqual(["hello A", "hello b"]);
    expect(texts(root, `#rootlate ${tag}`)).toEqual(["hello Z"]);
    expect(error).not.toHaveBeenCalled();
  });

  const parked: [string, string, boolean][] = [
    ["プロパティの束縛", "name: .name", true],
    ["プロパティの束縛", "name: .name", false],
    ["spread", "...: .", true],
    ["spread", "...: .", false],
  ];
  it.each(parked)("%s: 行から取り出した要素を文書に戻してから定義する（行が生きている: %s）", async (_form, rowBind, rowAlive) => {
    const tag = tagOf("late");
    const late = lateRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, write } = await page(lateHtml(tag, rowBind, "name: one.name"), LATE());
    const el = root.querySelector(`#late ${tag}`)!;
    document.createElement("div").append(el);
    await settle();
    // 行が消える（プールに入る）: 消えた行の値で適用・展開しない
    if (!rowAlive) await write((s) => { s.late = [{ name: "b" }]; });
    root.getElementById("park")!.append(el);
    await settle();

    late.define();
    await settle();
    expect(el.textContent).toBe(rowAlive ? "hello a" : "");
    expect(texts(root, `#late ${tag}`)).toEqual(["hello b"]);
    expect(error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- #357

const ITEMS = () => ({ items: [{ name: "a", status: "-" }, { name: "b", status: "-" }] });

describe("#357 スコープ付き registry の shadow root の一覧の行（happy-dom では registry の口で模す）", () => {
  // 既出（fixes.test.ts F29）: 最初の描画の行のプロパティの束縛が、置かれた後の registry で定義を待つ（global も定義する模型）

  it.each([["プロパティの束縛", "name: .name"], ["spread", "...: ."]])(
    "%s: 最初に描いた行にも値が入り、global registry を待たず、足した行・書き込みにも追従する", async (_form, rowBind) => {
      const tag = tagOf("scoped");
      const reg = scopedRegistry(tag, greetClass(tag));
      const error = spyError();
      const { root, write } = await page(
        `<ul><template data-wcs="for: items"><li><${tag} data-wcs="${rowBind}"></${tag}></li></template></ul>`,
        ITEMS(), (h) => reg.attach(h),
      );
      expect(texts(root, tag)).toEqual(["hello a", "hello b"]);
      expect(reg.globalWaits()).toBe(0);

      await write((s) => { s.items = [...s.items, { name: "c", status: "-" }]; });
      expect(texts(root, tag)).toEqual(["hello a", "hello b", "hello c"]);
      await write((s) => { s["items.0.name"] = "A"; });
      expect(texts(root, tag)).toEqual(["hello A", "hello b", "hello c"]);
      expect(reg.globalWaits()).toBe(0);
      expect(error).not.toHaveBeenCalled();
    },
  );

  it("行の要素の出力（イベント）が、最初に描いた行でも後から足した行でも state に届く", async () => {
    const tag = tagOf("scoped");
    const reg = scopedRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, write, read } = await page(
      `<ul><template data-wcs="for: items"><li><${tag} data-wcs="name: .name; status: .status"></${tag}></li></template></ul>`,
      ITEMS(), (h) => reg.attach(h),
    );
    await write((s) => { s.items = [...s.items, { name: "c", status: "-" }]; });
    root.querySelectorAll(tag).forEach((el, i) => {
      el.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: `E${i}` }));
    });
    await settle();
    expect((read("items") as any[]).map((item) => item.status)).toEqual(["E0", "E1", "E2"]);
    expect(reg.globalWaits()).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });

  it("if の枝・入れ子の for の行の要素も、値が入り出力が state に届く", async () => {
    const tag = tagOf("scoped");
    const reg = scopedRegistry(tag, greetClass(tag));
    const error = spyError();
    const { root, read } = await page(
      `<div id="branch"><template data-wcs="if: show"><${tag} data-wcs="name: one.name; status: one.status"></${tag}></template></div>`
      + `<ul id="nested"><template data-wcs="for: groups"><li><template data-wcs="for: .items"><${tag} data-wcs="name: .name; status: .status"></${tag}></template></li></template></ul>`,
      { show: true, one: { name: "z", status: "-" }, groups: [{ items: [{ name: "a", status: "-" }] }] },
      (h) => reg.attach(h),
    );
    expect(texts(root, `#branch ${tag}`)).toEqual(["hello z"]);
    expect(texts(root, `#nested ${tag}`)).toEqual(["hello a"]);

    root.querySelector(`#branch ${tag}`)!.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: "EB" }));
    root.querySelector(`#nested ${tag}`)!.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: "EN" }));
    await settle();
    expect(read("one").status).toBe("EB");
    expect(read("groups")[0].items[0].status).toBe("EN");
    expect(reg.globalWaits()).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });

  const INIT = () => ({ show: true, nm: "SN", st: "SS", lb: "SL", items: [{ nm: "N0", st: "S0", lb: "L0" }] });
  const initHtml = (tag: string) =>
    `<ul id="rows"><template data-wcs="for: items"><li><${tag} data-wcs="name#init=element: .nm; status: .st; label: .lb"></${tag}></li></template></ul>`
    + `<div id="branch"><template data-wcs="if: show"><${tag} data-wcs="name#init=element: nm; status: st; label: lb"></${tag}></template></div>`;

  for (const registry of ["スコープ付き registry", "global registry（対照）"] as const) {
    it(`${registry} で定義済みのタグ: 足した行と開き直した if の枝の要素の値が state に入り、state の値で上書きされない`, async () => {
      const tag = tagOf("init");
      const writes: string[] = [];
      const cls = probeClass(tag, writes);
      const error = spyError();
      let attach: ((h: Element) => ShadowRoot) | undefined;
      if (registry === "スコープ付き registry") {
        const reg = scopedRegistry(tag, cls);
        attach = (h) => reg.attach(h);
      } else {
        customElements.define(tag, cls);
      }
      const { root, write, read } = await page(initHtml(tag), INIT(), attach);
      const elementWins = (rows: number) => {
        expect(writes).toEqual([]);
        const items = read("items") as any[];
        expect(items.map((item) => [item.nm, item.st])).toEqual(Array.from({ length: rows }, () => ["EL-N", "EL-S"]));
        expect([read("nm"), read("st")]).toEqual(["EL-N", "EL-S"]);
        // 入力専用のメンバー label にだけ state の値が入る
        const els = Array.from(root.querySelectorAll(tag)) as any[];
        expect(els.map((el) => el.label)).toEqual([...items.map((item) => item.lb), "SL"]);
      };
      elementWins(1);

      await write((s) => { s.items = [...s.items, { nm: "N1", st: "S1", lb: "L1" }]; s.show = false; });
      await write((s) => { s.show = true; });
      elementWins(2);
      expect(error).not.toHaveBeenCalled();
    });
  }
});

/**
 * #357 の修正で入った回帰（3.4.0 の中で直した）: 後から定義される要素の二つの待ち — two-way・イベント・初期同期と、
 * 値の遅延適用 — が逆順に走ると、初期同期の前に state の値が要素へ書かれる（`<wcs-storage value#init=element>` なら
 * 保存済みの値が state の初期値で上書きされる）。要素が値を持つ側のメンバーは、定義されても state の値を書かれない。
 */
describe("#357 後から定義される要素の初期同期と遅延適用の順序（要素が値を持つ側のメンバー）", () => {
  const MEMBERS = [
    { label: "出力専用メンバー", bind: (p: string) => `status: ${p}`, key: "st", element: "EL-S" as string | null },
    { label: "#init=element", bind: (p: string) => `name#init=element: ${p}`, key: "nm", element: "EL-N" as string | null },
    { label: "#init=none", bind: (p: string) => `name#init=none: ${p}`, key: "nm", element: null as string | null },
  ];

  for (const member of MEMBERS) {
    it(`最初から真の if の中身: ${member.label} へ state の値を書かない`, async () => {
      const tag = tagOf("order");
      const writes: string[] = [];
      const late = lateRegistry(tag, probeClass(tag, writes));
      const error = spyError();
      const { root, read } = await page(
        `<template data-wcs="if: show"><${tag} data-wcs="${member.bind(member.key)}"></${tag}></template>`,
        { show: true, [member.key]: "S" },
      );
      late.define();
      await settle();
      expect(writes).toEqual([]);
      expect(read(member.key)).toBe(member.element ?? "S");
      expect(root.querySelector(tag)).not.toBeNull();
      expect(error).not.toHaveBeenCalled();
    });

    it(`定義の前に足した行: ${member.label} へ state の値を書かない`, async () => {
      const tag = tagOf("order");
      const writes: string[] = [];
      const late = lateRegistry(tag, probeClass(tag, writes));
      const error = spyError();
      const { write, read } = await page(
        `<ul><template data-wcs="for: items"><li><${tag} data-wcs="${member.bind(`.${member.key}`)}"></${tag}></li></template></ul>`,
        { items: [{ [member.key]: "S0" }] },
      );
      await write((s) => { s.items = [...s.items, { [member.key]: "S1" }]; });
      late.define();
      await settle();
      expect(writes).toEqual([]);
      expect((read("items") as any[]).map((item) => item[member.key])).toEqual(
        member.element === null ? ["S0", "S1"] : [member.element, member.element],
      );
      expect(error).not.toHaveBeenCalled();
    });
  }
});
