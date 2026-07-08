import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bootstrapEyedropper } from "../src/bootstrapEyedropper";
import { setConfig } from "../src/config";
import { WcsEyedropper } from "../src/components/Eyedropper";
import { getStates } from "./helpers";

function createEyedropperElement(): WcsEyedropper {
  const el = document.createElement("wcs-eyedropper") as WcsEyedropper;
  document.body.appendChild(el);
  return el;
}

describe("Eyedropper: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    setConfig({ tagNames: { eyedropper: "wcs-eyedropper" } });
    bootstrapEyedropper();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createEyedropperElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-eyedropper:loading-changed(true) で loading が on になる", () => {
    const el = createEyedropperElement();
    el.dispatchEvent(new CustomEvent("wcs-eyedropper:loading-changed", { detail: true }));
    expect(getStates(el)?.has("loading")).toBe(true);
  });

  it("wcs-eyedropper:loading-changed(false) で loading が off に戻る", () => {
    const el = createEyedropperElement();
    el.dispatchEvent(new CustomEvent("wcs-eyedropper:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-eyedropper:loading-changed", { detail: false }));
    expect(getStates(el)?.has("loading")).toBe(false);
  });

  it("wcs-eyedropper:cancelled-changed(true) で cancelled が on になる", () => {
    const el = createEyedropperElement();
    el.dispatchEvent(new CustomEvent("wcs-eyedropper:cancelled-changed", { detail: true }));
    expect(getStates(el)?.has("cancelled")).toBe(true);
  });

  it("wcs-eyedropper:cancelled-changed(false) で cancelled が off に戻る", () => {
    const el = createEyedropperElement();
    el.dispatchEvent(new CustomEvent("wcs-eyedropper:cancelled-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-eyedropper:cancelled-changed", { detail: false }));
    expect(getStates(el)?.has("cancelled")).toBe(false);
  });

  it("wcs-eyedropper:error が非nullなら error が on になる", () => {
    const el = createEyedropperElement();
    el.dispatchEvent(new CustomEvent("wcs-eyedropper:error", { detail: { message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-eyedropper:error がnullなら error が off に戻る", () => {
    const el = createEyedropperElement();
    el.dispatchEvent(new CustomEvent("wcs-eyedropper:error", { detail: { message: "boom" } }));
    el.dispatchEvent(new CustomEvent("wcs-eyedropper:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsEyedropper;
    try {
      expect(() => {
        el = document.createElement("wcs-eyedropper") as WcsEyedropper;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-eyedropper:loading-changed", { detail: true }));
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

    let el!: WcsEyedropper;
    try {
      expect(() => {
        el = document.createElement("wcs-eyedropper") as WcsEyedropper;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-eyedropper:loading-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createEyedropperElement();
    el.dispatchEvent(new CustomEvent("wcs-eyedropper:loading-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["loading"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createEyedropperElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-eyedropper:loading-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-eyedropper:loading-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-eyedropper:cancelled-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-cancelled")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-eyedropper:error", { detail: { message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createEyedropperElement();

    el.dispatchEvent(new CustomEvent("wcs-eyedropper:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-eyedropper:cancelled-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-eyedropper:error", { detail: { message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-cancelled")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
