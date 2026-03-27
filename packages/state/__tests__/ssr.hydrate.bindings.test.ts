import { describe, it, expect } from "vitest";
import { bootstrapState } from "../src/bootstrapState";

beforeAll(() => {
  bootstrapState();
});

describe("hydrateBindings", () => {
  it("通常バインディング: textContent がSSRデータで復元される", async () => {
    // SSR 出力を模擬: <wcs-ssr> + enable-ssr + レンダリング済み DOM
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"message":"Hello SSR"}</script>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"message":""}'>
      </wcs-state>
      <p data-wcs="textContent: message">Hello SSR</p>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // SSR データが使われている
    expect(stateEl.__state.message).toBe("Hello SSR");
    // バインディングが適用されて textContent が反映
    const p = document.querySelector("p");
    expect(p?.textContent).toBe("Hello SSR");
  });

  it("value 属性が SSR データで維持される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"name":"Alice"}</script>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"name":""}'>
      </wcs-state>
      <input data-wcs="value: name" value="Alice" />
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("Alice");
  });

  it("for ブロック: SSR レンダリング済みDOMがそのまま表示される", async () => {
    // SSR出力を模擬: forコメント + レンダリング済み li + テンプレート in wcs-ssr
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"items":[{"name":"Alice"},{"name":"Bob"}]}</script>
        <template id="u0" data-wcs="for: items">
          <li data-wcs="textContent: items.*.name"></li>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"items":[]}'>
      </wcs-state>
      <ul>
        <!--@@wcs-for:u0-->
        <!--@@wcs-for-start:u0:items:0--><li data-wcs="textContent: items.*.name">Alice</li><!--@@wcs-for-end:u0:items:0-->
        <!--@@wcs-for-start:u0:items:1--><li data-wcs="textContent: items.*.name">Bob</li><!--@@wcs-for-end:u0:items:1-->
      </ul>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // 既存の li がそのまま残っている
    const items = document.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("Alice");
    expect(items[1].textContent).toBe("Bob");
  });

  it("if ブロック: SSR レンダリング済みDOMがそのまま表示される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"show":true}</script>
        <template id="u0" data-wcs="if: show">
          <p class="visible">表示される</p>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"show":false}'>
      </wcs-state>
      <!--@@wcs-if:u0-->
      <!--@@wcs-if-start:u0:show--><p class="visible">表示される</p><!--@@wcs-if-end:u0:show-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // SSR で表示されていた要素がそのまま残る
    const p = document.querySelector("p.visible");
    expect(p).not.toBeNull();
    expect(p?.textContent).toBe("表示される");
  });

  it("hydrateProps: 属性化不可プロパティが復元される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"html":"<b>bold</b>"}</script>
        <script type="application/json" data-wcs-ssr-props>{"wcs-ssr-0":{"innerHTML":"<b>bold</b>"}}</script>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"html":""}'>
      </wcs-state>
      <div data-wcs="innerHTML: html" data-wcs-ssr-id="wcs-ssr-0"></div>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    const div = document.querySelector("div[data-wcs-ssr-id]") as HTMLElement;
    expect(div.innerHTML).toBe("<b>bold</b>");
  });

  it("for ブロック: SSR 描画済み DOM が Content 化される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"items":[{"name":"Alice"},{"name":"Bob"}]}</script>
        <template id="u0" data-wcs="for: items">
          <li data-wcs="textContent: .name"></li>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"items":[]}'>
      </wcs-state>
      <ul>
        <!--@@wcs-for:u0-->
        <!--@@wcs-for-start:u0:items:0--><li data-wcs="textContent: items.*.name">Alice</li><!--@@wcs-for-end:u0:items:0-->
        <!--@@wcs-for-start:u0:items:1--><li data-wcs="textContent: items.*.name">Bob</li><!--@@wcs-for-end:u0:items:1-->
      </ul>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // DOM がそのまま残っている
    const items = document.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("Alice");
    expect(items[1].textContent).toBe("Bob");

    // ブロック境界コメント (start/end) は除去されている
    const html = document.body.innerHTML;
    expect(html).not.toContain("@@wcs-for-start");
    expect(html).not.toContain("@@wcs-for-end");
    // プレースホルダーコメントは残る（状態変化時の再レンダリング用）
    expect(html).toContain("@@wcs-for:u0");
  });

  it("if ブロック: SSR 描画済み DOM が Content 化される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"show":true}</script>
        <template id="u0" data-wcs="if: show">
          <p class="visible">表示される</p>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"show":false}'>
      </wcs-state>
      <!--@@wcs-if:u0-->
      <!--@@wcs-if-start:u0:show--><p class="visible">表示される</p><!--@@wcs-if-end:u0:show-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    const p = document.querySelector("p.visible");
    expect(p).not.toBeNull();

    // ブロック境界コメントは除去
    const html = document.body.innerHTML;
    expect(html).not.toContain("@@wcs-if-start");
    expect(html).not.toContain("@@wcs-if-end");
  });

  it("for ブロック: テンプレートが fragmentInfoByUUID に復帰する", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"items":[{"name":"Alice"}]}</script>
        <template id="u0" data-wcs="for: items">
          <li data-wcs="textContent: .name"></li>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"items":[]}'>
      </wcs-state>
      <ul>
        <li data-wcs="textContent: items.*.name">Alice</li>
      </ul>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // fragmentInfoByUUID に復帰しているか確認
    const { getFragmentInfoByUUID } = await import("../src/structural/fragmentInfoByUUID");
    const fragmentInfo = getFragmentInfoByUUID("u0");
    expect(fragmentInfo).not.toBeNull();
    expect(fragmentInfo?.parseBindTextResult.bindingType).toBe("for");
    expect(fragmentInfo?.parseBindTextResult.statePathName).toBe("items");
  });

  it("バインド収集後に data-wcs-completed 属性が付与される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"msg":"Hello","show":true}</script>
        <template id="u0" data-wcs="if: show">
          <span>visible</span>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"msg":"","show":false}'>
      </wcs-state>
      <p data-wcs="textContent: msg">Hello</p>
      <input data-wcs="value: msg" value="Hello" />
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // data-wcs を持つ要素に data-wcs-completed が付いている
    const p = document.querySelector("p[data-wcs]");
    expect(p?.hasAttribute("data-wcs-completed")).toBe(true);
    const input = document.querySelector("input[data-wcs]");
    expect(input?.hasAttribute("data-wcs-completed")).toBe(true);
  });

  it("for ブロック内の要素にも data-wcs-completed が付与される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"items":[{"name":"Alice"},{"name":"Bob"}]}</script>
        <template id="u0" data-wcs="for: items">
          <li data-wcs="textContent: .name"></li>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"items":[]}'>
      </wcs-state>
      <ul>
        <li data-wcs="textContent: items.*.name">Alice</li>
        <li data-wcs="textContent: items.*.name">Bob</li>
      </ul>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    const items = document.querySelectorAll("li[data-wcs]");
    for (const li of items) {
      expect(li.hasAttribute("data-wcs-completed")).toBe(true);
    }
  });

  it("$connectedCallback はスキップされる", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"count":42}</script>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"count":0}'>
      </wcs-state>
      <span data-wcs="textContent: count">42</span>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // SSR のデータが使われている（$connectedCallback で上書きされていない）
    expect(stateEl.__state.count).toBe(42);
  });
});
