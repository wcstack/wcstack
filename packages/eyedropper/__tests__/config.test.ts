import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    // デフォルトに戻す
    setConfig({
      tagNames: { eyedropper: "wcs-eyedropper" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.tagNames.eyedropper).toBe("wcs-eyedropper");
  });

  it("tagNames を更新できる", () => {
    setConfig({ tagNames: { eyedropper: "my-eyedropper" } });
    expect(getConfig().tagNames.eyedropper).toBe("my-eyedropper");
  });

  it("tagNames なしの setConfig は既存値を保持する", () => {
    setConfig({});
    expect(getConfig().tagNames.eyedropper).toBe("wcs-eyedropper");
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
    setConfig({ tagNames: { eyedropper: "x-eyedropper" } });
    const config2 = getConfig();
    expect(config1).not.toBe(config2);
  });
});
