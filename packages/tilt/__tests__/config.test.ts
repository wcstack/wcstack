import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { tilt: "wcs-tilt" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.tagNames.tilt).toBe("wcs-tilt");
  });

  it("tagNames を更新できる", () => {
    setConfig({ tagNames: { tilt: "my-tilt" } });
    expect(getConfig().tagNames.tilt).toBe("my-tilt");
  });

  it("tagNames なしの setConfig は既存値を保持する", () => {
    setConfig({});
    expect(getConfig().tagNames.tilt).toBe("wcs-tilt");
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
    setConfig({ tagNames: { tilt: "x-tilt" } });
    const config2 = getConfig();
    expect(config1).not.toBe(config2);
  });
});
