import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    // デフォルトに戻す
    setConfig({
      tagNames: { share: "wcs-share" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.tagNames.share).toBe("wcs-share");
  });

  it("tagNames を更新できる", () => {
    setConfig({ tagNames: { share: "my-share" } });
    expect(getConfig().tagNames.share).toBe("my-share");
  });

  it("tagNames なしの setConfig は既存値を保持する", () => {
    setConfig({});
    expect(getConfig().tagNames.share).toBe("wcs-share");
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
    setConfig({ tagNames: { share: "x-share" } });
    const config2 = getConfig();
    expect(config1).not.toBe(config2);
  });
});
