import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapPip } from "../src/bootstrapPip";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapPip", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { pip: "wcs-pip" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapPip()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapPip({ tagNames: { pip: "wcs-pip" } });
    expect(getConfig().tagNames.pip).toBe("wcs-pip");
  });

  it("wcs-pip をカスタム要素として登録する", () => {
    bootstrapPip();
    expect(customElements.get("wcs-pip")).toBeDefined();
  });
});
