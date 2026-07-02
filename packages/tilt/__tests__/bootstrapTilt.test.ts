import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapTilt } from "../src/bootstrapTilt";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapTilt", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { tilt: "wcs-tilt" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapTilt()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    bootstrapTilt({ tagNames: { tilt: "wcs-tilt" } });
    expect(getConfig().tagNames.tilt).toBe("wcs-tilt");
  });

  it("wcs-tilt をカスタム要素として登録する", () => {
    bootstrapTilt();
    expect(customElements.get("wcs-tilt")).toBeDefined();
  });
});
