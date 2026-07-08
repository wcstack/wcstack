import { describe, it, expect, afterEach } from "vitest";
import { Fetch } from "../src/components/Fetch";
import { registerComponents } from "../src/registerComponents";
import { getStates } from "./helpers";

// registerComponents経由でカスタム要素を登録
registerComponents();

function createFetchElement(): Fetch {
  const el = document.createElement("wcs-fetch") as Fetch;
  document.body.appendChild(el);
  return el;
}

describe("Fetch: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createFetchElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-fetch:loading-changed(true) で loading が on になる", () => {
    const el = createFetchElement();
    el.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", { detail: true }));
    expect(getStates(el)?.has("loading")).toBe(true);
  });

  it("wcs-fetch:loading-changed(false) で loading が off に戻る", () => {
    const el = createFetchElement();
    el.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", { detail: false }));
    expect(getStates(el)?.has("loading")).toBe(false);
  });

  it("wcs-fetch:error が非nullなら error が on になる", () => {
    const el = createFetchElement();
    el.dispatchEvent(new CustomEvent("wcs-fetch:error", { detail: { message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-fetch:error がnullなら error が off に戻る", () => {
    const el = createFetchElement();
    el.dispatchEvent(new CustomEvent("wcs-fetch:error", { detail: { message: "boom" } }));
    el.dispatchEvent(new CustomEvent("wcs-fetch:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: Fetch;
    try {
      expect(() => {
        el = document.createElement("wcs-fetch") as Fetch;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", { detail: true }));
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

    let el!: Fetch;
    try {
      expect(() => {
        el = document.createElement("wcs-fetch") as Fetch;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createFetchElement();
    el.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["loading"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createFetchElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-fetch:error", { detail: { message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createFetchElement();

    el.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-fetch:error", { detail: { message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
