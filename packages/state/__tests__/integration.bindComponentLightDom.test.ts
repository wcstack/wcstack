/**
 * Light DOM の `bind-component` の統合テスト。
 *
 * ADR-15 §1.1〜§1.12 の検証はすべて Shadow DOM 形で行われており、Light DOM 形は
 * **repo 全体でテストも example も 1 件も無い**（README にだけ存在する）。両者は経路が違う:
 *
 * - Shadow DOM は rootNode が閉じているので state の名前空間が無償で分離される
 * - Light DOM は名前空間を上位スコープと**共有**するため `name` が必須で、
 *   バインディングも `@name` で参照先を明示する必要がある
 *
 * 測った結果、**plain（親からバインドしない state 注入）は成立し、mapped（親から
 * `data-wcs` でバインドする形）は初期化がデッドロックする**（§1.13）。
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
 * Light DOM コンポーネントを定義する。`<wcs-state bind-component>` は要素直下に置き、
 * `name` を必須で付ける（名前空間が上位と共有されるため）。
 */
function defineLightComponent(
  tag: string,
  stateName: string,
  initialState: Record<string, any>,
  innerTemplate: string,
): void {
  class LightComponent extends HTMLElement {
    state: Record<string, any> = structuredClone(initialState);
    connectedCallback() {
      if (this.childElementCount === 0) {
        this.innerHTML =
          `<wcs-state bind-component="state" name="${stateName}"></wcs-state>${innerTemplate}`;
      }
    }
  }
  customElements.define(tag, LightComponent);
}

describe("bind-component: Light DOM の plain 形（state 注入）", () => {
  /**
   * 親からバインドしない形。値の正本はコンポーネント自身の `state` にあり、
   * Shadow DOM を使わずに `<wcs-state bind-component>` でリアクティブ化だけを受ける。
   * この経路は `waitInitializeBinding` を通らないので成立する。
   */
  async function mountPlain(stateName: string, componentTag: string) {
    const host = document.createElement(uniqueTag("bcld-host"));
    const hostShadow = host.attachShadow({ mode: "open" });
    hostShadow.innerHTML =
      `<wcs-state json='{"outer":"untouched"}'></wcs-state>` +
      `<${componentTag}></${componentTag}>`;
    document.body.appendChild(host);

    const hostState = hostShadow.querySelector("wcs-state:not([name])") as State;
    await hostState.connectedCallbackPromise;
    const innerState = hostShadow.querySelector(`wcs-state[name="${stateName}"]`) as State;
    await innerState.connectedCallbackPromise;
    await State.getBindingsReady(hostShadow);
    await flush();

    const component = hostShadow.querySelector(componentTag) as HTMLElement;
    return { host, hostShadow, innerState, component };
  }

  it("Light DOM でも state 注入で描画されること", async () => {
    const tag = uniqueTag("bcld-plain");
    const stateName = `sp${counter}`;
    defineLightComponent(
      tag,
      stateName,
      { message: "Hello" },
      `<span class="inner" data-wcs="textContent: message@${stateName}"></span>`,
    );

    const { host, component } = await mountPlain(stateName, tag);

    expect((component.querySelector(".inner") as HTMLElement).textContent).toBe("Hello");

    host.remove();
  });

  it("注入された state への書き込みが Light DOM の描画に反映されること", async () => {
    const tag = uniqueTag("bcld-plain");
    const stateName = `sp${counter}`;
    defineLightComponent(
      tag,
      stateName,
      { message: "Hello" },
      `<span class="inner" data-wcs="textContent: message@${stateName}"></span>`,
    );

    const { host, innerState, component } = await mountPlain(stateName, tag);
    const inner = component.querySelector(".inner") as HTMLElement;

    innerState.createState("writable", (s: any) => {
      s.message = "Updated";
    });
    await flush();

    expect(inner.textContent).toBe("Updated");

    host.remove();
  });

  it("Light DOM の子スコープが自分のリストを for で回せること", async () => {
    const tag = uniqueTag("bcld-plainlist");
    const stateName = `sp${counter}`;
    defineLightComponent(
      tag,
      stateName,
      { items: [{ name: "a" }, { name: "b" }] },
      `<ul><template data-wcs="for: items@${stateName}">` +
        `<li class="row" data-wcs="textContent: items.*.name@${stateName}"></li>` +
        `</template></ul>`,
    );

    const { host, innerState, component } = await mountPlain(stateName, tag);
    const rows = () =>
      Array.from(component.querySelectorAll(".row")).map((el) => el.textContent);
    expect(rows()).toEqual(["a", "b"]);

    innerState.createState("writable", (s: any) => {
      s["items.0.name"] = "a2";
    });
    await flush();
    expect(rows()).toEqual(["a2", "b"]);

    host.remove();
  });
});

