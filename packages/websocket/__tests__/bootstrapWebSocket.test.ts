import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapWebSocket } from "../src/bootstrapWebSocket";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapWebSocket", () => {
  beforeEach(() => {
    setConfig({
      autoTrigger: true,
      triggerAttribute: "data-wstarget",
      tagNames: { ws: "wcs-ws" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapWebSocket()).not.toThrow();
  });

  it("カスタム設定を適用する", () => {
    bootstrapWebSocket({ autoTrigger: false });
    expect(getConfig().autoTrigger).toBe(false);
  });
});
