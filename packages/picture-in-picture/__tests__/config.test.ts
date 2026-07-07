import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    // デフォルトに戻す
    setConfig({
      tagNames: { pip: "wcs-pip" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.tagNames.pip).toBe("wcs-pip");
  });

  it("tagNames を更新できる", () => {
    setConfig({ tagNames: { pip: "my-pip" } });
    expect(getConfig().tagNames.pip).toBe("my-pip");
  });

  it("tagNames なしの setConfig は既存値を保持する", () => {
    setConfig({});
    expect(getConfig().tagNames.pip).toBe("wcs-pip");
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
    setConfig({ tagNames: { pip: "x-pip" } });
    const config2 = getConfig();
    expect(config1).not.toBe(config2);
  });
});
