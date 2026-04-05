import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    // デフォルトに戻す
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-uploadtarget",
      tagNames: { upload: "wcs-upload" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.autoTrigger).toBe(true);
    expect(config.triggerAttribute).toBe("data-uploadtarget");
    expect(config.tagNames.upload).toBe("wcs-upload");
  });

  it("設定を部分的に更新できる", () => {
    setConfig({ autoTrigger: false });
    const config = getConfig();
    expect(config.autoTrigger).toBe(false);
    expect(config.triggerAttribute).toBe("data-uploadtarget");
  });

  it("tagNamesを更新できる", () => {
    setConfig({ tagNames: { upload: "my-upload" } });
    const config = getConfig();
    expect(config.tagNames.upload).toBe("my-upload");
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
    setConfig({ autoTrigger: false });
    const config2 = getConfig();
    expect(config1).not.toBe(config2);
  });
});
