import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IBindingInfo } from "../src/types";
import { setConfig } from "../src/config";

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
  attachToken: vi.fn(() => false),
  detachToken: vi.fn(),
  attachTwoway: vi.fn(),
  detachTwoway: vi.fn(),
  attachRadio: vi.fn(() => false),
  detachRadio: vi.fn(),
  attachCheckbox: vi.fn(() => false),
  detachCheckbox: vi.fn(),
}));

vi.mock("../src/getCustomElement", () => ({ getCustomElement: vi.fn(() => mocks.customTag) }));
vi.mock("../src/platform/customElementRegistry", () => ({
  getCustomElementRegistry: vi.fn(() => mocks.registry),
  upgradeCustomElement: vi.fn((registry: any, node: Node) => registry.upgrade?.(node)),
}));
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
vi.mock("../src/stateElementByName", () => ({ getStateElement: vi.fn(() => mocks.stateElement) }));
vi.mock("../src/event/handler", () => ({ attachEventHandler: mocks.attachEvent, detachEventHandler: mocks.detachEvent }));
vi.mock("../src/event/eventTokenHandler", () => ({ attachEventTokenHandler: mocks.attachToken, detachEventTokenHandler: mocks.detachToken }));
vi.mock("../src/event/twowayHandler", () => ({ attachTwowayEventHandler: mocks.attachTwoway, detachTwowayEventHandler: mocks.detachTwoway, addTwowayValueObserver: vi.fn(() => vi.fn()) }));
vi.mock("../src/event/radioHandler", () => ({ attachRadioEventHandler: mocks.attachRadio, detachRadioEventHandler: mocks.detachRadio }));
vi.mock("../src/event/checkboxHandler", () => ({ attachCheckboxEventHandler: mocks.attachCheckbox, detachCheckboxEventHandler: mocks.detachCheckbox }));

import { BindingSession, getBindingSession, getOrCreateBindingSession } from "../src/bindings/BindingSession";
import { getDefinitionCoordinator } from "../src/bindings/DefinitionCoordinator";

function createBinding(node = document.createElement("input"), overrides: Partial<IBindingInfo> = {}): IBindingInfo {
  return {
    propName: "value",
    propSegments: ["value"],
    propModifiers: [],
    statePathName: "value",
    statePathInfo: { path: "value", wildcardCount: 0 } as any,
    inFilters: [],
    outFilters: [],
    node,
    replaceNode: node,
    bindingType: "prop",
    ...overrides,
  };
}

function definedRegistry(): any {
  return { get: vi.fn(() => class {}), whenDefined: vi.fn(), upgrade: vi.fn() };
}

