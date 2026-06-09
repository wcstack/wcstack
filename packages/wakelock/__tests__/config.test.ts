import { describe, it, expect, beforeEach } from "vitest";
import { config, getConfig, setConfig } from "../src/config.js";

describe("config", () => {
  beforeEach(() => {
    // Reset to defaults between tests (config is module-level mutable state).
    setConfig({ tagNames: { wakelock: "wcs-wakelock" } });
  });

  it("既定のタグ名は wcs-wakelock", () => {
    expect(config.tagNames.wakelock).toBe("wcs-wakelock");
  });

  it("setConfig でタグ名を上書きできる", () => {
    setConfig({ tagNames: { wakelock: "my-wakelock" } });
    expect(config.tagNames.wakelock).toBe("my-wakelock");
  });

  it("tagNames を含まない setConfig は no-op", () => {
    setConfig({});
    expect(config.tagNames.wakelock).toBe("wcs-wakelock");
  });

  it("getConfig は凍結された設定スナップショットを返す", () => {
    const frozen = getConfig();
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.tagNames)).toBe(true);
    expect(() => {
      (frozen.tagNames as { wakelock: string }).wakelock = "x";
    }).toThrow();
  });

  it("setConfig を挟まなければ getConfig は同一の凍結参照をキャッシュして返す", () => {
    const first = getConfig();
    const second = getConfig();
    expect(second).toBe(first);
  });

  it("setConfig 後の getConfig は新しいスナップショットを返す", () => {
    const first = getConfig();
    setConfig({ tagNames: { wakelock: "other-wakelock" } });
    const second = getConfig();
    expect(first).not.toBe(second);
    expect(second.tagNames.wakelock).toBe("other-wakelock");
  });
});
