/**
 * bindings.observerSkipRemovedChildren.test.ts — 親ごとの「framework 削除の件数」（bindings/observerSkip.ts）。
 * 全消去は `textContent = ''` で全行が 1 つの mutation record に載るので、親に件数を 1 回書けば
 * observer はその record を丸ごと飛ばせる。件数が足りない record は従来のノードごとの印に落ちる。
 */
import { describe, it, expect } from "vitest";
import { consumeObserverSkipRemovedChildren, markObserverSkipRemovedChildren } from "../src/bindings/observerSkip";

describe("markObserverSkipRemovedChildren / consumeObserverSkipRemovedChildren", () => {
  it("件数の無い親は消費されないこと", () => {
    const parent = document.createElement("tbody");
    expect(consumeObserverSkipRemovedChildren(parent, 3)).toBe(false);
  });

  it("件数が record の削除数に足りなければ消費せず、件数は残ること", () => {
    const parent = document.createElement("tbody");
    markObserverSkipRemovedChildren(parent, 2);
    expect(consumeObserverSkipRemovedChildren(parent, 3)).toBe(false);
    // 残った 2 件はそのまま使える
    expect(consumeObserverSkipRemovedChildren(parent, 2)).toBe(true);
    expect(consumeObserverSkipRemovedChildren(parent, 1)).toBe(false);
  });

  it("件数と削除数が一致すれば消費して空になり、超えていれば差分が残ること", () => {
    const parent = document.createElement("tbody");
    markObserverSkipRemovedChildren(parent, 5);
    expect(consumeObserverSkipRemovedChildren(parent, 2)).toBe(true); // 3 残る
    expect(consumeObserverSkipRemovedChildren(parent, 3)).toBe(true); // 0 で削除
    expect(consumeObserverSkipRemovedChildren(parent, 1)).toBe(false);
  });

  it("同じ親への印は累積し、親ごとに独立であること", () => {
    const a = document.createElement("tbody");
    const b = document.createElement("tbody");
    markObserverSkipRemovedChildren(a, 1);
    markObserverSkipRemovedChildren(a, 1);
    expect(consumeObserverSkipRemovedChildren(b, 1)).toBe(false);
    expect(consumeObserverSkipRemovedChildren(a, 2)).toBe(true);
  });
});
