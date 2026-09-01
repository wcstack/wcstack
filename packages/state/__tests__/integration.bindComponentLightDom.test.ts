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
describe("bind-component: Light DOM の mapped 形（§1.13）", () => {
  async function mountMapped(
    stateName: string,
    componentTag: string,
    bindText: string,
    json = '{"user":{"name":"Alice"}}',
  ) {
    const host = document.createElement(uniqueTag("bcld-host"));
    const hostShadow = host.attachShadow({ mode: "open" });
    hostShadow.innerHTML =
      `<wcs-state json='${json}'></wcs-state>` +
      `<${componentTag} data-wcs="${bindText}"></${componentTag}>`;
    document.body.appendChild(host);

    const hostState = hostShadow.querySelector("wcs-state:not([name])") as State;
    await hostState.connectedCallbackPromise;
    // ホストのパスが張られてから子スコープが自分のパスを張る（§1.13）。
    // Shadow DOM 形と同じく、ホストの getBindingsReady は子スコープを含まない。
    await State.getBindingsReady(hostShadow);
    const innerState = hostShadow.querySelector(`wcs-state[name="${stateName}"]`) as State;
    await innerState.connectedCallbackPromise;
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
      {}, // v2 R1: 既定値はマッピングを隠す（D19）
      `<span class="inner" data-wcs="textContent: message@${stateName}"></span>`,
    );

    const { host, component } = await mountMapped(stateName, tag, "state.message: user.name");
    expect((component.querySelector(".inner") as HTMLElement).textContent).toBe("Alice");
    host.remove();
  });

  it("v2: ホスト配線のある Light DOM マウントは name 属性が要らないこと（L1 の unit 版）", async () => {
    const tag = uniqueTag("bcld-nameless");
    class NamelessLight extends HTMLElement {
      state: Record<string, any> = {};
      connectedCallback() {
        if (this.childElementCount === 0) {
          this.innerHTML =
            `<wcs-state bind-component="state"></wcs-state>` +
            `<span class="inner" data-wcs="textContent: name"></span>`;
        }
      }
    }
    customElements.define(tag, NamelessLight);
    const host = document.createElement(uniqueTag("bcld-host"));
    const hostShadow = host.attachShadow({ mode: "open" });
    hostShadow.innerHTML =
      `<wcs-state json='{"user":{"name":"Alice"}}'></wcs-state>` +
      `<${tag} data-wcs="state: user"></${tag}>`;
    document.body.appendChild(host);
    const hostState = hostShadow.querySelector("wcs-state") as State;
    await hostState.connectedCallbackPromise;
    await State.getBindingsReady(hostShadow);
    const component = hostShadow.querySelector(tag) as HTMLElement;
    await (component.querySelector("wcs-state") as State).connectedCallbackPromise;
    await flush();

    expect((component.querySelector(".inner") as HTMLElement).textContent).toBe("Alice");
    hostState.createState("writable", (s: any) => {
      s["user.name"] = "Noa";
    });
    await flush();
    expect((component.querySelector(".inner") as HTMLElement).textContent).toBe("Noa");

    host.remove();
  });

  it("Light DOM の丸ごとマウントは v1 経路のまま、差し替え通知と再接続の読み直しが効くこと", async () => {
    // v2 の単一ツリー化は Shadow DOM 形だけを切り替える（P3-7 まで）。Light DOM の
    // ルート規則は v1 の再読込通知（rootReloadPaths / boundPaths）と再接続の
    // ルート読み直し（_reloadMappedPathsAfterReconnect の rootPaths）に乗り続ける
    const tag = uniqueTag("bcld-root");
    const stateName = `sr${counter + 1}`;
    class LightRoot extends HTMLElement {
      state: Record<string, any> = {
        // v1 melt の bindProperty が $updatedCallback を配線する分岐も踏む
        $updatedCallback(_addresses: unknown[]) {},
      };
      connectedCallback() {
        if (this.childElementCount === 0) {
          this.innerHTML =
            `<wcs-state bind-component="state" name="${stateName}"></wcs-state>` +
            `<span class="name" data-wcs="textContent: name@${stateName}"></span>`;
        }
      }
    }
    customElements.define(tag, LightRoot);
    const { host, hostState, component } = await mountMapped(stateName, tag, "state: user");
    const inner = () => (component.querySelector(".name") as HTMLElement).textContent;

    expect(inner()).toBe("Alice");

    // 丸ごと差し替え → 値を運ばない再読込通知（子の登録済みパスの先頭セグメントを撃つ）
    hostState.createState("writable", (s: any) => {
      s.user = { name: "Dana" };
    });
    await flush();
    await flush();
    expect(inner()).toBe("Dana");

    // 切断中の書き込みは届かない（no-op）が、再接続でルート規則の全パスを読み直す
    const hostShadow = host.shadowRoot!;
    component.remove();
    await flush();
    hostState.createState("writable", (s: any) => {
      s["user.name"] = "Eve";
    });
    await flush();
    hostShadow.appendChild(component);
    await (component.querySelector("wcs-state") as State).connectedCallbackPromise;
    await flush();
    await flush();
    expect(inner()).toBe("Eve");

    host.remove();
  });

  it("親スコープ起点の書き込みが Light DOM の子に届くこと", async () => {
    const tag = uniqueTag("bcld-mapped");
    const stateName = `sm${counter}`;
    defineLightComponent(
      tag,
      stateName,
      {}, // v2 R1: 既定値はマッピングを隠す（D19）
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

  it("Light DOM の子からの書き戻しが親に届くこと", async () => {
    const tag = uniqueTag("bcld-mapped");
    const stateName = `sm${counter}`;
    defineLightComponent(
      tag,
      stateName,
      {}, // v2 R1: 既定値はマッピングを隠す（D19）
      `<span class="inner" data-wcs="textContent: message@${stateName}"></span>`,
    );

    const { host, hostState, component } = await mountMapped(
      stateName,
      tag,
      "state.message: user.name",
    );

    // v2: 子側の書き込みは公開 chroot（element.state）を通す
    (component as any).state.message = "Dave";
    await flush();

    expect((component.querySelector(".inner") as HTMLElement).textContent).toBe("Dave");
    let hostValue: unknown;
    hostState.createState("readonly", (s: any) => {
      hostValue = s["user.name"];
    });
    expect(hostValue).toBe("Dave");

    host.remove();
  });

  /**
   * §1.8 の相乗り経路（親起点の行フィールド書き込み）が、Light DOM の
   * 分離されたバインディングパスを通っても成立するか。
   */
  it("Light DOM の子スコープが親のリストを for で回せること", async () => {
    const tag = uniqueTag("bcld-mappedlist");
    const stateName = `sm${counter}`;
    defineLightComponent(
      tag,
      stateName,
      {}, // v2 R1（D19）
      `<ul><template data-wcs="for: items@${stateName}">` +
        `<li class="row" data-wcs="textContent: items.*.name@${stateName}"></li>` +
        `</template></ul>`,
    );

    const { host, hostState, component } = await mountMapped(
      stateName,
      tag,
      "state.items: rows",
      '{"rows":[{"name":"a"},{"name":"b"}]}',
    );

    const rows = () =>
      Array.from(component.querySelectorAll(".row")).map((el) => el.textContent);
    expect(rows()).toEqual(["a", "b"]);

    // 親起点の行フィールド書き込み
    hostState.createState("writable", (s: any) => {
      s["rows.0.name"] = "a2";
    });
    await flush();
    expect(rows()).toEqual(["a2", "b"]);

    // 親起点のリスト置換
    hostState.createState("writable", (s: any) => {
      s.rows = [{ name: "c" }, { name: "d" }, { name: "e" }];
    });
    await flush();
    expect(rows()).toEqual(["c", "d", "e"]);

    host.remove();
  });

  /**
   * Δ>0（コンポーネントがホストの `for` の中）。Light DOM では `name` が
   * 上位スコープと共有されるため、同じ name を 2 つ登録できない ＝
   * **行ごとにインスタンスを持つ形は Light DOM では成立しない**。
   * ここでは 1 行だけのリストで、Δ>0 の経路自体が通ることを見る。
   */
  it("ホストの for の中の Light DOM コンポーネントでも行の値が届くこと", async () => {
    const tag = uniqueTag("bcld-delta");
    const stateName = `sm${counter}`;
    defineLightComponent(
      tag,
      stateName,
      {}, // v2 R1（D19）
      `<span class="inner" data-wcs="textContent: row.name@${stateName}"></span>`,
    );

    const host = document.createElement(uniqueTag("bcld-host"));
    const hostShadow = host.attachShadow({ mode: "open" });
    hostShadow.innerHTML =
      `<wcs-state json='{"groups":[{"name":"G1"}]}'></wcs-state>` +
      `<template data-wcs="for: groups">` +
      `<${tag} data-wcs="state.row: groups.*"></${tag}>` +
      `</template>`;
    document.body.appendChild(host);

    const hostState = hostShadow.querySelector("wcs-state:not([name])") as State;
    await hostState.connectedCallbackPromise;
    await State.getBindingsReady(hostShadow);
    const innerState = hostShadow.querySelector(`wcs-state[name="${stateName}"]`) as State;
    await innerState.connectedCallbackPromise;
    await flush();

    const component = hostShadow.querySelector(tag) as HTMLElement;
    expect((component.querySelector(".inner") as HTMLElement).textContent).toBe("G1");

    hostState.createState("writable", (s: any) => {
      s["groups.0.name"] = "G1b";
    });
    await flush();
    expect((component.querySelector(".inner") as HTMLElement).textContent).toBe("G1b");

    host.remove();
  });
});
