/**
 * binding.patternLedger.test.ts — パターン索引台帳（(absolutePathInfo, listIndex)
 * 2 段キー・r3 Phase 3）の単体契約。
 *
 * - 単一値昇格（1 本目は binding 素置き・2 本目で Set）
 * - remove の防御（未知パターン / 未知 listIndex / 不一致 binding）
 * - peekBindingsForAddress の従来台帳→パターン台帳フォールバック
 * - devtools 計装（sink 接続時のみアドレスを intern してイベント発火）
 * - registerAddress パターン経路の stateElement 未登録 raise（防御）
 */
import { describe, it, expect, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listIndex: { index: 0 } as any,
  stateElement: null as any,
  attachEvent: vi.fn(() => false),
}));

vi.mock("../src/list/getListIndexByBindingInfo", () => ({
  getListIndexByBindingInfo: vi.fn(() => mocks.listIndex),
}));
vi.mock("../src/stateElementByName", () => ({
  getStateElementByName: vi.fn(() => mocks.stateElement),
}));
vi.mock("../src/binding/getAbsoluteStateAddressByBinding", () => ({
  getAbsoluteStateAddressByBinding: vi.fn(() => ({ absolutePathInfo: {}, listIndex: null })),
  clearAbsoluteStateAddressByBinding: vi.fn(),
  resolveBindingRootNode: vi.fn(() => document),
}));
vi.mock("../src/event/handler", () => ({
  attachEventHandler: mocks.attachEvent,
  detachEventHandler: vi.fn(),
}));
vi.mock("../src/event/twowayHandler", () => ({
  attachTwowayEventHandler: vi.fn(),
  detachTwowayEventHandler: vi.fn(),
  addTwowayValueObserver: vi.fn(() => vi.fn()),
}));

import {
  addBindingByPattern,
  removeBindingByPattern,
  addBindingByAbsoluteStateAddress,
  peekBindingsForAddress,
} from "../src/binding/getBindingSetByAbsoluteStateAddress";
import { BindingSession } from "../src/bindings/BindingSession";
import { setDevtoolsSink } from "../src/devtools/sink";
import type { DevtoolsEvent } from "../src/devtools/types";
import type { IAbsolutePathInfo, IAbsoluteStateAddress } from "../src/address/types";
import type { IBindingInfo } from "../src/types";
import type { IListIndex } from "../src/list/types";

const makePathInfo = (): IAbsolutePathInfo => ({} as IAbsolutePathInfo);
const makeListIndex = (): IListIndex => ({} as IListIndex);
const makeBinding = (): IBindingInfo => ({} as IBindingInfo);
const addressOf = (absolutePathInfo: IAbsolutePathInfo, listIndex: IListIndex | null): IAbsoluteStateAddress =>
  ({ absolutePathInfo, listIndex } as IAbsoluteStateAddress);

afterEach(() => {
  setDevtoolsSink(null);
  vi.clearAllMocks();
  mocks.listIndex = { index: 0 };
  mocks.stateElement = null;
});

