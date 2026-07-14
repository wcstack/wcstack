import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IBindingInfo } from "../src/types";

const mocks = vi.hoisted(() => ({
  addAddress: vi.fn(),
  removeAddress: vi.fn(),
  clearAbsoluteAddress: vi.fn(),
  clearStateAddress: vi.fn(),
  apply: vi.fn(),
  attachEvent: vi.fn(() => false),
  detachEvent: vi.fn(),
  attachEventToken: vi.fn(() => false),
  detachEventToken: vi.fn(),
  attachTwoway: vi.fn(),
  detachTwoway: vi.fn(),
  attachRadio: vi.fn(() => false),
  detachRadio: vi.fn(),
  attachCheckbox: vi.fn(() => false),
  detachCheckbox: vi.fn(),
  setPathInfo: vi.fn(),
}));

vi.mock("../src/apply/applyChangeFromBindings", () => ({
  applyChangeFromBindings: mocks.apply,
}));
vi.mock("../src/binding/getAbsoluteStateAddressByBinding", () => ({
  getAbsoluteStateAddressByBinding: vi.fn(() => ({ path: "value" })),
  clearAbsoluteStateAddressByBinding: mocks.clearAbsoluteAddress,
}));
vi.mock("../src/binding/getBindingSetByAbsoluteStateAddress", () => ({
  addBindingByAbsoluteStateAddress: mocks.addAddress,
  removeBindingByAbsoluteStateAddress: mocks.removeAddress,
}));
vi.mock("../src/binding/getStateAddressByBindingInfo", () => ({
  clearStateAddressByBindingInfo: mocks.clearStateAddress,
}));
vi.mock("../src/event/handler", () => ({
  attachEventHandler: mocks.attachEvent,
  detachEventHandler: mocks.detachEvent,
}));
vi.mock("../src/event/eventTokenHandler", () => ({
  attachEventTokenHandler: mocks.attachEventToken,
  detachEventTokenHandler: mocks.detachEventToken,
}));
vi.mock("../src/event/twowayHandler", () => ({
  attachTwowayEventHandler: mocks.attachTwoway,
  detachTwowayEventHandler: mocks.detachTwoway,
}));
vi.mock("../src/event/radioHandler", () => ({
  attachRadioEventHandler: mocks.attachRadio,
  detachRadioEventHandler: mocks.detachRadio,
}));
vi.mock("../src/event/checkboxHandler", () => ({
  attachCheckboxEventHandler: mocks.attachCheckbox,
  detachCheckboxEventHandler: mocks.detachCheckbox,
}));
vi.mock("../src/stateElementByName", () => ({
  getStateElementByName: vi.fn(() => ({ setPathInfo: mocks.setPathInfo })),
}));

import { BindingSession } from "../src/bindings/BindingSession";

let sequence = 0;

function createBinding(node: Element): IBindingInfo {
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
  };
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("BindingSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("同じ binding の listener と address を二重登録せず、再 activation は新 generation にすること", () => {
    const node = document.createElement("input");
    document.body.appendChild(node);
    const binding = createBinding(node);
    const session = new BindingSession(document);

    session.initialize([binding]);
    const firstGeneration = session.getRecord(binding)?.generation;
    session.initialize([binding]);

    expect(mocks.attachTwoway).toHaveBeenCalledTimes(1);
    expect(mocks.addAddress).toHaveBeenCalledTimes(1);

    session.disposeBinding(binding);
    session.disposeBinding(binding);
    expect(mocks.detachTwoway).toHaveBeenCalledTimes(1);
    expect(mocks.removeAddress).toHaveBeenCalledTimes(1);

    session.initialize([binding]);
    expect(session.getRecord(binding)?.generation).toBeGreaterThan(firstGeneration ?? 0);
    expect(mocks.attachTwoway).toHaveBeenCalledTimes(2);
    expect(mocks.addAddress).toHaveBeenCalledTimes(2);
  });

  it("未定義 custom element が削除された場合、定義完了後も attach しないこと", async () => {
    const tagName = `x-session-pending-${++sequence}`;
    const node = document.createElement(tagName);
    document.body.appendChild(node);
    const binding = createBinding(node);
    const session = new BindingSession(document);

    session.initialize([binding]);
    expect(session.getRecord(binding)?.phase).toBe("waiting-definition");
    expect(mocks.attachTwoway).not.toHaveBeenCalled();

    node.remove();
    await flushMutations();
    expect(session.getRecord(binding)?.phase).toBe("disposed");

    customElements.define(tagName, class extends HTMLElement {});
    await customElements.whenDefined(tagName);
    await flushMutations();
    expect(mocks.attachTwoway).not.toHaveBeenCalled();
  });

  it("外部 DOM 削除後の再接続で一度だけ再登録すること", async () => {
    const node = document.createElement("input");
    document.body.appendChild(node);
    const binding = createBinding(node);
    const session = new BindingSession(document);

    session.initialize([binding]);
    const firstGeneration = session.getRecord(binding)?.generation;
    node.remove();
    await flushMutations();
    expect(session.getRecord(binding)?.phase).toBe("disposed");

    document.body.appendChild(node);
    await flushMutations();

    expect(session.getRecord(binding)?.phase).toBe("active");
    expect(session.getRecord(binding)?.generation).toBeGreaterThan(firstGeneration ?? 0);
    expect(mocks.attachTwoway).toHaveBeenCalledTimes(2);
    expect(mocks.addAddress).toHaveBeenCalledTimes(2);
    expect(mocks.apply).toHaveBeenCalledTimes(1);
  });
});
