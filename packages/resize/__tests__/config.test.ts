import { describe, it, expect, beforeEach } from "vitest";
import { config, getConfig, setConfig } from "../src/config.js";

describe("config", () => {
  beforeEach(() => {
    // Reset to defaults between tests (config is module-level mutable state).
    setConfig({ tagNames: { resize: "wcs-resize" } });
  });

  it("既定のタグ名は wcs-resize", () => {
    expect(config.tagNames.resize).toBe("wcs-resize");
  });

  it("setConfig でタグ名を上書きできる", () => {
    setConfig({ tagNames: { resize: "my-resize" } });
    expect(config.tagNames.resize).toBe("my-resize");
  });

  it("tagNames を含まない setConfig は no-op", () => {
    setConfig({});
    expect(config.tagNames.resize).toBe("wcs-resize");
  });

  it("getConfig は凍結された設定スナップショットを返す", () => {
    const frozen = getConfig();
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.tagNames)).toBe(true);
    expect(() => {
      (frozen.tagNames as { resize: string }).resize = "x";
    }).toThrow();
  });

  it("setConfig を挟まなければ getConfig は同一の凍結参照をキャッシュして返す", () => {
    const first = getConfig();
    const second = getConfig();
    expect(second).toBe(first);
  });

  it("setConfig 後の getConfig は新しいスナップショットを返す", () => {
    const first = getConfig();
    setConfig({ tagNames: { resize: "other-resize" } });
    const second = getConfig();
    expect(first).not.toBe(second);
    expect(second.tagNames.resize).toBe("other-resize");
  });
});
