import { describe, it, expect } from "vitest";
import { bootstrapState } from "../src/bootstrapState";

beforeAll(() => {
  bootstrapState();
});

describe("ハイドレーション後のイベントハンドラ", () => {
  it("通常要素のイベントハンドラが動作する", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"count":0}</script>
      </wcs-ssr>
      <wcs-state enable-ssr name="default"></wcs-state>
      <button data-wcs="onclick: increment">Click</button>
      <span data-wcs="textContent: count">0</span>
    `;

    // メソッドを含む state を API でセット
    const stateEl = document.querySelector("wcs-state") as any;
    stateEl.setInitialState({
      count: 0,
      increment() { this.count++; },
    });
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // SSR データで count=0 に上書きされている
    expect(stateEl.__state.count).toBe(0);
    // increment メソッドが存在する
    expect(typeof stateEl.__state.increment).toBe("function");

    // クリックでイベントハンドラが動作する
    const button = document.querySelector("button")!;
    button.click();
    await new Promise(resolve => setTimeout(resolve, 100));

    const span = document.querySelector("span")!;
    expect(span.textContent).toBe("1");
  });

  it("for ブロック内の要素にイベントハンドラが登録されている", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"items":[{"name":"Alice"},{"name":"Bob"}]}</script>
        <template id="u0" data-wcs="for: items">
          <div>
            <span data-wcs="textContent: .name"></span>
            <button data-wcs="onclick: select">Select</button>
          </div>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr name="default"></wcs-state>
      <!--@@wcs-for:u0-->
      <!--@@wcs-for-start:u0:items:0--><div><span data-wcs="textContent: items.*.name">Alice</span><button data-wcs="onclick: select">Select</button></div><!--@@wcs-for-end:u0:items:0-->
      <!--@@wcs-for-start:u0:items:1--><div><span data-wcs="textContent: items.*.name">Bob</span><button data-wcs="onclick: select">Select</button></div><!--@@wcs-for-end:u0:items:1-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    stateEl.setInitialState({
      items: [],
      select(_e: Event, _index: number) {},
    });
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // ボタンが2つ存在してバインド済み
    const buttons = document.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0].hasAttribute("data-wcs-completed")).toBe(false);
    expect(buttons[1].hasAttribute("data-wcs-completed")).toBe(false);
  });

  it("if ブロック内の要素にイベントハンドラが登録されている", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"show":true,"count":0}</script>
        <template id="u0" data-wcs="if: show">
          <button data-wcs="onclick: increment">Click</button>
          <span data-wcs="textContent: count">0</span>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr name="default"></wcs-state>
      <!--@@wcs-if:u0-->
      <!--@@wcs-if-start:u0:show--><button data-wcs="onclick: increment">Click</button><span data-wcs="textContent: count">0</span><!--@@wcs-if-end:u0:show-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    stateEl.setInitialState({
      show: true,
      count: 0,
      increment() { this.count++; },
    });
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    const button = document.querySelector("button")!;
    expect(button).not.toBeNull();
    expect(button.hasAttribute("data-wcs-completed")).toBe(false);

    // if ブロック内のボタンクリックでイベントが動作する
    button.click();
    await new Promise(resolve => setTimeout(resolve, 100));

    const span = document.querySelector("span")!;
    expect(span.textContent).toBe("1");
  });
});
