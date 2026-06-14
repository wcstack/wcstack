import { describe, it, expect, afterEach } from "vitest";
import { bootstrapNotification } from "../src/bootstrapNotification.js";
import { getConfig, setConfig } from "../src/config.js";

afterEach(() => {
  setConfig({ autoTrigger: true, triggerAttribute: "data-notifytarget", tagNames: { notify: "wcs-notify" } });
});

describe("bootstrapNotification", () => {
  it("デフォルトの要素を登録する", () => {
    bootstrapNotification();
    expect(customElements.get("wcs-notify")).toBeDefined();
  });

  it("登録前にユーザー config を適用する", () => {
    bootstrapNotification({ triggerAttribute: "data-custom" });
    expect(getConfig().triggerAttribute).toBe("data-custom");
    // Registration is define-once: a second bootstrap with the same tag is a no-op.
    expect(() => bootstrapNotification()).not.toThrow();
  });
});
