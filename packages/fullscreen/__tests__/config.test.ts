import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    // デフォルトに戻す
    setConfig({
      tagNames: { fullscreen: "wcs-fullscreen" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.tagNames.fullscreen).toBe("wcs-fullscreen");
  });

  it("tagNames を更新できる", () => {
    setConfig({ tagNames: { fullscreen: "my-fullscreen" } });
    expect(getConfig().tagNames.fullscreen).toBe("my-fullscreen");
  });

  it("tagNames なしの setConfig は既存値を保持する", () => {
    setConfig({});
    expect(getConfig().tagNames.fullscreen).toBe("wcs-fullscreen");
  });

  it("getConfig が凍結されたオブジェクトを返す", () => {
    const config = getConfig();
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.tagNames)).toBe(true);
  });

  it("getConfig がキャッシュを返す", () => {
    const config1 = getConfig();
    const config2 = getConfig();
    expect(config1).toBe(config2);
  });

  it("setConfig 後にキャッシュがクリアされる", () => {
    const config1 = getConfig();
    setConfig({ tagNames: { fullscreen: "x-fullscreen" } });
    const config2 = getConfig();
    expect(config1).not.toBe(config2);
  });
});
