import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { inSsr, getConfig, resetSsrCache } from "../src/config";
import { Ssr } from "../src/components/Ssr";
import { addSsrProperty, trackSsrPropertyNode, getSsrProperties, getAllSsrPropertyNodes, clearSsrPropertyStore } from "../src/apply/ssrPropertyStore";
import { getBindingsReady } from "../src/stateElementByName";

beforeAll(() => {
  bootstrapState();
});

describe("inSsr()", () => {
  beforeEach(() => {
    resetSsrCache();
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-wcs-server");
    resetSsrCache();
  });

  it("data-wcs-server 属性がない場合は false を返す", () => {
    expect(inSsr()).toBe(false);
  });

  it("data-wcs-server 属性がある場合は true を返す", () => {
    document.documentElement.setAttribute("data-wcs-server", "");
    expect(inSsr()).toBe(true);
  });

  it("キャッシュが効いて2回目以降は DOM を参照しない", () => {
    document.documentElement.setAttribute("data-wcs-server", "");
    expect(inSsr()).toBe(true);
    // 属性を外してもキャッシュで true のまま
    document.documentElement.removeAttribute("data-wcs-server");
    expect(inSsr()).toBe(true);
  });

  it("resetSsrCache() でキャッシュがクリアされる", () => {
    document.documentElement.setAttribute("data-wcs-server", "");
    expect(inSsr()).toBe(true);
    document.documentElement.removeAttribute("data-wcs-server");
    resetSsrCache();
    expect(inSsr()).toBe(false);
  });

  it("html 要素が見つからない場合は false を返す", () => {
    const spy = vi.spyOn(document, "querySelector").mockReturnValue(null);
    expect(inSsr()).toBe(false);
    spy.mockRestore();
  });
});

describe("getConfig()", () => {
  it("config オブジェクトを返す", () => {
    const cfg = getConfig();
    expect(cfg.bindAttributeName).toBe("data-wcs");
    expect(cfg.tagNames.state).toBe("wcs-state");
    expect(cfg.tagNames.ssr).toBe("wcs-ssr");
  });
});

describe("ssrPropertyStore", () => {
  beforeEach(() => {
    clearSsrPropertyStore();
  });

  it("addSsrProperty で追加し getSsrProperties で取得できる", () => {
    const node = document.createElement("div");
    addSsrProperty(node, "innerHTML", "<b>test</b>");
    const entries = getSsrProperties(node);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ propName: "innerHTML", value: "<b>test</b>" });
  });

  it("同じプロパティ名は上書きされる", () => {
    const node = document.createElement("div");
    addSsrProperty(node, "innerHTML", "old");
    addSsrProperty(node, "innerHTML", "new");
    const entries = getSsrProperties(node);
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe("new");
  });

  it("trackSsrPropertyNode で追跡し getAllSsrPropertyNodes で取得できる", () => {
    const node1 = document.createElement("div");
    const node2 = document.createElement("span");
    trackSsrPropertyNode(node1);
    trackSsrPropertyNode(node2);
    const nodes = getAllSsrPropertyNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes).toContain(node1);
    expect(nodes).toContain(node2);
  });

  it("clearSsrPropertyStore でトラッキングがクリアされる", () => {
    const node = document.createElement("div");
    trackSsrPropertyNode(node);
    clearSsrPropertyStore();
    expect(getAllSsrPropertyNodes()).toHaveLength(0);
  });

  it("未登録ノードの getSsrProperties は空配列を返す", () => {
    const node = document.createElement("div");
    expect(getSsrProperties(node)).toEqual([]);
  });
});

describe("Ssr.extractStateData()", () => {
  it("__state からデータプロパティを抽出する", () => {
    const el = document.createElement("div") as any;
    el.__state = { name: "Alice", age: 30, $internal: true, greet: () => {} };
    const data = Ssr.extractStateData(el);
    expect(data).toEqual({ name: "Alice", age: 30 });
  });

  it("__state がない場合は空オブジェクトを返す", () => {
    const el = document.createElement("div");
    expect(Ssr.extractStateData(el)).toEqual({});
  });

  it("__state が null の場合は空オブジェクトを返す", () => {
    const el = document.createElement("div") as any;
    el.__state = null;
    expect(Ssr.extractStateData(el)).toEqual({});
  });
});

