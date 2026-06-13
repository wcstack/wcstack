import { describe, it, expect } from "vitest";
import { bootstrapSpeech } from "../src/bootstrapSpeech";
import { config } from "../src/config";

describe("bootstrapSpeech", () => {
  it("カスタム要素を登録する", () => {
    bootstrapSpeech();
    expect(customElements.get("wcs-speak")).toBeDefined();
    expect(customElements.get("wcs-listen")).toBeDefined();
  });

  it("userConfig を渡すと設定を適用する", () => {
    bootstrapSpeech({ autoTrigger: false });
    expect(config.autoTrigger).toBe(false);
    // 復帰
    bootstrapSpeech({ autoTrigger: true });
  });

  it("再呼び出しでも既存登録を壊さない（冪等）", () => {
    bootstrapSpeech();
    expect(() => bootstrapSpeech()).not.toThrow();
    expect(customElements.get(config.tagNames.speak)).toBeDefined();
  });
});
