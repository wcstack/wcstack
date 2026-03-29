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

  it("ハイドレーション完了後に data-wcs-completed 属性が除去されている", async () => {
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

    // data-wcs-completed はハイドレーション完了後に除去されている
    expect(document.querySelectorAll("[data-wcs-completed]").length).toBe(0);
  });

  it("for ブロック内の要素も data-wcs-completed が除去されている", async () => {
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

    expect(document.querySelectorAll("[data-wcs-completed]").length).toBe(0);
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

  it("if/else ブロック: else 側のハイドレーションが正しく動作する", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"loggedIn":false}</script>
        <template id="uuid-if1" data-wcs="if: loggedIn"><p class="welcome">welcome</p></template>
        <template id="uuid-else1" data-wcs="else:"><p class="login">please login</p></template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"loggedIn":false}'></wcs-state>
      <!--@@wcs-if:uuid-if1-->
      <!--@@wcs-else:uuid-else1-->
      <!--@@wcs-else-start:uuid-else1:loggedIn-->
      <p class="login">please login</p>
      <!--@@wcs-else-end:uuid-else1:loggedIn-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(document.querySelector("p.login")?.textContent).toBe("please login");
    expect(document.querySelector("p.welcome")).toBeNull();
  });

  it("if/elseif ブロック: elseif 側のハイドレーションが正しく動作する", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"role":"editor"}</script>
        <template id="uuid-if2" data-wcs="if: isAdmin"><p class="admin">admin</p></template>
        <template id="uuid-elseif2" data-wcs="elseif: isEditor"><p class="editor">editor</p></template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"role":"editor"}'></wcs-state>
      <!--@@wcs-if:uuid-if2-->
      <!--@@wcs-elseif:uuid-elseif2-->
      <!--@@wcs-elseif-start:uuid-elseif2:isEditor-->
      <p class="editor">editor</p>
      <!--@@wcs-elseif-end:uuid-elseif2:isEditor-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(document.querySelector("p.editor")?.textContent).toBe("editor");
  });

  it("hydrateProps: target が見つからない場合はスキップする", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"x":1}</script>
        <script type="application/json" data-wcs-ssr-props>{"nonexistent-id":{"innerHTML":"<b>x</b>"}}</script>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"x":1}'></wcs-state>
      <p data-wcs="textContent: x">1</p>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // エラーにならず正常に完了
    expect(stateEl.__state.x).toBe(1);
  });

  it("空の for ブロック（ノードなし）は正しく処理される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"items":[]}</script>
        <template id="uuid-empty" data-wcs="for: items"><li></li></template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"items":[]}'></wcs-state>
      <!--@@wcs-for:uuid-empty-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(stateEl.__state.items).toEqual([]);
  });

  it("for ブロック内の $index バインディングがハイドレーションされる", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"items":["A","B"]}</script>
        <template id="uuid-idx" data-wcs="for: items">
          <li>
            <span class="val" data-wcs="textContent: items.*"></span>
            <span class="idx" data-wcs="textContent: $1"></span>
          </li>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"items":["A","B"]}'></wcs-state>
      <!--@@wcs-for:uuid-idx-->
      <!--@@wcs-for-start:uuid-idx:items:0-->
      <li><span class="val">A</span><span class="idx">0</span></li>
      <!--@@wcs-for-end:uuid-idx:items:0-->
      <!--@@wcs-for-start:uuid-idx:items:1-->
      <li><span class="val">B</span><span class="idx">1</span></li>
      <!--@@wcs-for-end:uuid-idx:items:1-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    const vals = document.querySelectorAll(".val");
    expect(vals[0].textContent).toBe("A");
    expect(vals[1].textContent).toBe("B");
  });

  it("for ブロックの start/end 間にノードがない場合もエラーにならない", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"items":["A"]}</script>
        <template id="uuid-nonode" data-wcs="for: items"><li></li></template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"items":["A"]}'></wcs-state>
      <!--@@wcs-for:uuid-nonode-->
      <!--@@wcs-for-start:uuid-nonode:items:0-->
      <!--@@wcs-for-end:uuid-nonode:items:0-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(stateEl.__state.items).toEqual(["A"]);
  });

  it("if/elseif/else chain がハイドレーションで正しく復元される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"status":"warning"}</script>
        <template id="uuid-c1" data-wcs="if: isError"><p class="error">error</p></template>
        <template id="uuid-c2" data-wcs="elseif: isWarning"><p class="warning">warning</p></template>
        <template id="uuid-c3" data-wcs="else:"><p class="ok">ok</p></template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"status":"warning"}'></wcs-state>
      <!--@@wcs-if:uuid-c1-->
      <!--@@wcs-elseif:uuid-c2-->
      <!--@@wcs-elseif-start:uuid-c2:isWarning-->
      <p class="warning">warning</p>
      <!--@@wcs-elseif-end:uuid-c2:isWarning-->
      <!--@@wcs-else:uuid-c3-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(document.querySelector("p.warning")?.textContent).toBe("warning");
  });
});
