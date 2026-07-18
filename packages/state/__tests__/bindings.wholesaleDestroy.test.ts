/**
 * bindings.wholesaleDestroy.test.ts — clear の全行破棄で teardown を GC に任せる
 * wholesale destroy 経路（BindingSession.canWholesaleDestroy / destroyRecords、
 * Content.tryDestroy）の契約。
 *
 * - 定義待ち（pendingDefinitions / deferred タスク）や connect-snapshot 待ち
 *   （observationPending）が 1 つでもあれば wholesale は不許可（従来経路に倒す）
 * - destroyRecords は teardown（listener 解除等）を実行せずに record を終端化する
 * - session を持たない content（SSR ハイドレーション産）は tryDestroy が false
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IBindingInfo } from "../src/types";

const mocks = vi.hoisted(() => ({
  customTag: null as string | null,
  registry: null as any,
  apply: vi.fn(),
  addAddress: vi.fn(),
  removeAddress: vi.fn(),
  clearAbsolute: vi.fn(),
  clearState: vi.fn(),
  getAddress: vi.fn(() => ({ path: "value" })),
  stateElement: { setPathInfo: vi.fn() } as any,
  attachEvent: vi.fn(() => false),
  detachEvent: vi.fn(),
}));

vi.mock("../src/getCustomElement", () => ({ getCustomElement: vi.fn(() => mocks.customTag) }));
vi.mock("../src/apply/applyChangeFromBindings", () => ({ applyChangeFromBindings: mocks.apply }));
vi.mock("../src/binding/getAbsoluteStateAddressByBinding", () => ({
  getAbsoluteStateAddressByBinding: mocks.getAddress,
  clearAbsoluteStateAddressByBinding: mocks.clearAbsolute,
}));
vi.mock("../src/binding/getBindingSetByAbsoluteStateAddress", () => ({
  addBindingByAbsoluteStateAddress: mocks.addAddress,
  removeBindingByAbsoluteStateAddress: mocks.removeAddress,
}));
vi.mock("../src/binding/getStateAddressByBindingInfo", () => ({ clearStateAddressByBindingInfo: mocks.clearState }));
vi.mock("../src/stateElementByName", () => ({ getStateElementByName: vi.fn(() => mocks.stateElement) }));
vi.mock("../src/event/handler", () => ({ attachEventHandler: mocks.attachEvent, detachEventHandler: mocks.detachEvent }));

import { BindingSession } from "../src/bindings/BindingSession";
import { createContentFromNodes } from "../src/structural/createContent";

function createBinding(node: Element = document.createElement("input"), overrides: Partial<IBindingInfo> = {}): IBindingInfo {
  return {
    propName: "value",
    propSegments: ["value"],
    propModifiers: [],
    statePathName: "value",
    statePathInfo: { path: "value", wildcardCount: 0 } as any,
    stateName: "default",
    inFilters: [],
    outFilters: [],
    node,
    replaceNode: node,
    bindingType: "prop",
    ...overrides,
  };
}

describe("wholesale destroy（clear 高速破棄）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customTag = null;
    mocks.attachEvent.mockReturnValue(false);
  });

  it("canWholesaleDestroy: 素の session は許可されること", () => {
    const session = new BindingSession();
    session.initialize([createBinding()], { registerAddress: false });
    expect(session.canWholesaleDestroy()).toBe(true);
  });

  it("canWholesaleDestroy: 定義待ち record があれば不許可になること", () => {
    const session = new BindingSession();
    const binding = createBinding();
    session.initialize([binding], { registerAddress: false });
    session.getRecord(binding)!.pendingDefinitions = 1;
    expect(session.canWholesaleDestroy()).toBe(false);
  });

  it("canWholesaleDestroy: connect-snapshot 待ち record があれば不許可になること", () => {
    const session = new BindingSession();
    const binding = createBinding();
    session.initialize([binding], { registerAddress: false });
    session.getRecord(binding)!.observationPending = true;
    expect(session.canWholesaleDestroy()).toBe(false);
  });

  it("canWholesaleDestroy: deferred タスクがあれば不許可になること", () => {
    const session = new BindingSession();
    session.initialize([createBinding()], { registerAddress: false });
    (session as any).deferred.add({ node: document.createElement("div"), active: true, cancel: null });
    expect(session.canWholesaleDestroy()).toBe(false);
  });

  it("destroyRecords: teardown を実行せずに record を終端化すること", () => {
    const session = new BindingSession();
    mocks.attachEvent.mockReturnValueOnce(true);
    const eventBinding = createBinding(undefined, { bindingType: "event" });
    session.initialize([eventBinding], { registerAddress: false });
    expect(session.getRecord(eventBinding)?.phase).toBe("active");

    session.destroyRecords();
    expect(session.getRecord(eventBinding)?.phase).toBe("disposed");
    // teardown（detachEventHandler）は走らない — listener はノードごと GC に任せる
    expect(mocks.detachEvent).not.toHaveBeenCalled();
    // 終端化済みなので dispose しても二重解体にならない
    session.dispose();
    expect(mocks.detachEvent).not.toHaveBeenCalled();
  });

  it("activate: 初回活性化はアドレス登録と初期同期だけ行うこと", () => {
    const session = new BindingSession();
    const binding = createBinding();
    session.initialize([binding], { registerAddress: false });
    expect(session.getRecord(binding)?.phase).toBe("active");
    expect(mocks.addAddress).not.toHaveBeenCalled();

    session.activate([binding], document);
    expect(mocks.addAddress).toHaveBeenCalledTimes(1);
    // 再活性化（アドレス登録済み）では二重登録しない
    session.activate([binding], document);
    expect(mocks.addAddress).toHaveBeenCalledTimes(1);
  });

  it("activate: pool 再利用（disposed record）は start で再構築されること", () => {
    const session = new BindingSession();
    const binding = createBinding();
    session.initialize([binding], { registerAddress: false });
    session.disposeBinding(binding);
    expect(session.getRecord(binding)?.phase).toBe("disposed");

    session.activate([binding], document);
    expect(session.getRecord(binding)?.phase).toBe("active");
    expect(mocks.addAddress).toHaveBeenCalledTimes(1);
  });

  it("activate: remember されていない binding は従来 initialize に倒れること", () => {
    const session = new BindingSession();
    const binding = createBinding();
    // knownRoot が観測不能 root（素の fragment）でも活性化は成立する
    session.activate([binding], document.createDocumentFragment());
    expect(session.getRecord(binding)?.phase).toBe("active");
    expect(mocks.addAddress).toHaveBeenCalledTimes(1);
  });

  it("tryDestroy: session を持たない content は false を返し何も壊さないこと", () => {
    const span = document.createElement("span");
    document.body.appendChild(span);
    const content = createContentFromNodes([span]);
    expect(content.tryDestroy()).toBe(false);
    expect(span.parentNode).not.toBeNull();
    span.remove();
  });
});
