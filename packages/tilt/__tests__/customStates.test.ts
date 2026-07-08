import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bootstrapTilt } from "../src/bootstrapTilt";
import { setConfig } from "../src/config";
import { WcsTilt } from "../src/components/Tilt";
import { getStates } from "./helpers";

function createTiltElement(): WcsTilt {
  const el = document.createElement("wcs-tilt") as WcsTilt;
  document.body.appendChild(el);
  return el;
}

describe("WcsTilt: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    setConfig({ tagNames: { tilt: "wcs-tilt" } });
    bootstrapTilt();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createTiltElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-tilt:error が非nullなら error が on になる", () => {
    const el = createTiltElement();
    el.dispatchEvent(new CustomEvent("wcs-tilt:error", {
      detail: { error: new Error("not in a user gesture") },
    }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-tilt:error がnullなら error が off に戻る", () => {
    const el = createTiltElement();
    el.dispatchEvent(new CustomEvent("wcs-tilt:error", {
      detail: { error: new Error("not in a user gesture") },
    }));
    el.dispatchEvent(new CustomEvent("wcs-tilt:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsTilt;
    try {
      expect(() => {
        el = document.createElement("wcs-tilt") as WcsTilt;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-tilt:error", {
        detail: { error: new Error("boom") },
      }));
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

    let el!: WcsTilt;
    try {
      expect(() => {
        el = document.createElement("wcs-tilt") as WcsTilt;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-tilt:error", {
        detail: { error: new Error("boom") },
      }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createTiltElement();
    el.dispatchEvent(new CustomEvent("wcs-tilt:error", {
      detail: { error: new Error("boom") },
    }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["error"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-error がトグルされる", () => {
    const el = createTiltElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-tilt:error", {
      detail: { error: new Error("boom") },
    }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-tilt:error", { detail: null }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createTiltElement();

    el.dispatchEvent(new CustomEvent("wcs-tilt:error", {
      detail: { error: new Error("boom") },
    }));

    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
