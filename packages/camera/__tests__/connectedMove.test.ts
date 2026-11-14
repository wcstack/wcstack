import { describe, it, expect } from "vitest";
import { WcsCamera } from "../src/components/Camera";
import { WcsRecorder } from "../src/components/Recorder";

// moveBefore() で動かされた要素（並べ替えで動くリストの行の中）は、connectedMoveCallback を持っていれば
// disconnectedCallback / connectedCallback を受けない（docs/timing-and-firing-contract.md §25）。
// happy-dom には moveBefore() が無いので、ここでは要素のクラスがそのコールバックを持つことを確かめる。
// 実ブラウザでの確認は e2e/tests/io-move-row.spec.ts
describe("connectedMoveCallback（moveBefore() での移動）", () => {
  it("WcsCamera は connectedMoveCallback を持つ（ブラウザは移動のとき、切断と接続の代わりにこれを呼ぶ）。呼ばれても何もしない", () => {
    expect(Object.hasOwn(WcsCamera.prototype, "connectedMoveCallback")).toBe(true);
    expect(WcsCamera.prototype.connectedMoveCallback.call(null)).toBeUndefined();
  });
  it("WcsRecorder は connectedMoveCallback を持つ（ブラウザは移動のとき、切断と接続の代わりにこれを呼ぶ）。呼ばれても何もしない", () => {
    expect(Object.hasOwn(WcsRecorder.prototype, "connectedMoveCallback")).toBe(true);
    expect(WcsRecorder.prototype.connectedMoveCallback.call(null)).toBeUndefined();
  });
});
