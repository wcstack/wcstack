import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IBindingInfo } from "../src/types";
import type { IPropagationContext } from "../src/propagation/types";

vi.mock("../src/apply/applyChangeFromBindings", () => ({
  applyChangeFromBindings: vi.fn(),
}));

import { getAbsolutePathInfo } from "../src/address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { getPathInfo } from "../src/address/PathInfo";
import { applyChangeFromBindings } from "../src/apply/applyChangeFromBindings";
import { applyChangeToProperty } from "../src/apply/applyChangeToProperty";
import type { IApplyContext } from "../src/apply/types";
import { addBindingByAbsoluteStateAddress, clearBindingSetByAbsoluteStateAddress } from "../src/binding/getBindingSetByAbsoluteStateAddress";
import type { IStateElement } from "../src/components/types";
import { setConfig } from "../src/config";
import { MAX_PROPAGATION_HOPS } from "../src/define";
import { setDevtoolsSink } from "../src/devtools/sink";
import type { DevtoolsEvent } from "../src/devtools/types";
import {
  __private__,
  beginPropagationTransaction,
  extendPropagationContext,
  getCurrentPropagationContext,
  getEdgeId,
  getWireId,
  matchWriteReceipt,
  runWithPropagationContext,
  runWithWriteReceipt,
} from "../src/propagation/propagation";
import { getUpdater, registerUpdateBatchListener, unregisterUpdateBatchListener } from "../src/updater/updater";

const applyChangeFromBindingsMock = vi.mocked(applyChangeFromBindings);

function createBinding(node: Element, statePathName: string): IBindingInfo {
  return {
    propName: "value",
    propSegments: ["value"],
    propModifiers: [],
    statePathName,
    statePathInfo: getPathInfo(statePathName),
    stateName: "default",
    inFilters: [],
    outFilters: [],
    node,
    replaceNode: node,
    bindingType: "prop",
    uuid: null,
  } as IBindingInfo;
}

function createAbsAddress(path: string) {
  const stateElement = { name: "default" } as IStateElement;
  return createAbsoluteStateAddress(getAbsolutePathInfo(stateElement, getPathInfo(path)), null);
}

describe("propagation core", () => {
  it("wire ID は (node, member, state, path) で安定し edge ID は方向を含むこと", () => {
    const node = document.createElement("div");
    const wireId = getWireId(node, "value", "default", "text");
    expect(getWireId(node, "value", "default", "text")).toBe(wireId);
    expect(getWireId(node, "checked", "default", "text")).not.toBe(wireId);
    expect(getWireId(document.createElement("div"), "value", "default", "text")).not.toBe(wireId);
    expect(getEdgeId(wireId, "to-element")).not.toBe(getEdgeId(wireId, "to-state"));
  });

  it("transaction 開始と edge 通過が immutable に記録されること", () => {
    const first = beginPropagationTransaction(-1);
    const second = beginPropagationTransaction(-1);
    expect(second.transactionId).toBeGreaterThan(first.transactionId);
    expect(first.hop).toBe(0);
    expect(first.visitedEdges.size).toBe(0);

    const extended = extendPropagationContext(first, 7);
    expect(extended.transactionId).toBe(first.transactionId);
    expect(extended.hop).toBe(1);
    expect(extended.visitedEdges.has(7)).toBe(true);
    // 元の context は不変
    expect(first.visitedEdges.has(7)).toBe(false);
  });

  it("current context は同期 scope で復元され、例外時も戻ること", () => {
    const context = beginPropagationTransaction(-1);
    expect(getCurrentPropagationContext()).toBeNull();
    runWithPropagationContext(context, () => {
      expect(getCurrentPropagationContext()).toBe(context);
      runWithPropagationContext(null, () => {
        expect(getCurrentPropagationContext()).toBeNull();
      });
      expect(getCurrentPropagationContext()).toBe(context);
    });
    expect(getCurrentPropagationContext()).toBeNull();

    expect(() => runWithPropagationContext(context, () => {
      throw new Error("scope failure");
    })).toThrow(/scope failure/);
    expect(getCurrentPropagationContext()).toBeNull();
  });

  it("WriteReceipt は同期 scope 内だけで観測でき、例外時も破棄されること", () => {
    const node = document.createElement("input");
    expect(matchWriteReceipt(node, "value")).toBeNull();
    runWithWriteReceipt(node, "value", "written", 1, 10, () => {
      const receipt = matchWriteReceipt(node, "value");
      expect(receipt?.writtenValue).toBe("written");
      expect(receipt?.transactionId).toBe(10);
      expect(matchWriteReceipt(node, "checked")).toBeNull();
      expect(matchWriteReceipt(document.createElement("input"), "value")).toBeNull();
      // 入れ子は最も内側が勝つ
      runWithWriteReceipt(node, "value", "inner", 1, 11, () => {
        expect(matchWriteReceipt(node, "value")?.writtenValue).toBe("inner");
      });
      expect(matchWriteReceipt(node, "value")?.writtenValue).toBe("written");
    });
    expect(matchWriteReceipt(node, "value")).toBeNull();

    expect(() => runWithWriteReceipt(node, "value", "boom", 1, 12, () => {
      throw new Error("write failure");
    })).toThrow(/write failure/);
    expect(__private__.receiptStack.length).toBe(0);
  });
});

