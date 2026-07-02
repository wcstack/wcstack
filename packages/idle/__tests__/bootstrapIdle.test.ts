import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapIdle } from "../src/bootstrapIdle";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapIdle", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { idle: "wcs-idle" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapIdle()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    bootstrapIdle({ tagNames: { idle: "wcs-idle" } });
    expect(getConfig().tagNames.idle).toBe("wcs-idle");
  });

  it("wcs-idle をカスタム要素として登録する", () => {
    bootstrapIdle();
    expect(customElements.get("wcs-idle")).toBeDefined();
  });
});
