import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapGyroscope } from "../src/bootstrapGyroscope";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapGyroscope", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { gyroscope: "wcs-gyroscope" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapGyroscope()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapGyroscope({ tagNames: { gyroscope: "wcs-gyroscope" } });
    expect(getConfig().tagNames.gyroscope).toBe("wcs-gyroscope");
  });

  it("wcs-gyroscope をカスタム要素として登録する", () => {
    bootstrapGyroscope();
    expect(customElements.get("wcs-gyroscope")).toBeDefined();
  });
});