describe("Ssr.buildContent()", () => {
  beforeEach(() => {
    clearSsrPropertyStore();
  });

  it("stateData を JSON script として追加する", () => {
    const ssrEl = document.createElement("wcs-ssr");
    Ssr.buildContent(ssrEl, { count: 42, items: ["a", "b"] });
    const script = ssrEl.querySelector('script[type="application/json"]');
    expect(script).not.toBeNull();
    expect(JSON.parse(script!.textContent!)).toEqual({ count: 42, items: ["a", "b"] });
  });

  it("ssrPropertyStore にデータがある場合 props script を追加する", () => {
    const node = document.createElement("div");
    addSsrProperty(node, "innerHTML", "<b>rich</b>");
    trackSsrPropertyNode(node);

    const ssrEl = document.createElement("wcs-ssr");
    Ssr.buildContent(ssrEl, { x: 1 });

    const propsScript = ssrEl.querySelector('script[data-wcs-ssr-props]');
    expect(propsScript).not.toBeNull();
    const propsData = JSON.parse(propsScript!.textContent!);
    expect(Object.keys(propsData)).toHaveLength(1);
    // node に data-wcs-ssr-id が付与される
    expect(node.hasAttribute("data-wcs-ssr-id")).toBe(true);
  });

  it("ssrPropertyStore が空の場合 props script は追加されない", () => {
    const ssrEl = document.createElement("wcs-ssr");
    Ssr.buildContent(ssrEl, { x: 1 });
    const propsScript = ssrEl.querySelector('script[data-wcs-ssr-props]');
    expect(propsScript).toBeNull();
  });

  it("buildContent 後に ssrPropertyStore がクリアされる", () => {
    const node = document.createElement("div");
    trackSsrPropertyNode(node);

    const ssrEl = document.createElement("wcs-ssr");
    Ssr.buildContent(ssrEl, {});

    expect(getAllSsrPropertyNodes()).toHaveLength(0);
  });
});