describe("applyChangeToProperty propagation", () => {
  beforeEach(() => {
    setConfig({ enablePropagationContext: true });
  });

  afterEach(() => {
    setConfig({ enablePropagationContext: false });
    setDevtoolsSink(null);
  });

  it("同じ transaction が同じ edge を再度通る場合だけ抑止すること（diamond 不変条件）", () => {
    const events: DevtoolsEvent[] = [];
    setDevtoolsSink((event) => events.push(event));
    const first = document.createElement("input");
    const second = document.createElement("input");
    const firstBinding = createBinding(first, "text");
    const secondBinding = createBinding(second, "text");
    const firstEdge = getEdgeId(getWireId(first, "value", "default", "text"), "to-element");
    const visited = extendPropagationContext(beginPropagationTransaction(-1), firstEdge);
    const propagationContextByBinding = new Map<IBindingInfo, IPropagationContext | null>([
      [firstBinding, visited],
      [secondBinding, visited],
    ]);
    const context = { propagationContextByBinding } as unknown as IApplyContext;

    applyChangeToProperty(firstBinding, context, "next");
    applyChangeToProperty(secondBinding, context, "next");

    // 同一 transaction 内: 通過済み edge の first は抑止、未通過の second は適用
    expect(first.value).toBe("");
    expect(second.value).toBe("next");
    expect(events).toEqual([
      expect.objectContaining({
        type: "propagation:suppressed",
        reason: "visited-edge",
        transactionId: visited.transactionId,
        edgeId: firstEdge,
      }),
    ]);

    // sink なしでも抑止自体は同じに機能する
    setDevtoolsSink(null);
    applyChangeToProperty(firstBinding, context, "still-suppressed");
    expect(first.value).toBe("");
  });

  it("書き込みは receipt と拡張 context の scope で実行されること", () => {
    let observedReceiptValue: unknown = null;
    let observedContext: IPropagationContext | null = null;
    const element = document.createElement("input");
    Object.defineProperty(element, "value", {
      get: () => "",
      set: (value: unknown) => {
        observedReceiptValue = matchWriteReceipt(element, "value")?.writtenValue ?? null;
        observedContext = getCurrentPropagationContext();
        void value;
      },
      configurable: true,
    });
    const binding = createBinding(element, "text");

    applyChangeToProperty(binding, {} as IApplyContext, "written");

    const edgeId = getEdgeId(getWireId(element, "value", "default", "text"), "to-element");
    expect(observedReceiptValue).toBe("written");
    expect(observedContext).not.toBeNull();
    expect(observedContext!.hop).toBe(1);
    expect(observedContext!.visitedEdges.has(edgeId)).toBe(true);
    // scope 終了後は receipt / context とも破棄される
    expect(matchWriteReceipt(element, "value")).toBeNull();
    expect(getCurrentPropagationContext()).toBeNull();
  });
});

