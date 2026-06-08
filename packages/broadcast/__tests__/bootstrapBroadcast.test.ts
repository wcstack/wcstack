import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapBroadcast } from "../src/bootstrapBroadcast";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapBroadcast", () => {
  beforeEach(() => {
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-broadcast-target",
      tagNames: { broadcast: "wcs-broadcast" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapBroadcast()).not.toThrow();
  });

  it("カスタム設定を適用する", () => {
    bootstrapBroadcast({ autoTrigger: false });
    expect(getConfig().autoTrigger).toBe(false);
  });

  it("wcs-broadcast をカスタム要素として登録する", () => {
    bootstrapBroadcast();
    expect(customElements.get("wcs-broadcast")).toBeDefined();
  });
});
