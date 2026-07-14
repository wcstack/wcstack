import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IBindingInfo } from "../src/types";
import type { IPropagationContext } from "../src/propagation/types";

const mocks = vi.hoisted(() => ({
  writes: [] as Array<{ path: string; value: unknown; context: IPropagationContext | null }>,
}));

vi.mock("../src/stateElementByName", () => ({
  getStateElementByName: vi.fn(() => ({
    createState: (_mutability: string, callback: (state: any) => void) => callback(stateProxy),
  })),
}));

import { setConfig } from "../src/config";
import { setDevtoolsSink } from "../src/devtools/sink";
import type { DevtoolsEvent } from "../src/devtools/types";
import { attachTwowayEventHandler, detachTwowayEventHandler } from "../src/event/twowayHandler";
import { getPathInfo } from "../src/address/PathInfo";
import {
  beginPropagationTransaction,
  extendPropagationContext,
  getCurrentPropagationContext,
  getEdgeId,
  getWireId,
  runWithPropagationContext,
  runWithWriteReceipt,
} from "../src/propagation/propagation";
import { setLoopContextSymbol } from "../src/proxy/symbols";

const stateTarget: Record<PropertyKey, any> = {
  [setLoopContextSymbol]: (_loopContext: unknown, callback: () => unknown) => callback(),
};
const stateProxy = new Proxy(stateTarget, {
  set(target, key, value) {
    mocks.writes.push({
      path: String(key),
      value,
      context: getCurrentPropagationContext(),
    });
    return Reflect.set(target, key, value);
  },
});

let sequence = 0;

function defineProducer(): string {
  sequence += 1;
  const tag = `x-propagation-producer-${sequence}`;
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties: [
        { name: "value", event: "value-change", getter: (event: Event) => (event as CustomEvent).detail },
      ],
      inputs: [{ name: "value" }],
    };
    value: unknown;
  });
  return tag;
}

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

function dispatchValueChange(node: Element, detail: unknown): void {
  node.dispatchEvent(new CustomEvent("value-change", { detail }));
}

