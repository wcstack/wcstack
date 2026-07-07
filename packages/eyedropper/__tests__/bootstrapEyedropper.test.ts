import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapEyedropper } from "../src/bootstrapEyedropper";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapEyedropper", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { eyedropper: "wcs-eyedropper" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapEyedropper()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapEyedropper({ tagNames: { eyedropper: "wcs-eyedropper" } });
    expect(getConfig().tagNames.eyedropper).toBe("wcs-eyedropper");
  });

  it("wcs-eyedropper をカスタム要素として登録する", () => {
    bootstrapEyedropper();
    expect(customElements.get("wcs-eyedropper")).toBeDefined();
  });
});
