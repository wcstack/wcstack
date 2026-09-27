import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getDefinitionCoordinator } from "../src/bindings/DefinitionCoordinator";
import { BindingSession } from "../src/bindings/BindingSession";

beforeAll(() => {
  bootstrapState();
});

let counter = 0;
function uniqueTag(prefix: string): string {
  return `${prefix}-${++counter}`;
}

async function flushUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * 後から定義される要素。コンストラクタは走らない（下の registry が upgrade をプロトタイプの
 * 付け替えで模す）ので、フィールド初期化子を持たせない。
 */
function greetClass(tag: string): CustomElementConstructor {
  return class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable",
      version: 1,
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
 * 1 つのタグだけ「後から定義される」registry。happy-dom は接続済みの未定義要素を
 * `customElements.define` で別ノードに差し替える（integration.spreadDeferred.test.ts の注記）ので、
 * 本物の define では同じノードへの展開を確かめられない。state は要素の registry を
 * `element.customElementRegistry`（スコープ付き registry の口）から引くので、そこに差し込む。
 * 実ブラウザ（Chromium）での本物の define は Issue #330 の検証で別に確かめた。
 */
function lateRegistry(tag: string) {
  const cls = greetClass(tag);
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
    get(this: Element) { return this.localName === tag ? registry : undefined; },
  });
  return {
    define(): void { defined = true; resolve(cls); },
    /** この registry で定義を待っている数（行ごとの待ち） */
    pending(): number { return getDefinitionCoordinator(registry).pendingCount(tag); },
  };
}

