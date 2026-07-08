import { describe, it, expect, afterEach } from "vitest";
import { WcsWebSocket } from "../src/components/WebSocket";
import { registerComponents } from "../src/registerComponents";
import { getStates } from "./helpers";

// registerComponents経由でカスタム要素を登録
registerComponents();

function createWebSocketElement(): WcsWebSocket {
  const el = document.createElement("wcs-ws") as WcsWebSocket;
  document.body.appendChild(el);
  return el;
}

describe("WcsWebSocket: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createWebSocketElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-ws:connected-changed(true) で connected が on になる", () => {
    const el = createWebSocketElement();
    el.dispatchEvent(new CustomEvent("wcs-ws:connected-changed", { detail: true }));
    expect(getStates(el)?.has("connected")).toBe(true);
  });

  it("wcs-ws:connected-changed(false) で connected が off に戻る", () => {
    const el = createWebSocketElement();
    el.dispatchEvent(new CustomEvent("wcs-ws:connected-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-ws:connected-changed", { detail: false }));
    expect(getStates(el)?.has("connected")).toBe(false);
  });

  it("wcs-ws:loading-changed(true) で loading が on になる", () => {
    const el = createWebSocketElement();
    el.dispatchEvent(new CustomEvent("wcs-ws:loading-changed", { detail: true }));
    expect(getStates(el)?.has("loading")).toBe(true);
  });

  it("wcs-ws:loading-changed(false) で loading が off に戻る", () => {
    const el = createWebSocketElement();
    el.dispatchEvent(new CustomEvent("wcs-ws:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-ws:loading-changed", { detail: false }));
    expect(getStates(el)?.has("loading")).toBe(false);
  });

  it("wcs-ws:error が非nullなら error が on になる", () => {
    const el = createWebSocketElement();
    el.dispatchEvent(new CustomEvent("wcs-ws:error", { detail: { message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-ws:error がnullなら error が off に戻る", () => {
    const el = createWebSocketElement();
    el.dispatchEvent(new CustomEvent("wcs-ws:error", { detail: { message: "boom" } }));
    el.dispatchEvent(new CustomEvent("wcs-ws:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("connected と loading は独立に切り替わる（相互排他ではない）", () => {
    const el = createWebSocketElement();
    el.dispatchEvent(new CustomEvent("wcs-ws:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-ws:connected-changed", { detail: true }));
    expect(getStates(el)?.has("loading")).toBe(true);
    expect(getStates(el)?.has("connected")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-ws:loading-changed", { detail: false }));
    expect(getStates(el)?.has("loading")).toBe(false);
    expect(getStates(el)?.has("connected")).toBe(true);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsWebSocket;
    try {
      expect(() => {
        el = document.createElement("wcs-ws") as WcsWebSocket;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-ws:connected-changed", { detail: true }));
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

    let el!: WcsWebSocket;
    try {
      expect(() => {
        el = document.createElement("wcs-ws") as WcsWebSocket;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-ws:connected-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createWebSocketElement();
    el.dispatchEvent(new CustomEvent("wcs-ws:connected-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["connected"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createWebSocketElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-ws:connected-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-connected")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-ws:connected-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-connected")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-ws:loading-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-ws:error", { detail: { message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createWebSocketElement();

    el.dispatchEvent(new CustomEvent("wcs-ws:connected-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-ws:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-ws:error", { detail: { message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-connected")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
