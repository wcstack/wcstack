import { describe, it, expect, afterEach } from "vitest";
import { WcsWakeLock } from "../src/components/WakeLock";
import { registerComponents } from "../src/registerComponents";
import { getStates } from "./helpers";

// registerComponents経由でカスタム要素を登録
registerComponents();

function createWakeLockElement(): WcsWakeLock {
  const el = document.createElement("wcs-wakelock") as WcsWakeLock;
  document.body.appendChild(el);
  return el;
}

describe("WcsWakeLock: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createWakeLockElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-wakelock:held-changed(true) で held が on になる", () => {
    const el = createWakeLockElement();
    el.dispatchEvent(new CustomEvent("wcs-wakelock:held-changed", { detail: true }));
    expect(getStates(el)?.has("held")).toBe(true);
  });

  it("wcs-wakelock:held-changed(false) で held が off に戻る", () => {
    const el = createWakeLockElement();
    el.dispatchEvent(new CustomEvent("wcs-wakelock:held-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-wakelock:held-changed", { detail: false }));
    expect(getStates(el)?.has("held")).toBe(false);
  });

  it("wcs-wakelock:error が非nullなら error が on になる", () => {
    const el = createWakeLockElement();
    el.dispatchEvent(new CustomEvent("wcs-wakelock:error", { detail: new Error("boom") }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-wakelock:error がnullなら error が off に戻る", () => {
    const el = createWakeLockElement();
    el.dispatchEvent(new CustomEvent("wcs-wakelock:error", { detail: new Error("boom") }));
    el.dispatchEvent(new CustomEvent("wcs-wakelock:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsWakeLock;
    try {
      expect(() => {
        el = document.createElement("wcs-wakelock") as WcsWakeLock;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-wakelock:held-changed", { detail: true }));
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

    let el!: WcsWakeLock;
    try {
      expect(() => {
        el = document.createElement("wcs-wakelock") as WcsWakeLock;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-wakelock:held-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createWakeLockElement();
    el.dispatchEvent(new CustomEvent("wcs-wakelock:held-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["held"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createWakeLockElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-wakelock:held-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-held")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-wakelock:held-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-held")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-wakelock:error", { detail: new Error("boom") }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createWakeLockElement();

    el.dispatchEvent(new CustomEvent("wcs-wakelock:held-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-wakelock:error", { detail: new Error("boom") }));

    expect(el.hasAttribute("data-wcs-state-held")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