describe("パターン索引台帳", () => {
  it("1本目は binding 素置き・2本目で Set 昇格・同一 binding の再 add は不変", () => {
    const pathInfo = makePathInfo();
    const listIndex = makeListIndex();
    const first = makeBinding();
    const second = makeBinding();

    addBindingByPattern(pathInfo, listIndex, first);
    expect(peekBindingsForAddress(addressOf(pathInfo, listIndex))).toBe(first);
    addBindingByPattern(pathInfo, listIndex, first);
    expect(peekBindingsForAddress(addressOf(pathInfo, listIndex))).toBe(first);

    addBindingByPattern(pathInfo, listIndex, second);
    const entry = peekBindingsForAddress(addressOf(pathInfo, listIndex));
    expect(entry).toBeInstanceOf(Set);
    expect((entry as Set<IBindingInfo>).has(first)).toBe(true);
    expect((entry as Set<IBindingInfo>).has(second)).toBe(true);

    const third = makeBinding();
    addBindingByPattern(pathInfo, listIndex, third);
    expect(peekBindingsForAddress(addressOf(pathInfo, listIndex))).toBe(entry);
    expect((entry as Set<IBindingInfo>).size).toBe(3);
  });

  it("remove の防御: 未知パターン / 未知 listIndex / 不一致 binding では変化しないこと", () => {
    const pathInfo = makePathInfo();
    const listIndex = makeListIndex();
    const binding = makeBinding();

    // 未知パターン
    expect(() => removeBindingByPattern(makePathInfo(), listIndex, binding)).not.toThrow();

    addBindingByPattern(pathInfo, listIndex, binding);
    // 未知 listIndex
    removeBindingByPattern(pathInfo, makeListIndex(), binding);
    expect(peekBindingsForAddress(addressOf(pathInfo, listIndex))).toBe(binding);
    // 不一致 binding
    removeBindingByPattern(pathInfo, listIndex, makeBinding());
    expect(peekBindingsForAddress(addressOf(pathInfo, listIndex))).toBe(binding);
    // 一致 remove でエントリごと消える
    removeBindingByPattern(pathInfo, listIndex, binding);
    expect(peekBindingsForAddress(addressOf(pathInfo, listIndex))).toBeUndefined();
  });

  it("Set 昇格後の remove は Set から外すこと", () => {
    const pathInfo = makePathInfo();
    const listIndex = makeListIndex();
    const first = makeBinding();
    const second = makeBinding();
    addBindingByPattern(pathInfo, listIndex, first);
    addBindingByPattern(pathInfo, listIndex, second);
    removeBindingByPattern(pathInfo, listIndex, first);
    const entry = peekBindingsForAddress(addressOf(pathInfo, listIndex));
    expect(entry).toBeInstanceOf(Set);
    expect((entry as Set<IBindingInfo>).has(second)).toBe(true);
  });

  it("peekBindingsForAddress は従来台帳を優先し、listIndex 無しはパターン台帳を引かないこと", () => {
    const pathInfo = makePathInfo();
    const listIndex = makeListIndex();
    const classic = makeBinding();
    const pattern = makeBinding();

    // 従来台帳とパターン台帳の両方に登録（旧経路許容のフォールバック順序）
    const address = addressOf(pathInfo, listIndex);
    addBindingByAbsoluteStateAddress(address, classic);
    addBindingByPattern(pathInfo, listIndex, pattern);
    expect(peekBindingsForAddress(address)).toBe(classic);

    // listIndex === null はパターン台帳に到達しない
    expect(peekBindingsForAddress(addressOf(pathInfo, null))).toBeUndefined();
  });

  it("devtools sink 接続時は intern したアドレス付きで binding-added / removed が発火すること", () => {
    const events: DevtoolsEvent[] = [];
    setDevtoolsSink((e) => events.push(e));
    const pathInfo = makePathInfo();
    const listIndex = makeListIndex();
    const binding = makeBinding();

    addBindingByPattern(pathInfo, listIndex, binding);
    removeBindingByPattern(pathInfo, listIndex, binding);

    const added = events.find((e) => e.type === "state:binding-added") as any;
    const removed = events.find((e) => e.type === "state:binding-removed") as any;
    expect(added.binding).toBe(binding);
    expect(added.absoluteAddress.absolutePathInfo).toBe(pathInfo);
    expect(added.absoluteAddress.listIndex).toBe(listIndex);
    // intern されるので add / remove で同一アドレスインスタンス
    expect(removed.absoluteAddress).toBe(added.absoluteAddress);
  });
});

describe("registerAddress のパターン経路（防御）", () => {
  it("listIndex 付き binding の stateElement 未登録は raiseError すること", () => {
    mocks.stateElement = null;
    const node = document.createElement("input");
    const binding: IBindingInfo = {
      propName: "value",
      propSegments: ["value"],
      propModifiers: [],
      statePathName: "items.*.v",
      statePathInfo: { path: "items.*.v", wildcardCount: 1 } as any,
      stateName: "default",
      inFilters: [],
      outFilters: [],
      node,
      replaceNode: node,
      bindingType: "prop",
    };
    const session = new BindingSession();
    expect(() => session.initialize([binding])).toThrow(/State element with name "default" not found/);
  });
});
