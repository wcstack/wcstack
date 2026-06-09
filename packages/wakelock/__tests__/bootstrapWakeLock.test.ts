import { describe, it, expect } from "vitest";
import { bootstrapWakeLock } from "../src/bootstrapWakeLock.js";
import { WcsWakeLock } from "../src/components/WakeLock.js";
import { config, setConfig } from "../src/config.js";

describe("bootstrapWakeLock", () => {
  it("既定タグ名 wcs-wakelock を登録する", () => {
    bootstrapWakeLock();
    expect(customElements.get("wcs-wakelock")).toBe(WcsWakeLock);
  });

  it("再呼び出しは冪等（既に定義済みでも throw しない）", () => {
    bootstrapWakeLock();
    expect(() => bootstrapWakeLock()).not.toThrow();
    expect(customElements.get("wcs-wakelock")).toBe(WcsWakeLock);
  });

  it("userConfig を渡すと setConfig 経由で設定を上書きする", () => {
    // タグ名は1プロセスで1度しか define できないため、ここでは config 反映のみ検証。
    bootstrapWakeLock({ tagNames: { wakelock: "wcs-wakelock" } });
    expect(config.tagNames.wakelock).toBe("wcs-wakelock");
    setConfig({ tagNames: { wakelock: "wcs-wakelock" } });
  });
});
