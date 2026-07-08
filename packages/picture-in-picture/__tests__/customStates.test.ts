import { describe, it, expect, afterEach } from "vitest";
import { WcsPip } from "../src/components/Pip";
import { registerComponents } from "../src/registerComponents";
import { getStates } from "./helpers";

// registerComponents経由でカスタム要素を登録
registerComponents();

function createPipElement(): WcsPip {
  const el = document.createElement("wcs-pip") as WcsPip;
  document.body.appendChild(el);
  return el;
}

describe("WcsPip: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createPipElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-pip:change({ active: true }) で active が on になる", () => {
    const el = createPipElement();
    el.dispatchEvent(new CustomEvent("wcs-pip:change", { detail: { active: true } }));
    expect(getStates(el)?.has("active")).toBe(true);
  });

  it("wcs-pip:change({ active: false }) で active が off に戻る", () => {
    const el = createPipElement();
    el.dispatchEvent(new CustomEvent("wcs-pip:change", { detail: { active: true } }));
    el.dispatchEvent(new CustomEvent("wcs-pip:change", { detail: { active: false } }));
    expect(getStates(el)?.has("active")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsPip;
    try {
      expect(() => {
        el = document.createElement("wcs-pip") as WcsPip;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-pip:change", { detail: { active: true } }));
    }).not.toThrow();
  });

  it("probe が SyntaxError を投げる環境（旧Chromium相当）でも _internals が無効化され動作継続する", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    proto.attachInternals = function (): ElementInternals {
      return {
        states: {
          add: () => { throw new DOMException("Failed to execute 'add' on 'CustomStateSet'", "SyntaxError"); },
          delete: () => {},
          has: () => false,
        },
      } as unknown as ElementInternals;
    };

    let el!: WcsPip;
    try {
      expect(() => {
        el = document.createElement("wcs-pip") as WcsPip;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-pip:change", { detail: { active: true } }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createPipElement();
    el.dispatchEvent(new CustomEvent("wcs-pip:change", { detail: { active: true } }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["active"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createPipElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-pip:change", { detail: { active: true } }));
    expect(el.hasAttribute("data-wcs-state-active")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-pip:change", { detail: { active: false } }));
    expect(el.hasAttribute("data-wcs-state-active")).toBe(false);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createPipElement();

    el.dispatchEvent(new CustomEvent("wcs-pip:change", { detail: { active: true } }));

    expect(el.hasAttribute("data-wcs-state-active")).toBe(false);
  });
});
