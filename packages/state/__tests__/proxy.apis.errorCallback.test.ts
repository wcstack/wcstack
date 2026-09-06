/**
 * proxy/apis/errorCallback.ts の単体テスト — `$errorCallback` の有無と this の受け渡し。
 * 配送タイミング・隔離・console 抑止は applyChangeFromBindings / integration 側で固定する。
 */
import { describe, it, expect, vi } from "vitest";
import { errorCallback } from "../src/proxy/apis/errorCallback";
import type { IBindingErrorInfo } from "../src/types";

const info: IBindingErrorInfo = { path: "a.b", bindingType: "prop", node: document.createElement("div") };

describe("errorCallback api", () => {
  it("$errorCallback が関数なら receiver を this にして (error, info) で呼ぶこと", () => {
    const callback = vi.fn();
    const target = { $errorCallback: callback };
    const receiver = { proxy: true };
    const error = new Error("boom");

    errorCallback(target, error, info, receiver, {} as any);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(error, info);
    expect(callback.mock.instances[0]).toBe(receiver);
  });

  it("$errorCallback が無い・関数でない場合は何もしないこと", () => {
    expect(() => errorCallback({}, new Error("boom"), info, {}, {} as any)).not.toThrow();
    expect(() => errorCallback({ $errorCallback: "nope" }, new Error("boom"), info, {}, {} as any)).not.toThrow();
  });
});
