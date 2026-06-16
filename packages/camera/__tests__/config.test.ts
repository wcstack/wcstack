import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapCamera } from "../src/bootstrapCamera";
import { getConfig, setConfig, config } from "../src/config";

describe("config / bootstrapCamera", () => {
  it("既定のタグ名は wcs-camera / wcs-recorder", () => {
    const c = getConfig();
    expect(c.tagNames.camera).toBe("wcs-camera");
    expect(c.tagNames.recorder).toBe("wcs-recorder");
  });

  it("getConfig は deep-frozen なクローンを返す（内部 config は変えられない）", () => {
    const c = getConfig();
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.tagNames)).toBe(true);
  });

  it("setConfig でタグ名を上書きでき、frozen クローンに反映される", () => {
    setConfig({ tagNames: { camera: "x-cam" } });
    expect(config.tagNames.camera).toBe("x-cam");
    expect(getConfig().tagNames.camera).toBe("x-cam");
    // 後続テストに影響しないよう戻す。
    setConfig({ tagNames: { camera: "wcs-camera" } });
  });

  it("bootstrapCamera でカスタム要素が登録される", () => {
    bootstrapCamera();
    expect(customElements.get("wcs-camera")).toBeDefined();
    expect(customElements.get("wcs-recorder")).toBeDefined();
  });

  it("bootstrapCamera は userConfig を受け付ける（既登録なので再 define はしない）", () => {
    expect(() => bootstrapCamera({ tagNames: { camera: "wcs-camera" } })).not.toThrow();
  });
});
