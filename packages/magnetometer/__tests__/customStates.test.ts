import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bootstrapMagnetometer } from "../src/bootstrapMagnetometer";
import { setConfig } from "../src/config";
import { WcsMagnetometer } from "../src/components/Magnetometer";
import { getStates } from "./helpers";

function createMagnetometerElement(): WcsMagnetometer {
  const el = document.createElement("wcs-magnetometer") as WcsMagnetometer;
  document.body.appendChild(el);
  return el;
}

describe("Magnetometer: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    setConfig({ tagNames: { magnetometer: "wcs-magnetometer" } });
    bootstrapMagnetometer();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createMagnetometerElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-magnetometer:error が非nullなら error が on になる", () => {
    const el = createMagnetometerElement();
    el.dispatchEvent(new CustomEvent("wcs-magnetometer:error", {
      detail: { error: "unsupported", message: "Magnetometer is not supported" },
    }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-magnetometer:error がnullなら error が off に戻る", () => {
    const el = createMagnetometerElement();
    el.dispatchEvent(new CustomEvent("wcs-magnetometer:error", {
      detail: { error: "unsupported", message: "Magnetometer is not supported" },
    }));
    el.dispatchEvent(new CustomEvent("wcs-magnetometer:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsMagnetometer;
    try {
      expect(() => {
        el = document.createElement("wcs-magnetometer") as WcsMagnetometer;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-magnetometer:error", {
        detail: { error: "unsupported", message: "Magnetometer is not supported" },
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

    let el!: WcsMagnetometer;
    try {
      expect(() => {
        el = document.createElement("wcs-magnetometer") as WcsMagnetometer;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-magnetometer:error", {
        detail: { error: "unsupported", message: "Magnetometer is not supported" },
      }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createMagnetometerElement();
    el.dispatchEvent(new CustomEvent("wcs-magnetometer:error", {
      detail: { error: "unsupported", message: "Magnetometer is not supported" },
    }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["error"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createMagnetometerElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-magnetometer:error", {
      detail: { error: "unsupported", message: "Magnetometer is not supported" },
    }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-magnetometer:error", { detail: null }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createMagnetometerElement();

    el.dispatchEvent(new CustomEvent("wcs-magnetometer:error", {
      detail: { error: "unsupported", message: "Magnetometer is not supported" },
    }));

    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
