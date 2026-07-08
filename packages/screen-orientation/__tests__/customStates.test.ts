import { describe, it, expect, afterEach } from "vitest";
import { WcsScreenOrientation } from "../src/components/ScreenOrientation";
import { registerComponents } from "../src/registerComponents";
import { getStates } from "./helpers";

// registerComponents経由でカスタム要素を登録
registerComponents();

function createScreenOrientationElement(): WcsScreenOrientation {
  const el = document.createElement("wcs-screen-orientation") as WcsScreenOrientation;
  document.body.appendChild(el);
  return el;
}

describe("ScreenOrientation: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createScreenOrientationElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-orientation:change(type: portrait-primary) で portrait が on になる", () => {
    const el = createScreenOrientationElement();
    el.dispatchEvent(new CustomEvent("wcs-orientation:change", {
      detail: { type: "portrait-primary", angle: 0 },
    }));
    expect(getStates(el)?.has("portrait")).toBe(true);
    expect(getStates(el)?.has("landscape")).toBe(false);
  });

  it("wcs-orientation:change(type: landscape-primary) で landscape が on、portrait が off になる（相互排他）", () => {
    const el = createScreenOrientationElement();
    el.dispatchEvent(new CustomEvent("wcs-orientation:change", {
      detail: { type: "portrait-primary", angle: 0 },
    }));
    el.dispatchEvent(new CustomEvent("wcs-orientation:change", {
      detail: { type: "landscape-primary", angle: 90 },
    }));
    expect(getStates(el)?.has("landscape")).toBe(true);
    expect(getStates(el)?.has("portrait")).toBe(false);
  });

  it("wcs-orientation:change(type: null) で portrait/landscape がともに off になる", () => {
    const el = createScreenOrientationElement();
    el.dispatchEvent(new CustomEvent("wcs-orientation:change", {
      detail: { type: "portrait-primary", angle: 0 },
    }));
    el.dispatchEvent(new CustomEvent("wcs-orientation:change", {
      detail: { type: null, angle: null },
    }));
    expect(getStates(el)?.has("portrait")).toBe(false);
    expect(getStates(el)?.has("landscape")).toBe(false);
  });

  it("wcs-orientation:error が非nullなら error が on になる", () => {
    const el = createScreenOrientationElement();
    el.dispatchEvent(new CustomEvent("wcs-orientation:error", { detail: { message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-orientation:error がnullなら error が off に戻る", () => {
    const el = createScreenOrientationElement();
    el.dispatchEvent(new CustomEvent("wcs-orientation:error", { detail: { message: "boom" } }));
    el.dispatchEvent(new CustomEvent("wcs-orientation:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsScreenOrientation;
    try {
      expect(() => {
        el = document.createElement("wcs-screen-orientation") as WcsScreenOrientation;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-orientation:change", {
        detail: { type: "portrait-primary", angle: 0 },
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

    let el!: WcsScreenOrientation;
    try {
      expect(() => {
        el = document.createElement("wcs-screen-orientation") as WcsScreenOrientation;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-orientation:change", {
        detail: { type: "portrait-primary", angle: 0 },
      }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createScreenOrientationElement();
    el.dispatchEvent(new CustomEvent("wcs-orientation:change", {
      detail: { type: "portrait-primary", angle: 0 },
    }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["portrait"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createScreenOrientationElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-orientation:change", {
      detail: { type: "portrait-primary", angle: 0 },
    }));
    expect(el.hasAttribute("data-wcs-state-portrait")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-orientation:change", {
      detail: { type: "landscape-primary", angle: 90 },
    }));
    expect(el.hasAttribute("data-wcs-state-portrait")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-landscape")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-orientation:error", { detail: { message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createScreenOrientationElement();

    el.dispatchEvent(new CustomEvent("wcs-orientation:change", {
      detail: { type: "portrait-primary", angle: 0 },
    }));
    el.dispatchEvent(new CustomEvent("wcs-orientation:error", { detail: { message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-portrait")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
