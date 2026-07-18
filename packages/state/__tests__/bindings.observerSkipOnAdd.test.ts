/**
 * bindings.observerSkipOnAdd.test.ts — framework マウント由来の追加サブツリーに
 * 対する MutationObserver 走査スキップ（削除側 observerSkip の対称形）の契約。
 *
 * - framework がマーク済みの追加サブツリーは、connect-snapshot 待ち
 *   （observationPending な record）がグローバルにゼロなら走査されない
 * - 待ちが 1 件でもあればマーク済みでも従来どおり走査され、接続時 snapshot が届く
 * - 待ちカウンタは snapshot 消化・record 終端（dispose）で必ず戻る
 * - マークは one-shot（1 回の配送で消費される）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IBindingInfo } from "../src/types";

const mocks = vi.hoisted(() => ({
  state: {} as Record<PropertyKey, any>,
  addAddress: vi.fn(),
  removeAddress: vi.fn(),
  clearAbsolute: vi.fn(),
  clearStateAddress: vi.fn(),
  setPathInfo: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("../src/apply/applyChangeFromBindings", () => ({
  applyChangeFromBindings: mocks.apply,
}));
vi.mock("../src/binding/getAbsoluteStateAddressByBinding", () => ({
  getAbsoluteStateAddressByBinding: vi.fn((binding: IBindingInfo) => ({ path: binding.statePathName })),
  clearAbsoluteStateAddressByBinding: mocks.clearAbsolute,
}));
vi.mock("../src/binding/getBindingSetByAbsoluteStateAddress", () => ({
  addBindingByAbsoluteStateAddress: mocks.addAddress,
  removeBindingByAbsoluteStateAddress: mocks.removeAddress,
}));
vi.mock("../src/binding/getStateAddressByBindingInfo", () => ({
  getStateAddressByBindingInfo: vi.fn((binding: IBindingInfo) => ({
    pathInfo: {
      path: binding.statePathName,
      lastSegment: binding.statePathName,
      wildcardCount: 0,
    },
    listIndex: null,
    parentAddress: null,
  })),
  clearStateAddressByBindingInfo: mocks.clearStateAddress,
}));
vi.mock("../src/stateElementByName", () => ({
  getStateElementByName: vi.fn(() => ({
    setPathInfo: mocks.setPathInfo,
    createState: (_mutability: string, callback: (state: any) => void) => callback(mocks.state),
  })),
}));

import { BindingSession } from "../src/bindings/BindingSession";
import {
  consumeObserverSkipOnAdd,
  hasPendingObservation,
  markObserverSkipOnAdd,
} from "../src/bindings/observerSkip";
import { setConfig } from "../src/config";
import { hasByAddressSymbol, setLoopContextSymbol } from "../src/proxy/symbols";

let sequence = 0;
const sessions: BindingSession[] = [];

function nextTag(label: string): string {
  sequence += 1;
  return `x-obsskip-${label}-${sequence}`;
}

function declaration(properties: readonly any[]): any {
  return { protocol: "wc-bindable", version: 1, properties };
}

function createBinding(node: Element, statePathName: string, modifiers: string[] = []): IBindingInfo {
  return {
    propName: "value",
    propSegments: ["value"],
    propModifiers: modifiers,
    statePathName,
    statePathInfo: { path: statePathName, wildcardCount: 0 } as any,
    stateName: "default",
    inFilters: [],
    outFilters: [],
    node,
    replaceNode: node,
    bindingType: "prop",
  };
}

function session(root: Node = document): BindingSession {
  const result = new BindingSession(root);
  sessions.push(result);
  return result;
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("追加側 observer スキップ（framework マウント）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    mocks.state = {
      [setLoopContextSymbol]: (_context: unknown, callback: () => unknown) => callback(),
      [hasByAddressSymbol]: (address: any) => address.pathInfo.path in mocks.state,
    };
    setConfig({ enableDirectionalInitialSync: true });
  });

  afterEach(async () => {
    for (const current of sessions.splice(0)) current.dispose();
    setConfig({ enableDirectionalInitialSync: false });
    document.body.replaceChildren();
    await flushMutations();
  });

  it("マーク済みの追加サブツリーは走査されず、マーク無しなら従来どおり restart すること", async () => {
    const node = document.createElement("input");
    const binding = createBinding(node, "plainValue");
    const owner = session(document);
    owner.initialize([binding]);
    owner.disposeBinding(binding);
    expect(owner.getRecord(binding)?.phase).toBe("disposed");

    // framework マウント相当: マークして接続 → 追加走査がスキップされ restart しない
    markObserverSkipOnAdd(node);
    document.body.append(node);
    await flushMutations();
    expect(owner.getRecord(binding)?.phase).toBe("disposed");

    // マークは消費済み（one-shot）なので、外部 DOM 操作の再接続は従来どおり届く
    node.remove();
    await flushMutations();
    document.body.append(node);
    await flushMutations();
    expect(owner.getRecord(binding)?.phase).toBe("active");
  });

  it("connect-snapshot 待ちがある間はマーク済みでも走査され、snapshot が届くこと", async () => {
    const tag = nextTag("connect");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration([
        { name: "value", event: "value-change", getter: (event: Event) => (event as CustomEvent).detail },
      ]);
      value: unknown = "before-connect";
    });
    const node = document.createElement(tag) as HTMLElement & { value: unknown };
    const binding = createBinding(node, "connectedValue", ["sync=connect"]);
    session(document).initialize([binding]);
    // 未接続の two-way sync=connect → connect-snapshot 待ちが立つ
    expect(hasPendingObservation()).toBe(true);

    node.value = "connected-snapshot";
    // framework マウント相当のマークがあっても、待ちがある間は走査に倒れる
    markObserverSkipOnAdd(node);
    document.body.append(node);
    await flushMutations();

    expect(mocks.state.connectedValue).toBe("connected-snapshot");
    // snapshot 消化で待ちが戻り、以後のマークは再びスキップに使える
    expect(hasPendingObservation()).toBe(false);
  });

  it("未消化の connect-snapshot 待ちは record 終端（dispose）で必ず戻ること", () => {
    const tag = nextTag("dispose");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration([
        { name: "value", event: "value-change", getter: (event: Event) => (event as CustomEvent).detail },
      ]);
      value: unknown = "never-connected";
    });
    const node = document.createElement(tag) as HTMLElement & { value: unknown };
    const binding = createBinding(node, "neverConnected", ["sync=connect"]);
    const owner = session(document);
    owner.initialize([binding]);
    expect(hasPendingObservation()).toBe(true);

    owner.dispose();
    expect(hasPendingObservation()).toBe(false);
  });

  it("マークは one-shot で消費されること（未マークは false）", () => {
    const node = document.createElement("div");
    expect(consumeObserverSkipOnAdd(node)).toBe(false);
    markObserverSkipOnAdd(node);
    expect(consumeObserverSkipOnAdd(node)).toBe(true);
    expect(consumeObserverSkipOnAdd(node)).toBe(false);
  });
});