async function mount(html: string) {
  const host = document.createElement(uniqueTag("x-spread-tpl-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = html;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flushUpdates();
  return { host, shadowRoot, stateEl };
}

function read(stateEl: State, path: string): unknown {
  let value: unknown;
  stateEl.createState("readonly", (state: any) => {
    value = JSON.parse(JSON.stringify(state[path]));
  });
  return value;
}

async function write(stateEl: State, fn: (state: any) => void): Promise<void> {
  stateEl.createState("writable", fn);
  await flushUpdates();
}

function texts(root: ParentNode, selector: string): (string | null)[] {
  return Array.from(root.querySelectorAll(selector)).map((node) => node.textContent);
}

const PEOPLE = `{"people":[{"name":"a"},{"name":"b"}]}`;

/**
 * #330: `for:` / `if:` のテンプレートの中の spread（`...: rows.*` / `...: .`）が未定義の
 * カスタム要素に付いていると、テンプレートの束縛が spread を遅延せずに投げ、`for:` ごと
 * 描画に失敗していた（行が 1 つも出ない）。ルートと同じく定義まで展開を遅らせ、定義後に
 * その行のループ文脈で展開する。遅延中に消えた行は展開しない。
 */
describe("構造テンプレートの中の遅延 spread（#330）", () => {
  let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

  afterEach(() => {
    errorSpy?.mockRestore();
    errorSpy = null;
    delete (HTMLElement.prototype as any).customElementRegistry;
  });

  function spyErrors(): ReturnType<typeof vi.spyOn> {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    return errorSpy;
  }

  it("for の行の `...: .` は定義まで遅れ、定義後に行ごとに展開されること（一覧は先に描かれる）", async () => {
    const tag = uniqueTag("x-greet");
    const late = lateRegistry(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='${PEOPLE}'></wcs-state>
      <ul><template data-wcs="for: people"><li><${tag} data-wcs="...: ."></${tag}></li></template></ul>
    `);

    expect(shadowRoot.querySelectorAll("li").length).toBe(2);
    expect(texts(shadowRoot, tag)).toEqual(["", ""]);
    expect(late.pending()).toBe(2);

    late.define();
    await flushUpdates();
    expect(texts(shadowRoot, tag)).toEqual(["hello a", "hello b"]);
    // 出力専用メンバーの初期同期（#319）も行ごとに成り立つ — 要素の値が state に入る
    expect(read(stateEl, "people")).toEqual([{ name: "a", status: "ready" }, { name: "b", status: "ready" }]);
    expect(late.pending()).toBe(0);

    // 展開した束縛は行の束縛として state の書き込みに追従する
    await write(stateEl, (state) => { state["people.1.name"] = "bb"; });
    expect(texts(shadowRoot, tag)).toEqual(["hello a", "hello bb"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("for の行の `...: people.*` も同じく定義後に展開され、定義済みで作った行と同じくパスの欠落を報告しないこと", async () => {
    const tag = uniqueTag("x-greet");
    const late = lateRegistry(tag);
    const errors = spyErrors();
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='${PEOPLE}'></wcs-state>
      <ul><template data-wcs="for: people"><li><${tag} data-wcs="...: people.*"></${tag}></li></template></ul>
    `);

    expect(shadowRoot.querySelectorAll("li").length).toBe(2);
    late.define();
    await flushUpdates();
    expect(texts(shadowRoot, tag)).toEqual(["hello a", "hello b"]);
    // 定義後に足した行（遅延なしで展開する）と揃う: 行の束縛は state のパス台帳に載せないので、
    // 要素が埋める出力専用メンバー（`people.*.status`）を「state に無いパス」と報告しない
    await write(stateEl, (state) => { state.people = [...state.people, { name: "c" }]; });
    expect(texts(shadowRoot, tag)).toEqual(["hello a", "hello b", "hello c"]);
    expect(read(stateEl, "people")).toEqual([
      { name: "a", status: "ready" }, { name: "b", status: "ready" }, { name: "c", status: "ready" },
    ]);
    const missing = warns.mock.calls.filter((call) => String(call[0]).includes("binding-path-missing"));
    warns.mockRestore();
    expect(missing).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("if のテンプレートの中の spread も定義後に展開されること", async () => {
    const tag = uniqueTag("x-greet");
    const late = lateRegistry(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='{"show":true,"one":{"name":"z"}}'></wcs-state>
      <div><template data-wcs="if: show"><${tag} data-wcs="...: one"></${tag}></template></div>
    `);

    expect(shadowRoot.querySelectorAll(tag).length).toBe(1);
    late.define();
    await flushUpdates();
    expect(texts(shadowRoot, tag)).toEqual(["hello z"]);
    expect(read(stateEl, "one")).toEqual({ name: "z", status: "ready" });
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("定義前に消えた行は定義後も展開せず、待ちも残さないこと", async () => {
    const tag = uniqueTag("x-greet");
    const late = lateRegistry(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='${PEOPLE}'></wcs-state>
      <ul><template data-wcs="for: people"><li><${tag} data-wcs="...: ."></${tag}></li></template></ul>
    `);
    const removed = shadowRoot.querySelector(tag) as any;

    await write(stateEl, (state) => { state.people = state.people.slice(1); });
    expect(texts(shadowRoot, tag)).toEqual([""]);
    expect(late.pending()).toBe(1);

    late.define();
    await flushUpdates();
    expect(texts(shadowRoot, tag)).toEqual(["hello b"]);
    expect(removed.isConnected).toBe(false);
    expect(removed.name).toBeUndefined();
    expect(removed.textContent).toBe("");
    expect(read(stateEl, "people")).toEqual([{ name: "b", status: "ready" }]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("定義前にプールへ戻した行を定義前に使い回すと、新しい行のループ文脈で展開されること", async () => {
    const tag = uniqueTag("x-greet");
    const late = lateRegistry(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='${PEOPLE}'></wcs-state>
      <ul><template data-wcs="for: people"><li><${tag} data-wcs="...: ."></${tag}></li></template></ul>
    `);
    const first = shadowRoot.querySelector(tag);

    await write(stateEl, (state) => { state.people = state.people.slice(1); });
    await write(stateEl, (state) => { state.people = [...state.people, { name: "c" }]; });
    // 行 a の Content を行 c が使い回している（同じ要素）
    expect(shadowRoot.querySelectorAll(tag)[1]).toBe(first);
    expect(late.pending()).toBe(2);

    late.define();
    await flushUpdates();
    expect(texts(shadowRoot, tag)).toEqual(["hello b", "hello c"]);
    expect(read(stateEl, "people")).toEqual([{ name: "b", status: "ready" }, { name: "c", status: "ready" }]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("定義前にプールへ戻した行を定義後に使い回すと、使い回した行で展開されること", async () => {
    const tag = uniqueTag("x-greet");
    const late = lateRegistry(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='${PEOPLE}'></wcs-state>
      <ul><template data-wcs="for: people"><li><${tag} data-wcs="...: ."></${tag}></li></template></ul>
    `);
    const first = shadowRoot.querySelector(tag);

    await write(stateEl, (state) => { state.people = state.people.slice(1); });
    late.define();
    await flushUpdates();
    expect(texts(shadowRoot, tag)).toEqual(["hello b"]);

    await write(stateEl, (state) => { state.people = [...state.people, { name: "c" }]; });
    expect(shadowRoot.querySelectorAll(tag)[1]).toBe(first);
    expect(texts(shadowRoot, tag)).toEqual(["hello b", "hello c"]);
    expect(late.pending()).toBe(0);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("定義後に展開した行はプールから使い回しても新しい行の値で描かれ、書き込みに追従すること", async () => {
    const tag = uniqueTag("x-greet");
    const late = lateRegistry(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='${PEOPLE}'></wcs-state>
      <ul><template data-wcs="for: people"><li><${tag} data-wcs="...: ."></${tag}></li></template></ul>
    `);
    late.define();
    await flushUpdates();
    const first = shadowRoot.querySelector(tag) as any;
    expect(first.sets).toBe(1);
    const defer = vi.spyOn(BindingSession.prototype, "deferUntilDefined");

    await write(stateEl, (state) => { state.people = state.people.slice(1); });
    await write(stateEl, (state) => { state.people = [...state.people, { name: "c" }]; });
    expect(shadowRoot.querySelectorAll(tag)[1]).toBe(first);
    expect(texts(shadowRoot, tag)).toEqual(["hello b", "hello c"]);
    // 展開は一度きり — 使い回しの活性化は展開した束縛を 1 組だけ動かし、定義待ちを予約し直さない
    //（し直すと展開し直した束縛が使い回しのたびに行の束縛の列へ積み上がる）
    expect(first.sets).toBe(2);
    expect(defer.mock.calls.filter((call) => call[1] === tag)).toEqual([]);
    defer.mockRestore();

    await write(stateEl, (state) => { state["people.1.name"] = "cc"; });
    expect(texts(shadowRoot, tag)).toEqual(["hello b", "hello cc"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("定義前に if の枝が閉じたら展開せず、定義後に開き直すと展開されること", async () => {
    const tag = uniqueTag("x-greet");
    const late = lateRegistry(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='{"show":true,"one":{"name":"z"}}'></wcs-state>
      <div><template data-wcs="if: show"><${tag} data-wcs="...: one"></${tag}></template></div>
    `);
    const el = shadowRoot.querySelector(tag) as any;

    await write(stateEl, (state) => { state.show = false; });
    expect(late.pending()).toBe(0);
    late.define();
    await flushUpdates();
    expect(el.name).toBeUndefined();

    await write(stateEl, (state) => { state.show = true; });
    expect(shadowRoot.querySelector(tag)).toBe(el);
    expect(texts(shadowRoot, tag)).toEqual(["hello z"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("開いたままの if の枝を定義前に適用し直しても待ちを重ねず、展開は一度きりであること", async () => {
    const tag = uniqueTag("x-greet");
    const late = lateRegistry(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='{"count":1,"one":{"name":"z"}}'></wcs-state>
      <div><template data-wcs="if: count"><${tag} data-wcs="...: one"></${tag}></template></div>
    `);
    expect(late.pending()).toBe(1);

    // 真→真: 枝は開いたまま activateContent がもう一度走る
    await write(stateEl, (state) => { state.count = 2; });
    await write(stateEl, (state) => { state.count = 3; });
    expect(late.pending()).toBe(1);

    const el = shadowRoot.querySelector(tag) as any;
    const setter = vi.fn();
    Object.defineProperty(el, "name", { configurable: true, set: setter, get: () => undefined });
    late.define();
    await flushUpdates();
    expect(setter).toHaveBeenCalledTimes(1);
    expect(setter).toHaveBeenCalledWith("z");
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("spread と明示の束縛を併せた要素は、定義後の展開でも明示の束縛が後勝ちすること", async () => {
    const tag = uniqueTag("x-greet");
    const late = lateRegistry(tag);
    const errors = spyErrors();
    const { host, shadowRoot } = await mount(`
      <wcs-state json='{"people":[{"name":"a","nick":"A"},{"name":"b","nick":"B"}]}'></wcs-state>
      <ul><template data-wcs="for: people"><li><${tag} data-wcs="...: .; name: .nick"></${tag}></li></template></ul>
    `);

    expect(shadowRoot.querySelectorAll("li").length).toBe(2);
    late.define();
    await flushUpdates();
    expect(texts(shadowRoot, tag)).toEqual(["hello A", "hello B"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("展開した要素の添字の束縛（`$1`）も、行の添字が変わると当て直されること", async () => {
    const tag = uniqueTag("x-greet");
    const late = lateRegistry(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='${PEOPLE}'></wcs-state>
      <ul><template data-wcs="for: people"><li><${tag} data-wcs="...: .; attr.data-i: $1"></${tag}></li></template></ul>
    `);
    late.define();
    await flushUpdates();
    const indexes = () => Array.from(shadowRoot.querySelectorAll(tag)).map((el) => el.getAttribute("data-i"));
    expect(indexes()).toEqual(["0", "1"]);

    await write(stateEl, (s) => { s.people = [{ name: "z" }, ...s.people]; });
    expect(indexes()).toEqual(["0", "1", "2"]);
    await write(stateEl, (s) => { s.people = s.people.slice().reverse(); });
    expect(indexes()).toEqual(["0", "1", "2"]);
    expect(texts(shadowRoot, tag)).toEqual(["hello b", "hello a", "hello z"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("祖先を走査し直しても（binder）行の待ちを二重に予約せず、展開した行の要素のイベントが state に届くこと", async () => {
    const tag = uniqueTag("x-greet");
    const late = lateRegistry(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='{"title":"T","people":[{"name":"a"},{"name":"b"}]}'></wcs-state>
      <div id="box"><ul><template data-wcs="for: people"><li><${tag} data-wcs="...: ."></${tag}></li></template></ul></div>
    `);
    const p = document.createElement("p");
    p.setAttribute("data-wcs", "textContent: title");
    shadowRoot.getElementById("box")!.append(p);
    (globalThis as any)[Symbol.for("wcstack.binder")].bind(p);
    await flushUpdates();
    expect(p.textContent).toBe("T");
    expect(late.pending()).toBe(2);

    late.define();
    await flushUpdates();
    expect(texts(shadowRoot, tag)).toEqual(["hello a", "hello b"]);
    shadowRoot.querySelectorAll(tag).forEach((el, i) => {
      el.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: `E${i}` }));
    });
    await flushUpdates();
    expect((read(stateEl, "people") as any[]).map((person) => person.status)).toEqual(["E0", "E1"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});
