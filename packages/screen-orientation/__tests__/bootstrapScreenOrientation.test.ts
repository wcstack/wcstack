import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapScreenOrientation } from "../src/bootstrapScreenOrientation";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapScreenOrientation", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { screenOrientation: "wcs-screen-orientation" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapScreenOrientation()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    bootstrapScreenOrientation({ tagNames: { screenOrientation: "wcs-screen-orientation" } });
    expect(getConfig().tagNames.screenOrientation).toBe("wcs-screen-orientation");
  });

  it("wcs-screen-orientation をカスタム要素として登録する", () => {
    bootstrapScreenOrientation();
    expect(customElements.get("wcs-screen-orientation")).toBeDefined();
  });
});
