import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

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

async function settleWhenDefined(tag: string): Promise<void> {
  await customElements.whenDefined(tag);
  // whenDefined の then コールバック（scheduleDeferredApply）→ applyChangeFromBindings
  // が走り切るまで譲る
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * 未 define カスタム要素への値適用の whenDefined 再適用
 * （scheduleDeferredApply、docs/state-binding-init-races.md §2）の統合テスト。
 *
 * 従来は applyChange が「customElement 側の初期化を期待」して片道 skip して
 * おり、state の初期化が要素の define より先に完了する構成（例: state を
 * ローカル配信・I/O ノードを CDN 配信）で初期値が永遠に適用されなかった。
 *
 * Note: happy-dom は customElements.define による既存ノードのアップグレード時に
 * ノードを差し替える既知の挙動があるため、「同一ノードへ define 後に値が届く」
 * happy path は unit では直接検証できない（integration.spreadDeferred.test.ts と
 * 同じ制約）。ここでは skip → whenDefined スケジュール → コールバック実行までの
 * 経路（no-op / エラー報告 / 多重登録ガード）を検証し、end-to-end は実ブラウザ
 * （examples/state-sse-dashboard、docs/state-binding-init-races.md §4 の再現手順）
 * で確認する。
 */
describe("deferred apply for late-defined custom elements (integration)", () => {
  it("未 define の間は適用されず（own property を書かない）、削除されたノードには whenDefined 後も適用しないこと", async () => {
    const tag = uniqueTag("apply-deferred-removed");

    const host = document.createElement(uniqueTag("apply-deferred-removed-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="mock" data-wcs="url: theUrl"></${tag}>
      <wcs-state json='{"theUrl":"/a"}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const el = shadowRoot.querySelector("#mock") as any;
    // class 未定義の間は適用されない（own property を書いて upgrade 後の
    // class accessor を隠さない、という skip の本来の目的は維持）
    expect(el.url).toBeUndefined();

    el.remove();

    class LateEl extends HTMLElement {}
    customElements.define(tag, LateEl);
    await settleWhenDefined(tag);

    // 削除済みノードには再適用しない（deferred spread と同じ規約）
    expect(el.url).toBeUndefined();

    host.remove();
  });

  it("再適用の失敗は console.error に報告され、define 前に何度 applyChange が走っても再適用は 1 回だけであること", async () => {
    const tag = uniqueTag("apply-deferred-error");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const host = document.createElement(uniqueTag("apply-deferred-error-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="mock" data-wcs="url: theUrl"></${tag}>
      <wcs-state json='{"theUrl":"/a"}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    // define 前に state を更新 → 2 回目の applyChange も skip 経路に入り
    // scheduleDeferredApply が再度呼ばれる（多重登録ガードの対象）
    await stateEl.createStateAsync("writable", async (state: any) => {
      state.theUrl = "/b";
    });
    await new Promise((r) => setTimeout(r, 0));

    // binding のノードは接続したまま state element だけ除去 → 再適用時に
    // state 解決が raiseError → catch 経路で console.error に報告される
    stateEl.remove();

    class LateEl extends HTMLElement {}
    customElements.define(tag, LateEl);
    await settleWhenDefined(tag);

    // ガードが無ければ whenDefined コールバックが 2 回走り error も 2 回になる
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain(`[@wcstack/state] deferred apply failed for <${tag}>.`);

    host.remove();
  });
});