describe("BindingSession defensive branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customTag = null;
    mocks.registry = definedRegistry();
    mocks.stateElement = { setPathInfo: vi.fn() };
    mocks.attachEvent.mockReturnValue(false);
    mocks.attachToken.mockReturnValue(false);
    mocks.attachRadio.mockReturnValue(false);
    mocks.attachCheckbox.mockReturnValue(false);
    mocks.attachTwoway.mockImplementation(() => undefined);
    mocks.getAddress.mockImplementation(() => ({ path: "value" }));
    // flag 非依存の lifecycle 分岐テスト。OFF を明示して非 directional 経路を網羅
    // （directional path は initialSyncPolicy / initialSync.unit が担当）。
    setConfig({ enableDirectionalInitialSync: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setConfig({ enableDirectionalInitialSync: true });
  });

  it("event/eventToken/radio/checkbox cleanup と filter key を所有すること", () => {
    const eventSession = new BindingSession();
    mocks.attachEvent.mockReturnValueOnce(true);
    const eventBinding = createBinding(undefined, {
      bindingType: "event",
      inFilters: [{ filterName: "in", args: ["1"], filterFn: vi.fn() }],
      outFilters: [{ filterName: "out", args: ["2"], filterFn: vi.fn() }],
    });
    eventSession.initialize([eventBinding]);
    eventSession.dispose();
    expect(mocks.detachEvent).toHaveBeenCalledTimes(1);

    const tokenSession = new BindingSession();
    mocks.attachToken.mockReturnValueOnce(true);
    const tokenBinding = createBinding(undefined, { propSegments: ["eventToken", "value"] });
    tokenSession.initialize([tokenBinding], { registerAddress: false });
    tokenSession.dispose();
    expect(mocks.detachToken).toHaveBeenCalledTimes(1);

    const controlsSession = new BindingSession();
    mocks.attachRadio.mockReturnValueOnce(true);
    mocks.attachCheckbox.mockReturnValueOnce(true);
    const controls = createBinding();
    controlsSession.initialize([controls], { registerAddress: false });
    controlsSession.dispose();
    expect(mocks.detachRadio).toHaveBeenCalledTimes(1);
    expect(mocks.detachCheckbox).toHaveBeenCalledTimes(1);
  });

  it("custom definition rejection と upgrade/attach failure を failed record にすること", async () => {
    mocks.customTag = "x-rejected-session";
    mocks.registry = { get: vi.fn(), whenDefined: vi.fn(() => Promise.reject(new Error("rejected"))) };
    const rejectedBinding = createBinding();
    const rejectedSession = new BindingSession();
    rejectedSession.initialize([rejectedBinding], { registerAddress: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(rejectedSession.getRecord(rejectedBinding)?.phase).toBe("failed");

    let define!: (constructor: CustomElementConstructor) => void;
    mocks.customTag = "x-upgrade-fails";
    mocks.registry = {
      get: vi.fn(),
      whenDefined: vi.fn(() => new Promise<CustomElementConstructor>((resolve) => { define = resolve; })),
      upgrade: vi.fn(() => { throw new Error("upgrade failed"); }),
    };
    const failedBinding = createBinding();
    const failedSession = new BindingSession();
    failedSession.initialize([failedBinding], { registerAddress: false });
    define(class extends HTMLElement {});
    await Promise.resolve();
    await Promise.resolve();
    expect(failedSession.getRecord(failedBinding)?.phase).toBe("failed");
  });

  it("generic definition callback/reject/cancel/dispose paths を処理すること", async () => {
    let define!: (constructor: CustomElementConstructor) => void;
    mocks.registry = {
      get: vi.fn(),
      whenDefined: vi.fn(() => new Promise<CustomElementConstructor>((resolve) => { define = resolve; })),
      upgrade: vi.fn(),
    };
    const session = new BindingSession();
    const callbackError = vi.fn();
    session.deferUntilDefined(document.createElement("div"), "x-callback-fails", () => {
      throw new Error("callback failed");
    }, callbackError);
    define(class extends HTMLElement {});
    await Promise.resolve();
    await Promise.resolve();
    expect(callbackError).toHaveBeenCalledTimes(1);

    let rejectDefinition!: (error: unknown) => void;
    mocks.registry = {
      get: vi.fn(),
      whenDefined: vi.fn(() => new Promise<CustomElementConstructor>((_, reject) => { rejectDefinition = reject; })),
    };
    const rejected = vi.fn();
    session.deferUntilDefined(document.createElement("div"), "x-task-rejected", vi.fn(), rejected);
    rejectDefinition(new Error("task rejected"));
    await Promise.resolve();
    await Promise.resolve();
    expect(rejected).toHaveBeenCalledTimes(1);

    let rejectWithDefault!: (error: unknown) => void;
    mocks.registry = {
      get: vi.fn(),
      whenDefined: vi.fn(() => new Promise<CustomElementConstructor>((_, reject) => { rejectWithDefault = reject; })),
    };
    session.deferUntilDefined(document.createElement("div"), "x-default-reject", vi.fn());
    rejectWithDefault(new Error("default reject"));
    await Promise.resolve();
    await Promise.resolve();

    mocks.registry = { get: vi.fn(), whenDefined: vi.fn(() => new Promise(() => undefined)) };
    const cancelNode = document.createElement("div");
    const cancel = session.deferUntilDefined(cancelNode, "x-cancel", vi.fn());
    const secondCancel = session.deferUntilDefined(cancelNode, "x-second-cancel", vi.fn());
    cancel();
    cancel();
    secondCancel();
    session.deferUntilDefined(document.createElement("div"), "x-dispose", vi.fn());
    session.dispose();
  });

  it("platform absence, invalid owner, rejected teardown, address guards を安全に処理すること", () => {
    mocks.customTag = "x-no-registry";
    mocks.registry = null;
    const session = new BindingSession();
    expect(() => session.initialize([createBinding()], { registerAddress: false })).toThrow(/CustomElementRegistry/);
    expect(() => session.deferUntilDefined(document.createElement("div"), "x-no-registry", vi.fn())).toThrow(/CustomElementRegistry/);

    mocks.customTag = null;
    const binding = createBinding(undefined, { bindingType: "event" });
    expect(session.addTeardown(binding, vi.fn())).toBe(false);
    session.initialize([binding]);
    expect(new BindingSession().getRecord(binding)).toBeNull();
    const finalCleanup = vi.fn();
    session.addTeardown(binding, finalCleanup);
    session.addTeardown(binding, () => { throw new Error("cleanup failed"); });
    const record = session.getRecord(binding)!;
    (session as any).registerAddress(record);
    expect((record as any).address).not.toBeNull();
    session.disposeBinding(binding);
    // アドレス台帳解除はデータ駆動（record.address 起点）で dispose 時に 1 回だけ走る
    expect((record as any).address).toBeNull();
    expect(mocks.removeAddress).toHaveBeenCalledTimes(1);
    expect(mocks.clearState).toHaveBeenCalledTimes(1);
    expect(mocks.clearAbsolute).toHaveBeenCalledTimes(1);
    // 二重 dispose・未知 binding は no-op（二重解除しない）
    session.disposeBinding(binding);
    session.disposeBinding(createBinding());
    expect(mocks.removeAddress).toHaveBeenCalledTimes(1);
    // 例外を投げる teardown が居ても他の cleanup（finalCleanup）は完走する
    expect(finalCleanup).toHaveBeenCalledTimes(1);
    expect(mocks.stateElement.setPathInfo).not.toHaveBeenCalled();

    session.observe({ getRootNode: () => null } as any);
    expect(getBindingSession(createBinding())).toBeNull();

    const ownerlessRoot = document.createElement("div").attachShadow({ mode: "open" });
    vi.stubGlobal("MutationObserver", undefined);
    new BindingSession(ownerlessRoot);
    vi.unstubAllGlobals();

    let deliver!: (mutations: MutationRecord[]) => void;
    vi.stubGlobal("MutationObserver", class {
      constructor(callback: (mutations: MutationRecord[]) => void) { deliver = callback; }
      observe(): void {}
    });
    const emptyRoot = document.createElement("div").attachShadow({ mode: "open" });
    new BindingSession(emptyRoot);
    deliver([{ removedNodes: [], addedNodes: [] } as any]);
  });

  it("owner が interested session のみへ per-node 配送すること（単一値→Set昇格を含む）", () => {
    let deliver!: (mutations: MutationRecord[]) => void;
    vi.stubGlobal("MutationObserver", class {
      constructor(callback: (mutations: MutationRecord[]) => void) { deliver = callback; }
      observe(): void {}
    });
    const shadow = document.createElement("div").attachShadow({ mode: "open" });
    const anchor = document.createElement("input");
    const bystander = document.createElement("input");
    shadow.appendChild(anchor);
    shadow.appendChild(bystander);

    const first = createBinding(anchor);
    const second = createBinding(anchor);
    const third = createBinding(anchor);
    const unrelated = createBinding(bystander);
    const firstSession = new BindingSession(shadow);
    const secondSession = new BindingSession();
    const thirdSession = new BindingSession();
    const unrelatedSession = new BindingSession();
    firstSession.initialize([first], { registerAddress: false });
    secondSession.initialize([second], { registerAddress: false });
    thirdSession.initialize([third], { registerAddress: false });
    unrelatedSession.initialize([unrelated], { registerAddress: false });

    // interest の無い node（テキスト）を含むサブツリー削除でも安全に配送されること
    const wrapper = document.createElement("div");
    wrapper.appendChild(document.createTextNode("no interest"));
    shadow.appendChild(wrapper);
    shadow.removeChild(wrapper);
    shadow.removeChild(anchor);
    deliver([
      { removedNodes: [wrapper, anchor], addedNodes: [] } as any,
    ]);
    expect(firstSession.getRecord(first)?.phase).toBe("disposed");
    expect(secondSession.getRecord(second)?.phase).toBe("disposed");
    expect(thirdSession.getRecord(third)?.phase).toBe("disposed");
    expect(unrelatedSession.getRecord(unrelated)?.phase).toBe("active");

    // 再接続: interested な node のみ restart され、applyOnReconnect 分が一括適用される
    shadow.appendChild(anchor);
    deliver([{ removedNodes: [], addedNodes: [anchor, bystander] } as any]);
    expect(firstSession.getRecord(first)?.phase).toBe("active");
    expect(secondSession.getRecord(second)?.phase).toBe("active");
    expect(mocks.apply).toHaveBeenCalledWith(expect.arrayContaining([first, second, third]));

    // root から外れたままの node の追加通知は無視される
    shadow.removeChild(anchor);
    firstSession.disposeBinding(first);
    deliver([{ removedNodes: [], addedNodes: [anchor] } as any]);
    expect(firstSession.getRecord(first)?.phase).toBe("disposed");
  });

  it("session 単体の handleMutations が削除・追加サブツリーを per-node 処理すること", () => {
    const session = new BindingSession();
    const binding = createBinding();
    session.initialize([binding], { registerAddress: false });
    // 追加通知でも root 外なら無視される
    session.handleMutations({ contains: () => false } as any, [], [binding.node]);
    expect(session.getRecord(binding)?.phase).toBe("active");
    session.handleMutations({ contains: () => false } as any, [binding.node], []);
    expect(session.getRecord(binding)?.phase).toBe("disposed");
    // 再接続成功時は applyOnReconnect 分が一括適用される
    session.handleMutations({ contains: () => true } as any, [], [binding.node]);
    expect(session.getRecord(binding)?.phase).toBe("active");
    expect(mocks.apply).toHaveBeenCalledWith([binding]);
  });

  it("reconnect failure、owner final-state branches、root session cache を処理すること", () => {
    const node = document.createElement("input");
    const binding = createBinding(node);
    const session = new BindingSession();
    session.initialize([binding], { registerAddress: false });
    session.disposeBinding(binding);
    mocks.attachTwoway.mockImplementation(() => { throw new Error("reattach failed"); });
    const root = { contains: (candidate: Node) => candidate === node } as any;
    expect(() => session.handleMutations(root, [node], [node])).not.toThrow();
    session.handleMutations({ contains: () => true } as any, [node], [document.createElement("span")]);

    mocks.attachTwoway.mockImplementation(() => undefined);
    const forgottenNode = document.createElement("input");
    const forgottenBinding = createBinding(forgottenNode);
    const forgottenSession = new BindingSession();
    forgottenSession.initialize([forgottenBinding], { registerAddress: false });
    forgottenSession.disposeBinding(forgottenBinding);
    (forgottenSession as any).optionsByBinding.delete(forgottenBinding);
    forgottenSession.handleMutations({ contains: () => true } as any, [], [forgottenNode]);
    expect(forgottenSession.getRecord(forgottenBinding)?.phase).toBe("disposed");

    const rememberedNode = document.createElement("input");
    const remembered = createBinding(rememberedNode);
    const rememberedSession = new BindingSession();
    rememberedSession.initialize([remembered], { registerAddress: false });
    (rememberedSession as any).optionsByBinding.delete(remembered);
    rememberedSession.initialize([createBinding(rememberedNode)], { registerAddress: false });
    rememberedSession.dispose();

    const fallbackSession = new BindingSession();
    const fallbackBinding = createBinding();
    (fallbackSession as any).start(fallbackBinding, {
      registerAddress: false,
      registerPathInfo: false,
      applyOnReconnect: false,
    });
    fallbackSession.dispose();

    const rootNode = document.createDocumentFragment();
    expect(getOrCreateBindingSession(rootNode)).toBe(getOrCreateBindingSession(rootNode));
  });

  /**
   * 束縛ごとの record を持つ session（プランに載らない content）の解体・走査・張り直し。
   * プラン行は行 record 側（bindings.rowSession.branches.test.ts）を通るようになったので、
   * こちらの経路は非プランの content だけが通る。
   */
  it("record を持つ session の destroyRecords / 走査 / 張り直しが record 側で働くこと", () => {
    const session = new BindingSession();
    const live = createBinding();
    const disposed = createBinding();
    session.initialize([live, disposed], { registerAddress: true });
    session.disposeBinding(disposed);

    // 活性なノードだけが走査に出る
    const active: Node[] = [];
    session.forEachActiveBindingNode((node) => active.push(node));
    expect(active).toEqual([live.node]);

    // 張り直しは活性でアドレスを持つ record だけ
    mocks.removeAddress.mockClear();
    const rebound = session.rebindAddresses();
    expect(rebound).toEqual([live]);
    expect(mocks.removeAddress).toHaveBeenCalledTimes(1);

    // wholesale destroy は残った record のアドレスを外して台帳を空にする
    mocks.removeAddress.mockClear();
    session.destroyRecords();
    expect(mocks.removeAddress).toHaveBeenCalledTimes(1);
    expect(session.getRecord(live)?.phase).toBe("disposed");
  });

  it("アドレスを登録していない record と解体済みの record は、張り直しの対象外であること", () => {
    const session = new BindingSession();
    const unregistered = createBinding();
    const disposed = createBinding();
    session.initialize([unregistered, disposed], { registerAddress: false });
    session.disposeBinding(disposed);

    mocks.removeAddress.mockClear();
    expect(session.rebindAddresses()).toEqual([]);
    expect(mocks.removeAddress).not.toHaveBeenCalled();

    // 走査には解体済みだけが出てこない
    const active: Node[] = [];
    session.forEachActiveBindingNode((node) => active.push(node));
    expect(active).toEqual([unregistered.node]);
  });

  it("取り消した定義待ちのコールバックは、後から解決しても何もしないこと", async () => {
    let define!: (constructor: CustomElementConstructor) => void;
    let rejectDefine!: (error: unknown) => void;
    mocks.registry = {
      get: vi.fn(),
      whenDefined: vi.fn(() => new Promise<CustomElementConstructor>((resolve, reject) => {
        define = resolve;
        rejectDefine = reject;
      })),
      upgrade: vi.fn(),
    };
    const node = document.createElement("x-late-session");
    const session = new BindingSession();
    const applied = vi.fn();
    const rejected = vi.fn();
    const cancel = session.deferUntilDefined(node, "x-late-session", applied, rejected);

    cancel();
    define(class extends HTMLElement {});
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).not.toHaveBeenCalled();

    // 取り消した待ちが reject されても同じ（finish が false を返す）
    const other = document.createElement("x-late-session-2");
    const otherSession = new BindingSession();
    const otherRejected = vi.fn();
    const cancelOther = otherSession.deferUntilDefined(other, "x-late-session", vi.fn(), otherRejected);
    cancelOther();
    rejectDefine(new Error("late failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect(otherRejected).not.toHaveBeenCalled();
  });
});

/**
 * 定義待ちの registry を引く時点（#357）と、外れて戻ったノードの待ち直し（#352）。
 * registry はモック（getCustomElementRegistry が mocks.registry を返す）で、引いた時点を差し替えで確かめる。
 */
describe("BindingSession 定義待ちの張り方（#352 / #357）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customTag = null;
  });

  function pendingRegistry(): any {
    let define!: (constructor: CustomElementConstructor) => void;
    const registry = {
      get: vi.fn(),
      whenDefined: vi.fn(() => new Promise<CustomElementConstructor>((resolve) => { define = resolve; })),
      upgrade: vi.fn(),
      define: () => define(class extends HTMLElement {}),
    };
    return registry;
  }

  function connectedNode(): Element {
    const root = document.createElement("div").attachShadow({ mode: "open" });
    const node = document.createElement("x-deferred");
    root.appendChild(node);
    return node;
  }

  const outside = { contains: () => false } as any;
  const inside = { contains: () => true } as any;

  it("DocumentFragment の中のノードは、その場では待たず、次の microtask にその時の registry で待つこと", async () => {
    const before = pendingRegistry();
    const after = pendingRegistry();
    mocks.registry = before;
    const fragment = document.createDocumentFragment();
    const node = fragment.appendChild(document.createElement("x-deferred"));
    const session = new BindingSession();
    const callback = vi.fn();
    session.deferUntilDefined(node, "x-deferred", callback);
    expect(before.whenDefined).not.toHaveBeenCalled();

    // 差し込み先の木で registry が変わる（fragment の中では global、差し込むとスコープ付き）
    mocks.registry = after;
    await Promise.resolve();
    expect(before.whenDefined).not.toHaveBeenCalled();
    expect(after.whenDefined).toHaveBeenCalledTimes(1);
    after.define();
    await Promise.resolve();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(after.upgrade).toHaveBeenCalledWith(node);
  });

  it("microtask の前に取り消した・外れた fragment の中の待ちは張らないこと", async () => {
    mocks.registry = pendingRegistry();
    const fragment = document.createDocumentFragment();
    const cancelled = fragment.appendChild(document.createElement("x-deferred"));
    const removed = fragment.appendChild(document.createElement("x-deferred"));
    const session = new BindingSession();
    session.deferUntilDefined(cancelled, "x-deferred", vi.fn())();
    session.deferUntilDefined(removed, "x-deferred", vi.fn());
    session.handleMutations(outside, [removed], []);
    await Promise.resolve();
    expect(mocks.registry.whenDefined).not.toHaveBeenCalled();
    expect(session.canWholesaleDestroy()).toBe(true);
  });

  it("外れたノードの待ちは registry から下ろし、戻ったらその時の registry で待ち直すこと", async () => {
    const first = pendingRegistry();
    mocks.registry = first;
    const node = connectedNode();
    const session = new BindingSession();
    const callback = vi.fn();
    session.deferUntilDefined(node, "x-deferred", callback);
    expect(getDefinitionCoordinator(first).pendingCount("x-deferred")).toBe(1);

    session.handleMutations(outside, [node], []);
    // 戻らない要素を registry に掴ませない
    expect(getDefinitionCoordinator(first).pendingCount("x-deferred")).toBe(0);
    expect(session.canWholesaleDestroy()).toBe(true);

    const second = pendingRegistry();
    mocks.registry = second;
    session.handleMutations(inside, [], [node]);
    expect(getDefinitionCoordinator(second).pendingCount("x-deferred")).toBe(1);
    // 張ったままの待ちへの追加の通知は、待ちを重ねない
    session.handleMutations(inside, [], [node]);
    expect(second.whenDefined).toHaveBeenCalledTimes(1);
    expect(getDefinitionCoordinator(second).pendingCount("x-deferred")).toBe(1);

    second.define();
    await Promise.resolve();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("同じノードの先の待ちが microtask に並んでいる間は、後の待ちもその後ろに並び、登録順に走ること", async () => {
    const registry = pendingRegistry();
    mocks.registry = registry;
    const fragment = document.createDocumentFragment();
    const node = fragment.appendChild(document.createElement("x-deferred"));
    const session = new BindingSession();
    const order: string[] = [];
    // createContent の fragment の中で登録する待ち（two-way・イベントを付ける側）
    session.deferUntilDefined(node, "x-deferred", () => order.push("attach"));
    // 差し込んだ後の活性化で登録する待ち（値の遅延適用）
    document.createElement("div").attachShadow({ mode: "open" }).appendChild(node);
    session.deferUntilDefined(node, "x-deferred", () => order.push("apply"));
    expect(registry.whenDefined).not.toHaveBeenCalled();

    await Promise.resolve();
    registry.define();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["attach", "apply"]);
  });

  it("fragment の中で並べた two-way・イベントを付ける待ちは、並んでいる間に解体されたら張らず、張るときに registry が無ければ record を failed にすること", async () => {
    mocks.customTag = "x-deferred";
    const registry = pendingRegistry();
    mocks.registry = registry;
    const fragment = document.createDocumentFragment();
    const disposed = createBinding(fragment.appendChild(document.createElement("x-deferred")));
    const orphaned = createBinding(fragment.appendChild(document.createElement("x-deferred")));
    const disposedSession = new BindingSession();
    const orphanedSession = new BindingSession();
    disposedSession.initialize([disposed], { registerAddress: false });
    orphanedSession.initialize([orphaned], { registerAddress: false });
    expect(orphanedSession.getRecord(orphaned)?.phase).toBe("waiting-definition");
    disposedSession.dispose();
    // 差し込んだ先に registry が無い（張るときに引く）
    mocks.registry = null;
    await Promise.resolve();
    expect(registry.whenDefined).not.toHaveBeenCalled();
    expect(orphanedSession.getRecord(orphaned)?.phase).toBe("failed");
  });

  it("外れている間に session ごと解体された待ちは、戻っても張り直さないこと", () => {
    const registry = pendingRegistry();
    mocks.registry = registry;
    const node = connectedNode();
    const session = new BindingSession();
    session.deferUntilDefined(node, "x-deferred", vi.fn());
    session.handleMutations(outside, [node], []);
    session.dispose();
    session.handleMutations(inside, [], [node]);
    expect(registry.whenDefined).toHaveBeenCalledTimes(1);
    expect(getDefinitionCoordinator(registry).pendingCount("x-deferred")).toBe(0);

    // 解体の後に登録した待ちは、外れて戻れば張り直す
    session.deferUntilDefined(node, "x-deferred", vi.fn());
    session.handleMutations(outside, [node], []);
    session.handleMutations(inside, [], [node]);
    expect(getDefinitionCoordinator(registry).pendingCount("x-deferred")).toBe(1);
  });

  it("待ち直すときに registry が無ければ reject へ送り、待ちを済ませること", () => {
    mocks.registry = pendingRegistry();
    const node = connectedNode();
    const session = new BindingSession();
    const rejected = vi.fn();
    session.deferUntilDefined(node, "x-deferred", vi.fn(), rejected);
    session.handleMutations(outside, [node], []);

    mocks.registry = null;
    session.handleMutations(inside, [], [node]);
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(String(rejected.mock.calls[0][0])).toMatch(/CustomElementRegistry is unavailable for <x-deferred>/);
    // 済んだ待ちは次の追加でも張らない
    mocks.registry = pendingRegistry();
    session.handleMutations(inside, [], [node]);
    expect(mocks.registry.whenDefined).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it("行の束縛（applyOnReconnect なし）でも、定義を待ったまま外れたものは戻ったときに適用し直すこと", () => {
    mocks.customTag = "x-deferred";
    mocks.registry = pendingRegistry();
    const waiting = createBinding(connectedNode());
    mocks.customTag = null;
    const plain = createBinding(connectedNode());
    const session = new BindingSession();
    mocks.customTag = "x-deferred";
    session.initialize([waiting], { registerAddress: false, applyOnReconnect: false });
    mocks.customTag = null;
    session.initialize([plain], { registerAddress: false, applyOnReconnect: false });

    session.handleMutations(outside, [waiting.node, plain.node], []);
    mocks.apply.mockClear();
    mocks.customTag = "x-deferred";
    session.handleMutations(inside, [], [waiting.node]);
    mocks.customTag = null;
    session.handleMutations(inside, [], [plain.node]);
    expect(mocks.apply).toHaveBeenCalledTimes(1);
    expect(mocks.apply).toHaveBeenCalledWith([waiting]);
  });
});
