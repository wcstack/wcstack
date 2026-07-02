import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapCredential } from "../src/bootstrapCredential";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapCredential", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { credential: "wcs-credential" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapCredential()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    bootstrapCredential({ tagNames: { credential: "wcs-credential" } });
    expect(getConfig().tagNames.credential).toBe("wcs-credential");
  });

  it("wcs-credential をカスタム要素として登録する", () => {
    bootstrapCredential();
    expect(customElements.get("wcs-credential")).toBeDefined();
  });
});
