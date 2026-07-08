import { describe, it, expect, afterEach } from "vitest";
import { Storage } from "../src/components/Storage";
import { STORAGE_EVENTS } from "../src/events";
import { registerComponents } from "../src/registerComponents";
import { getStates } from "./helpers";

// registerComponents経由でカスタム要素を登録
registerComponents();

function createStorageElement(): Storage {
  const el = document.createElement("wcs-storage") as Storage;
  document.body.appendChild(el);
  return el;
}

describe("Storage: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createStorageElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-storage:loading-changed(true) で loading が on になる", () => {
    const el = createStorageElement();
    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, { detail: true }));
    expect(getStates(el)?.has("loading")).toBe(true);
  });

  it("wcs-storage:loading-changed(false) で loading が off に戻る", () => {
    const el = createStorageElement();
    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, { detail: true }));
    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, { detail: false }));
    expect(getStates(el)?.has("loading")).toBe(false);
  });

  it("wcs-storage:error が非nullなら error が on になる", () => {
    const el = createStorageElement();
    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.error, { detail: { operation: "load", message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-storage:error がnullなら error が off に戻る", () => {
    const el = createStorageElement();
    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.error, { detail: { operation: "load", message: "boom" } }));
    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.error, { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("loading と error は独立して共存できる", () => {
    const el = createStorageElement();
    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, { detail: true }));
    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.error, { detail: { operation: "save", message: "boom" } }));
    expect(getStates(el)).toEqual(new Set(["loading", "error"]));
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: Storage;
    try {
      expect(() => {
        el = document.createElement("wcs-storage") as Storage;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, { detail: true }));
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

    let el!: Storage;
    try {
      expect(() => {
        el = document.createElement("wcs-storage") as Storage;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createStorageElement();
    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["loading"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createStorageElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, { detail: true }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(true);

    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, { detail: false }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);

    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.error, { detail: { operation: "load", message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createStorageElement();

    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, { detail: true }));
    el.dispatchEvent(new CustomEvent(STORAGE_EVENTS.error, { detail: { operation: "load", message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
