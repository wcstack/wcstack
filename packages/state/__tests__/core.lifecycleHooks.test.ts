import { describe, it, expect, vi, afterEach } from "vitest";
import { State } from "../src/components/State";
import { registerLifecycleHooks, runConnecting, CLAIMED } from "../src/core/lifecycleHooks";
import type { IStateElement } from "../src/components/types";

/**
 * ライフサイクルの受け口（core/lifecycleHooks.ts、設計案 H3・H5）の境界。
 * このファイルは bootstrapState() を呼ばないので、どの機能も install されていない
 * （＝ 分割エントリで機能を install し忘れたページと同じ）。
 */
const STATE_TAG = "wcs-state-lifecycle-boundary";
if (!customElements.get(STATE_TAG)) {
  customElements.define(STATE_TAG, State);
}

describe("core/lifecycleHooks — readiness barrier", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dcc 未 install で [data-wc-definition] ホスト内の <wcs-state> を接続すると名指しで落ちること", async () => {
    const host = document.createElement("x-lifecycle-dcc-host");
    host.setAttribute("data-wc-definition", "");
    const shadow = host.attachShadow({ mode: "open" });
    const stateEl = document.createElement(STATE_TAG) as State;
    shadow.appendChild(stateEl);
    await expect((stateEl as any).connectedCallback())
      .rejects.toThrow(/\[wcs\/feature-not-installed\] a <wcs-state> inside a \[data-wc-definition\] host needs the "dcc" feature/);
  });

  it("scopes 未 install で mount= を接続すると名指しで落ちること", async () => {
    const stateEl = document.createElement(STATE_TAG) as State;
    stateEl.setAttribute("mount", "vol");
    document.body.appendChild(stateEl);
    await expect((stateEl as any).connectedCallback())
      .rejects.toThrow(/\[wcs\/feature-not-installed\] the "mount" attribute needs the "scopes" feature/);
  });
});

describe("core/lifecycleHooks — readiness barrier（着地）", () => {
  it("scopes 未 install で bind-component を接続すると名指しで落ち、初期化失敗として着地すること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const stateEl = document.createElement(STATE_TAG) as State;
      stateEl.setAttribute("bind-component", "state");
      await expect((stateEl as any).connectedCallback())
        .rejects.toThrow(/\[wcs\/feature-not-installed\] the "bind-component" attribute needs the "scopes" feature/);
      // 黙って素の state にならず、bind-component の他の設定エラーと同じ着地（#257）に載る
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/feature-not-installed/);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("core/lifecycleHooks — order", () => {
  it("install の順ではなく order の昇順で聞き、最初に引き取った機能で確定すること", () => {
    const asked: string[] = [];
    const element = {} as IStateElement;
    registerLifecycleHooks("test-late", {
      order: 20,
      connecting: () => { asked.push("late"); return CLAIMED; },
    });
    registerLifecycleHooks("test-early", {
      order: 10,
      connecting: () => { asked.push("early"); return null; },
    });
    expect(runConnecting(element)).toBe(CLAIMED);
    expect(asked).toEqual(["early", "late"]);
  });

  it("同じ機能名の再登録は置き換えで、二重に聞かないこと（install の冪等）", () => {
    const connecting = vi.fn(() => null);
    registerLifecycleHooks("test-idempotent", { order: 5, connecting });
    registerLifecycleHooks("test-idempotent", { order: 5, connecting });
    runConnecting({} as IStateElement);
    expect(connecting).toHaveBeenCalledTimes(1);
  });
});
