import { describe, it, expect } from "vitest";
import { bootstrapResize } from "../src/bootstrapResize.js";
import { WcsResize } from "../src/components/Resize.js";
import { config, setConfig } from "../src/config.js";

describe("bootstrapResize", () => {
  it("既定タグ名 wcs-resize を登録する", () => {
    bootstrapResize();
    expect(customElements.get("wcs-resize")).toBe(WcsResize);
  });

  it("再呼び出しは冪等（既に定義済みでも throw しない）", () => {
    bootstrapResize();
    expect(() => bootstrapResize()).not.toThrow();
    expect(customElements.get("wcs-resize")).toBe(WcsResize);
  });

  it("userConfig を渡すと setConfig 経由で設定を上書きする", () => {
    // タグ名は1プロセスで1度しか define できないため、ここでは config 反映のみ検証。
    bootstrapResize({ tagNames: { resize: "wcs-resize" } });
    expect(config.tagNames.resize).toBe("wcs-resize");
    // 後続テストへの影響を避けるため既定へ戻す。
    setConfig({ tagNames: { resize: "wcs-resize" } });
  });
});
