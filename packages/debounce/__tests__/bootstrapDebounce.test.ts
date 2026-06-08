import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapDebounce } from "../src/bootstrapDebounce";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapDebounce", () => {
  beforeEach(() => {
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-debouncetarget",
      tagNames: { debounce: "wcs-debounce", throttle: "wcs-throttle" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapDebounce()).not.toThrow();
  });

  it("カスタム設定を適用する", () => {
    bootstrapDebounce({ autoTrigger: false });
    expect(getConfig().autoTrigger).toBe(false);
  });

  it("wcs-debounce と wcs-throttle をカスタム要素として登録する", () => {
    bootstrapDebounce();
    expect(customElements.get("wcs-debounce")).toBeDefined();
    expect(customElements.get("wcs-throttle")).toBeDefined();
  });
});
