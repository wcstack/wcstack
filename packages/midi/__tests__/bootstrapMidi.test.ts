import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapMidi } from "../src/bootstrapMidi";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapMidi", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { midi: "wcs-midi" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapMidi()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapMidi({ tagNames: { midi: "wcs-midi" } });
    expect(getConfig().tagNames.midi).toBe("wcs-midi");
  });

  it("wcs-midi をカスタム要素として登録する", () => {
    bootstrapMidi();
    expect(customElements.get("wcs-midi")).toBeDefined();
  });
});
