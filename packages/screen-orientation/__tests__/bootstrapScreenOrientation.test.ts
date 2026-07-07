import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapScreenOrientation } from "../src/bootstrapScreenOrientation";
import { getConfig, setConfig } from "../src/config";
import * as configModule from "../src/config";
import * as registerComponentsModule from "../src/registerComponents";

describe("bootstrapScreenOrientation", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { screenOrientation: "wcs-screen-orientation" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapScreenOrientation()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する", () => {
    // customElements.define は同一コンストラクタ（WcsScreenOrientation）を別タグ名で
    // 二重登録できない（仕様上の制約）ため、registerComponents は実行させず setConfig への
    // 転送だけをスパイで検証する。beforeEach と同値の userConfig を渡すと転送が no-op に
    // 変異しても区別できず見逃すため、既定と異なる値を渡した上で toHaveBeenCalledWith で
    // 転送そのものを弁別する。
    vi.spyOn(registerComponentsModule, "registerComponents").mockImplementation(() => {});
    const setConfigSpy = vi.spyOn(configModule, "setConfig");

    const userConfig = { tagNames: { screenOrientation: "custom-screen-orientation" } };
    bootstrapScreenOrientation(userConfig);

    expect(setConfigSpy).toHaveBeenCalledWith(userConfig);
    // config への反映（setConfig の実挙動）も併せて確認する。
    expect(getConfig().tagNames.screenOrientation).toBe("custom-screen-orientation");
  });

  it("wcs-screen-orientation をカスタム要素として登録する", () => {
    bootstrapScreenOrientation();
    expect(customElements.get("wcs-screen-orientation")).toBeDefined();
  });
});