describe("updater update records", () => {
  const registeredAddresses: ReturnType<typeof createAbsAddress>[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    setConfig({ enablePropagationContext: true });
  });

  afterEach(() => {
    setConfig({ enablePropagationContext: false });
    setDevtoolsSink(null);
    for (const address of registeredAddresses.splice(0)) {
      clearBindingSetByAbsoluteStateAddress(address);
    }
  });

  it("coalescing は last-write-wins で winner の context をそのまま採用すること", () => {
    const events: DevtoolsEvent[] = [];
    setDevtoolsSink((event) => events.push(event));
    const node = document.createElement("input");
    document.body.append(node);
    const binding = createBinding(node, "coalesce");
    const address = createAbsAddress("coalesce");
    registeredAddresses.push(address);
    addBindingByAbsoluteStateAddress(address, binding);

    const dropped = beginPropagationTransaction(-1);
    const winner = beginPropagationTransaction(-1);
    getUpdater().testApplyChange([address, address], [dropped, winner]);

    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    const [bindings, contextByBinding] = applyChangeFromBindingsMock.mock.calls[0];
    expect(bindings).toEqual([binding]);
    expect(contextByBinding?.get(binding)).toBe(winner);
    // sink はグローバルのため binding 登録等のイベントを除いて検証する
    expect(events.filter((event) => event.type.startsWith("propagation:"))).toEqual([
      expect.objectContaining({
        type: "propagation:coalesced",
        droppedTransactionId: dropped.transactionId,
        winnerTransactionId: winner.transactionId,
      }),
    ]);
    node.remove();
  });

  it("hop 上限超過の update record は quarantine され例外を投げないこと", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const events: DevtoolsEvent[] = [];
    setDevtoolsSink((event) => events.push(event));
    const node = document.createElement("input");
    document.body.append(node);
    const quarantinedBinding = createBinding(node, "runaway");
    const quarantinedAddress = createAbsAddress("runaway");
    const survivor = document.createElement("input");
    document.body.append(survivor);
    const survivorBinding = createBinding(survivor, "healthy");
    const survivorAddress = createAbsAddress("healthy");
    registeredAddresses.push(quarantinedAddress, survivorAddress);
    addBindingByAbsoluteStateAddress(quarantinedAddress, quarantinedBinding);
    addBindingByAbsoluteStateAddress(survivorAddress, survivorBinding);

    const exhausted: IPropagationContext = {
      transactionId: 999,
      originBindingId: -1,
      visitedEdges: new Set<number>(),
      hop: MAX_PROPAGATION_HOPS,
    };
    const healthy = beginPropagationTransaction(-1);
    const batches: ReadonlySet<unknown>[] = [];
    const listener = (batch: ReadonlySet<unknown>) => batches.push(batch);
    registerUpdateBatchListener(listener);
    try {
      expect(() => getUpdater().testApplyChange(
        [quarantinedAddress, survivorAddress],
        [exhausted, healthy],
      )).not.toThrow();
    } finally {
      unregisterUpdateBatchListener(listener);
    }

    const [bindings, contextByBinding] = applyChangeFromBindingsMock.mock.calls[0];
    expect(bindings).toEqual([survivorBinding]);
    expect(contextByBinding?.get(survivorBinding)).toBe(healthy);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("hop limit"),
      expect.objectContaining({ transactionId: 999, hop: MAX_PROPAGATION_HOPS }),
    );
    expect(events.filter((event) => event.type.startsWith("propagation:"))).toEqual([
      expect.objectContaining({ type: "propagation:hop-limit", transactionId: 999 }),
    ]);
    // quarantine された address も drain バッチ通知には含まれる（state 値は適用済み）
    expect(batches[0]?.has(quarantinedAddress)).toBe(true);

    // sink なしでも quarantine は診断ログ付きで機能する
    setDevtoolsSink(null);
    getUpdater().testApplyChange([quarantinedAddress], [exhausted]);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
    node.remove();
    survivor.remove();
  });

  it("context なしの enqueue は従来どおり 1 引数で applyChangeFromBindings を呼ぶこと", () => {
    const node = document.createElement("input");
    document.body.append(node);
    const binding = createBinding(node, "legacy");
    const address = createAbsAddress("legacy");
    registeredAddresses.push(address);
    addBindingByAbsoluteStateAddress(address, binding);

    getUpdater().testApplyChange([address]);

    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([binding]);
    node.remove();
  });
});
