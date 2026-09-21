/**
 * bindings.rowSession.branches.test.ts — 行 record（行ランタイム設計 R3）の分岐。
 *
 * `bindings.BindingSession.branches.test.ts` と同じ作法で、session を直に組んで
 * 行 record 側の分岐（未登録の行・失敗した slot・二度目の適用・アドレスの張り直し・
 * 行を持つ session の destroyRecords）を通す。実 DOM の経路は
 * `bindings.rowSession.test.ts`（統合）が担当する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IBindingInfo } from "../src/types";
import { setConfig } from "../src/config";

const mocks = vi.hoisted(() => ({
  stateElement: null as any,
  addAddress: vi.fn(),
  removeAddress: vi.fn(),
  getAddress: vi.fn(() => ({ path: "items.*.name" })),
  listIndex: null as any,
  attachEvent: vi.fn(() => false),
}));

vi.mock("../src/getCustomElement", () => ({ getCustomElement: vi.fn(() => null) }));
vi.mock("../src/binding/getAbsoluteStateAddressByBinding", () => ({
  getAbsoluteStateAddressByBinding: mocks.getAddress,
  clearAbsoluteStateAddressByBinding: vi.fn(),
  resolveBindingRootNode: vi.fn(() => document),
}));
vi.mock("../src/binding/getBindingSetByAbsoluteStateAddress", () => ({
  addBindingByAbsoluteStateAddress: mocks.addAddress,
  removeBindingByAbsoluteStateAddress: mocks.removeAddress,
  addBindingByPattern: vi.fn(),
  removeBindingByPattern: vi.fn(),
}));
vi.mock("../src/list/getListIndexByBindingInfo", () => ({ getListIndexByBindingInfo: vi.fn(() => mocks.listIndex) }));
vi.mock("../src/stateElementByName", () => ({ getStateElement: vi.fn(() => mocks.stateElement) }));
vi.mock("../src/event/handler", () => ({ attachEventHandler: mocks.attachEvent, detachEventHandler: vi.fn() }));

import { BindingSession } from "../src/bindings/BindingSession";

function createBinding(name: string): IBindingInfo {
  const node = document.createElement("span");
  return {
    propName: "textContent",
    propSegments: ["textContent"],
    propModifiers: [],
    statePathName: name,
    statePathInfo: { path: name, wildcardCount: 1 } as any,
    inFilters: [],
    outFilters: [],
    node,
    replaceNode: node,
    bindingType: "prop",
  } as IBindingInfo;
}

function createPlan(bindings: IBindingInfo[], overrides: { authority?: string; outputOnly?: boolean } = {}): any {
  return {
    directional: true,
    slots: bindings.map((binding, index) => ({
      nodeIndex: index,
      template: binding,
      isEvent: false,
      isIndexBinding: false,
      policy: { observable: false, authority: overrides.authority ?? "state", outputOnly: overrides.outputOnly ?? true },
      authority: overrides.authority ?? "state",
    })),
  };
}

describe("行 record の分岐", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stateElement = { setPathInfo: vi.fn() };
    mocks.listIndex = null;
    mocks.getAddress.mockImplementation(() => ({ path: "items.*.name" }));
    mocks.attachEvent.mockImplementation(() => false);
    setConfig({ enableDirectionalInitialSync: true });
  });

  afterEach(() => {
    setConfig({ enableDirectionalInitialSync: true });
  });

  it("登録前の行はそのまま適用対象で、登録後は権限で決まること", () => {
    const bindings = [createBinding("items.*.name")];
    const session = new BindingSession();
    session.initializeRow(createPlan(bindings), bindings);

    // 登録前（initialize を通っていない行）は常に適用する
    expect(session.shouldApplyState(bindings[0])).toBe(true);

    session.initialize(bindings, { registerAddress: true });
    // 登録後の初回は authority が state のときだけ適用
    expect(session.shouldApplyState(bindings[0])).toBe(true);
    // 2 回目以降も state 権限なら適用する
    expect(session.shouldApplyState(bindings[0])).toBe(true);
  });

  it("state 権限でない slot は、初回だけ見送り 2 回目から出力の有無で決まること", () => {
    const bindings = [createBinding("items.*.name")];
    const session = new BindingSession();
    session.initializeRow(createPlan(bindings, { authority: "element", outputOnly: false }), bindings);
    session.initialize(bindings, { registerAddress: true });

    // 初回: element 権限なので state 側からは書かない
    expect(session.shouldApplyState(bindings[0])).toBe(false);
    // 2 回目: 出力のみでなければ以後は適用する
    expect(session.shouldApplyState(bindings[0])).toBe(true);
  });

  it("出力のみの element 権限 slot は、張り直しの適用対象にならないこと", () => {
    const bindings = [createBinding("items.*.name")];
    const session = new BindingSession();
    session.initializeRow(createPlan(bindings, { authority: "element", outputOnly: true }), bindings);
    session.initialize(bindings, { registerAddress: true });
    // 初回の判定を消費させる（以後は outputOnly なので適用しない）
    expect(session.shouldApplyState(bindings[0])).toBe(false);

    expect(session.rebindAddresses()).toEqual([]);
  });

  it("束縛を 1 つも渡さない destroyRow は、record 側の全消去に倒れること", () => {
    const bindings = [createBinding("items.*.name")];
    const session = new BindingSession();
    session.initializeRow(createPlan(bindings), bindings);
    session.initialize(bindings, { registerAddress: true });

    session.destroyRow([]);

    expect(mocks.removeAddress).toHaveBeenCalled();
  });

  it("イベントの配線に失敗した slot は失敗として残り、登録後は適用対象から外れること", () => {
    const bindings = [createBinding("items.*.name"), createBinding("items.*.onclick")];
    const plan = createPlan(bindings);
    plan.slots[1].isEvent = true;
    mocks.attachEvent.mockImplementation(() => { throw new Error("attach failed"); });
    const session = new BindingSession();

    expect(() => session.initializeRow(plan, bindings)).toThrow(/attach failed/);
    // 生きている slot の登録で行が「登録済み」になる
    session.initialize([bindings[0]], { registerAddress: true });

    expect(session.shouldApplyState(bindings[1])).toBe(false);
    expect(session.getRecord(bindings[1])?.phase).toBe("failed");
  });

  it("行のパターン登録で state ツリーが見つからなければ名指しで落ちること", () => {
    const bindings = [createBinding("items.*.name")];
    const session = new BindingSession();
    session.initializeRow(createPlan(bindings), bindings);
    // listIndex を持つ（パターン台帳へ登録する）行で、ルートに state が無い形
    mocks.listIndex = { index: 0 } as any;
    mocks.stateElement = null;

    expect(() => session.initialize(bindings, { registerAddress: true }))
      .toThrow(/No state tree found on this root for binding/);
  });

  it("同じ行をもう一度 initialize しても、登録済みの slot は登録し直さないこと", () => {
    const bindings = [createBinding("items.*.name")];
    const session = new BindingSession();
    session.initializeRow(createPlan(bindings), bindings);
    session.initialize(bindings, { registerAddress: true });
    const registrations = mocks.addAddress.mock.calls.length;
    expect(registrations).toBeGreaterThan(0);

    session.initialize(bindings, { registerAddress: true });
    expect(mocks.addAddress.mock.calls.length).toBe(registrations);
  });

  it("アドレスの張り直しで、生きている slot が新しいアドレスへ移ること", () => {
    const bindings = [createBinding("items.*.name")];
    const session = new BindingSession();
    session.initializeRow(createPlan(bindings), bindings);
    session.initialize(bindings, { registerAddress: true });

    const before = mocks.removeAddress.mock.calls.length;
    mocks.getAddress.mockImplementation(() => ({ path: "items.*.name", generation: 2 }));
    const rebound = session.rebindAddresses();

    expect(rebound).toEqual(bindings);
    expect(mocks.removeAddress.mock.calls.length).toBeGreaterThan(before);
  });

  it("登録済みの行を再活性化しても、同じ slot を二重に登録しないこと", () => {
    const bindings = [createBinding("items.*.name")];
    const session = new BindingSession();
    const plan = createPlan(bindings);
    session.initializeRow(plan, bindings);
    session.initialize(bindings, { registerAddress: true });
    const registrations = mocks.addAddress.mock.calls.length;

    // 同じ行をもう一度活性化する（プールから戻した行の再活性化と同じ経路）
    session.activate(bindings, document);

    expect(mocks.addAddress.mock.calls.length).toBe(registrations);
  });

  it("解体済みの slot は、張り直しにも活性ノードの走査にも出てこないこと", () => {
    const bindings = [createBinding("items.*.name"), createBinding("items.*.note")];
    const session = new BindingSession();
    session.initializeRow(createPlan(bindings), bindings);
    session.initialize(bindings, { registerAddress: true });

    session.disposeBinding(bindings[1]);

    const active: Node[] = [];
    session.forEachActiveBindingNode((node) => active.push(node));
    expect(active).toEqual([bindings[0].node]);

    const rebound = session.rebindAddresses();
    expect(rebound).toEqual([bindings[0]]);
  });

  it("登録していない行は張り直しの対象にならないこと", () => {
    const bindings = [createBinding("items.*.name")];
    const session = new BindingSession();
    session.initializeRow(createPlan(bindings), bindings);
    // initialize を通していない = アドレスもパターンも持たない行

    expect(session.rebindAddresses()).toEqual([]);
    expect(mocks.removeAddress).not.toHaveBeenCalled();
  });

  it("行を持つ session の destroyRecords が、行のアドレスも外すこと", () => {
    const bindings = [createBinding("items.*.name")];
    const session = new BindingSession();
    session.initializeRow(createPlan(bindings), bindings);
    session.initialize(bindings, { registerAddress: true });

    session.destroyRecords();

    expect(mocks.removeAddress).toHaveBeenCalled();
    const active: Node[] = [];
    session.forEachActiveBindingNode((node) => active.push(node));
    expect(active).toEqual([]);
  });
});
