/**
 * webComponent/outerListPath.ts の分岐テスト。
 *
 * 統合テスト（integration.bindComponentListRow）が通すのは「mapped で段数が一致する」
 * 幸せな道だけなので、翻訳が成立しない側をここで固定する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPathInfo } from "../src/address/PathInfo";
import { IAbsolutePathInfo } from "../src/address/types";
import { IStateElement } from "../src/components/types";

vi.mock("../src/webComponent/MappingRule", () => ({
  getOuterAbsolutePathInfo: vi.fn(),
}));

import { getOuterAbsolutePathInfo } from "../src/webComponent/MappingRule";
import { getOuterRowPathInfo, propagateListPathToOuterState } from "../src/webComponent/outerListPath";

function createStateElement(overrides: Partial<IStateElement> = {}): IStateElement {
  return {
    name: "default",
    hasMappedComponentState: true,
    boundComponent: document.createElement("div"),
    setPathInfo: vi.fn(),
    ...overrides,
  } as unknown as IStateElement;
}

function createOuterAbsPathInfo(path: string, stateElement: IStateElement): IAbsolutePathInfo {
  return {
    pathInfo: getPathInfo(path),
    stateName: stateElement.name,
    stateElement,
    parentAbsolutePathInfo: null,
  };
}

beforeEach(() => {
  vi.mocked(getOuterAbsolutePathInfo).mockReset();
});

describe("propagateListPathToOuterState", () => {
  it("マップ先の state 要素に for パスとして伝えること", () => {
    const inner = createStateElement();
    const outer = createStateElement({ name: "outer" });
    vi.mocked(getOuterAbsolutePathInfo).mockReturnValue(createOuterAbsPathInfo("rows", outer));

    propagateListPathToOuterState(inner, "items");

    expect(outer.setPathInfo).toHaveBeenCalledWith("rows", "for");
  });

  it("mapped でない state（plain なコンポーネント / 通常の state）では何もしないこと", () => {
    const inner = createStateElement({ hasMappedComponentState: false });

    propagateListPathToOuterState(inner, "items");

    expect(getOuterAbsolutePathInfo).not.toHaveBeenCalled();
  });

  it("束ね先のコンポーネントが引けないときは何もしないこと", () => {
    const inner = createStateElement({ boundComponent: null });

    propagateListPathToOuterState(inner, "items");

    expect(getOuterAbsolutePathInfo).not.toHaveBeenCalled();
  });

  it("マッピング規則に一致しないローカルなリストは伝播しないこと", () => {
    const inner = createStateElement();
    vi.mocked(getOuterAbsolutePathInfo).mockReturnValue(null);

    expect(() => propagateListPathToOuterState(inner, "localItems")).not.toThrow();
  });

  it("翻訳先が自分自身なら伝播しないこと（自己ループの防衛線）", () => {
    const inner = createStateElement();
    vi.mocked(getOuterAbsolutePathInfo).mockReturnValue(createOuterAbsPathInfo("rows", inner));

    propagateListPathToOuterState(inner, "items");

    expect(inner.setPathInfo).not.toHaveBeenCalled();
  });
});

describe("getOuterRowPathInfo", () => {
  it("段数が一致する行パスは親スコープの絶対パス情報を返すこと", () => {
    const inner = createStateElement();
    const outer = createStateElement({ name: "outer" });
    const outerAbs = createOuterAbsPathInfo("rows.*.name", outer);
    vi.mocked(getOuterAbsolutePathInfo).mockReturnValue(outerAbs);

    expect(getOuterRowPathInfo(inner, getPathInfo("items.*.name"))).toBe(outerAbs);
  });

  it("ワイルドカードを持たないパスは対象外であること", () => {
    const inner = createStateElement();

    expect(getOuterRowPathInfo(inner, getPathInfo("items"))).toBeNull();
    expect(getOuterAbsolutePathInfo).not.toHaveBeenCalled();
  });

  it("マッピング規則が無いパスは対象外であること", () => {
    const inner = createStateElement();
    vi.mocked(getOuterAbsolutePathInfo).mockReturnValue(null);

    expect(getOuterRowPathInfo(inner, getPathInfo("items.*.name"))).toBeNull();
  });

  it("ワイルドカードの段数が変わる入れ子形は対象外であること", () => {
    // 規則 state.items: rows.*.children（コンポーネント自身が親の for の中）に対し
    // 子が items.*.name を読む形。親スコープ側の行 listIndex と子スコープ側の行
    // listIndex は繋がっていないので、行の同一性をそのまま流用できない。
    const inner = createStateElement();
    const outer = createStateElement({ name: "outer" });
    vi.mocked(getOuterAbsolutePathInfo).mockReturnValue(
      createOuterAbsPathInfo("rows.*.children.*.name", outer),
    );

    expect(getOuterRowPathInfo(inner, getPathInfo("items.*.name"))).toBeNull();
  });

  it("mapped でない state 要素は対象外であること", () => {
    const inner = createStateElement({ hasMappedComponentState: undefined });

    expect(getOuterRowPathInfo(inner, getPathInfo("items.*.name"))).toBeNull();
    expect(getOuterAbsolutePathInfo).not.toHaveBeenCalled();
  });
});
