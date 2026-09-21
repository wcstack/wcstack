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

/** ルートノードの getBindingsReady が、次のマクロタスクまでにどう決着したか（印付けされていれば即 reject 済み） */
async function bindingsReadyState(rootNode: Node): Promise<"resolved" | "rejected" | "pending"> {
  return Promise.race([
    State.getBindingsReady(rootNode).then(() => "resolved" as const, () => "rejected" as const),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 0)),
  ]);
}

describe("core/lifecycleHooks — readiness barrier", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dcc 未 install で [data-wc-definition] ホスト内の <wcs-state> を接続すると名指しで落ち、DCC のロード失敗と同じ着地に載ること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const host = document.createElement("x-lifecycle-dcc-host");
      host.setAttribute("data-wc-definition", "");
      const shadow = host.attachShadow({ mode: "open" });
      const stateEl = document.createElement(STATE_TAG) as State;
      shadow.appendChild(stateEl);
      await expect((stateEl as any).connectedCallback())
        .rejects.toThrow(/\[wcs\/feature-not-installed\] a <wcs-state> inside a \[data-wc-definition\] host needs the "dcc" feature/);
      // 要件 D23: connectedCallbackPromise を待つ側（renderToString・mount）が止まらない
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/feature-not-installed/);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      // DCC の <wcs-state> はそのシャドウのツリーの持ち主なので、ツリーごと利用不能になる
      expect(await bindingsReadyState(shadow)).toBe("rejected");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("scopes 未 install で mount= を接続すると名指しで落ち、ルートを巻き込まずに着地すること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const host = document.createElement("x-lifecycle-volume-host");
      const shadow = host.attachShadow({ mode: "open" });
      const stateEl = document.createElement(STATE_TAG) as State;
      stateEl.setAttribute("mount", "vol");
      shadow.appendChild(stateEl);
      await expect((stateEl as any).connectedCallback())
        .rejects.toThrow(/\[wcs\/feature-not-installed\] the "mount" attribute needs the "scopes" feature/);
      // 要件 D23: この要素の connectedCallbackPromise は reject される
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/feature-not-installed/);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      // ボリュームはツリーの持ち主ではない。まだ来ていないルートのノードを利用不能と印付けしない
      expect(await bindingsReadyState(shadow)).not.toBe("rejected");
    } finally {
      errorSpy.mockRestore();
    }
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