describe("twowayHandler propagation", () => {
  const attached: IBindingInfo[] = [];
  const events: DevtoolsEvent[] = [];

  function attach(statePathName: string): { node: HTMLElement; binding: IBindingInfo } {
    const node = document.createElement(defineProducer());
    document.body.append(node);
    const binding = createBinding(node, statePathName);
    attachTwowayEventHandler(binding);
    attached.push(binding);
    return { node, binding };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writes.length = 0;
    events.length = 0;
    setConfig({ enablePropagationContext: true });
    setDevtoolsSink((event) => events.push(event));
  });

  afterEach(() => {
    for (const binding of attached.splice(0)) {
      detachTwowayEventHandler(binding);
      (binding.node as Element).remove();
    }
    setDevtoolsSink(null);
    setConfig({ enablePropagationContext: false });
    for (const key of Object.keys(stateTarget)) {
      delete stateTarget[key];
    }
  });

  it("同じ setter scope 内の Object.is 同値通知は confirmation として抑止すること", () => {
    const { node } = attach("confirmed");
    const wireId = getWireId(node, "value", "default", "confirmed");

    runWithWriteReceipt(node, "value", "written", wireId, 100, () => {
      dispatchValueChange(node, "written");
    });

    expect(mocks.writes).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "propagation:suppressed",
        reason: "confirmation",
        transactionId: 100,
        member: "value",
      }),
    ]);
  });

  it("confirmation は非 primitive の echo も抑止すること（same-value guard の外側）", () => {
    const { node } = attach("objectEcho");
    const payload = { latest: true };
    const wireId = getWireId(node, "value", "default", "objectEcho");

    runWithWriteReceipt(node, "value", payload, wireId, 101, () => {
      dispatchValueChange(node, payload);
    });

    expect(mocks.writes).toEqual([]);
  });

  it("shadow diagnostic が same-value guard との一致/不一致を可視化すること", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    setConfig({ debug: true });
    setDevtoolsSink(null); // sink なしの confirmation 経路も同時に検証
    try {
      const { node } = attach("shadowDiag");
      const wireId = getWireId(node, "value", "default", "shadowDiag");

      // primitive: guard も同じ結論（一致）
      runWithWriteReceipt(node, "value", "primitive", wireId, 110, () => {
        dispatchValueChange(node, "primitive");
      });
      // null: guard の対象（一致）
      runWithWriteReceipt(node, "value", null, wireId, 111, () => {
        dispatchValueChange(node, null);
      });
      // object: provenance だけが守る echo（不一致）
      const payload = { deep: true };
      runWithWriteReceipt(node, "value", payload, wireId, 112, () => {
        dispatchValueChange(node, payload);
      });
      // sameValueGuard opt-out 時は primitive でも provenance だけが守る
      setConfig({ sameValueGuard: false });
      runWithWriteReceipt(node, "value", "unguarded", wireId, 113, () => {
        dispatchValueChange(node, "unguarded");
      });

      expect(mocks.writes).toEqual([]);
      const flags = debugSpy.mock.calls
        .filter(([message]) => String(message).includes("confirmation"))
        .map(([, detail]) => (detail as { coveredBySameValueGuard: boolean }).coveredBySameValueGuard);
      expect(flags).toEqual([true, true, false, false]);
    } finally {
      setConfig({ debug: false, sameValueGuard: true });
      debugSpy.mockRestore();
    }
  });

  it("setter scope 内の異なる値は正規化差分として新しい edge で継続すること", () => {
    const { node } = attach("normalized");
    const wireId = getWireId(node, "value", "default", "normalized");
    const outerContext = extendPropagationContext(
      beginPropagationTransaction(wireId),
      getEdgeId(wireId, "to-element"),
    );

    runWithPropagationContext(outerContext, () => {
      runWithWriteReceipt(node, "value", " raw ", wireId, outerContext.transactionId, () => {
        dispatchValueChange(node, "raw");
      });
    });

    expect(mocks.writes).toHaveLength(1);
    expect(mocks.writes[0].path).toBe("normalized");
    expect(mocks.writes[0].value).toBe("raw");
    // state への commit は to-state edge を通過した拡張 context の下で行われる
    const commitContext = mocks.writes[0].context;
    expect(commitContext).not.toBeNull();
    expect(commitContext!.transactionId).toBe(outerContext.transactionId);
    expect(commitContext!.hop).toBe(outerContext.hop + 1);
    expect(commitContext!.visitedEdges.has(getEdgeId(wireId, "to-state"))).toBe(true);
    expect(commitContext!.visitedEdges.has(getEdgeId(wireId, "to-element"))).toBe(true);
  });

  it("同じ transaction が同じ element→state edge を再度通る場合は抑止すること", () => {
    const { node } = attach("edgeSuppressed");
    const wireId = getWireId(node, "value", "default", "edgeSuppressed");
    const visited = extendPropagationContext(
      beginPropagationTransaction(wireId),
      getEdgeId(wireId, "to-state"),
    );

    runWithPropagationContext(visited, () => {
      dispatchValueChange(node, "looped");
    });

    expect(mocks.writes).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "propagation:suppressed",
        reason: "visited-edge",
        transactionId: visited.transactionId,
        edgeId: getEdgeId(wireId, "to-state"),
      }),
    ]);

    // sink なしでも抑止自体は同じに機能する
    setDevtoolsSink(null);
    runWithPropagationContext(visited, () => {
      dispatchValueChange(node, "looped-again");
    });
    expect(mocks.writes).toEqual([]);
  });

  it("scope 終了後に届いた同値 event は stale receipt で confirmation にしないこと", () => {
    const { node } = attach("lateEvent");
    const wireId = getWireId(node, "value", "default", "lateEvent");

    runWithWriteReceipt(node, "value", "same", wireId, 102, () => undefined);
    dispatchValueChange(node, "same");

    expect(mocks.writes).toHaveLength(1);
    expect(mocks.writes[0].value).toBe("same");
    // 外部 event なので新しい transaction が始まり to-state edge を通過する
    expect(mocks.writes[0].context?.hop).toBe(1);
    expect(mocks.writes[0].context?.visitedEdges.has(getEdgeId(wireId, "to-state"))).toBe(true);
  });

  it("同一 payload の複数 occurrence は dedupe しないこと", () => {
    const { node } = attach("occurrences");

    dispatchValueChange(node, "same-payload");
    dispatchValueChange(node, "same-payload");

    expect(mocks.writes).toHaveLength(2);
    // 別々の外部 event は別 transaction
    expect(mocks.writes[0].context?.transactionId).not.toBe(mocks.writes[1].context?.transactionId);
  });

  it("feature flag 無効時は context を張らず従来経路で書き込むこと", () => {
    setConfig({ enablePropagationContext: false });
    const { node } = attach("legacyPath");

    runWithWriteReceipt(node, "value", "same", 1, 103, () => {
      dispatchValueChange(node, "same");
    });

    expect(mocks.writes).toHaveLength(1);
    expect(mocks.writes[0].context).toBeNull();
  });
});
