import { describe, it, expect } from "vitest";
import { WcsGeolocation } from "../src/components/Geolocation";

// moveBefore() で動かされた要素（並べ替えで動くリストの行の中）は、connectedMoveCallback を持っていれば
// disconnectedCallback / connectedCallback を受けない（docs/timing-and-firing-contract.md §25）。
// happy-dom には moveBefore() が無いので、ここでは要素のクラスがそのコールバックを持つことを確かめる。
// 実ブラウザでの確認は e2e/tests/io-move-row.spec.ts
describe("connectedMoveCallback（moveBefore() での移動）", () => {
  it("WcsGeolocation は connectedMoveCallback を持つ（ブラウザは移動のとき、切断と接続の代わりにこれを呼ぶ）。呼ばれても何もしない", () => {
    expect(Object.hasOwn(WcsGeolocation.prototype, "connectedMoveCallback")).toBe(true);
    expect(WcsGeolocation.prototype.connectedMoveCallback.call(null)).toBeUndefined();
  });
});
