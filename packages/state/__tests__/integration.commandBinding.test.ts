import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import type { IWcBindable } from "../src/event/types";

beforeAll(() => {
  bootstrapState();
});

/**
 * command binding 統合テスト。
 *
 * - 実 `data-wcs="command.fetch: $command.fetchUsers"` 文字列をパーサ・bindings 構築・
 *   apply 経路まで全て本物で通す。
 * - state 側は JSON で `$commandTokens` を宣言し、`$command` namespace 経由で
 *   token を取り出して emit する。
 * - subscribe → emit → 要素メソッド呼び出しまでの導線が壊れていないことを検証する。
 */
describe("command binding (integration)", () => {
  it("実 binding 文字列 command.fetch: $command.fetchUsers が要素メソッドへ通ること", async () => {
    const fetchSpy = vi.fn().mockReturnValue("ok");
    const tagName = "cmd-fetch-integration";
    if (!customElements.get(tagName)) {
      class C extends HTMLElement {
        static wcBindable: IWcBindable = {
          protocol: "wc-bindable",
          version: 1,
          properties: [],
          commands: ["fetch"],
        };
        fetch(...args: unknown[]): unknown {
          return fetchSpy(...args);
        }
      }
      customElements.define(tagName, C);
    }

    const host = document.createElement("cmd-binding-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tagName} data-wcs="command.fetch: $command.fetchUsers"></${tagName}>
      <wcs-state json='{"$commandTokens":["fetchUsers"]}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    let results: unknown[] | undefined;
    await stateEl.createStateAsync("readonly", async (state: any) => {
      results = state.$command.fetchUsers.emit("/api/users", { method: "GET" });
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/users", { method: "GET" });
    expect(results).toEqual(["ok"]);

    host.remove();
  });
});
