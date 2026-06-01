import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapTimer } from "../src/bootstrapTimer";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapTimer", () => {
  beforeEach(() => {
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-timertarget",
      tagNames: { timer: "wcs-timer" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapTimer()).not.toThrow();
  });

  it("カスタム設定を適用する", () => {
    bootstrapTimer({ autoTrigger: false });
    expect(getConfig().autoTrigger).toBe(false);
  });

  it("wcs-timer をカスタム要素として登録する", () => {
    bootstrapTimer();
    expect(customElements.get("wcs-timer")).toBeDefined();
  });
});
