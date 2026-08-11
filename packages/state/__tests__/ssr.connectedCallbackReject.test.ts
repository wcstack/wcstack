import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

// バインディング初期化の失敗を決定的に再現する（throw の形は何でもよい —
// 対象は「初期化中に何か 1 つでも投げたとき」の配管そのもの）
vi.mock("../src/buildBindings", () => ({
  buildBindings: vi.fn().mockRejectedValue(new Error("binding init failed")),
}));

import { bootstrapState } from "../src/bootstrapState";

beforeAll(() => {
  bootstrapState();
});

describe("SSR モード + enable-ssr でのバインディング初期化失敗", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-wcs-server");
    document.body.innerHTML = "";
  });

  // §8.2（docs/state-bind-component-nested-for-design.md）:
  // getBindingsReady の reject を connectedCallbackPromise まで配管しないと、
  // @wcstack/server の renderToString が mutex を握ったまま
  // connectedCallbackPromise 待ちで無言ハングする
  it("connectedCallbackPromise が reject し、無言ハングにならないこと", async () => {
    document.documentElement.setAttribute("data-wcs-server", "");
    document.body.innerHTML = `<wcs-state json='{"a":1}' enable-ssr></wcs-state>`;
    const stateEl = document.querySelector("wcs-state") as any;

    await expect(stateEl.connectedCallbackPromise).rejects.toThrow("binding init failed");
  });
});
