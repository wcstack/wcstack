import { describe, it, expect } from "vitest";
import {
  collectNodesAndBindingInfos,
  processDeferredNode,
  unregisterNode,
  type IDeferredSpreadEntry,
} from "../src/bindings/collectNodesAndBindingInfos";
import type { IWcBindable } from "../src/event/types";

let counter = 0;
function uniqueTag(): string {
  return `wcs-collect-deferred-${++counter}`;
}

function defineEl(tag: string, properties: { name: string; event: string }[]) {
  class C extends HTMLElement {
    static wcBindable: IWcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties,
    };
  }
  customElements.define(tag, C);
  return C;
}

describe("collectNodesAndBindingInfos spread deferral", () => {
  it("class 未定義の spread を deferred として返すこと", () => {
    const tag = uniqueTag();
    const root = document.createElement("div");
    const el = document.createElement(tag);
    el.setAttribute("data-wcs", "...: fetchX");
    root.appendChild(el);

    const [, bindings, deferred] = collectNodesAndBindingInfos(root);
    expect(bindings).toHaveLength(0);
    expect(deferred).toHaveLength(1);
    expect(deferred[0].tagName).toBe(tag);
    expect(deferred[0].parseResults).toHaveLength(1);
    expect(deferred[0].parseResults[0].bindingType).toBe("spread");

    unregisterNode(el);
  });

  it("processDeferredNode が parseResults から bindings を生成すること", () => {
    const tag = uniqueTag();
    const root = document.createElement("div");
    const el = document.createElement(tag);
    el.setAttribute("data-wcs", "...: fetchX");
    root.appendChild(el);

    const [, , deferred] = collectNodesAndBindingInfos(root);
    expect(deferred).toHaveLength(1);

    // class を後から登録
    const constructor = defineEl(tag, [
      { name: "value", event: `${tag}:value-changed` },
      { name: "loading", event: `${tag}:loading-changed` },
    ]);
    Object.setPrototypeOf(el, constructor.prototype);

    const bindings = processDeferredNode(deferred[0]);
    expect(bindings).toHaveLength(2);
    expect(bindings.map(b => b.propName).sort()).toEqual(["loading", "value"]);
    expect(bindings.map(b => b.statePathName).sort()).toEqual(["fetchX.loading", "fetchX.value"]);

    unregisterNode(el);
  });

  it("class が登録済みなら deferred は発生しないこと", () => {
    const tag = uniqueTag();
    defineEl(tag, [{ name: "value", event: `${tag}:value-changed` }]);

    const root = document.createElement("div");
    const el = document.createElement(tag);
    el.setAttribute("data-wcs", "...: fetchX");
    root.appendChild(el);

    const [, bindings, deferred] = collectNodesAndBindingInfos(root);
    expect(deferred).toHaveLength(0);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].propName).toBe("value");
    expect(bindings[0].statePathName).toBe("fetchX.value");

    unregisterNode(el);
  });

  it("processDeferredNode の戻り値の bindings は IDeferredSpreadEntry を一度だけ展開すること", () => {
    const tag = uniqueTag();
    const root = document.createElement("div");
    const el = document.createElement(tag);
    el.setAttribute("data-wcs", "...: fetchX");
    root.appendChild(el);

    const [, , deferred] = collectNodesAndBindingInfos(root);
    const entry: IDeferredSpreadEntry = deferred[0];

    const constructor = defineEl(tag, [{ name: "value", event: `${tag}:value-changed` }]);
    Object.setPrototypeOf(el, constructor.prototype);
    const bindings = processDeferredNode(entry);
    expect(bindings).toHaveLength(1);

    unregisterNode(el);
  });
});
