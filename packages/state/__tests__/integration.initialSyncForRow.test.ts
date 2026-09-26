import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

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

function defineOutputOnly(tag: string): void {
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties: [{ name: "status", event: `${tag}:status` }],
    };
    status: unknown = "ready";
  });
}

function defineTwoWay(tag: string): void {
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable",
      version: 1,
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

async function mount(html: string) {
  const host = document.createElement(uniqueTag("x-row-sync-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = html;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flushUpdates();
  return { host, shadowRoot, stateEl };
}

function readRows(stateEl: State): unknown {
  let rows: unknown;
  stateEl.createState("readonly", (state: any) => {
    rows = JSON.parse(JSON.stringify(state.rows));
  });
  return rows;
}

function texts(root: ParentNode, selector: string): (string | null)[] {
  return Array.from(root.querySelectorAll(selector)).map((node) => node.textContent);
}

/**
 * #319: 初期値を要素から受け取る wc-bindable メンバー（出力専用、`#init=element`、
 * `#init=auto` で state 側が未初期化）を `for:` の行に置く。行はバッチ fragment の上で
 * 活性化されるので、初期同期が `getRootNode()`（＝fragment）から state を引くと見つからず
 * 投げ、`for:` の反映ごと失敗して一覧が空のまま残っていた。
 * 要素のクラスを先に定義しておく — 未定義なら初期同期は定義待ちで後回しになり、
 * その頃には行が文書に入っているので踏まない（happy-dom の upgrade ノード差し替えも避ける）。
 */
describe("for: 行の中の初期同期（#319）", () => {
  let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

  afterEach(() => {
    errorSpy?.mockRestore();
    errorSpy = null;
  });

  function spyErrors(): ReturnType<typeof vi.spyOn> {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    return errorSpy;
  }

  it("出力専用メンバーを持つ定義済み要素を行に置いても一覧が描かれ、行の値は要素の値で初期化されること", async () => {
    const tag = uniqueTag("x-row-output");
    defineOutputOnly(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='{"rows":[{"st":"seed"},{"st":"s2"}]}'></wcs-state>
      <ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span>{{ .st }}</span></li></template></ul>
    `);

    expect(shadowRoot.querySelectorAll("li").length).toBe(2);
    expect(readRows(stateEl)).toEqual([{ st: "ready" }, { st: "ready" }]);
    expect(texts(shadowRoot, "span")).toEqual(["ready", "ready"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("双方向メンバーの #init=element も行ごとに要素の値を state へ取り込むこと", async () => {
    const tag = uniqueTag("x-row-store");
    defineTwoWay(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='{"rows":[{"n":"a"},{"n":"b"}]}'></wcs-state>
      <ul><template data-wcs="for: rows"><li><${tag} data-wcs="value#init=element: .n"></${tag}><span>{{ .n }}</span></li></template></ul>
    `);

    expect(readRows(stateEl)).toEqual([{ n: "persisted" }, { n: "persisted" }]);
    expect(texts(shadowRoot, "span")).toEqual(["persisted", "persisted"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("#init=auto は行ごとに、state に値のある行は state 側、無い行は要素側が勝つこと", async () => {
    const tag = uniqueTag("x-row-store");
    defineTwoWay(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='{"rows":[{"n":"a"},{"m":"b"}]}'></wcs-state>
      <ul><template data-wcs="for: rows"><li><${tag} data-wcs="value#init=auto: .n"></${tag}></li></template></ul>
    `);

    expect(readRows(stateEl)).toEqual([{ n: "a" }, { m: "b", n: "persisted" }]);
    const stores = Array.from(shadowRoot.querySelectorAll(tag)) as any[];
    expect(stores.map((store) => store.value)).toEqual(["a", "persisted"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("空の一覧に後から行を足しても描かれ、さらに足した行も描かれること", async () => {
    const tag = uniqueTag("x-row-output");
    defineOutputOnly(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='{"rows":[]}'></wcs-state>
      <ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span>{{ .st }}</span></li></template></ul>
    `);

    stateEl.createState("writable", (state: any) => {
      state.rows = [{ st: "seed" }, { st: "s2" }];
    });
    await flushUpdates();
    expect(texts(shadowRoot, "span")).toEqual(["ready", "ready"]);

    stateEl.createState("writable", (state: any) => {
      state.rows = [...state.rows, { st: "s3" }];
    });
    await flushUpdates();
    expect(texts(shadowRoot, "span")).toEqual(["ready", "ready", "ready"]);
    expect(readRows(stateEl)).toEqual([{ st: "ready" }, { st: "ready" }, { st: "ready" }]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("描いた一覧を新しい行オブジェクトの配列で丸ごと置き換えても（再取得相当）一覧が消えないこと", async () => {
    const tag = uniqueTag("x-row-output");
    defineOutputOnly(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='{"rows":[{"st":"seed"},{"st":"s2"}]}'></wcs-state>
      <ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span>{{ .st }}</span></li></template></ul>
    `);
    expect(shadowRoot.querySelectorAll("li").length).toBe(2);

    stateEl.createState("writable", (state: any) => {
      state.rows = [{ st: "x1" }, { st: "x2" }, { st: "x3" }];
    });
    await flushUpdates();

    expect(shadowRoot.querySelectorAll("li").length).toBe(3);
    expect(readRows(stateEl)).toEqual([{ st: "ready" }, { st: "ready" }, { st: "ready" }]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("行の中の if: の中に置いた要素も、初期表示で行ごと初期化されること", async () => {
    const tag = uniqueTag("x-row-output");
    defineOutputOnly(tag);
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(`
      <wcs-state json='{"rows":[{"on":true,"st":"seed"},{"on":true,"st":"s2"}]}'></wcs-state>
      <ul><template data-wcs="for: rows"><li><template data-wcs="if: .on"><${tag} data-wcs="status: .st"></${tag}></template><span>{{ .st }}</span></li></template></ul>
    `);

    expect(shadowRoot.querySelectorAll(tag).length).toBe(2);
    expect(readRows(stateEl)).toEqual([{ on: true, st: "ready" }, { on: true, st: "ready" }]);
    expect(texts(shadowRoot, "span")).toEqual(["ready", "ready"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});
