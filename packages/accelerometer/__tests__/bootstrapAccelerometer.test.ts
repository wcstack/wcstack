import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapAccelerometer } from "../src/bootstrapAccelerometer";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapAccelerometer", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { accelerometer: "wcs-accelerometer" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapAccelerometer()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapAccelerometer({ tagNames: { accelerometer: "wcs-accelerometer" } });
    expect(getConfig().tagNames.accelerometer).toBe("wcs-accelerometer");
  });

  it("wcs-accelerometer をカスタム要素として登録する", () => {
    bootstrapAccelerometer();
    expect(customElements.get("wcs-accelerometer")).toBeDefined();
  });
});
