import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IBindingInfo } from "../src/types";

const mocks = vi.hoisted(() => ({
  getStateElementByName: vi.fn(),
}));

vi.mock("../src/stateElementByName", () => ({
  getStateElementByName: mocks.getStateElementByName,
}));

import { getPathInfo } from "../src/address/PathInfo";
import {
  commitProducerValue,
  hasInitialSyncModifier,
  resolveInitialAuthority,
  resolveInitialSyncPolicy,
} from "../src/bindings/initialSync";
import { setConfig } from "../src/config";
import { setLoopContextSymbol } from "../src/proxy/symbols";

let sequence = 0;

function nextTag(label: string): string {
  sequence += 1;
  return `x-initial-sync-${label}-${sequence}`;
}

function declaration(properties: readonly any[], inputs?: readonly any[]): any {
  return {
    protocol: "wc-bindable",
    version: 1,
    properties,
    ...(typeof inputs === "undefined" ? {} : { inputs }),
  };
}

function createBinding(
  node: Element,
  overrides: Partial<IBindingInfo> = {},
): IBindingInfo {
  return {
    propName: "value",
    propSegments: ["value"],
    propModifiers: [],
    statePathName: "target",
    statePathInfo: getPathInfo("target"),
    stateName: "default",
    inFilters: [],
    outFilters: [],
    node,
    replaceNode: node,
    bindingType: "prop",
    uuid: null,
    ...overrides,
  } as IBindingInfo;
}

describe("initialSync policy resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConfig({ enableDirectionalInitialSync: true });
  });

  afterEach(() => {
    setConfig({ enableDirectionalInitialSync: false });
    document.body.replaceChildren();
  });

  it("feature flag 無効時は modifier なしなら既定 policy を返すこと", () => {
    setConfig({ enableDirectionalInitialSync: false });
    const binding = createBinding(document.createElement("div"));
    expect(resolveInitialSyncPolicy(binding)).toEqual({
      authority: "state",
      syncOn: "call",
      observable: false,
    });
    expect(hasInitialSyncModifier(binding)).toBe(false);
  });

  it("flag modifier は無視し key=value だけを解釈すること", () => {
    const binding = createBinding(document.createElement("div"), {
      propModifiers: ["ro", "init=none"],
    });
    expect(hasInitialSyncModifier(binding)).toBe(true);
    expect(resolveInitialSyncPolicy(binding)).toEqual({
      authority: "none",
      syncOn: "call",
      observable: false,
    });
  });

  it("未知の key=value / 重複 / 不正値を診断すること", () => {
    const node = document.createElement("div");
    expect(() => resolveInitialSyncPolicy(createBinding(node, { propModifiers: ["foo=bar"] })))
      .toThrow(/Unknown binding modifier/);
    expect(() => resolveInitialSyncPolicy(createBinding(node, { propModifiers: ["init=state", "init=element"] })))
      .toThrow(/only be specified once/);
    expect(() => resolveInitialSyncPolicy(createBinding(node, { propModifiers: ["init=bogus"] })))
      .toThrow(/Invalid init modifier value/);
    expect(() => resolveInitialSyncPolicy(createBinding(node, { propModifiers: ["sync=later"] })))
      .toThrow(/Invalid sync modifier value/);
  });

  it("event binding は init=none のみ許可すること", () => {
    const node = document.createElement("button");
    expect(resolveInitialSyncPolicy(createBinding(node, { bindingType: "event", propName: "onclick" })))
      .toEqual({ authority: "none", syncOn: "call", observable: false });
    expect(resolveInitialSyncPolicy(createBinding(node, {
      bindingType: "event",
      propName: "onclick",
      propModifiers: ["init=none"],
    }))).toEqual({ authority: "none", syncOn: "call", observable: false });
    expect(() => resolveInitialSyncPolicy(createBinding(node, {
      bindingType: "event",
      propName: "onclick",
      propModifiers: ["init=element"],
    }))).toThrow(/Event bindings only allow init=none/);
  });

  it("prop 以外の binding type は state / none だけを許可すること", () => {
    const node = document.createTextNode("") as unknown as Element;
    expect(resolveInitialSyncPolicy(createBinding(node, { bindingType: "text", propName: "text" })))
      .toEqual({ authority: "state", syncOn: "call", observable: false });
    expect(resolveInitialSyncPolicy(createBinding(node, {
      bindingType: "text",
      propName: "text",
      propModifiers: ["init=none"],
    }))).toEqual({ authority: "none", syncOn: "call", observable: false });
    expect(() => resolveInitialSyncPolicy(createBinding(node, {
      bindingType: "text",
      propName: "text",
      propModifiers: ["init=element"],
    }))).toThrow(/does not support init=element/);
  });

  it("wcBindable 宣言のない要素は既定 state・非 observable になること", () => {
    const node = document.createElement("div");
    expect(resolveInitialSyncPolicy(createBinding(node))).toEqual({
      authority: "state",
      syncOn: "call",
      observable: false,
    });
    expect(resolveInitialSyncPolicy(createBinding(node, { propModifiers: ["init=element"] })))
      .toEqual({ authority: "element", syncOn: "call", observable: false });
  });

  it("wcBindable 宣言外の member と input-only member の sync=connect を診断すること", () => {
    const tag = nextTag("contract");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration(
        [{ name: "output", event: "output-change" }],
        [{ name: "input" }],
      );
    });
    const node = document.createElement(tag);
    expect(() => resolveInitialSyncPolicy(createBinding(node, { propName: "undeclared" })))
      .toThrow(/not declared by wcBindable/);
    expect(() => resolveInitialSyncPolicy(createBinding(node, {
      propName: "input",
      propModifiers: ["sync=connect"],
    }))).toThrow(/sync=connect requires observable property/);
  });

  it("input-only member は state authority・非 observable になること", () => {
    const tag = nextTag("input-only");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = declaration([], [{ name: "value" }]);
    });
    const node = document.createElement(tag);
    expect(resolveInitialSyncPolicy(createBinding(node))).toEqual({
      authority: "state",
      syncOn: "call",
      observable: false,
    });
  });
});

