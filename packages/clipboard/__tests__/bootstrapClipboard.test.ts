import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapClipboard } from "../src/bootstrapClipboard";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapClipboard", () => {
  beforeEach(() => {
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-clipboardtarget",
      tagNames: { clipboard: "wcs-clipboard" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapClipboard()).not.toThrow();
  });

  it("カスタム設定を適用する", () => {
    bootstrapClipboard({ autoTrigger: false });
    expect(getConfig().autoTrigger).toBe(false);
  });

  it("wcs-clipboard をカスタム要素として登録する", () => {
    bootstrapClipboard();
    expect(customElements.get("wcs-clipboard")).toBeDefined();
  });
});
