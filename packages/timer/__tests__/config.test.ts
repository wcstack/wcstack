import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    // デフォルトに戻す
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-timertarget",
      tagNames: { timer: "wcs-timer" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.autoTrigger).toBe(true);
    expect(config.triggerAttribute).toBe("data-timertarget");
    expect(config.tagNames.timer).toBe("wcs-timer");
  });

  it("設定を部分的に更新できる", () => {
    setConfig({ autoTrigger: false });
    const config = getConfig();
    expect(config.autoTrigger).toBe(false);
    expect(config.triggerAttribute).toBe("data-timertarget");
  });

  it("triggerAttribute を更新できる", () => {
    setConfig({ triggerAttribute: "data-tick" });
    expect(getConfig().triggerAttribute).toBe("data-tick");
  });

  it("tagNames を更新できる", () => {
    setConfig({ tagNames: { timer: "my-timer" } });
    const config = getConfig();
    expect(config.tagNames.timer).toBe("my-timer");
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
    setConfig({ autoTrigger: false });
    const config2 = getConfig();
    expect(config1).not.toBe(config2);
  });
});
