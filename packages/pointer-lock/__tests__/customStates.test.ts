import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bootstrapPointerLock } from "../src/bootstrapPointerLock";
import { setConfig } from "../src/config";
import { WcsPointerLock } from "../src/components/PointerLock";
import { getStates } from "./helpers";

function createPointerLockElement(): WcsPointerLock {
  const el = document.createElement("wcs-pointer-lock") as WcsPointerLock;
  document.body.appendChild(el);
  return el;
}

describe("WcsPointerLock: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    setConfig({ tagNames: { pointerLock: "wcs-pointer-lock" } });
    bootstrapPointerLock();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createPointerLockElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-pointer-lock:change(true) で active が on になる", () => {
    const el = createPointerLockElement();
    el.dispatchEvent(new CustomEvent("wcs-pointer-lock:change", { detail: true }));
    expect(getStates(el)?.has("active")).toBe(true);
  });

  it("wcs-pointer-lock:change(false) で active が off に戻る", () => {
    const el = createPointerLockElement();
    el.dispatchEvent(new CustomEvent("wcs-pointer-lock:change", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-pointer-lock:change", { detail: false }));
    expect(getStates(el)?.has("active")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsPointerLock;
    try {
      expect(() => {
        el = document.createElement("wcs-pointer-lock") as WcsPointerLock;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-pointer-lock:change", { detail: true }));
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

    let el!: WcsPointerLock;
    try {
      expect(() => {
        el = document.createElement("wcs-pointer-lock") as WcsPointerLock;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-pointer-lock:change", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createPointerLockElement();
    el.dispatchEvent(new CustomEvent("wcs-pointer-lock:change", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["active"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createPointerLockElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-pointer-lock:change", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-active")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-pointer-lock:change", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-active")).toBe(false);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createPointerLockElement();

    el.dispatchEvent(new CustomEvent("wcs-pointer-lock:change", { detail: true }));

    expect(el.hasAttribute("data-wcs-state-active")).toBe(false);
  });
});
