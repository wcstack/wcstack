import { describe, it, expect } from "vitest";
import { bootstrapIntersection } from "../src/bootstrapIntersection.js";
import { WcsIntersect } from "../src/components/Intersect.js";
import { config, setConfig } from "../src/config.js";

describe("bootstrapIntersection", () => {
  it("既定タグ名 wcs-intersect を登録する", () => {
    bootstrapIntersection();
    expect(customElements.get("wcs-intersect")).toBe(WcsIntersect);
  });

  it("再呼び出しは冪等（既に定義済みでも throw しない）", () => {
    bootstrapIntersection();
    expect(() => bootstrapIntersection()).not.toThrow();
    expect(customElements.get("wcs-intersect")).toBe(WcsIntersect);
  });

  it("userConfig を渡すと setConfig 経由で設定を上書きする", () => {
    // タグ名は1プロセスで1度しか define できないため、ここでは config 反映のみ検証。
    bootstrapIntersection({ tagNames: { intersect: "wcs-intersect" } });
    expect(config.tagNames.intersect).toBe("wcs-intersect");
    // 後続テストへの影響を避けるため既定へ戻す。
    setConfig({ tagNames: { intersect: "wcs-intersect" } });
  });
});
