/**
 * bind-component の「親 state 起点の変更が子コンポーネントに届くか」の統合テスト。
 *
 * 既存のカバレッジは 2 方向しか固定していなかった:
 *   - 初期配送（子のバインディングが innerState 経由で親をライブ読みする）
 *   - 子起点の書き込み（子自身の setByAddress が子アドレスを enqueue する）
 * どちらも「子側のコードが動く」経路なので、親だけが書いたときに子の Shadow 内の
 * ビューが更新されるかは一度も通っていない。単体テストは isWebComponentComplete を
 * 丸ごとモックしており、この判定の実引数が合っているかを検証できない
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.7 / §6）。
 *
 * ここでは実モジュールだけで親スコープと子コンポーネントを組み立て、
 * 親 state への書き込みが子のビューに反映されることを観測可能な形で固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

/**
 * shadow 内に `<wcs-state bind-component="state">` と 1 つのビューを持つ
 * コンポーネントを定義する。innerTemplate は子スコープのマークアップ。
 */
function defineEditor(tag: string, initialState: Record<string, any>, innerTemplate: string): void {
  class Editor extends HTMLElement {
    state: Record<string, any> = structuredClone(initialState);
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      this.shadowRoot!.innerHTML =
        `<wcs-state bind-component="state"></wcs-state>${innerTemplate}`;
    }
  }
  customElements.define(tag, Editor);
}

/** 親スコープ（shadow root）を組み立て、親 state / 子 state の準備完了まで待つ。 */
async function mountParentScope(json: string, componentTag: string, componentBindText: string) {
  const host = document.createElement(uniqueTag("bcd-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `
    <wcs-state json='${json}'></wcs-state>
    <div id="host-view" data-wcs="textContent: user.name"></div>
    <${componentTag} data-wcs="${componentBindText}"></${componentTag}>
  `;
  document.body.appendChild(host);

  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);

  const component = shadowRoot.querySelector(componentTag) as HTMLElement;
  const childShadow = component.shadowRoot!;
  const childStateElement = childShadow.querySelector("wcs-state") as State;
  await childStateElement.connectedCallbackPromise;
  await State.getBindingsReady(childShadow);
  await flush();

  const hostView = () => (shadowRoot.querySelector("#host-view") as HTMLElement).textContent;
  const innerView = () => (childShadow.querySelector("#inner-view") as HTMLElement).textContent;

  return { host, shadowRoot, parentStateElement, component, childShadow, hostView, innerView };
}

describe("bind-component: 親 state 起点の変更配送 (integration)", () => {
  it("マップされたパスそのものへの親の書き込みが子のビューに届くこと", async () => {
    const tag = uniqueTag("bcd-editor");
    defineEditor(tag, { name: "" }, `<span id="inner-view" data-wcs="textContent: name"></span>`);

    const { host, parentStateElement, hostView, innerView } = await mountParentScope(
      '{"user":{"name":"Alice"}}',
      tag,
      "state.name: user.name",
    );

    // 初期配送（従来から成立している経路）
    expect(hostView()).toBe("Alice");
    expect(innerView()).toBe("Alice");

    // 親だけが書く。子のコードは一切動かない。
    parentStateElement.createState("writable", (s: any) => {
      s["user.name"] = "Carol";
    });
    await flush();

    expect(hostView()).toBe("Carol");
    expect(innerView()).toBe("Carol");

    host.remove();
  });

  it("マップ先より深いサブパスへの親の書き込みが子のビューに届くこと", async () => {
    const tag = uniqueTag("bcd-editor");
    defineEditor(tag, { user: {} }, `<span id="inner-view" data-wcs="textContent: user.name"></span>`);

    const { host, parentStateElement, hostView, innerView } = await mountParentScope(
      '{"user":{"name":"Alice"}}',
      tag,
      "state.user: user",
    );

    expect(hostView()).toBe("Alice");
    expect(innerView()).toBe("Alice");

    parentStateElement.createState("writable", (s: any) => {
      s["user.name"] = "Dave";
    });
    await flush();

    expect(hostView()).toBe("Dave");
    expect(innerView()).toBe("Dave");

    host.remove();
  });

  /**
   * 完了台帳のキーが stateProp 名になったことで、`data-wcs="state: user"` のように
   * stateProp をそのままプロパティ名に書いた形（propSegments が 1 セグメント）も
   * ゲートを通ってしまう。applyChangeToWebComponent は「先頭＝束ね先、残り＝子のパス」を
   * 前提にしており残余が空だと raiseError するため、updater の drain（例外を捕まえない）を
   * 突き抜けて同じバッチの無関係な更新まで巻き添えにする。
   * この形は元から無言の no-op なので、そのまま no-op に留めることを固定する。
   */
  it("stateProp と同名の 1 セグメントバインディングが同じバッチの他の更新を巻き添えにしないこと", async () => {
    const tag = uniqueTag("bcd-editor");
    defineEditor(tag, { name: "" }, `<span id="inner-view" data-wcs="textContent: name"></span>`);

    const host = document.createElement(uniqueTag("bcd-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <wcs-state json='{"user":{"name":"Alice"}}'></wcs-state>
      <div id="host-view" data-wcs="textContent: user.name"></div>
      <${tag} data-wcs="state: user"></${tag}>
    `;
    document.body.appendChild(host);

    const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
    await parentStateElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();

    const hostView = () => (shadowRoot.querySelector("#host-view") as HTMLElement).textContent;
    expect(hostView()).toBe("Alice");

    // バインドされたパスそのものへの書き込み。同じバッチに #host-view の更新も乗る。
    parentStateElement.createState("writable", (s: any) => {
      s.user = { name: "Carol" };
    });
    await flush();

    // 1 セグメント側は従来どおり何も起きないが、同じバッチの更新は完走する
    expect(hostView()).toBe("Carol");

    host.remove();
  });
});