/**
 * **§1.13（未修正）: mapped な Light DOM は初期化がデッドロックする。**
 *
 * 親から `data-wcs="state.message: user.name"` でバインドした Light DOM
 * コンポーネント —— README が Light DOM 節で説明している形 —— は、
 * `initializePromise` も `getBindingsReady` も永久に解決しない。
 *
 * 循環の実体（切り分け済み。plain 形＝`data-wcs` を外すと全部解決する）:
 *
 * 1. ホスト root の `buildBindings` は `waitForStateInitialize(root)` を通る。これは
 *    `root.querySelectorAll("wcs-state")` で **root 内の全 state 要素**の
 *    `initializePromise` を待つ。Light DOM ではコンポーネントの内側の `<wcs-state>` も
 *    同じ root にいるので、この集合に含まれてしまう
 * 2. その内側の state は `_initializeBindWebComponent` で
 *    `waitInitializeBinding(boundComponent)` を待つ（コンポーネント要素に `data-wcs` が
 *    あるため）
 * 3. その binding を作るのはホスト root の `initializeBindings()` で、これは 1 の
 *    `waitForStateInitialize` の**後**に走る
 *
 * → 1 が 2 を待ち、2 が 3 を待ち、3 は 1 の後。Shadow DOM 形では内側の state が
 * 別 rootNode にいるため 1 の集合に入らず、この循環は成立しない。
 * **rootNode による名前空間分離が、実は初期化順序の分離も担っていた**ということ。
 *
 * 単純に `waitForStateInitialize` から `bind-component` 付きを除くだけでは足りない。
 * Light DOM ではホスト側のバインディングとコンポーネント側のバインディングが
 * 同一 root・同一 `buildBindings` パスに同居しており、両者に依存順序があるため。
 *
 * 直したらこの describe の `.skip` を外すこと（そのまま回帰テストになる）。
 */
describe.skip("bind-component: Light DOM の mapped 形（§1.13・未修正）", () => {
  async function mountMapped(stateName: string, componentTag: string, bindText: string) {
    const host = document.createElement(uniqueTag("bcld-host"));
    const hostShadow = host.attachShadow({ mode: "open" });
    hostShadow.innerHTML =
      `<wcs-state json='{"user":{"name":"Alice"}}'></wcs-state>` +
      `<${componentTag} data-wcs="${bindText}"></${componentTag}>`;
    document.body.appendChild(host);

    const hostState = hostShadow.querySelector("wcs-state:not([name])") as State;
    await hostState.connectedCallbackPromise;
    const innerState = hostShadow.querySelector(`wcs-state[name="${stateName}"]`) as State;
    // ここが解決しない
    await innerState.connectedCallbackPromise;
    await State.getBindingsReady(hostShadow);
    await flush();

    const component = hostShadow.querySelector(componentTag) as HTMLElement;
    return { host, hostState, innerState, component };
  }

  it("初期配送が Light DOM でも届くこと", async () => {
    const tag = uniqueTag("bcld-mapped");
    const stateName = `sm${counter}`;
    defineLightComponent(
      tag,
      stateName,
      { message: "" },
      `<span class="inner" data-wcs="textContent: message@${stateName}"></span>`,
    );

    const { host, component } = await mountMapped(stateName, tag, "state.message: user.name");
    expect((component.querySelector(".inner") as HTMLElement).textContent).toBe("Alice");
    host.remove();
  });

  it("親スコープ起点の書き込みが Light DOM の子に届くこと", async () => {
    const tag = uniqueTag("bcld-mapped");
    const stateName = `sm${counter}`;
    defineLightComponent(
      tag,
      stateName,
      { message: "" },
      `<span class="inner" data-wcs="textContent: message@${stateName}"></span>`,
    );

    const { host, hostState, component } = await mountMapped(
      stateName,
      tag,
      "state.message: user.name",
    );
    hostState.createState("writable", (s: any) => {
      s["user.name"] = "Carol";
    });
    await flush();

    expect((component.querySelector(".inner") as HTMLElement).textContent).toBe("Carol");
    host.remove();
  });
});
