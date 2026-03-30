import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

/**
 * DSD (Declarative Shadow DOM) テスト
 *
 * 未定義のカスタム要素（クラス定義なし）でも
 * <template shadowrootmode="open"> + <wcs-state> でリアクティビティが動作することを確認する。
 *
 * happy-dom は DSD を自動処理しないため、
 * ブラウザの DSD 処理をシミュレートして ShadowRoot を手動作成する。
 */
describe("Declarative Shadow DOM (未定義カスタム要素)", () => {

  /**
   * ブラウザの DSD 処理をシミュレート:
   * <template shadowrootmode="open"> の内容を ShadowRoot に展開する
   */
  function simulateDSD(element: Element): ShadowRoot {
    const shadowRoot = element.attachShadow({ mode: "open" });
    return shadowRoot;
  }

  async function setupDSD(tagName: string, html: string): Promise<{ host: Element; shadowRoot: ShadowRoot; stateEl: State }> {
    const host = document.createElement(tagName);
    const shadowRoot = simulateDSD(host);
    shadowRoot.innerHTML = html;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    return { host, shadowRoot, stateEl };
  }

  describe("テキストバインディング", () => {
    it("{{ }} マスタッシュ構文が動作すること", async () => {
      const { host, shadowRoot } = await setupDSD("dsd-mustache", `
        <p>Static text</p>
        <p>{{ message }}</p>
        <wcs-state json='{"message":"Hello, World!"}'></wcs-state>
      `);

      const paragraphs = shadowRoot.querySelectorAll("p");
      expect(paragraphs[0].textContent).toBe("Static text");
      expect(paragraphs[1].textContent).toBe("Hello, World!");

      host.remove();
    });

    it("data-wcs textContent バインディングが動作すること", async () => {
      const { host, shadowRoot } = await setupDSD("dsd-textcontent", `
        <div data-wcs="textContent: title"></div>
        <wcs-state json='{"title":"DSD Title"}'></wcs-state>
      `);

      expect(shadowRoot.querySelector("div")?.textContent).toBe("DSD Title");

      host.remove();
    });
  });

  describe("リアクティブ更新", () => {
    it("ステート変更が DOM に反映されること", async () => {
      const { host, shadowRoot, stateEl } = await setupDSD("dsd-reactive", `
        <span data-wcs="textContent: count"></span>
        <wcs-state json='{"count":1}'></wcs-state>
      `);

      expect(shadowRoot.querySelector("span")?.textContent).toBe("1");

      await stateEl.createStateAsync("writable", async (state) => {
        state.count = 42;
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(shadowRoot.querySelector("span")?.textContent).toBe("42");

      host.remove();
    });

    it("文字列ステートの更新が反映されること", async () => {
      const { host, shadowRoot, stateEl } = await setupDSD("dsd-string-update", `
        <span data-wcs="textContent: name"></span>
        <wcs-state json='{"name":"Alice"}'></wcs-state>
      `);

      expect(shadowRoot.querySelector("span")?.textContent).toBe("Alice");

      await stateEl.createStateAsync("writable", async (state) => {
        state.name = "Bob";
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(shadowRoot.querySelector("span")?.textContent).toBe("Bob");

      host.remove();
    });
  });

  describe("スコープ分離", () => {
    it("複数の未定義カスタム要素がそれぞれ独立した DSD ステートを持てること", async () => {
      const { host: host1, shadowRoot: shadow1 } = await setupDSD("dsd-scope-a", `
        <span data-wcs="textContent: value"></span>
        <wcs-state json='{"value":"AAA"}'></wcs-state>
      `);
      const { host: host2, shadowRoot: shadow2 } = await setupDSD("dsd-scope-b", `
        <span data-wcs="textContent: value"></span>
        <wcs-state json='{"value":"BBB"}'></wcs-state>
      `);

      expect(shadow1.querySelector("span")?.textContent).toBe("AAA");
      expect(shadow2.querySelector("span")?.textContent).toBe("BBB");

      host1.remove();
      host2.remove();
    });

    it("DSD ステートがドキュメントレベルのステートから分離されていること", async () => {
      // ドキュメントレベルのステート
      document.body.innerHTML = `
        <div data-wcs="textContent: value"></div>
        <wcs-state json='{"value":"document-level"}'></wcs-state>
      `;
      const docStateEl = document.querySelector("wcs-state") as State;
      await docStateEl.connectedCallbackPromise;
      await State.getBindingsReady(document);

      // DSD のステート（同じプロパティ名 "value"）
      const host = document.createElement("dsd-isolation");
      const shadowRoot = host.attachShadow({ mode: "open" });
      shadowRoot.innerHTML = `
        <span data-wcs="textContent: value"></span>
        <wcs-state json='{"value":"shadow-level"}'></wcs-state>
      `;
      document.body.appendChild(host);

      const shadowStateEl = shadowRoot.querySelector("wcs-state") as State;
      await shadowStateEl.connectedCallbackPromise;
      await State.getBindingsReady(shadowRoot);

      // 各スコープが独立していること
      expect(document.querySelector("div")?.textContent).toBe("document-level");
      expect(shadowRoot.querySelector("span")?.textContent).toBe("shadow-level");

      host.remove();
    });

    it("名前付きステートが DSD 内で動作すること", async () => {
      const { host, shadowRoot } = await setupDSD("dsd-named-state", `
        <div data-wcs="textContent: label@mystate"></div>
        <wcs-state name="mystate" json='{"label":"Named State"}'></wcs-state>
      `);

      expect(shadowRoot.querySelector("div")?.textContent).toBe("Named State");

      host.remove();
    });
  });

  describe("属性バインディング", () => {
    it("class バインディングが動作すること", async () => {
      const { host, shadowRoot } = await setupDSD("dsd-class-bind", `
        <div data-wcs="class.active: isActive"></div>
        <wcs-state json='{"isActive":true}'></wcs-state>
      `);

      const div = shadowRoot.querySelector("div");
      expect(div?.classList.contains("active")).toBe(true);

      host.remove();
    });

    it("style バインディングが動作すること", async () => {
      const { host, shadowRoot } = await setupDSD("dsd-style-bind", `
        <div data-wcs="style.color: textColor"></div>
        <wcs-state json='{"textColor":"red"}'></wcs-state>
      `);

      const div = shadowRoot.querySelector("div") as HTMLElement;
      expect(div?.style.color).toBe("red");

      host.remove();
    });

    it("attr バインディングが動作すること", async () => {
      const { host, shadowRoot } = await setupDSD("dsd-attr-bind", `
        <a data-wcs="attr.href: url"></a>
        <wcs-state json='{"url":"https://example.com"}'></wcs-state>
      `);

      const a = shadowRoot.querySelector("a");
      expect(a?.getAttribute("href")).toBe("https://example.com");

      host.remove();
    });
  });

  describe("構造レンダリング", () => {
    it("条件レンダリング (if) が動作すること", async () => {
      const { host, shadowRoot, stateEl } = await setupDSD("dsd-if", `
        <template data-wcs="if: visible">
          <p>Visible</p>
        </template>
        <wcs-state json='{"visible":true}'></wcs-state>
      `);

      expect(shadowRoot.querySelector("p")?.textContent).toBe("Visible");

      // false に更新
      await stateEl.createStateAsync("writable", async (state) => {
        state.visible = false;
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(shadowRoot.querySelector("p")).toBeNull();

      host.remove();
    });

    it("リストレンダリング (for) が動作すること", async () => {
      const { host, shadowRoot } = await setupDSD("dsd-for", `
        <template data-wcs="for: items">
          <li data-wcs="textContent: items.*"></li>
        </template>
        <wcs-state json='{"items":["Apple","Banana","Cherry"]}'></wcs-state>
      `);

      const items = shadowRoot.querySelectorAll("li");
      expect(items.length).toBe(3);
      expect(items[0].textContent).toBe("Apple");
      expect(items[1].textContent).toBe("Banana");
      expect(items[2].textContent).toBe("Cherry");

      host.remove();
    });

    it("リストのリアクティブ更新が動作すること", async () => {
      const { host, shadowRoot, stateEl } = await setupDSD("dsd-for-update", `
        <template data-wcs="for: items">
          <li data-wcs="textContent: items.*"></li>
        </template>
        <wcs-state json='{"items":["A","B"]}'></wcs-state>
      `);

      expect(shadowRoot.querySelectorAll("li").length).toBe(2);

      await stateEl.createStateAsync("writable", async (state) => {
        state.items = ["X", "Y", "Z"];
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      const items = shadowRoot.querySelectorAll("li");
      expect(items.length).toBe(3);
      expect(items[0].textContent).toBe("X");
      expect(items[1].textContent).toBe("Y");
      expect(items[2].textContent).toBe("Z");

      host.remove();
    });
  });

  describe("フィルタ", () => {
    it("フィルタパイプラインが動作すること", async () => {
      const { host, shadowRoot } = await setupDSD("dsd-filter", `
        <span data-wcs="textContent: name|uc"></span>
        <wcs-state json='{"name":"hello"}'></wcs-state>
      `);

      expect(shadowRoot.querySelector("span")?.textContent).toBe("HELLO");

      host.remove();
    });
  });

  describe("ネストされたプロパティ", () => {
    it("ドット区切りのネストパスが動作すること", async () => {
      const { host, shadowRoot } = await setupDSD("dsd-nested", `
        <span data-wcs="textContent: user.name"></span>
        <wcs-state json='{"user":{"name":"Taro"}}'></wcs-state>
      `);

      expect(shadowRoot.querySelector("span")?.textContent).toBe("Taro");

      host.remove();
    });
  });
});
