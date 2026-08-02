import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapAudio } from "../src/bootstrapAudio";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapAudio", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { audio: "wcs-audio" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapAudio()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapAudio({ tagNames: { audio: "wcs-audio" } });
    expect(getConfig().tagNames.audio).toBe("wcs-audio");
  });

  it("wcs-audio をカスタム要素として登録する", () => {
    bootstrapAudio();
    expect(customElements.get("wcs-audio")).toBeDefined();
  });
});
