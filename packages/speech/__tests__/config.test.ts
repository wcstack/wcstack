import { describe, it, expect, beforeEach } from "vitest";
import { config, getConfig, setConfig } from "../src/config";

describe("config", () => {
  beforeEach(() => {
    // 既定へ戻す（モジュールはファイル内で共有されるため）
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-speaktarget",
      listenTriggerAttribute: "data-listentarget",
      tagNames: { speak: "wcs-speak", listen: "wcs-listen" },
    });
  });

  it("既定値を持つ", () => {
    expect(config.autoTrigger).toBe(true);
    expect(config.triggerAttribute).toBe("data-speaktarget");
    expect(config.listenTriggerAttribute).toBe("data-listentarget");
    expect(config.tagNames.speak).toBe("wcs-speak");
    expect(config.tagNames.listen).toBe("wcs-listen");
  });

  it("getConfig は凍結されたコピーを返す", () => {
    const frozen = getConfig();
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.tagNames)).toBe(true);
    expect(() => { (frozen as any).autoTrigger = false; }).toThrow();
  });

  it("getConfig は再計算まで同じ凍結インスタンスを返す", () => {
    const a = getConfig();
    const b = getConfig();
    expect(a).toBe(b);
  });

  it("setConfig で autoTrigger / triggerAttribute / tagNames を更新する", () => {
    setConfig({ autoTrigger: false, triggerAttribute: "data-x", listenTriggerAttribute: "data-y", tagNames: { speak: "x-speak", listen: "x-listen" } });
    expect(config.autoTrigger).toBe(false);
    expect(config.triggerAttribute).toBe("data-x");
    expect(config.listenTriggerAttribute).toBe("data-y");
    expect(config.tagNames.speak).toBe("x-speak");
    expect(config.tagNames.listen).toBe("x-listen");
  });

  it("setConfig は凍結キャッシュを無効化する", () => {
    const before = getConfig();
    setConfig({ autoTrigger: false });
    const after = getConfig();
    expect(after).not.toBe(before);
    expect(after.autoTrigger).toBe(false);
  });

  it("setConfig は未指定フィールドを変更しない", () => {
    setConfig({});
    expect(config.autoTrigger).toBe(true);
    expect(config.triggerAttribute).toBe("data-speaktarget");
  });
});
