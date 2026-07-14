import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import type { IWcBindable } from "../src/event/types";

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

let counter = 0;
function uniqueTag(prefix: string): string {
  return `${prefix}-${++counter}`;
}

/**
 * Deferred whenDefined 経路の統合テスト。
 *
 * Note: happy-dom は customElements.define による既存ノードのアップグレード
 * 時にノードの位置を保持しない既知の挙動があるため、実ブラウザでの「同一
 * ノードへの値適用」を直接検証できない。ここでは deferred 経路が
 * customElements.whenDefined をスケジュールし、解決後にハンドラが
 * 呼ばれることを「ノードが事前に切断されたケースで no-op になる」
 * テストで間接的に確認する。
 *
 * end-to-end の動作は実ブラウザ向け examples/spread/ で確認する。
 */
describe("spread binding deferred (integration)", () => {
  it("deferred 中に node が削除された場合は whenDefined 後に no-op になること", async () => {
    const tag = uniqueTag("spread-deferred-removed");

    const host = document.createElement(uniqueTag("spread-deferred-removed-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="mock" data-wcs="...: fetchX"></${tag}>
      <wcs-state json='{"fetchX":{"value":"hi"}}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const el = shadowRoot.querySelector("#mock") as any;
    // class 未定義時点では spread は未展開
    expect(el.value).toBeUndefined();

    // 要素を削除してから class 登録 → deferred ハンドラは isConnected=false で抜ける
    el.remove();

    class LateEl extends HTMLElement {
      static wcBindable: IWcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [{ name: "value", event: `${tag}:value-changed` }],
      };
    }
    customElements.define(tag, LateEl);

    await customElements.whenDefined(tag);
    await Promise.resolve();
    await Promise.resolve();

    // 削除済み node なのでハンドラは早期 return、エラーも値更新も発生しない
    expect(el.value).toBeUndefined();

    host.remove();
  });

  it("後から登録された class が無効な wcBindable の場合は console.error に報告すること", async () => {
    const tag = uniqueTag("spread-deferred-invalid");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const host = document.createElement(uniqueTag("spread-deferred-invalid-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="mock" data-wcs="...: fetchX"></${tag}>
      <wcs-state json='{"fetchX":{"value":"hi"}}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    class LateInvalidEl extends HTMLElement {}
    customElements.define(tag, LateInvalidEl);

    await customElements.whenDefined(tag);
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain(`[@wcstack/state] deferred spread failed for <${tag}>.`);
    expect(errorSpy.mock.calls[0]?.[1]).toBeInstanceOf(Error);
    expect((errorSpy.mock.calls[0]?.[1] as Error).message).toContain(
      `[@wcstack/state] Spread binding "fetchX" requires <${tag}> to expose a valid wcBindable declaration`,
    );

    host.remove();
  });
});
