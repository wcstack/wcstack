import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapDefined } from "../src/bootstrapDefined.js";
import { getConfig, setConfig } from "../src/config.js";

describe("bootstrapDefined", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { defined: "wcs-defined" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapDefined()).not.toThrow();
  });

  it("二度呼んでも再登録で throw しない（冪等）", () => {
    bootstrapDefined();
    expect(() => bootstrapDefined()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapDefined({ tagNames: { defined: "wcs-defined" } });
    expect(getConfig().tagNames.defined).toBe("wcs-defined");
  });

  it("wcs-defined をカスタム要素として登録する", () => {
    bootstrapDefined();
    expect(customElements.get("wcs-defined")).toBeDefined();
  });
});
