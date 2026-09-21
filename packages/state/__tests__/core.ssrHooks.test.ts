import { describe, it, expect, vi } from "vitest";
import { State } from "../src/components/State";
import { registerComponents } from "../src/registerComponents";
import { ssrHooks } from "../src/core/ssrHooks";

/**
 * SSR の受け口（core/ssrHooks.ts、設計案 H8・H5）の境界。
 * このファイルは `bootstrapState()` を呼ばないので SSR 機能は install されていない
 * （＝ 分割エントリで `features/ssr` を入れないページ）。
 */
const STATE_TAG = "wcs-state-ssr-boundary";
if (!customElements.get(STATE_TAG)) {
  customElements.define(STATE_TAG, State);
}

describe("core/ssrHooks — 未 install", () => {
  it("受け口は空で、`<wcs-ssr>` も定義されないこと", () => {
    expect(ssrHooks).toBeNull();
    const registry = { get: vi.fn(() => undefined), define: vi.fn() } as unknown as CustomElementRegistry;
    registerComponents(registry);
    expect(vi.mocked(registry.define).mock.calls.map((call) => call[0])).toEqual(["wcs-state"]);
  });

  it("enable-ssr を宣言した state の接続は名指しで落ちること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const stateEl = document.createElement(STATE_TAG) as State;
      stateEl.setAttribute("enable-ssr", "");
      stateEl.setAttribute("state", '{"message":"hi"}');
      document.body.appendChild(stateEl);
      await expect(stateEl.connectedCallbackPromise)
        .rejects.toThrow(/\[wcs\/feature-not-installed\] the "enable-ssr" attribute needs the "ssr" feature/);
      stateEl.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("enable-ssr の無い state は受け口を一度も見ないこと", async () => {
    const stateEl = document.createElement(STATE_TAG) as State;
    stateEl.setAttribute("state", '{"message":"hi"}');
    document.body.appendChild(stateEl);
    await expect(stateEl.connectedCallbackPromise).resolves.toBeUndefined();
    stateEl.remove();
  });
});
