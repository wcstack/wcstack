import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    // デフォルトに戻す
    setConfig({
      tagNames: { sse: "wcs-sse" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.tagNames.sse).toBe("wcs-sse");
  });

  it("tagNamesを更新できる", () => {
    setConfig({ tagNames: { sse: "my-sse" } });
    const config = getConfig();
    expect(config.tagNames.sse).toBe("my-sse");
  });

  it("tagNames未指定のsetConfigは既存値を保持する", () => {
    setConfig({});
    const config = getConfig();
    expect(config.tagNames.sse).toBe("wcs-sse");
  });

  it("getConfigが凍結されたオブジェクトを返す", () => {
    const config = getConfig();
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.tagNames)).toBe(true);
  });

  it("getConfigがキャッシュを返す", () => {
    const config1 = getConfig();
    const config2 = getConfig();
    expect(config1).toBe(config2);
  });

  it("setConfig後にキャッシュがクリアされる", () => {
    const config1 = getConfig();
    setConfig({ tagNames: { sse: "x-sse" } });
    const config2 = getConfig();
    expect(config1).not.toBe(config2);
  });
});
