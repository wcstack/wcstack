import { describe, it, expect, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { Ssr } from "../src/components/Ssr";
import { VERSION } from "../src/version";

beforeAll(() => {
  bootstrapState();
});

describe("Ssr コンポーネント", () => {
  it("wcs-ssr がカスタム要素として登録されている", () => {
    expect(customElements.get("wcs-ssr")).toBe(Ssr);
  });

  it("stateData で初期データ JSON を取得できる", () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"count":42,"items":["a","b"]}</script>
      </wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.stateData).toEqual({ count: 42, items: ["a", "b"] });
  });

  it("name プロパティで name 属性を取得できる", () => {
    document.body.innerHTML = `<wcs-ssr name="cart"></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.name).toBe("cart");
  });

  it("name 属性がない場合は default", () => {
    document.body.innerHTML = `<wcs-ssr></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.name).toBe("default");
  });

  it("templates で UUID → テンプレートの Map を取得できる", () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{}</script>
        <template id="u0" data-wcs="for: items"><li></li></template>
        <template id="u1" data-wcs="if: show"><p></p></template>
      </wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.templates.size).toBe(2);
    expect(ssrEl.templates.has("u0")).toBe(true);
    expect(ssrEl.templates.has("u1")).toBe(true);
  });

  it("getTemplate(uuid) でテンプレートを取得できる", () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{}</script>
        <template id="u0" data-wcs="for: items"><li></li></template>
      </wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    const tpl = ssrEl.getTemplate("u0");
    expect(tpl).not.toBeNull();
    expect(tpl?.getAttribute("data-wcs")).toBe("for: items");
  });

  it("getTemplate で存在しない UUID は null を返す", () => {
    document.body.innerHTML = `<wcs-ssr name="default"><script type="application/json">{}</script></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.getTemplate("nonexistent")).toBeNull();
  });

  it("hydrateProps でプロパティ復元データを取得できる", () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{}</script>
        <script type="application/json" data-wcs-ssr-props>{"wcs-ssr-0":{"innerHTML":"<b>bold</b>"}}</script>
      </wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.hydrateProps["wcs-ssr-0"]).toEqual({ innerHTML: "<b>bold</b>" });
  });

  it("setStateData() で初期データをプログラムからセットできる", () => {
    document.body.innerHTML = `<wcs-ssr name="default"></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    ssrEl.setStateData({ message: "set from code" });
    expect(ssrEl.stateData).toEqual({ message: "set from code" });
  });

  it("setHydrateProps() でプロパティ復元データをプログラムからセットできる", () => {
    document.body.innerHTML = `<wcs-ssr name="default"></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    ssrEl.setHydrateProps({ "el-0": { scrollTop: 100 } });
    expect(ssrEl.hydrateProps["el-0"]).toEqual({ scrollTop: 100 });
  });

  it("Ssr.findByName() で名前指定で検索できる", () => {
    document.body.innerHTML = `
      <wcs-ssr name="a"><script type="application/json">{"x":1}</script></wcs-ssr>
      <wcs-ssr name="b"><script type="application/json">{"y":2}</script></wcs-ssr>
    `;
    const a = Ssr.findByName(document.body, "a") as Ssr;
    const b = Ssr.findByName(document.body, "b") as Ssr;
    expect(a.stateData).toEqual({ x: 1 });
    expect(b.stateData).toEqual({ y: 2 });
  });

  it("Ssr.findByName() で見つからない場合は null", () => {
    document.body.innerHTML = `<div></div>`;
    expect(Ssr.findByName(document.body, "missing")).toBeNull();
  });

  it("Ssr.findByName() で Document を渡した場合は documentElement から検索する", () => {
    document.body.innerHTML = `
      <wcs-ssr name="doc-test"><script type="application/json">{"z":3}</script></wcs-ssr>
    `;
    // happy-dom の document は Document instanceof を通らないため、
    // documentElement 経由で検索する分岐をテスト
    const result = Ssr.findByName(document.documentElement, "doc-test") as Ssr;
    expect(result).not.toBeNull();
    expect(result.stateData).toEqual({ z: 3 });
  });

  it("Ssr.findByName() で Element でも Document でもない Node を渡すと null", () => {
    const textNode = document.createTextNode("hello");
    expect(Ssr.findByName(textNode, "test")).toBeNull();
  });

  it("version プロパティで version 属性を取得できる", () => {
    document.body.innerHTML = `<wcs-ssr version="1.6.0"></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.version).toBe("1.6.0");
  });

  it("version 属性がない場合は空文字", () => {
    document.body.innerHTML = `<wcs-ssr></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.version).toBe("");
  });

  it("verifyVersion() で version 属性がない場合は true を返す", () => {
    document.body.innerHTML = `<wcs-ssr></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.verifyVersion()).toBe(true);
  });

  it("verifyVersion() でメジャー・マイナーが一致すれば true", () => {
    const parts = VERSION.split(".");
    document.body.innerHTML = `<wcs-ssr version="${parts[0]}.${parts[1]}.999"></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.verifyVersion()).toBe(true);
  });

  it("verifyVersion() でメジャーが異なれば false", () => {
    document.body.innerHTML = `<wcs-ssr version="999.0.0"></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.verifyVersion()).toBe(false);
  });

  it("stateData で script がない場合は空オブジェクト", () => {
    document.body.innerHTML = `<wcs-ssr></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.stateData).toEqual({});
  });

  it("stateData で JSON パースエラーの場合は空オブジェクト", () => {
    document.body.innerHTML = `
      <wcs-ssr>
        <script type="application/json">invalid json</script>
      </wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.stateData).toEqual({});
  });

  it("stateData で script.textContent が空の場合は空オブジェクト", () => {
    document.body.innerHTML = `
      <wcs-ssr>
        <script type="application/json"></script>
      </wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.stateData).toEqual({});
  });

  it("hydrateProps で script がない場合は空オブジェクト", () => {
    document.body.innerHTML = `<wcs-ssr></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.hydrateProps).toEqual({});
  });

  it("hydrateProps で JSON パースエラーの場合は空オブジェクト", () => {
    document.body.innerHTML = `
      <wcs-ssr>
        <script type="application/json" data-wcs-ssr-props>bad json</script>
      </wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.hydrateProps).toEqual({});
  });

  it("hydrateProps で script.textContent が空の場合は空オブジェクト", () => {
    document.body.innerHTML = `
      <wcs-ssr>
        <script type="application/json" data-wcs-ssr-props></script>
      </wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.hydrateProps).toEqual({});
  });

  it("stateData はキャッシュされ2回目以降は再パースしない", () => {
    document.body.innerHTML = `
      <wcs-ssr><script type="application/json">{"a":1}</script></wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    const first = ssrEl.stateData;
    const second = ssrEl.stateData;
    expect(first).toBe(second);
  });

  it("templates はキャッシュされる", () => {
    document.body.innerHTML = `
      <wcs-ssr><script type="application/json">{}</script><template id="t1"></template></wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    const first = ssrEl.templates;
    const second = ssrEl.templates;
    expect(first).toBe(second);
  });

  it("hydrateProps はキャッシュされる", () => {
    document.body.innerHTML = `
      <wcs-ssr><script type="application/json" data-wcs-ssr-props>{"a":{}}</script></wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    const first = ssrEl.hydrateProps;
    const second = ssrEl.hydrateProps;
    expect(first).toBe(second);
  });
});

describe("Ssr static ユーティリティ", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("removeBlockBoundaryComments で境界コメントを除去する", () => {
    document.body.innerHTML = `
      <div>
        <!--@@wcs-for-start:uuid:items:0-->
        <li>item</li>
        <!--@@wcs-for-end:uuid:items:0-->
      </div>
    `;
    Ssr.removeBlockBoundaryComments(document.body);
    const html = document.body.innerHTML;
    expect(html).not.toContain("@@wcs-for-start");
    expect(html).not.toContain("@@wcs-for-end");
    expect(html).toContain("<li>item</li>");
  });

  it("removeBlockBoundaryComments でコメントがない場合は何もしない", () => {
    document.body.innerHTML = `<p>hello</p>`;
    Ssr.removeBlockBoundaryComments(document.body);
    expect(document.body.innerHTML).toContain("<p>hello</p>");
  });

  it("removeStructuralComments でプレースホルダーコメントを除去する", () => {
    document.body.innerHTML = `
      <div>
        <!--@@wcs-for:uuid123-->
        <!--@@wcs-if:uuid456-->
        <!-- normal comment -->
      </div>
    `;
    Ssr.removeStructuralComments(document.body);
    const html = document.body.innerHTML;
    expect(html).not.toContain("@@wcs-for:");
    expect(html).not.toContain("@@wcs-if:");
    // 通常のコメントは残る
    expect(html).toContain("normal comment");
  });

  it("restoreTextBindings でテキストコメントを @@: 形式に復元する", () => {
    document.body.innerHTML = `
      <p><!--@@wcs-text-start:msg-->Hello<!--@@wcs-text-end:msg--></p>
    `;
    Ssr.restoreTextBindings(document.body);
    const html = document.body.innerHTML;
    expect(html).toContain("@@: msg");
    expect(html).not.toContain("@@wcs-text-start");
    expect(html).not.toContain("@@wcs-text-end");
    expect(html).not.toContain("Hello");
  });

  it("restoreTextBindings でテキストコメントがない場合は何もしない", () => {
    document.body.innerHTML = `<p>plain</p>`;
    Ssr.restoreTextBindings(document.body);
    expect(document.body.innerHTML).toContain("plain");
  });

  it("cleanupDom で SSR DOM を完全にクリーンアップする", () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"x":1}</script>
        <template id="uuid1" data-wcs="for: items"><li></li></template>
      </wcs-ssr>
      <!--@@wcs-for:uuid1-->
      <!--@@wcs-for-start:uuid1:items:0-->
      <li>rendered</li>
      <!--@@wcs-for-end:uuid1:items:0-->
      <!--@@wcs-text-start:msg-->Hello<!--@@wcs-text-end:msg-->
      <div data-wcs-ssr-id="wcs-ssr-0">content</div>
    `;
    Ssr.cleanupDom(document);
    const html = document.body.innerHTML;
    // wcs-ssr が除去されている
    expect(html).not.toContain("wcs-ssr");
    // ブロック境界コメントとレンダリング済みノードが除去されている
    expect(html).not.toContain("@@wcs-for-start");
    expect(html).not.toContain("rendered");
    // テキストバインディングが復元されている
    expect(html).toContain("@@: msg");
    // プレースホルダーがテンプレートに差し替えられている
    expect(html).toContain("<template");
    expect(html).toContain("data-wcs");
    // data-wcs-ssr-id が除去されている
    expect(html).not.toContain("data-wcs-ssr-id");
  });

  it("cleanupDom で if/else コメントも処理する", () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{}</script>
        <template id="uuid2" data-wcs="if: show"><p></p></template>
      </wcs-ssr>
      <!--@@wcs-if:uuid2-->
      <!--@@wcs-if-start:uuid2:show-->
      <p>visible</p>
      <!--@@wcs-if-end:uuid2:show-->
    `;
    Ssr.cleanupDom(document);
    const html = document.body.innerHTML;
    expect(html).not.toContain("@@wcs-if-start");
    expect(html).not.toContain("visible");
    expect(html).toContain("<template");
  });

  it("cleanupDom でプレースホルダーに対応するテンプレートがない場合は無視する", () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{}</script>
      </wcs-ssr>
      <!--@@wcs-for:nonexistent-uuid-->
    `;
    Ssr.cleanupDom(document);
    // エラーにならず処理が完了する
    expect(document.querySelector("wcs-ssr")).toBeNull();
  });

  it("cleanupDom でテンプレートに data-wcs 属性がない場合もコピーされる", () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{}</script>
        <template id="uuid-noattr"><li></li></template>
      </wcs-ssr>
      <!--@@wcs-for:uuid-noattr-->
    `;
    Ssr.cleanupDom(document);
    const html = document.body.innerHTML;
    expect(html).toContain("<template");
    // data-wcs 属性がないテンプレートも差し替えられる
    expect(html).not.toContain("@@wcs-for:");
  });

  it("cleanupDom で template.content が空の場合に childNodes からコピーする", () => {
    // wcs-ssr を手動構築して template.content が空の状態を再現
    const ssrEl = document.createElement("wcs-ssr");
    ssrEl.setAttribute("name", "default");
    const jsonScript = document.createElement("script");
    jsonScript.setAttribute("type", "application/json");
    jsonScript.textContent = "{}";
    ssrEl.appendChild(jsonScript);

    const tpl = document.createElement("template");
    tpl.setAttribute("id", "uuid3");
    tpl.setAttribute("data-wcs", "for: items");
    // happy-dom では appendChild は content に入る
    // content.appendChild してから content を空にし、直接 childNodes にノードを追加
    tpl.content.appendChild(document.createElement("li"));
    // content を空にする
    while (tpl.content.firstChild) tpl.content.removeChild(tpl.content.firstChild);
    ssrEl.appendChild(tpl);

    // importNode(tpl.content) が空を返すよう、content をモック
    const origContent = tpl.content;
    Object.defineProperty(tpl, 'content', {
      get() {
        return document.createDocumentFragment(); // 常に空の fragment
      },
      configurable: true,
    });
    // childNodes にはノードを追加
    const li = document.createElement("li");
    li.textContent = "fallback";
    // appendChild は content に入るので innerHTML で強制追加
    origContent.appendChild(li);
    // childNodes として直接参照されるよう、tpl 自体にノードを追加
    Object.defineProperty(tpl, 'childNodes', {
      get() {
        return [li];
      },
      configurable: true,
    });

    document.body.innerHTML = "";
    document.body.appendChild(ssrEl);
    const placeholder = document.createComment("@@wcs-for:uuid3");
    document.body.appendChild(placeholder);

    Ssr.cleanupDom(document);
    const html = document.body.innerHTML;
    expect(html).toContain("<template");
  });
});
