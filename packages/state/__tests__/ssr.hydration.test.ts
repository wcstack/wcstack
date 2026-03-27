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
});
