import { describe, it, expect, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { mount, settle, fire } from "../src/exports";

const RESOLVER_KEY = Symbol.for("wcstack.ssr.resolveModule");
const g = globalThis as Record<symbol, unknown>;

// __tests__/fixtures/ledger/state.js が ./lib.js を import する（family-ledger の形）。
// 基底は変数で渡す: Vite（vitest）は new URL("<リテラル>", import.meta.url) を資産の URL に書き換える
const here = import.meta.url;
const fixtures = new URL("./fixtures/ledger/", here);
const resolveModule = (url: URL): URL => new URL("." + url.pathname, fixtures);

const LEDGER = `
  <wcs-state src="./state.js"></wcs-state>
  <p id="total" data-wcs="textContent: total"></p>
  <button id="add" data-wcs="onclick: add">+1</button>
`;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** state は初期化の失敗を console.error にも出す — 期待した失敗のテストでは黙らせる */
function silenceStateReport(): void {
  vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("mount(html, { resolveModule }) — 自分のファイルにある state（<wcs-state src>）", () => {
  it("resolveModule が返すファイルから src の state を読み、その state が import する相対モジュールも解決する", async () => {
    const app = await mount(LEDGER, { resolveModule });
    expect(app.root.querySelector("#total")!.textContent).toBe("7");
    fire(app.root.querySelector("#add")!, "click");
    await settle();
    expect(app.root.querySelector("#total")!.textContent).toBe("8");
    expect(app.state().read((s) => s.entries.length)).toBe(3);
  });

  it("mount ごとにモジュールを読み直す — 2 回の mount は state のオブジェクトを共有しない", async () => {
    const first = await mount(LEDGER, { resolveModule });
    await first.state().write((s) => { s.add(); s.add(); });
    await settle();
    expect(first.root.querySelector("#total")!.textContent).toBe("9");
    first.unmount();

    const second = await mount(LEDGER, { resolveModule });
    expect(second.root.querySelector("#total")!.textContent).toBe("7");
    expect(second.state().read((s) => s.entries.length)).toBe(2);
  });

  it("ファイルのパス（文字列）と file: URL の文字列も受け付け、ページが名指す URL を渡す", async () => {
    const seen: string[] = [];
    const asPath = await mount(LEDGER, {
      resolveModule: (url) => { seen.push(url.href); return fileURLToPath(resolveModule(url)); },
    });
    expect(asPath.root.querySelector("#total")!.textContent).toBe("7");
    expect(seen).toEqual([new URL("./state.js", document.baseURI).href]);

    const asFileUrl = await mount(LEDGER, { resolveModule: (url) => resolveModule(url).href });
    expect(asFileUrl.root.querySelector("#total")!.textContent).toBe("7");
  });

  it("file: の src はそのまま import する（resolveModule は呼ばない）", async () => {
    const spy = vi.fn(resolveModule);
    const src = new URL("state.js", fixtures).href;
    const app = await mount(`<wcs-state src="${src}"></wcs-state><p id="total" data-wcs="textContent: total"></p>`, { resolveModule: spy });
    expect(app.root.querySelector("#total")!.textContent).toBe("7");
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolveModule が無ければ、Node の ERR_UNSUPPORTED_ESM_URL_SCHEME ではなく、渡すように言って reject する", async () => {
    silenceStateReport();
    const mounting = mount(LEDGER);
    await expect(mounting).rejects.toThrow(/@wcstack\/testing: <wcs-state src> names http:\/\/[^ ]+\/state\.js, which Node cannot import/);
    await expect(mounting).rejects.toThrow(/Pass mount\(html, \{ resolveModule \}\) to map it to a local file/);
  });

  it("resolveModule が何も返さなければ、そう言って reject する", async () => {
    silenceStateReport();
    await expect(mount(LEDGER, { resolveModule: () => null })).rejects.toThrow(/resolveModule returned no file for it/);
  });

  it("resolver は mount の間だけ置き、元の値を戻す（失敗した mount でも）", async () => {
    expect(Object.prototype.hasOwnProperty.call(g, RESOLVER_KEY)).toBe(false);
    await mount(LEDGER, { resolveModule });
    expect(Object.prototype.hasOwnProperty.call(g, RESOLVER_KEY)).toBe(false);

    const previous = () => null;
    g[RESOLVER_KEY] = previous;
    try {
      await mount(LEDGER, { resolveModule });
      expect(g[RESOLVER_KEY]).toBe(previous);
      silenceStateReport();
      await expect(mount(LEDGER)).rejects.toThrow(/resolveModule/);
      expect(g[RESOLVER_KEY]).toBe(previous);
    } finally {
      delete g[RESOLVER_KEY];
    }
  });
});

describe("mount — setInitialState() を待つことになる <wcs-state> は、待たずに理由を言って reject する", () => {
  it("読み込み元の無いルートの <wcs-state>: 何を書けばよいかを言い、ページには何も挿入しない", async () => {
    document.body.innerHTML = "<i>before</i>";
    const mounting = mount(`<wcs-state></wcs-state><p data-wcs="textContent: x"></p>`);
    await expect(mounting).rejects.toThrow(/@wcstack\/testing: <wcs-state> has no state to load/);
    await expect(mounting).rejects.toThrow(/waits for setInitialState\(\) — which a test cannot call before mount\(\) returns/);
    await expect(mounting).rejects.toThrow(/json='\{"count": 0\}', an inline <script type="module">.*or src="\.\/state\.js" with mount\(html, \{ resolveModule \}\)/);
    expect(document.body.innerHTML).toBe("<i>before</i>");
  });

  it("読み込み元の無いボリューム（mount=）も同じ — 書かれたとおりの開始タグで指す", async () => {
    await expect(mount(`
      <wcs-state json='{"a": 1}'></wcs-state>
      <wcs-state mount="cfg" id="settings"></wcs-state>
    `)).rejects.toThrow(/<wcs-state mount="cfg" id="settings"> has no state to load/);
  });

  it("shadow に入れる HTML も、改名した state タグも同じく調べる", async () => {
    await expect(mount(`<wcs-state data-x></wcs-state>`, { root: "shadow" })).rejects.toThrow(/<wcs-state data-x> has no state to load/);
    await expect(mount(`<my-state></my-state>`, { stateTagName: "my-state" })).rejects.toThrow(/<my-state> has no state to load/);
  });

  it("state= / json= / インラインスクリプトの要素、<template> の中の要素は対象外", async () => {
    const app = await mount(`
      <script type="application/json" id="initial">{"a": 1}</script>
      <wcs-state state="initial"></wcs-state>
      <p id="a" data-wcs="textContent: a"></p>
      <template><wcs-state></wcs-state></template>
    `);
    expect(app.root.querySelector("#a")!.textContent).toBe("1");
  });

  it("bind-component の要素は対象外（状態はホストのプロパティから来る）", async () => {
    silenceStateReport();
    // ホストの無い bind-component は state 自身が理由を言って失敗する — こちらの検査には掛からない
    const mounting = mount(`<wcs-state bind-component="state"></wcs-state>`);
    await expect(mounting).rejects.toThrow(/direct child of a custom element/);
    await expect(mounting).rejects.not.toThrow(/no state to load/);
  });
});
