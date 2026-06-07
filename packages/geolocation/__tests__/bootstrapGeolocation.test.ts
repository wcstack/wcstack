import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapGeolocation } from "../src/bootstrapGeolocation";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapGeolocation", () => {
  beforeEach(() => {
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-geotarget",
      tagNames: { geo: "wcs-geo" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapGeolocation()).not.toThrow();
  });

  it("カスタム設定を適用する", () => {
    bootstrapGeolocation({ autoTrigger: false });
    expect(getConfig().autoTrigger).toBe(false);
  });

  it("wcs-geo をカスタム要素として登録する", () => {
    bootstrapGeolocation();
    expect(customElements.get("wcs-geo")).toBeDefined();
  });
});
