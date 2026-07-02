import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapNetwork } from "../src/bootstrapNetwork";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapNetwork", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { network: "wcs-network" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapNetwork()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapNetwork({ tagNames: { network: "wcs-network" } });
    expect(getConfig().tagNames.network).toBe("wcs-network");
  });

  it("wcs-network をカスタム要素として登録する", () => {
    bootstrapNetwork();
    expect(customElements.get("wcs-network")).toBeDefined();
  });
});
