import { describe, it, expect, afterEach, vi } from "vitest";
import { bootstrapRaf } from "../src/bootstrapRaf";
import { getConfig, setConfig } from "../src/config";
import { Raf } from "../src/components/Raf";

describe("bootstrapRaf", () => {
  afterEach(() => {
    setConfig({ autoTrigger: true, triggerAttribute: "data-raftarget", tagNames: { raf: "wcs-raf" } });
    vi.restoreAllMocks();
  });

  it("引数なしで既定タグ名 wcs-raf を登録する", () => {
    bootstrapRaf();
    expect(customElements.get("wcs-raf")).toBe(Raf);
  });

  it("userConfig で設定を上書きしてから登録する", () => {
    // 同一コンストラクタは 1 レジストリに 1 回しか define できない（仕様）ため、
    // カスタムタグ名の登録は define 呼び出しの引数で検証する。
    const defineSpy = vi.spyOn(customElements, "define").mockImplementation(() => {});
    bootstrapRaf({
      autoTrigger: false,
      triggerAttribute: "data-frame",
      tagNames: { raf: "my-raf" },
    });
    expect(defineSpy).toHaveBeenCalledWith("my-raf", Raf);
    const config = getConfig();
    expect(config.autoTrigger).toBe(false);
    expect(config.triggerAttribute).toBe("data-frame");
    expect(config.tagNames.raf).toBe("my-raf");
  });

  it("多重呼び出しでも throw しない（登録済みタグはスキップ）", () => {
    bootstrapRaf();
    expect(() => bootstrapRaf()).not.toThrow();
  });
});
