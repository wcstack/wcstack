import { describe, it, expect, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";

beforeAll(() => {
  bootstrapState();
});

describe("SSR バージョン不一致フォールバック", () => {
  it("バージョン不一致で buildBindings にフォールバックし textContent バインディングが動作する", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    document.body.innerHTML = `
      <wcs-ssr name="default" version="99.0.0">
        <script type="application/json">{"message":"Hello SSR"}</script>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"message":""}'>
      </wcs-state>
      <p data-wcs="textContent: message">Hello SSR</p>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 300));

    // SSR データは状態に読み込まれている
    expect(stateEl.__state.message).toBe("Hello SSR");

    // バインディングが適用されている
    const p = document.querySelector("p");
    expect(p?.textContent).toBe("Hello SSR");

    // <wcs-ssr> は除去されている
    expect(document.querySelector("wcs-ssr")).toBeNull();

    // 警告が出力されている
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("SSR version mismatch")
    );

    warnSpy.mockRestore();
  });

  it("バージョン不一致で for ブロックの SSR DOM がクリーンアップされ再構築される", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    document.body.innerHTML = `
      <wcs-ssr name="default" version="99.0.0">
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
    await new Promise(resolve => setTimeout(resolve, 300));

    // SSR データが使われている
    expect(stateEl.__state.items).toEqual([
      { name: "Alice" },
      { name: "Bob" },
    ]);

    // for ブロックが buildBindings で再構築されている
    const items = document.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("Alice");
    expect(items[1].textContent).toBe("Bob");

    // SSR 境界コメントは残っていない
    const html = document.body.innerHTML;
    expect(html).not.toContain("@@wcs-for-start");
    expect(html).not.toContain("@@wcs-for-end");

    // buildBindings が処理した構造コメント (wcs-for) が存在する
    expect(html).toContain("wcs-for");

    // <wcs-ssr> は除去されている
    expect(document.querySelector("wcs-ssr")).toBeNull();

    warnSpy.mockRestore();
  });

  it("バージョン不一致で if/else ブロックの SSR DOM がクリーンアップされ再構築される", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    document.body.innerHTML = `
      <wcs-ssr name="default" version="99.0.0">
        <script type="application/json">{"show":true}</script>
        <template id="u0" data-wcs="if: show">
          <p class="visible">表示される</p>
        </template>
        <template id="u1" data-wcs="else:">
          <p class="hidden">非表示</p>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"show":false}'>
      </wcs-state>
      <!--@@wcs-if:u0-->
      <!--@@wcs-if-start:u0:show--><p class="visible">表示される</p><!--@@wcs-if-end:u0:show-->
      <!--@@wcs-else:u1-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 300));

    // SSR データで show=true
    expect(stateEl.__state.show).toBe(true);

    // if ブロックが buildBindings で再構築されている
    const visible = document.querySelector("p.visible");
    expect(visible).not.toBeNull();
    expect(visible?.textContent).toBe("表示される");

    // SSR 境界コメントは残っていない
    const html = document.body.innerHTML;
    expect(html).not.toContain("@@wcs-if-start");
    expect(html).not.toContain("@@wcs-if-end");
    expect(html).not.toContain("@@wcs-else-start");
    expect(html).not.toContain("@@wcs-else-end");

    // buildBindings が処理した構造コメント (wcs-if / wcs-else) が存在する
    expect(html).toContain("wcs-if");
    expect(html).toContain("wcs-else");

    // <wcs-ssr> は除去されている
    expect(document.querySelector("wcs-ssr")).toBeNull();

    warnSpy.mockRestore();
  });

  it("バージョン不一致で Mustache テキストバインディングがクリーンアップされ再構築される", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    document.body.innerHTML = `
      <wcs-ssr name="default" version="99.0.0">
        <script type="application/json">{"count":42}</script>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"count":0}'>
      </wcs-state>
      <h2>Count: <!--@@wcs-text-start:count-->42<!--@@wcs-text-end:count--></h2>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 300));

    // SSR データが使われている
    expect(stateEl.__state.count).toBe(42);

    // テキストバインディングが復元されている
    const h2 = document.querySelector("h2");
    expect(h2?.textContent).toContain("42");

    // SSR テキストコメントは残っていない
    const html = document.body.innerHTML;
    expect(html).not.toContain("@@wcs-text-start");
    expect(html).not.toContain("@@wcs-text-end");

    warnSpy.mockRestore();
  });

  it("バージョン不一致で data-wcs-ssr-id 属性が除去される", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    document.body.innerHTML = `
      <wcs-ssr name="default" version="99.0.0">
        <script type="application/json">{"html":"<b>bold</b>"}</script>
        <script type="application/json" data-wcs-ssr-props>{"wcs-ssr-0":{"innerHTML":"<b>bold</b>"}}</script>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"html":""}'>
      </wcs-state>
      <div data-wcs="innerHTML: html" data-wcs-ssr-id="wcs-ssr-0"></div>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 300));

    // data-wcs-ssr-id が除去されている
    const div = document.querySelector("div[data-wcs]");
    expect(div?.hasAttribute("data-wcs-ssr-id")).toBe(false);

    // innerHTML バインディングが buildBindings で適用されている
    expect((div as HTMLElement)?.innerHTML).toBe("<b>bold</b>");

    warnSpy.mockRestore();
  });
});
