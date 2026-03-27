import { describe, it, expect } from "vitest";
import { bootstrapState } from "../src/bootstrapState";

beforeAll(() => {
  bootstrapState();
});

describe("ハイドレーション: テキストバインディング復元", () => {
  it("Mustache テキストが @@: コメントに復元されてバインディングが動作する", async () => {
    // SSR 出力を模擬: <!--@@wcs-text-start:name-->Alice<!--@@wcs-text-end:name-->
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"name":"Alice"}</script>
      </wcs-ssr>
      <wcs-state enable-ssr name="default" json='{"name":""}'></wcs-state>
      <p>Hello <!--@@wcs-text-start:name-->Alice<!--@@wcs-text-end:name-->!</p>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // テキストが正しく復元されている
    const p = document.querySelector("p")!;
    expect(p.textContent).toBe("Hello Alice!");
  });

  it("複数の Mustache テキストが復元される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"first":"John","last":"Doe"}</script>
      </wcs-ssr>
      <wcs-state enable-ssr name="default" json='{"first":"","last":""}'></wcs-state>
      <p><!--@@wcs-text-start:first-->John<!--@@wcs-text-end:first--> <!--@@wcs-text-start:last-->Doe<!--@@wcs-text-end:last--></p>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    const p = document.querySelector("p")!;
    expect(p.textContent).toBe("John Doe");
  });

  it("テキストバインディングが状態変化に反応する", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"count":42}</script>
      </wcs-ssr>
      <wcs-state enable-ssr name="default"></wcs-state>
      <span>Count: <!--@@wcs-text-start:count-->42<!--@@wcs-text-end:count--></span>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    stateEl.setInitialState({ count: 42 });
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    const span = document.querySelector("span")!;
    expect(span.textContent).toBe("Count: 42");

    // 状態を変更
    stateEl.createState("writable", (state: any) => {
      state.count = 99;
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(span.textContent).toBe("Count: 99");
  });

  it("data-wcs='textContent:' バインディングも動作する", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"msg":"Hello SSR"}</script>
      </wcs-ssr>
      <wcs-state enable-ssr name="default"></wcs-state>
      <div data-wcs="textContent: msg">Hello SSR</div>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    stateEl.setInitialState({ msg: "Hello SSR" });
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    const div = document.querySelector("div")!;
    expect(div.textContent).toBe("Hello SSR");

    // 状態を変更
    stateEl.createState("writable", (state: any) => {
      state.msg = "Updated";
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(div.textContent).toBe("Updated");
  });
});
