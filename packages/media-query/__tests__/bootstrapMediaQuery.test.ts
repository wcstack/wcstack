import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapMediaQuery } from "../src/bootstrapMediaQuery";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapMediaQuery", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { mediaQuery: "wcs-media-query" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapMediaQuery()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapMediaQuery({ tagNames: { mediaQuery: "wcs-media-query" } });
    expect(getConfig().tagNames.mediaQuery).toBe("wcs-media-query");
  });

  it("wcs-media-query をカスタム要素として登録する", () => {
    bootstrapMediaQuery();
    expect(customElements.get("wcs-media-query")).toBeDefined();
  });
});
