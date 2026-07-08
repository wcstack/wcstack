import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bootstrapAccelerometer } from "../src/bootstrapAccelerometer";
import { WcsAccelerometer } from "../src/components/Accelerometer";
import { getStates } from "./helpers";

function createAccelerometerElement(): WcsAccelerometer {
  const el = document.createElement("wcs-accelerometer") as WcsAccelerometer;
  document.body.appendChild(el);
  return el;
}

describe("Accelerometer: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    bootstrapAccelerometer();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createAccelerometerElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-accelerometer:error が非nullなら error が on になる", () => {
    const el = createAccelerometerElement();
    el.dispatchEvent(new CustomEvent("wcs-accelerometer:error", {
      detail: { error: "unsupported", message: "Accelerometer is not supported" },
    }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-accelerometer:error がnullなら error が off に戻る", () => {
    const el = createAccelerometerElement();
    el.dispatchEvent(new CustomEvent("wcs-accelerometer:error", {
      detail: { error: "unsupported", message: "Accelerometer is not supported" },
    }));
    el.dispatchEvent(new CustomEvent("wcs-accelerometer:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsAccelerometer;
    try {
      expect(() => {
        el = document.createElement("wcs-accelerometer") as WcsAccelerometer;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-accelerometer:error", { detail: { error: "x", message: "y" } }));
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

    let el!: WcsAccelerometer;
    try {
      expect(() => {
        el = document.createElement("wcs-accelerometer") as WcsAccelerometer;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-accelerometer:error", { detail: { error: "x", message: "y" } }));
    }).not.toThrow();
  });

  it("states.add/delete が例外を投げても never-throw で継続する（防御的分岐）", () => {
    // _initInternals の probe を通過した後、通常運用中に states.add/delete が
    // 例外を投げるケース（_wireStates 内 try/catch の防御的分岐）を踏む。
    const el = createAccelerometerElement();
    const states = getStates(el)!;
    states.add = () => { throw new Error("boom"); };

    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-accelerometer:error", { detail: { error: "x", message: "y" } }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createAccelerometerElement();
    el.dispatchEvent(new CustomEvent("wcs-accelerometer:error", { detail: { error: "x", message: "y" } }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["error"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-error がトグルされる", () => {
    const el = createAccelerometerElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-accelerometer:error", { detail: { error: "x", message: "y" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-accelerometer:error", { detail: null }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });

  it("debug-states 属性なしでは data-wcs-state-error が一切書かれない", () => {
    const el = createAccelerometerElement();

    el.dispatchEvent(new CustomEvent("wcs-accelerometer:error", { detail: { error: "x", message: "y" } }));

    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
