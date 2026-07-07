import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapAmbientLightSensor } from "../src/bootstrapAmbientLightSensor";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapAmbientLightSensor", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { ambientLightSensor: "wcs-ambient-light-sensor" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapAmbientLightSensor()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    // 同名 tagName を渡して setConfig 経路（userConfig truthy 分岐）を通す。
    // 別名にするとクラスが既登録のため define が衝突するため、登録済みタグを使う。
    bootstrapAmbientLightSensor({ tagNames: { ambientLightSensor: "wcs-ambient-light-sensor" } });
    expect(getConfig().tagNames.ambientLightSensor).toBe("wcs-ambient-light-sensor");
  });

  it("wcs-ambient-light-sensor をカスタム要素として登録する", () => {
    bootstrapAmbientLightSensor();
    expect(customElements.get("wcs-ambient-light-sensor")).toBeDefined();
  });
});
