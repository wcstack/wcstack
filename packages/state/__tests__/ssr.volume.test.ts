/**
 * SSR × ボリューム（D14）— スナップショットはルートに 1 本で、接ぎ木済みボリュームの
 * データを含む。hydrate ではボリューム要素はモジュールをロードする（getter / $ 宣言の
 * ため）が、データは接ぎ木せずスナップショットの部分木を**採用**する。宣言済み
 * ボリュームが所有するスロットに対して、hydrate 時は衝突検査を掛けない。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

const flush = () => new Promise((r) => setTimeout(r));

function i18nModule(): Record<string, any> {
  return {
    lang: "module",
    dict: {
      module: { title: "from module" },
      snapshot: { title: "スナップショット" },
    },
    connected: false,
    get t() { return this.dict[this.lang]; },
    $connectedCallback() { this.connected = true; },
  };
}

describe("SSR × ボリューム（D14: 採用）", () => {
  it("hydrate されたルートでは、スナップショットのボリューム部分木を採用し接ぎ木しないこと", async () => {
    document.body.innerHTML = `
      <wcs-ssr>
        <script type="application/json">{"count":9,"i18n":{"lang":"snapshot","dict":{"module":{"title":"from module"},"snapshot":{"title":"スナップショット"}},"connected":false}}</script>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"count":0}'></wcs-state>
      <wcs-state mount="i18n"></wcs-state>
      <h1 data-wcs="textContent: i18n.t.title"></h1>
    `;
    const rootEl = document.querySelector("wcs-state[enable-ssr]") as State;
    const volumeEl = document.querySelector("wcs-state[mount]") as State;
    volumeEl.setInitialState(i18nModule());
    await rootEl.connectedCallbackPromise;
    await volumeEl.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();

    // データはスナップショット側（lang: "snapshot"）— モジュールの lang: "module" では上書きされない
    expect((rootEl as any).__state.i18n.lang).toBe("snapshot");
    // getter はモジュールから登録され、採用したデータの上で評価される
    expect(document.querySelector("h1")?.textContent).toBe("スナップショット");
    // $connectedCallback は hydrate でも走る（自分のライフサイクル）
    rootEl.createState("readonly", (s: any) => {
      expect(s["i18n.connected"]).toBe(true);
    });
  });

  it("hydrate されたルートでも、スナップショットに部分木が無ければ通常どおり接ぎ木すること", async () => {
    document.body.innerHTML = `
      <wcs-ssr>
        <script type="application/json">{"count":9}</script>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"count":0}'></wcs-state>
      <wcs-state mount="i18nB"></wcs-state>
    `;
    const rootEl = document.querySelector("wcs-state[enable-ssr]") as State;
    const volumeEl = document.querySelector("wcs-state[mount]") as State;
    volumeEl.setInitialState(i18nModule());
    await rootEl.connectedCallbackPromise;
    await volumeEl.connectedCallbackPromise;
    await flush();

    expect((rootEl as any).__state.count).toBe(9);
    expect((rootEl as any).__state.i18nB.lang).toBe("module");
  });

  it("hydrate されていないルートでは、既存キーとの衝突は従来どおり raise すること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = `
      <wcs-state json='{"i18nC":{"already":true}}'></wcs-state>
      <wcs-state mount="i18nC"></wcs-state>
    `;
    const rootEl = document.querySelector("wcs-state:not([mount])") as State;
    const volumeEl = document.querySelector("wcs-state[mount]") as State;
    volumeEl.setInitialState(i18nModule());
    await rootEl.connectedCallbackPromise;
    await volumeEl.connectedCallbackPromise;
    await flush();

    // graftIsolated が console.error で隔離する（衝突は 1 ボリュームに閉じる）
    expect(errorSpy.mock.calls.some(
      (call) => String(call[1] ?? call[0]).includes("collides with an existing key"),
    )).toBe(true);
    // 採用はしていない（ルートのデータが残る）
    expect((rootEl as any).__state.i18nC).toEqual({ already: true });
    errorSpy.mockRestore();
  });

  it("深いマウントパスでも hydrate 済みなら採用すること", async () => {
    document.body.innerHTML = `
      <wcs-ssr>
        <script type="application/json">{"app":{"i18n":{"lang":"snapshot","dict":{"module":{"title":"from module"},"snapshot":{"title":"スナップショット"}},"connected":false}}}</script>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"other":1}'></wcs-state>
      <wcs-state mount="app.i18n"></wcs-state>
    `;
    const rootEl = document.querySelector("wcs-state[enable-ssr]") as State;
    const volumeEl = document.querySelector("wcs-state[mount]") as State;
    volumeEl.setInitialState(i18nModule());
    await rootEl.connectedCallbackPromise;
    await volumeEl.connectedCallbackPromise;
    await flush();

    expect((rootEl as any).__state.app.i18n.lang).toBe("snapshot");
  });

  it("ボリュームの enable-ssr は無効（スナップショットはルートに集約）で warn が出ること", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.innerHTML = `
      <wcs-state json='{"count":1}'></wcs-state>
      <wcs-state mount="i18nE" enable-ssr></wcs-state>
    `;
    const rootEl = document.querySelector("wcs-state:not([mount])") as State;
    const volumeEl = document.querySelector("wcs-state[mount]") as State;
    volumeEl.setInitialState(i18nModule());
    await rootEl.connectedCallbackPromise;
    await volumeEl.connectedCallbackPromise;
    await flush();

    expect(warnSpy.mock.calls.some(
      (call) => String(call[0]).includes('ignores "enable-ssr"'),
    )).toBe(true);
    // 接ぎ木自体は通常どおり成立する
    expect((rootEl as any).__state.i18nE.lang).toBe("module");
    warnSpy.mockRestore();
  });
});
