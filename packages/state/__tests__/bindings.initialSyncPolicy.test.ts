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
import { resolveInitialSyncPolicy } from "../src/bindings/initialSync";
import { createWcBindable } from "../src/dcc/wcBindable";
import { setConfig } from "../src/config";
import { __private__ as twowayPrivate } from "../src/event/twowayHandler";
import { hasByAddressSymbol, setLoopContextSymbol } from "../src/proxy/symbols";

let sequence = 0;
const sessions: BindingSession[] = [];

function nextTag(label: string): string {
  sequence += 1;
  return `x-phase2-${label}-${sequence}`;
}

function declaration(properties: readonly any[], inputs?: readonly any[]): any {
  return {
    protocol: "wc-bindable",
    version: 1,
    properties,
    ...(typeof inputs === "undefined" ? {} : { inputs }),
  };
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

describe("BindingSession Phase 2 initial synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    mocks.state = {
      [setLoopContextSymbol]: (_context: unknown, callback: () => unknown) => callback(),
      [hasByAddressSymbol]: (address: any) => address.pathInfo.path in mocks.state,
    };
    setConfig({ enableDirectionalInitialSync: true });
  });

  afterEach(() => {
    for (const current of sessions.splice(0)) current.dispose();
    setConfig({ enableDirectionalInitialSync: false });
    document.body.replaceChildren();
  });

  it("output-only member は element authority で即時 snapshot を state に入れること", () => {
    const tag = nextTag("output");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration([
        { name: "value", event: "value-change", getter: (event: Event) => (event as CustomEvent).detail },
      ]);
      value: unknown = "element";
    });
    const node = document.createElement(tag) as HTMLElement & { value: unknown };
    document.body.append(node);
    const binding = createBinding(node, "result");

    expect(session().initialize([binding])).toEqual([]);
    expect(mocks.state.result).toBe("element");

    node.dispatchEvent(new CustomEvent("value-change", { detail: "event" }));
    expect(mocks.state.result).toBe("event");
  });

  it("双方向 member は既定で state authority、auto は未設定だけ element authority にすること", () => {
    const tag = nextTag("both");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration(
        [{ name: "value", event: "value-change" }],
        [{ name: "value" }],
      );
      value: unknown = "element";
    });
    const stateNode = document.createElement(tag) as HTMLElement & { value: unknown };
    const autoNode = document.createElement(tag) as HTMLElement & { value: unknown };
    const explicitUndefinedNode = document.createElement(tag) as HTMLElement & { value: unknown };
    document.body.append(stateNode, autoNode, explicitUndefinedNode);
    mocks.state.saved = "state";
    mocks.state.explicitUndefined = undefined;

    const stateBinding = createBinding(stateNode, "saved");
    const autoBinding = createBinding(autoNode, "missing", ["init=auto"]);
    const explicitUndefinedBinding = createBinding(explicitUndefinedNode, "explicitUndefined", ["init=auto"]);
    const initialized = session().initialize([stateBinding, autoBinding, explicitUndefinedBinding]);

    expect(initialized).toEqual([stateBinding, explicitUndefinedBinding]);
    expect(mocks.state.saved).toBe("state");
    expect(mocks.state.missing).toBe("element");
    expect("explicitUndefined" in mocks.state).toBe(true);
    expect(mocks.state.explicitUndefined).toBeUndefined();
  });

  it("sync=connect は接続前 event の後に接続時 snapshot を配送すること", async () => {
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

    node.dispatchEvent(new CustomEvent("value-change", { detail: "event-before-connect" }));
    expect(mocks.state.connectedValue).toBe("event-before-connect");
    node.value = "connected-snapshot";
    document.body.append(node);
    await flushMutations();

    expect(mocks.state.connectedValue).toBe("connected-snapshot");
  });

  it("sync=call の getter 中 event は stale snapshot より優先すること", () => {
    const tag = nextTag("read-event");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration([
        { name: "value", event: "value-change", getter: (event: Event) => (event as CustomEvent).detail },
      ]);
      get value(): unknown {
        this.dispatchEvent(new CustomEvent("value-change", { detail: "event-during-read" }));
        return "stale-snapshot";
      }
    });
    const node = document.createElement(tag);
    document.body.append(node);

    session().initialize([createBinding(node, "race")]);
    expect(mocks.state.race).toBe("event-during-read");
  });

  it("cohort 全 listener が attach 済みになってから state sweep を開始できること", () => {
    const targetTag = nextTag("cohort-target");
    customElements.define(targetTag, class extends HTMLElement {
      static wcBindable = declaration(
        [{ name: "value", event: "value-change", getter: (event: Event) => (event as CustomEvent).detail }],
        [{ name: "value" }],
      );
      value: unknown;
    });
    const target = document.createElement(targetTag) as HTMLElement & { value: unknown };
    const sourceTag = nextTag("cohort-source");
    customElements.define(sourceTag, class extends HTMLElement {
      static wcBindable = declaration(
        [{ name: "value", event: "value-change" }],
        [{ name: "value" }],
      );
      set value(_value: unknown) {
        target.dispatchEvent(new CustomEvent("value-change", { detail: "from-source-setter" }));
      }
      get value(): unknown { return undefined; }
    });
    const source = document.createElement(sourceTag) as HTMLElement & { value: unknown };
    document.body.append(source, target);
    mocks.state.source = "initial-source";
    mocks.state.target = "initial-target";
    const sourceBinding = createBinding(source, "source");
    const targetBinding = createBinding(target, "target");

    const stateSweep = session().initialize([sourceBinding, targetBinding]);
    expect(stateSweep).toEqual([sourceBinding, targetBinding]);
    for (const binding of stateSweep) {
      (binding.node as any).value = mocks.state[binding.statePathName];
    }

    expect(mocks.state.target).toBe("from-source-setter");
    expect(target.value).toBe("from-source-setter");
  });

  it("wcs-defined 型の output は監視完了 Promise を待たず現在値を読むこと", () => {
    const tag = nextTag("defined-monitor");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration([
        { name: "value", event: "wcs-defined:change", getter: (event: Event) => (event as CustomEvent).detail.value },
      ]);
      value = false;
      connectedCallbackPromise = new Promise<void>(() => undefined);
    });
    const node = document.createElement(tag);
    document.body.append(node);

    session().initialize([createBinding(node, "ready")]);
    expect(mocks.state.ready).toBe(false);
  });

  it("feature flag 無効時は initialize が key=value modifier を診断すること", () => {
    setConfig({ enableDirectionalInitialSync: false });
    const node = document.createElement("div");
    document.body.append(node);
    const binding = createBinding(node, "flagOff", ["init=element"]);

    expect(() => session().initialize([binding])).toThrow(/enableDirectionalInitialSync/);
  });

  it("未管理 binding・他 session・素通し条件では state 適用を許可すること", () => {
    const foreign = createBinding(document.createElement("div"), "foreign");
    const owner = session();
    const other = session();
    expect(other.shouldApplyState(foreign)).toBe(true);
    expect(owner.initialize([foreign])).toEqual([foreign]);
    expect(other.shouldApplyState(foreign)).toBe(true);

    const plain = createBinding(document.createElement("div"), "plain");
    owner.initialize([plain], { registerAddress: false });
    expect(owner.shouldApplyState(plain)).toBe(true);

    const waitingNode = document.createElement(nextTag("waiting"));
    const waiting = createBinding(waitingNode, "waiting");
    expect(owner.initialize([waiting])).toEqual([waiting]);
    expect(owner.getRecord(waiting)?.phase).toBe("waiting-definition");
    // 定義待ちのまま再 initialize しても settle を試みず素通しのままであること
    // （既存 record は新規初期化扱いにならないため戻り値には含まれない）
    expect(owner.initialize([waiting])).toEqual([]);
    expect(owner.getRecord(waiting)?.phase).toBe("waiting-definition");
    expect(owner.shouldApplyState(waiting)).toBe(true);
  });

  it("宣言済み output でも instance に property が無ければ snapshot を読まないこと", () => {
    const tag = nextTag("no-property");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration([
        { name: "value", event: "value-change", getter: (event: Event) => (event as CustomEvent).detail },
      ]);
      // 宣言だけ存在し、instance には value プロパティを持たない
    });
    const node = document.createElement(tag);
    document.body.append(node);
    const binding = createBinding(node, "absentSnapshot");

    expect(session().initialize([binding])).toEqual([]);
    expect("absentSnapshot" in mocks.state).toBe(false);
  });

  it("再 initialize では settle 済み record の snapshot を再送しないこと", () => {
    const tag = nextTag("resettle");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration([
        { name: "value", event: "value-change", getter: (event: Event) => (event as CustomEvent).detail },
      ]);
      value: unknown = "first";
    });
    const node = document.createElement(tag) as HTMLElement & { value: unknown };
    document.body.append(node);
    const binding = createBinding(node, "resettled");
    const current = session();

    expect(current.initialize([binding])).toEqual([]);
    expect(mocks.state.resettled).toBe("first");

    node.value = "second";
    expect(current.initialize([binding])).toEqual([]);
    expect(mocks.state.resettled).toBe("first");
  });

  it("接続時 snapshot の読み取り失敗は record を failed にして以後の適用を拒否すること", async () => {
    const tag = nextTag("connect-throw");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration([
        { name: "value", event: "value-change", getter: (event: Event) => (event as CustomEvent).detail },
      ]);
      get value(): unknown { throw new Error("snapshot read failed"); }
    });
    const node = document.createElement(tag);
    const binding = createBinding(node, "brokenConnect", ["sync=connect"]);
    const current = session(document);

    expect(current.initialize([binding])).toEqual([]);
    expect(current.getRecord(binding)?.phase).toBe("active");

    document.body.append(node);
    await flushMutations();

    expect(current.getRecord(binding)?.phase).toBe("failed");
    expect(current.shouldApplyState(binding)).toBe(false);
    expect("brokenConnect" in mocks.state).toBe(false);
  });

  it("dispose 後に届いた producer event / snapshot 読み取りは record を変更しないこと", () => {
    const tag = nextTag("zombie");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration([
        { name: "value", event: "value-change", getter: (event: Event) => (event as CustomEvent).detail },
      ]);
      value: unknown = "element";
    });
    const node = document.createElement(tag) as HTMLElement & { value: unknown };
    document.body.append(node);
    const binding = createBinding(node, "zombie");
    const current = session();
    current.initialize([binding]);
    const record = current.getRecord(binding) as any;
    const observers = twowayPrivate.producerValueObserversByNode.get(node)?.get("value");
    const zombieObserver = typeof observers === "undefined" ? undefined : [...observers][0];
    expect(zombieObserver).toBeDefined();

    current.dispose();

    const sequenceBefore = record.eventSequence;
    zombieObserver!("late-event");
    expect(record.eventSequence).toBe(sequenceBefore);
    expect(record.producerValue).toBe("element");

    (current as any).readProducerSnapshot(record, false);
    expect(record.producerValue).toBe("element");
  });

  it("契約に反する authority と feature flag 無効時の key=value を診断すること", () => {
    const tag = nextTag("contract");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration([{ name: "value", event: "value-change" }]);
      value = "output";
    });
    const node = document.createElement(tag);
    document.body.append(node);
    expect(() => session().initialize([createBinding(node, "bad", ["init=state"])]))
      .toThrow(/incompatible/);

    setConfig({ enableDirectionalInitialSync: false });
    expect(() => resolveInitialSyncPolicy(createBinding(node, "disabled", ["sync=connect"])))
      .toThrow(/enableDirectionalInitialSync/);
  });

  it("command-token 配線(propSegments[0]===command)は wcBindable 検証を経ず state authority を返すこと", () => {
    // bindingType は "prop" だが propName は wcBindable property ではない。
    // directional 有効下で declaration 検証(未宣言なら raiseError)に掛からず、
    // 現行互換の state authority を無同期で返すことを固定する。
    const tag = nextTag("command");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration([{ name: "value", event: "value-change" }]);
    });
    const node = document.createElement(tag);
    document.body.append(node);
    const commandBinding = {
      ...createBinding(node, "fetchResult"),
      propName: "command.fetch",
      propSegments: ["command", "fetch"],
    };

    expect(() => resolveInitialSyncPolicy(commandBinding)).not.toThrow();
    expect(resolveInitialSyncPolicy(commandBinding)).toEqual({
      authority: "state",
      syncOn: "call",
      observable: false,
    });
  });

  it("DCC $bindables member は既定で state authority になり、DCC 初期値が親 state を上書きしないこと", () => {
    // v1.21.0 回帰: createWcBindable が inputs を生成せず $bindables が output-only
    // 判定になり、親 state → DCC 書き込みの恒久抑止と DCC 初期値の親 state への
    // 逆流(commitProducerValue)が起きていた。
    const tag = nextTag("dcc");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = createWcBindable(tag, ["count"]);
      _count: unknown = 0;
      get count(): unknown { return this._count; }
      set count(value: unknown) { this._count = value; }
    });
    const node = document.createElement(tag) as HTMLElement & { count: unknown };
    document.body.append(node);
    mocks.state.parentCount = 42;
    const binding = { ...createBinding(node, "parentCount"), propName: "count", propSegments: ["count"] };

    expect(resolveInitialSyncPolicy(binding)).toEqual({
      authority: "state",
      syncOn: "call",
      observable: true,
    });
    const current = session();
    expect(current.initialize([binding])).toEqual([binding]);
    expect(mocks.state.parentCount).toBe(42);
    expect(current.shouldApplyState(binding)).toBe(true);
  });

  it("DCC member には init=state / element / auto すべてを明示できること", () => {
    const tag = nextTag("dcc-modifiers");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = createWcBindable(tag, ["count"]);
      count: unknown = 0;
    });
    const node = document.createElement(tag);
    document.body.append(node);
    for (const authority of ["state", "element", "auto"] as const) {
      const binding = {
        ...createBinding(node, "dccModifier"),
        propName: "count",
        propSegments: ["count"],
        propModifiers: [`init=${authority}`],
      };
      expect(() => resolveInitialSyncPolicy(binding)).not.toThrow();
    }
  });
});
