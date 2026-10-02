import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getDefinitionCoordinator } from "../src/bindings/DefinitionCoordinator";

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
      this.textContent = `hello ${v}`;
    }
    get name(): unknown { return (this as any)._n; }
    get status(): unknown { return "ready"; }
  };
}

/**
 * スコープ付き CustomElementRegistry を持つ shadow root を、Chromium（149）で測った振る舞いで模す:
 * - `document.importNode(template.content, true)` の要素は、DocumentFragment の中では global registry を返す
 *   （global はこのタグを知らないので未定義のまま）
 * - スコープ付き registry の shadow root に差し込むとその registry に付け替わり、その場で upgrade される
 * happy-dom は registry の付け替えも差し込み時の upgrade もしないので、要素の registry の口で両方を模す
 * （shadow root の中で引かれたら upgrade して scoped を返す）。
 */
function scopedRegistry(tag: string, cls: CustomElementConstructor = greetClass(tag)) {
  const scoped = {
    get: (name: string) => (name === tag ? cls : customElements.get(name)),
    whenDefined: (name: string) => (name === tag ? Promise.resolve(cls) : customElements.whenDefined(name)),
    upgrade: (root: Node) => {
      if ((root as Element).localName === tag) Object.setPrototypeOf(root, cls.prototype);
    },
  };
  // global はこのタグを定義しない（定義されるまで待ち続ける）
  const global = {
    get: (name: string) => (name === tag ? undefined : customElements.get(name)),
    whenDefined: (name: string) => (name === tag ? new Promise<CustomElementConstructor>(() => {}) : customElements.whenDefined(name)),
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
    /** global registry で定義を待っている数（行の要素がこちらを待つのが #357 の欠陥） */
    pendingGlobal(): number { return getDefinitionCoordinator(global).pendingCount(tag); },
  };
}

async function mount(reg: ReturnType<typeof scopedRegistry>, html: string) {
  const host = document.createElement(uniqueTag("x-scoped-host"));
  const shadowRoot = reg.attach(host);
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

const ITEMS = `{"items":[{"name":"a","status":"-"},{"name":"b","status":"-"}],"one":{"name":"z","status":"-"}}`;

/**
 * #357: スコープ付き registry の shadow root で、最初に描いた一覧の行のカスタム要素への束縛が適用されず、
 * global registry を待ち続けていた。全行追加の経路は行を DocumentFragment の中で活性化するので、
 * 定義待ちの registry を fragment の中の要素から引いていた（global）。待つ先は差し込んだ後の木から引く。
 */
describe("スコープ付き registry の shadow root の一覧の行（#357）", () => {
  afterEach(() => {
    delete (HTMLElement.prototype as any).customElementRegistry;
  });

  for (const [form, rowBind] of [["プロパティの束縛", "name: .name"], ["spread", "...: ."]] as const) {
    it(`${form}: 最初に描いた行にも値が入り、global registry を待たないこと`, async () => {
      const tag = uniqueTag("x-scoped");
      const reg = scopedRegistry(tag);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const { host, shadowRoot, stateEl } = await mount(reg, `
        <wcs-state json='${ITEMS}'></wcs-state>
        <ul><template data-wcs="for: items"><li><${tag} data-wcs="${rowBind}"></${tag}></li></template></ul>
      `);

      expect(texts(shadowRoot, tag)).toEqual(["hello a", "hello b"]);
      expect(reg.pendingGlobal()).toBe(0);

      await write(stateEl, (s) => { s.items = [...s.items, { name: "c", status: "-" }]; });
      expect(texts(shadowRoot, tag)).toEqual(["hello a", "hello b", "hello c"]);
      await write(stateEl, (s) => { s["items.0.name"] = "A"; });
      expect(texts(shadowRoot, tag)).toEqual(["hello A", "hello b", "hello c"]);
      expect(reg.pendingGlobal()).toBe(0);
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
      host.remove();
    });
  }

  it("行の要素の出力（two-way のイベント）が、最初に描いた行でも後から足した行でも state に届くこと", async () => {
    const tag = uniqueTag("x-scoped");
    const reg = scopedRegistry(tag);
    const { host, shadowRoot, stateEl } = await mount(reg, `
      <wcs-state json='${ITEMS}'></wcs-state>
      <ul><template data-wcs="for: items"><li><${tag} data-wcs="name: .name; status: .status"></${tag}></li></template></ul>
    `);
    await write(stateEl, (s) => { s.items = [...s.items, { name: "c", status: "-" }]; });

    shadowRoot.querySelectorAll(tag).forEach((el, i) => {
      el.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: `E${i}` }));
    });
    await flushUpdates();
    expect((read(stateEl, "items") as any[]).map((item) => item.status)).toEqual(["E0", "E1", "E2"]);
    expect(reg.pendingGlobal()).toBe(0);
    host.remove();
  });

  it("if の枝・入れ子の for の行の要素も、値が入り出力が state に届くこと", async () => {
    const tag = uniqueTag("x-scoped");
    const reg = scopedRegistry(tag);
    const { host, shadowRoot, stateEl } = await mount(reg, `
      <wcs-state json='{"show":true,"one":{"name":"z","status":"-"},"groups":[{"items":[{"name":"a","status":"-"}]}]}'></wcs-state>
      <div id="branch"><template data-wcs="if: show"><${tag} data-wcs="name: one.name; status: one.status"></${tag}></template></div>
      <ul id="nested"><template data-wcs="for: groups"><li><template data-wcs="for: .items"><${tag} data-wcs="name: .name; status: .status"></${tag}></template></li></template></ul>
    `);
    expect(texts(shadowRoot, `#branch ${tag}`)).toEqual(["hello z"]);
    expect(texts(shadowRoot, `#nested ${tag}`)).toEqual(["hello a"]);

    shadowRoot.querySelector(`#branch ${tag}`)!.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: "EB" }));
    shadowRoot.querySelector(`#nested ${tag}`)!.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: "EN" }));
    await flushUpdates();
    expect((read(stateEl, "one") as any).status).toBe("EB");
    expect((read(stateEl, "groups") as any[])[0].items[0].status).toBe("EN");
    expect(reg.pendingGlobal()).toBe(0);
    host.remove();
  });
});

