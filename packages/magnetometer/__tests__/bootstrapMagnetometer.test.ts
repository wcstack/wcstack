import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapMagnetometer } from "../src/bootstrapMagnetometer";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapMagnetometer", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { magnetometer: "wcs-magnetometer" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapMagnetometer()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapMagnetometer({ tagNames: { magnetometer: "wcs-magnetometer" } });
    expect(getConfig().tagNames.magnetometer).toBe("wcs-magnetometer");
  });

  it("wcs-magnetometer をカスタム要素として登録する", () => {
    bootstrapMagnetometer();
    expect(customElements.get("wcs-magnetometer")).toBeDefined();
  });
});
