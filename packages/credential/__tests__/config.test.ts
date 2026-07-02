import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { credential: "wcs-credential" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.tagNames.credential).toBe("wcs-credential");
  });

  it("tagNames を更新できる", () => {
    setConfig({ tagNames: { credential: "my-credential" } });
    expect(getConfig().tagNames.credential).toBe("my-credential");
  });

  it("tagNames なしの setConfig は既存値を保持する", () => {
    setConfig({});
    expect(getConfig().tagNames.credential).toBe("wcs-credential");
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
    setConfig({ tagNames: { credential: "x-credential" } });
    const config2 = getConfig();
    expect(config1).not.toBe(config2);
  });
});
