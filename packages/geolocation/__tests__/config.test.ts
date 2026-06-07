import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    // デフォルトに戻す
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-geotarget",
      tagNames: { geo: "wcs-geo" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.autoTrigger).toBe(true);
    expect(config.triggerAttribute).toBe("data-geotarget");
    expect(config.tagNames.geo).toBe("wcs-geo");
  });

  it("設定を部分的に更新できる", () => {
    setConfig({ autoTrigger: false });
    const config = getConfig();
    expect(config.autoTrigger).toBe(false);
    expect(config.triggerAttribute).toBe("data-geotarget");
  });

  it("triggerAttribute を更新できる", () => {
    setConfig({ triggerAttribute: "data-locate" });
    expect(getConfig().triggerAttribute).toBe("data-locate");
  });

  it("tagNames を更新できる", () => {
    setConfig({ tagNames: { geo: "my-geo" } });
    const config = getConfig();
    expect(config.tagNames.geo).toBe("my-geo");
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
