import { describe, it, expect, vi } from "vitest";
import { getUpdater, registerEnqueueListener } from "../src/updater/updater";
import type { IAbsoluteStateAddress } from "../src/address/types";

/**
 * enqueue listener（updater の受け口。`$watch` の連鎖・`on` scan の保留 reset が install で登録する）の境界。
 * drain は走らせない（queueMicrotask を差し替える）ので、このファイルは他のテストと分けてある。
 */
describe("updater — enqueue listener", () => {
  it("書き込みの enqueue ごとに登録済み listener へアドレスを渡し、同じ listener の再登録は 1 回として扱うこと", () => {
    const listener = vi.fn();
    registerEnqueueListener(listener);
    registerEnqueueListener(listener);
    vi.stubGlobal("queueMicrotask", () => undefined);
    try {
      const address = {} as IAbsoluteStateAddress;
      getUpdater().enqueueAbsoluteAddress(address);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(address);
      // 描画だけのやり直しは書き込みではないので listener に届かない
      getUpdater().enqueueRenderOnlyAddress({} as IAbsoluteStateAddress);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
