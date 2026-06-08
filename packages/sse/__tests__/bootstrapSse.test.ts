import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapSse } from "../src/bootstrapSse";
import { setConfig } from "../src/config";

describe("bootstrapSse", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { sse: "wcs-sse" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapSse()).not.toThrow();
  });

  it("設定オブジェクトを渡しても登録できる", () => {
    expect(() => bootstrapSse({})).not.toThrow();
  });

  it("デフォルトタグ wcs-sse を登録する", () => {
    bootstrapSse();
    expect(customElements.get("wcs-sse")).toBeDefined();
  });

  it("二重呼び出しでもエラーにならない（冪等）", () => {
    bootstrapSse();
    expect(() => bootstrapSse()).not.toThrow();
  });
});
