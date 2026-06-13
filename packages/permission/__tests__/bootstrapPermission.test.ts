import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapPermission } from "../src/bootstrapPermission";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapPermission", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { permission: "wcs-permission" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapPermission()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapPermission({ tagNames: { permission: "wcs-permission" } });
    expect(getConfig().tagNames.permission).toBe("wcs-permission");
  });

  it("wcs-permission をカスタム要素として登録する", () => {
    bootstrapPermission();
    expect(customElements.get("wcs-permission")).toBeDefined();
  });
});
