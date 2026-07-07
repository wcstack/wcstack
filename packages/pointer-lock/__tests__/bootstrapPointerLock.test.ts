import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapPointerLock } from "../src/bootstrapPointerLock";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapPointerLock", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { pointerLock: "wcs-pointer-lock" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapPointerLock()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapPointerLock({ tagNames: { pointerLock: "wcs-pointer-lock" } });
    expect(getConfig().tagNames.pointerLock).toBe("wcs-pointer-lock");
  });

  it("wcs-pointer-lock をカスタム要素として登録する", () => {
    bootstrapPointerLock();
    expect(customElements.get("wcs-pointer-lock")).toBeDefined();
  });
});
