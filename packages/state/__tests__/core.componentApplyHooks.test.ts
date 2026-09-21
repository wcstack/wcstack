import { describe, it, expect, vi } from "vitest";

vi.mock("../src/apply/getValue", () => ({
  getValue: vi.fn(),
}));
vi.mock("../src/bindings/BindingSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bindings/BindingSession")>();
  return { ...actual, getBindingSession: vi.fn(() => null) };
});
vi.mock("../src/binding/getAbsoluteStateAddressByBinding", () => ({
  getAbsoluteStateAddressByBinding: vi.fn(() => ({ absolutePathInfo: {}, listIndex: null })),
  clearAbsoluteStateAddressByBinding: vi.fn(),
}));

import { applyChange } from "../src/apply/applyChange";
import { applyChangeToProperty } from "../src/apply/applyChangeToProperty";
import { getValue } from "../src/apply/getValue";
import { getPathInfo } from "../src/address/PathInfo";
import { componentApplyHooks } from "../src/core/componentApplyHooks";
import { markWebComponentAsComplete, markWebComponentStatePropDeclared } from "../src/webComponent/completeWebComponent";
import { getInjectedKeys, takeOverwrittenObject } from "../src/webComponent/preCompletionWrites";
import type { IBindingInfo } from "../src/types";
import type { IApplyContext } from "../src/apply/types";

/**
 * カスタム要素のプロパティ束縛の受け口（core/componentApplyHooks.ts）の境界。
 * このファイルは bind-component の機能を install しない（＝ 分割エントリで scopes を入れないページ）。
 */
const context = { stateName: "default", stateElement: {} as any, state: {} as any, appliedBindingSet: new Set() } as IApplyContext;

let counter = 0;
function createCustomElement(): any {
  const tag = `cah-card-${++counter}`;
  customElements.define(tag, class extends HTMLElement {});
  return document.createElement(tag);
}

function binding(node: Element, propSegments: string[]): IBindingInfo {
  return {
    propName: propSegments.join("."),
    propSegments,
    propModifiers: [],
    statePathName: "user",
    statePathInfo: getPathInfo("user"),
    outFilters: [],
    inFilters: [],
    bindingType: "prop",
    uuid: null,
    node,
    replaceNode: node,
  } as IBindingInfo;
}

describe("core/componentApplyHooks — bind-component 未 install", () => {
  it("受け口は空であること", () => {
    expect(componentApplyHooks).toBeNull();
  });

  it("カスタム要素のオブジェクト値の置き換えも素の書き込みで、何も控えないこと", () => {
    const el = createCustomElement();
    el.state = { editing: false };
    const incoming = { name: "Alice" };
    applyChangeToProperty(binding(el, ["state"]), context, incoming);
    expect(el.state).toBe(incoming);
    expect(takeOverwrittenObject(el, "state")).toBeUndefined();
  });

  it("2 セグメントの書き込みも素の書き込みで、注入キーを控えないこと", () => {
    const el = createCustomElement();
    el.state = { message: "" };
    applyChangeToProperty(binding(el, ["state", "theme"]), context, { mode: "light" });
    applyChangeToProperty(binding(el, ["state", "message"]), context, "hello");
    expect(el.state).toEqual({ message: "hello", theme: { mode: "light" } });
    expect(getInjectedKeys(el, "state")).toBeUndefined();
  });

  it("applyChange は台帳を引かずに素のプロパティ書き込みへ倒れること（台帳に印があっても）", () => {
    const declared = createCustomElement();
    const completed = createCustomElement();
    document.body.append(declared, completed);
    markWebComponentStatePropDeclared(declared, "state");
    markWebComponentAsComplete(completed, "state");
    const applyContext = {
      rootNode: document,
      stateElement: { hasUpdatedCallback: false } as any,
      state: {} as any,
      appliedBindingSet: new Set(),
      newListValueByAbsAddress: new Map(),
      updatedAbsAddressSetByStateElement: new Map(),
      deferredSelectBindings: [],
    } as IApplyContext;
    vi.mocked(getValue).mockReturnValue({ name: "Alice" });
    try {
      applyChange(binding(declared, ["state"]), applyContext);
      applyChange(binding(completed, ["state"]), applyContext);
      expect(declared.state).toEqual({ name: "Alice" });
      expect(completed.state).toEqual({ name: "Alice" });
    } finally {
      declared.remove();
      completed.remove();
    }
  });
});