describe("SSR モードでのバインディング", () => {
  beforeEach(() => {
    resetSsrCache();
    document.documentElement.setAttribute("data-wcs-server", "");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-wcs-server");
    resetSsrCache();
    document.body.innerHTML = "";
  });

  it("SSR モードで textContent バインディングが適用される", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"msg":"Hello SSR"}'></wcs-state>
      <p data-wcs="textContent: msg"></p>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const p = document.querySelector("p");
    expect(p!.textContent).toBe("Hello SSR");
  });

  it("SSR モードでコメントテキストバインディングにマーカーが付与される", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"msg":"Hello SSR"}'></wcs-state>
      <p><!--@@: msg--></p>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const html = document.body.innerHTML;
    expect(html).toContain("@@wcs-text-start:msg");
    expect(html).toContain("@@wcs-text-end:msg");
    expect(html).toContain("Hello SSR");
  });

  it("SSR モードで property バインディングが属性に反映される", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"name":"Alice"}'></wcs-state>
      <input data-wcs="value: name" />
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const input = document.querySelector("input");
    expect(input!.getAttribute("value")).toBe("Alice");
  });

  it("SSR モードで checked が属性に反映される", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"on":true}'></wcs-state>
      <input type="checkbox" data-wcs="checked: on" />
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const input = document.querySelector("input");
    expect(input!.hasAttribute("checked")).toBe(true);
  });

  it("SSR モードで属性代替不可なプロパティが ssrPropertyStore に蓄積される", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"html":"<b>rich</b>"}'></wcs-state>
      <div data-wcs="innerHTML: html"></div>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const div = document.querySelector("div");
    expect(div!.innerHTML).toBe("<b>rich</b>");
  });

  it("SSR モードで enable-ssr 付き wcs-state が wcs-ssr を生成する", async () => {
    document.body.innerHTML = `
      <wcs-state enable-ssr json='{"count":42}'></wcs-state>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const ssrEl = document.querySelector("wcs-ssr");
    expect(ssrEl).not.toBeNull();
    expect(ssrEl!.getAttribute("name")).toBe("default");
  });

  it("SSR モードで textarea の value がテキストコンテンツに反映される", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"text":"Hello"}'></wcs-state>
      <textarea data-wcs="value: text"></textarea>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const textarea = document.querySelector("textarea");
    expect(textarea!.textContent).toBe("Hello");
  });

  it("SSR モードで checked false が属性を除去する", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"off":false}'></wcs-state>
      <input type="checkbox" checked data-wcs="checked: off" />
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const input = document.querySelector("input");
    expect(input!.hasAttribute("checked")).toBe(false);
  });

  it("SSR モードで selected が属性に反映される", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"sel":true}'></wcs-state>
      <option data-wcs="selected: sel">A</option>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const option = document.querySelector("option");
    expect(option!.hasAttribute("selected")).toBe(true);
  });

  it("SSR モードで selected false が属性を除去する", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"sel":false}'></wcs-state>
      <option selected data-wcs="selected: sel">A</option>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const option = document.querySelector("option");
    expect(option!.hasAttribute("selected")).toBe(false);
  });

  it("SSR モードで disabled が属性に反映される", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"dis":true}'></wcs-state>
      <button data-wcs="disabled: dis">Click</button>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const button = document.querySelector("button");
    expect(button!.hasAttribute("disabled")).toBe(true);
  });

  it("SSR モードで disabled false が属性を除去する", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"dis":false}'></wcs-state>
      <button disabled data-wcs="disabled: dis">Click</button>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const button = document.querySelector("button");
    expect(button!.hasAttribute("disabled")).toBe(false);
  });

  it("SSR モードで selectedIndex が option に selected 属性を設定する", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"idx":1}'></wcs-state>
      <select data-wcs="selectedIndex: idx">
        <option>A</option>
        <option>B</option>
        <option>C</option>
      </select>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const options = document.querySelectorAll("option");
    expect(options[0].hasAttribute("selected")).toBe(false);
    expect(options[1].hasAttribute("selected")).toBe(true);
    expect(options[2].hasAttribute("selected")).toBe(false);
  });

  it("SSR モードで for ブロックにコメントマーカーが付与される", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"items":[{"name":"Alice"},{"name":"Bob"}]}'></wcs-state>
      <ul>
        <template data-wcs="for: items">
          <li data-wcs="textContent: .name"></li>
        </template>
      </ul>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const html = document.body.innerHTML;
    expect(html).toContain("@@wcs-for-start:");
    expect(html).toContain("@@wcs-for-end:");
    const items = document.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("Alice");
    expect(items[1].textContent).toBe("Bob");
  });

  it("SSR モードで if ブロック（true）にコメントマーカーが付与される", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"show":true}'></wcs-state>
      <template data-wcs="if: show">
        <p>visible</p>
      </template>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const html = document.body.innerHTML;
    expect(html).toContain("@@wcs-if-start:");
    expect(html).toContain("@@wcs-if-end:");
    expect(document.querySelector("p")!.textContent).toBe("visible");
  });

  it("SSR モードで if ブロック（false）はコンテンツを表示しない", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"show":false}'></wcs-state>
      <template data-wcs="if: show">
        <p>hidden</p>
      </template>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    expect(document.querySelector("p")).toBeNull();
  });

  it("SSR モードで enable-ssr なしの wcs-state は wcs-ssr を生成しない", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"count":42}'></wcs-state>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    expect(document.querySelector("wcs-ssr")).toBeNull();
  });

  it("SSR モードで if/else ブロックの else 側にコメントマーカーが付与される", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"loggedIn":false}'></wcs-state>
      <template data-wcs="if: loggedIn">
        <p>welcome</p>
      </template>
      <template data-wcs="else:">
        <p>please login</p>
      </template>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const html = document.body.innerHTML;
    expect(html).toContain("@@wcs-else-start:");
    expect(html).toContain("@@wcs-else-end:");
    expect(document.querySelector("p")!.textContent).toBe("please login");
  });

  it("SSR モードで enable-ssr + for テンプレートが wcs-ssr に格納される", async () => {
    document.body.innerHTML = `
      <wcs-state enable-ssr json='{"items":[{"name":"Alice"}]}'></wcs-state>
      <template data-wcs="for: items">
        <li data-wcs="textContent: .name"></li>
      </template>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const ssrEl = document.querySelector("wcs-ssr");
    expect(ssrEl).not.toBeNull();
    const tpl = ssrEl!.querySelector("template[id]");
    expect(tpl).not.toBeNull();
  });

  it("SSR モードで value が null の場合に空文字にフォールバックされる", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"val":null}'></wcs-state>
      <input data-wcs="value: val" />
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const input = document.querySelector("input");
    expect(input!.getAttribute("value")).toBe("");
  });

  it("SSR モードで textarea の value が null の場合に空文字にフォールバックされる", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"val":null}'></wcs-state>
      <textarea data-wcs="value: val"></textarea>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    const textarea = document.querySelector("textarea");
    expect(textarea!.textContent).toBe("");
  });

  it("SSR モードで for リストにアイテムを追加すると既存アイテムにもコメントマーカーが付与される", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"items":["A"]}'></wcs-state>
      <ul>
        <template data-wcs="for: items">
          <li data-wcs="textContent: items.*"></li>
        </template>
      </ul>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    // 初期レンダリング確認
    expect(document.querySelectorAll("li").length).toBe(1);

    // state API でアイテム追加（既存要素の reorder + 新規追加パスを通す）
    await stateEl.createStateAsync("writable", async (state: any) => {
      state.items = ["A", "B"];
    });

    const html = document.body.innerHTML;
    expect(document.querySelectorAll("li").length).toBe(2);
    // 既存アイテムと新規アイテムの両方にコメントマーカーがある
    const forStartMatches = html.match(/@@wcs-for-start:/g);
    const forEndMatches = html.match(/@@wcs-for-end:/g);
    expect(forStartMatches!.length).toBeGreaterThanOrEqual(2);
    expect(forEndMatches!.length).toBeGreaterThanOrEqual(2);
  });

  it("State.getBindingsReady で静的メソッドからバインディング完了を待機できる", async () => {
    const { State } = await import("../src/components/State");
    document.body.innerHTML = `
      <wcs-state json='{"x":1}'></wcs-state>
      <p data-wcs="textContent: x"></p>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(document);

    expect(document.querySelector("p")!.textContent).toBe("1");
  });
});
