import { describe, it, expect } from "vitest";
import { bootstrapState } from "../src/bootstrapState";

beforeAll(() => {
  bootstrapState();
});

describe("enable-ssr ハイドレーション", () => {
  it("enable-ssr の場合 <wcs-ssr> の JSON から初期データを取得する", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"message":"Hello from SSR"}</script>
      </wcs-ssr>
      <wcs-state enable-ssr name="default"></wcs-state>
      <div data-wcs="textContent: message"></div>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    stateEl.setInitialState({
      message: "",
      async $connectedCallback() {
        this.message = "should not run";
      }
    });
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // SSR データが使われている（$connectedCallback の値ではない）
    expect(stateEl.__state.message).toBe("Hello from SSR");

    // バインディングが適用されている
    const div = document.querySelector("div");
    expect(div?.textContent).toBe("Hello from SSR");
  });

  it("enable-ssr の場合 $connectedCallback は呼ばれない", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"count":42}</script>
      </wcs-ssr>
      <wcs-state enable-ssr name="default" json='{"count":0}'></wcs-state>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;

    // SSR データが優先される
    expect(stateEl.__state.count).toBe(42);
  });

  it("enable-ssr がない場合は通常通り $connectedCallback が呼ばれる", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"message":"normal"}'></wcs-state>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;

    expect(stateEl.__state.message).toBe("normal");
  });

  it("enable-ssr で名前付き state も <wcs-ssr> から取得する", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="cart">
        <script type="application/json">{"items":["apple","banana"]}</script>
      </wcs-ssr>
      <wcs-state enable-ssr name="cart" json='{"items":[]}'></wcs-state>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;

    expect(stateEl.__state.items).toEqual(["apple", "banana"]);
  });

  it("enable-ssr で <wcs-ssr> が見つからない場���は通常の初期化を行う", async () => {
    document.body.innerHTML = `
      <wcs-state enable-ssr json='{"count":10}'></wcs-state>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;

    // wcs-ssr がないので json 属性の値がそのまま使わ��る
    expect(stateEl.__state.count).toBe(10);
  });

  it("enable-ssr で <wcs-ssr> の stateData が空の場合�� null 扱いになる", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{}</script>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"count":5}'></wcs-state>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;

    // 空の SSR データなので json 属性の値がそのまま使われる
    expect(stateEl.__state.count).toBe(5);
  });

  it("enable-ssr で SSR データのマージ時に getter/setter はスキップされる", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"count":99,"computed":999}</script>
      </wcs-ssr>
      <wcs-state enable-ssr name="default"></wcs-state>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    stateEl.setInitialState({
      count: 0,
      get computed() { return this.count * 2; },
    });
    await stateEl.connectedCallbackPromise;

    // count は SSR データで上書きされる
    expect(stateEl.__state.count).toBe(99);
    // getter は定義側が優先され、SSR 値 (999) では上書きされ��い
    expect(stateEl.__state.computed).toBe(198); // 99 * 2
  });

  it("enable-ssr で parentNode がない場合は null を返す", () => {
    const stateEl = document.createElement("wcs-state");
    stateEl.setAttribute("enable-ssr", "");
    // DOM に追加しない（parentNode === null）
    const result = (stateEl as any)._loadFromSsrElement();
    expect(result).toBeNull();
  });

  it("enable-ssr で SSR データに state 定義にないキーがある場合もマージされる", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"count":10,"extra":"new-key"}</script>
      </wcs-ssr>
      <wcs-state enable-ssr name="default" json='{"count":0}'></wcs-state>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;

    expect(stateEl.__state.count).toBe(10);
    expect(stateEl.__state.extra).toBe("new-key");
  });

  it("enable-ssr で SSR データのマージ時に関数はスキップされる", async () => {
    let callCount = 0;
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"count":50,"greet":"overwritten"}</script>
      </wcs-ssr>
      <wcs-state enable-ssr name="default"></wcs-state>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    stateEl.setInitialState({
      count: 0,
      greet() { callCount++; return "hello"; },
    });
    await stateEl.connectedCallbackPromise;

    // count は SSR データで上書き
    expect(stateEl.__state.count).toBe(50);
    // 関数は定義側が優先、文字列 "overwritten" では��書きされない
    expect(typeof stateEl.__state.greet).toBe("function");
    expect(stateEl.__state.greet()).toBe("hello");
  });
});
