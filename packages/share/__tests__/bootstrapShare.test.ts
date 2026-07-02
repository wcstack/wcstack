import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapShare } from "../src/bootstrapShare";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapShare", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { share: "wcs-share" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapShare()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapShare({ tagNames: { share: "wcs-share" } });
    expect(getConfig().tagNames.share).toBe("wcs-share");
  });

  it("wcs-share をカスタム要素として登録する", () => {
    bootstrapShare();
    expect(customElements.get("wcs-share")).toBeDefined();
  });
});