/**
 * name: two-way（出力 ＋ 入力）、status: 出力専用、label: 入力専用。要素の値は EL-N / EL-S。name と status への
 * 書き込みを `writes` に記録する（テストごとの配列 — 他のテストの遅れた書き込みを混ぜない）
 */
function initClass(tag: string, writes: string[]): CustomElementConstructor {
  return class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties: [
        { name: "status", event: `${tag}:status` },
        { name: "name", event: `${tag}:name` },
      ],
      inputs: [{ name: "name" }, { name: "label" }],
    };
    set name(v: unknown) { writes.push(`name=${String(v)}`); (this as any)._n = v; }
    get name(): unknown { return (this as any)._n ?? "EL-N"; }
    set status(v: unknown) { writes.push(`status=${String(v)}`); (this as any)._s = v; }
    get status(): unknown { return (this as any)._s ?? "EL-S"; }
    set label(v: unknown) { (this as any)._l = v; }
    get label(): unknown { return (this as any)._l; }
  };
}

const INIT_JSON = `{"show":true,"nm":"SN","st":"SS","lb":"SL","items":[{"nm":"N0","st":"S0","lb":"L0"}]}`;
function initHtml(tag: string): string {
  return `
    <wcs-state json='${INIT_JSON}'></wcs-state>
    <ul id="rows"><template data-wcs="for: items"><li><${tag} data-wcs="name#init=element: .nm; status: .st; label: .lb"></${tag}></li></template></ul>
    <div id="branch"><template data-wcs="if: show"><${tag} data-wcs="name#init=element: nm; status: st; label: lb"></${tag}></template></div>
  `;
}

/**
 * タグがスコープ付き registry に定義済みのとき、新しく作る Content — 後から足した行（先に文書へ差し込んでから
 * 活性化する経路）と if の枝の描画 — で、`#init=element` の要素と出力専用のメンバーへ state の値が書かれ、
 * 要素の値が消えていた（修正前から）。Content は fragment の中で作るので、そこでは global registry を見て
 * 「未定義」と判断して定義待ちを並べ、差し込むとスコープ付き registry で upgrade される。続く活性化が
 * 「定義済み」と見て値を直接書き、two-way・初期同期はその後だった。global registry で定義済みのページと同じく、
 * 要素の値が state に入り、入力専用のメンバーにだけ state の値が入る。
 */
describe("スコープ付き registry で定義済みのタグの新しい Content（#357）", () => {
  afterEach(() => {
    delete (HTMLElement.prototype as any).customElementRegistry;
  });

  function expectElementWins(writes: string[], stateEl: State, shadowRoot: ShadowRoot, tag: string, rows: number): void {
    expect(writes).toEqual([]);
    const items = read(stateEl, "items") as any[];
    expect(items.map((item) => [item.nm, item.st])).toEqual(Array.from({ length: rows }, () => ["EL-N", "EL-S"]));
    expect([read(stateEl, "nm"), read(stateEl, "st")]).toEqual(["EL-N", "EL-S"]);
    const els = Array.from(shadowRoot.querySelectorAll(tag)) as any[];
    expect(els.map((el) => el.label)).toEqual([...items.map((item) => item.lb), "SL"]);
  }

  for (const registry of ["スコープ付き registry", "global registry（対照）"] as const) {
    it(`${registry}: 足した行と if の枝の要素の値が state に入り、state の値で上書きされないこと`, async () => {
      const tag = uniqueTag("x-init");
      const writes: string[] = [];
      const cls = initClass(tag, writes);
      let shadowRoot: ShadowRoot, stateEl: State, host: HTMLElement;
      if (registry === "スコープ付き registry") {
        ({ host, shadowRoot, stateEl } = await mount(scopedRegistry(tag, cls), initHtml(tag)));
      } else {
        customElements.define(tag, cls);
        host = document.createElement(uniqueTag("x-global-host"));
        shadowRoot = host.attachShadow({ mode: "open" });
        shadowRoot.innerHTML = initHtml(tag);
        document.body.appendChild(host);
        stateEl = shadowRoot.querySelector("wcs-state") as State;
        await stateEl.connectedCallbackPromise;
        await State.getBindingsReady(shadowRoot);
        await flushUpdates();
      }
      expectElementWins(writes, stateEl, shadowRoot, tag, 1);

      await write(stateEl, (s) => { s.items = [...s.items, { nm: "N1", st: "S1", lb: "L1" }]; s.show = false; });
      await write(stateEl, (s) => { s.show = true; });
      expectElementWins(writes, stateEl, shadowRoot, tag, 2);
      host.remove();
    });
  }
});