describe("initialSync authority resolution and commit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConfig({ enableDirectionalInitialSync: true });
  });

  afterEach(() => {
    setConfig({ enableDirectionalInitialSync: false });
  });

  it("auto 解決時に state element が見つからなければエラーになること", () => {
    mocks.getStateElementByName.mockReturnValue(null);
    const binding = createBinding(document.createElement("div"));
    expect(() => resolveInitialAuthority(binding, "auto"))
      .toThrow(/not found for binding/);
  });

  it("auto 以外の authority はそのまま返すこと", () => {
    const binding = createBinding(document.createElement("div"));
    expect(resolveInitialAuthority(binding, "element")).toBe("element");
    expect(mocks.getStateElementByName).not.toHaveBeenCalled();
  });

  it("commitProducerValue は in filter を通して state へ書き込むこと", () => {
    const state: Record<PropertyKey, any> = {
      [setLoopContextSymbol]: (_context: unknown, callback: () => unknown) => callback(),
    };
    mocks.getStateElementByName.mockReturnValue({
      createState: (_mutability: string, callback: (target: any) => void) => callback(state),
    });
    const binding = createBinding(document.createElement("div"), {
      inFilters: [{ filterName: "suffix", args: [], filterFn: (value: any) => `${value}!` } as any],
    });
    commitProducerValue(binding, "raw");
    expect(state.target).toBe("raw!");
  });

  it("commitProducerValue は state element 不在をエラーにすること", () => {
    mocks.getStateElementByName.mockReturnValue(null);
    const binding = createBinding(document.createElement("div"));
    expect(() => commitProducerValue(binding, "value"))
      .toThrow(/not found for initial binding sync/);
  });
});
