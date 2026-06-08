import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapWorker } from "../src/bootstrapWorker";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapWorker", () => {
  beforeEach(() => {
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-worker-target",
      tagNames: { worker: "wcs-worker" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapWorker()).not.toThrow();
  });

  it("カスタム設定を適用する", () => {
    bootstrapWorker({ autoTrigger: false });
    expect(getConfig().autoTrigger).toBe(false);
  });

  it("wcs-worker をカスタム要素として登録する", () => {
    bootstrapWorker();
    expect(customElements.get("wcs-worker")).toBeDefined();
  });
});
