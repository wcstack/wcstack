import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapUpload } from "../src/bootstrapUpload";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapUpload", () => {
  beforeEach(() => {
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-uploadtarget",
      tagNames: { upload: "wcs-upload" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapUpload()).not.toThrow();
  });

  it("カスタム設定を適用する", () => {
    bootstrapUpload({ autoTrigger: false });
    expect(getConfig().autoTrigger).toBe(false);
  });
});
