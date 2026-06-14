import { describe, it, expect, afterEach } from "vitest";
import { getConfig, setConfig } from "../src/config.js";

afterEach(() => {
  // Restore defaults so cross-file test order does not matter.
  setConfig({ autoTrigger: true, triggerAttribute: "data-notifytarget", tagNames: { notify: "wcs-notify" } });
});

describe("config", () => {
  it("凍結されたデフォルトを返し、スナップショットをメモ化する", () => {
    const a = getConfig();
    expect(a.tagNames.notify).toBe("wcs-notify");
    expect(a.autoTrigger).toBe(true);
    expect(a.triggerAttribute).toBe("data-notifytarget");
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.tagNames)).toBe(true);
    // Memoized: same reference until setConfig() invalidates it.
    expect(getConfig()).toBe(a);
  });

  it("setConfig は各フィールドを更新し、スナップショットを無効化する", () => {
    const before = getConfig();
    setConfig({ autoTrigger: false, triggerAttribute: "data-x", tagNames: { notify: "x-notify" } });
    const after = getConfig();
    expect(after).not.toBe(before);
    expect(after.autoTrigger).toBe(false);
    expect(after.triggerAttribute).toBe("data-x");
    expect(after.tagNames.notify).toBe("x-notify");
  });

  it("存在しない / 型違いのフィールドを無視する", () => {
    setConfig({});
    const c = getConfig();
    expect(c.autoTrigger).toBe(true);
    expect(c.triggerAttribute).toBe("data-notifytarget");
    expect(c.tagNames.notify).toBe("wcs-notify");
  });
});
