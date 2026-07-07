import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    // デフォルトに戻す
    setConfig({
      tagNames: { ambientLightSensor: "wcs-ambient-light-sensor" },
    });
  });

  it("デフォルト設定が正しい", () => {
    const config = getConfig();
    expect(config.tagNames.ambientLightSensor).toBe("wcs-ambient-light-sensor");
  });

  it("tagNames を更新できる", () => {
    setConfig({ tagNames: { ambientLightSensor: "my-ambient-light-sensor" } });
    expect(getConfig().tagNames.ambientLightSensor).toBe("my-ambient-light-sensor");
  });

  it("tagNames なしの setConfig は既存値を保持する", () => {
    setConfig({});
    expect(getConfig().tagNames.ambientLightSensor).toBe("wcs-ambient-light-sensor");
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
    setConfig({ tagNames: { ambientLightSensor: "x-ambient-light-sensor" } });
    const config2 = getConfig();
    expect(config1).not.toBe(config2);
  });
});
