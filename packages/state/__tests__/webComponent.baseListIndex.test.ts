/**
 * webComponent/baseListIndex.ts の単体テスト。
 *
 * base listIndex ＝「mapped な bind-component の子スコープが、親スコープのどの行の
 * 内側にいるか」。ここが null / 非 null を取り違えると、子が作る listIndex の
 * arity が親の台帳と食い違う（docs/state-bind-component-nested-for-design.md）。
 */
import { describe, it, expect } from "vitest";
import { getBaseDepth, getBaseListIndex, getListParentListIndex } from "../src/webComponent/baseListIndex";
import { createListIndex } from "../src/list/createListIndex";
import { getPathInfo } from "../src/address/PathInfo";
import { createStateAddress } from "../src/address/StateAddress";
import { setLoopContextByNode } from "../src/list/loopContextByNode";
import { ILoopContext } from "../src/list/types";
import { IStateElement } from "../src/components/types";

function fakeStateElement(over: Partial<IStateElement>): IStateElement {
  return over as IStateElement;
}

describe("webComponent/baseListIndex", () => {
  it("mapped でない state 要素は base を持たないこと", () => {
    const stateElement = fakeStateElement({ hasMappedComponentState: false, boundComponent: null });
    expect(getBaseListIndex(stateElement)).toBe(null);
    expect(getBaseDepth(stateElement)).toBe(0);
  });

  it("state 要素が無い場合も base を持たないこと", () => {
    expect(getBaseListIndex(null)).toBe(null);
    expect(getBaseListIndex(undefined)).toBe(null);
    expect(getBaseDepth(null)).toBe(0);
  });

  it("mapped でも束ね先のコンポーネントが未設定なら base を持たないこと", () => {
    // 通常は bindWebComponent が両方を同時に立てるが、片方だけの状態を
    // base 深さ 1 と誤認すると子の listIndex が丸ごとずれる
    const stateElement = fakeStateElement({ hasMappedComponentState: true, boundComponent: null });
    expect(getBaseListIndex(stateElement)).toBe(null);
    expect(getBaseDepth(stateElement)).toBe(0);
  });

  it("コンポーネントが親スコープのループの外なら base を持たないこと", () => {
    const component = document.createElement("div");
    document.body.appendChild(component);
    const stateElement = fakeStateElement({ hasMappedComponentState: true, boundComponent: component });

    expect(getBaseListIndex(stateElement)).toBe(null);
    expect(getBaseDepth(stateElement)).toBe(0);

    component.remove();
  });

  it("コンポーネントが親スコープのループの中なら その行の listIndex を返すこと", () => {
    const component = document.createElement("div");
    document.body.appendChild(component);
    const listIndex = createListIndex(null, 1);
    const loopContext = createStateAddress(getPathInfo("groups.*"), listIndex) as ILoopContext;
    setLoopContextByNode(component, loopContext);
    const stateElement = fakeStateElement({ hasMappedComponentState: true, boundComponent: component });

    expect(getBaseListIndex(stateElement)).toBe(listIndex);
    expect(getBaseDepth(stateElement)).toBe(1);

    setLoopContextByNode(component, null);
    component.remove();
  });

  it("キャッシュせず、その時点のループ文脈を返すこと", () => {
    // 行 content はプールで再利用されるため、同じ要素が別の行に付け替わる。
    // 要素をキーに memo すると再接続後に古い行を指し続ける（§1.9 と同型の罠）
    const component = document.createElement("div");
    document.body.appendChild(component);
    const stateElement = fakeStateElement({ hasMappedComponentState: true, boundComponent: component });

    const first = createListIndex(null, 0);
    setLoopContextByNode(component, createStateAddress(getPathInfo("groups.*"), first) as ILoopContext);
    expect(getBaseListIndex(stateElement)).toBe(first);

    const second = createListIndex(null, 3);
    setLoopContextByNode(component, createStateAddress(getPathInfo("groups.*"), second) as ILoopContext);
    expect(getBaseListIndex(stateElement)).toBe(second);

    setLoopContextByNode(component, null);
    component.remove();
  });

  describe("getListParentListIndex", () => {
    it("囲むループがあるならその listIndex を優先すること", () => {
      const component = document.createElement("div");
      document.body.appendChild(component);
      const base = createListIndex(null, 0);
      setLoopContextByNode(component, createStateAddress(getPathInfo("groups.*"), base) as ILoopContext);
      const stateElement = fakeStateElement({ hasMappedComponentState: true, boundComponent: component });

      const container = createListIndex(base, 2);
      expect(getListParentListIndex(stateElement, container)).toBe(container);

      setLoopContextByNode(component, null);
      component.remove();
    });

    it("トップレベルのリストには base を親として与えること", () => {
      const component = document.createElement("div");
      document.body.appendChild(component);
      const base = createListIndex(null, 0);
      setLoopContextByNode(component, createStateAddress(getPathInfo("groups.*"), base) as ILoopContext);
      const stateElement = fakeStateElement({ hasMappedComponentState: true, boundComponent: component });

      expect(getListParentListIndex(stateElement, null)).toBe(base);

      setLoopContextByNode(component, null);
      component.remove();
    });

    it("通常の state では null のままであること（Δ=0）", () => {
      const stateElement = fakeStateElement({ hasMappedComponentState: false, boundComponent: null });
      expect(getListParentListIndex(stateElement, null)).toBe(null);
    });
  });
});
