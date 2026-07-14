import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("../src/stateElementByName", () => ({ getStateElementByName: vi.fn(() => mocks.stateElement) }));
vi.mock("../src/event/handler", () => ({ attachEventHandler: mocks.attachEvent, detachEventHandler: mocks.detachEvent }));
vi.mock("../src/event/eventTokenHandler", () => ({ attachEventTokenHandler: mocks.attachToken, detachEventTokenHandler: mocks.detachToken }));
vi.mock("../src/event/twowayHandler", () => ({ attachTwowayEventHandler: mocks.attachTwoway, detachTwowayEventHandler: mocks.detachTwoway }));
vi.mock("../src/event/radioHandler", () => ({ attachRadioEventHandler: mocks.attachRadio, detachRadioEventHandler: mocks.detachRadio }));
vi.mock("../src/event/checkboxHandler", () => ({ attachCheckboxEventHandler: mocks.attachCheckbox, detachCheckboxEventHandler: mocks.detachCheckbox }));

import { BindingSession, getBindingSession, getOrCreateBindingSession } from "../src/bindings/BindingSession";

function createBinding(node = document.createElement("input"), overrides: Partial<IBindingInfo> = {}): IBindingInfo {
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
  });

  afterEach(() => vi.unstubAllGlobals());

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
    const addressCleanup = Array.from(record.teardowns)[1] as () => void;
    addressCleanup();
    session.disposeBinding(binding);
    session.disposeBinding(binding);
    session.disposeBinding(createBinding());
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
    vi.stubGlobal("WeakRef", class {
      deref(): undefined { return undefined; }
    });
    const deadRoot = document.createElement("div").attachShadow({ mode: "open" });
    new BindingSession(deadRoot);
    deliver([{ removedNodes: [], addedNodes: [] } as any]);
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
});
