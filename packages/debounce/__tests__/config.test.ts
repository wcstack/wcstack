import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-debouncetarget",
      tagNames: { debounce: "wcs-debounce", throttle: "wcs-throttle" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.autoTrigger).toBe(true);
    expect(config.triggerAttribute).toBe("data-debouncetarget");
    expect(config.tagNames.debounce).toBe("wcs-debounce");
    expect(config.tagNames.throttle).toBe("wcs-throttle");
  });

  it("設定を部分的に更新できる", () => {
    setConfig({ autoTrigger: false });
    const config = getConfig();
    expect(config.autoTrigger).toBe(false);
    expect(config.triggerAttribute).toBe("data-debouncetarget");
  });

  it("triggerAttribute を更新できる", () => {
    setConfig({ triggerAttribute: "data-debounce" });
    expect(getConfig().triggerAttribute).toBe("data-debounce");
  });

  it("tagNames を部分的に更新できる", () => {
    setConfig({ tagNames: { debounce: "my-debounce" } });
    const config = getConfig();
    expect(config.tagNames.debounce).toBe("my-debounce");
    expect(config.tagNames.throttle).toBe("wcs-throttle");
  });

  it("getConfig が凍結されたオブジェクトを返す", () => {
    const config = getConfig();
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.tagNames)).toBe(true);
  });

  it("getConfig がキャッシュを返す", () => {
    expect(getConfig()).toBe(getConfig());
  });

  it("setConfig 後にキャッシュがクリアされる", () => {
    const config1 = getConfig();
    setConfig({ autoTrigger: false });
    expect(getConfig()).not.toBe(config1);
  });
});
