import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapFullscreen } from "../src/bootstrapFullscreen";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapFullscreen", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { fullscreen: "wcs-fullscreen" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapFullscreen()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapFullscreen({ tagNames: { fullscreen: "wcs-fullscreen" } });
    expect(getConfig().tagNames.fullscreen).toBe("wcs-fullscreen");
  });

  it("wcs-fullscreen をカスタム要素として登録する", () => {
    bootstrapFullscreen();
    expect(customElements.get("wcs-fullscreen")).toBeDefined();
  });
});
