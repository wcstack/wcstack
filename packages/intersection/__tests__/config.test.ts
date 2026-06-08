import { describe, it, expect, beforeEach } from "vitest";
import { config, getConfig, setConfig } from "../src/config.js";

describe("config", () => {
  beforeEach(() => {
    // Reset to defaults between tests (config is module-level mutable state).
    setConfig({ tagNames: { intersect: "wcs-intersect" } });
  });

  it("既定のタグ名は wcs-intersect", () => {
    expect(config.tagNames.intersect).toBe("wcs-intersect");
  });

  it("setConfig でタグ名を上書きできる", () => {
    setConfig({ tagNames: { intersect: "my-intersect" } });
    expect(config.tagNames.intersect).toBe("my-intersect");
  });

  it("tagNames を含まない setConfig は no-op", () => {
    setConfig({});
    expect(config.tagNames.intersect).toBe("wcs-intersect");
  });

  it("getConfig は凍結された設定スナップショットを返す", () => {
    const frozen = getConfig();
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.tagNames)).toBe(true);
    expect(() => {
      (frozen.tagNames as { intersect: string }).intersect = "x";
    }).toThrow();
  });

  it("setConfig を挟まなければ getConfig は同一の凍結参照をキャッシュして返す", () => {
    // 2 回連続呼び出しで同一参照（キャッシュヒット分岐）を確認する。
    const first = getConfig();
    const second = getConfig();
    expect(second).toBe(first);
  });

  it("setConfig 後の getConfig は新しいスナップショットを返す", () => {
    const first = getConfig();
    setConfig({ tagNames: { intersect: "other-intersect" } });
    const second = getConfig();
    expect(first).not.toBe(second);
    expect(second.tagNames.intersect).toBe("other-intersect");
  });
});
