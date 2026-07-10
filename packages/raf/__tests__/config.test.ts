import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    // デフォルトに戻す
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-raftarget",
      tagNames: { raf: "wcs-raf" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.autoTrigger).toBe(true);
    expect(config.triggerAttribute).toBe("data-raftarget");
    expect(config.tagNames.raf).toBe("wcs-raf");
  });

  it("設定を部分的に更新できる", () => {
    setConfig({ autoTrigger: false });
    const config = getConfig();
    expect(config.autoTrigger).toBe(false);
    expect(config.triggerAttribute).toBe("data-raftarget");
  });

  it("triggerAttribute を更新できる", () => {
    setConfig({ triggerAttribute: "data-frame" });
    expect(getConfig().triggerAttribute).toBe("data-frame");
  });

  it("tagNames を更新できる", () => {
    setConfig({ tagNames: { raf: "my-raf" } });
    const config = getConfig();
    expect(config.tagNames.raf).toBe("my-raf");
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
