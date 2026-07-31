import { describe, it, expect } from "vitest";
import { CameraCore } from "../src/core/CameraCore";
import { RecorderCore } from "../src/core/RecorderCore";

/**
 * wc-bindable の observation semantics 宣言を固定する。
 * 分類の正本は docs/architecture-hardening/12-wc-bindable-observable-inventory.md。
 * `state` は現状あえて未注釈（未指定 = 読み手は現行動作を維持する）。
 */
describe("camera / recorder の wc-bindable semantics", () => {
  const namesWith = (
    properties: readonly { name: string; semantics?: string }[],
    semantics: string,
  ): string[] =>
    properties
      .filter((p) => p.semantics === semantics)
      .map((p) => p.name)
      .sort();

  it("streamReady は handle（live MediaStream。snapshot に入れてはならない）", () => {
    expect(namesWith(CameraCore.wcBindable.properties, "handle")).toEqual(["streamReady"]);
  });

  it("camera の ended は event", () => {
    expect(namesWith(CameraCore.wcBindable.properties, "event")).toEqual(["ended"]);
  });

  it("recorder の録画完了系 2 property は event", () => {
    expect(namesWith(RecorderCore.wcBindable.properties, "event")).toEqual(["dataavailable", "recorded"]);
  });

  it("recorder に handle は無い（Blob / objectURL は settled value）", () => {
    expect(namesWith(RecorderCore.wcBindable.properties, "handle")).toEqual([]);
  });
});
