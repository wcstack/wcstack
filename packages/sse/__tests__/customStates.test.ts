import { describe, it, expect, afterEach } from "vitest";
import { WcsSse } from "../src/components/Sse";
import { getStates } from "./helpers";

// 既存テスト（sse.test.ts）の流儀に従い、customElements に直接登録する。
if (!customElements.get("wcs-sse")) {
  customElements.define("wcs-sse", WcsSse);
}

function createSseElement(): WcsSse {
  const el = document.createElement("wcs-sse") as WcsSse;
  document.body.appendChild(el);
  return el;
}

describe("WcsSse: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createSseElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-sse:connected-changed(true) で connected が on になる", () => {
    const el = createSseElement();
    el.dispatchEvent(new CustomEvent("wcs-sse:connected-changed", { detail: true }));
    expect(getStates(el)?.has("connected")).toBe(true);
  });

  it("wcs-sse:connected-changed(false) で connected が off に戻る", () => {
    const el = createSseElement();
    el.dispatchEvent(new CustomEvent("wcs-sse:connected-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-sse:connected-changed", { detail: false }));
    expect(getStates(el)?.has("connected")).toBe(false);
  });

  it("wcs-sse:loading-changed(true) で loading が on になる", () => {
    const el = createSseElement();
    el.dispatchEvent(new CustomEvent("wcs-sse:loading-changed", { detail: true }));
    expect(getStates(el)?.has("loading")).toBe(true);
  });

  it("wcs-sse:loading-changed(false) で loading が off に戻る", () => {
    const el = createSseElement();
    el.dispatchEvent(new CustomEvent("wcs-sse:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-sse:loading-changed", { detail: false }));
    expect(getStates(el)?.has("loading")).toBe(false);
  });

  it("wcs-sse:error が非nullなら error が on になる", () => {
    const el = createSseElement();
    el.dispatchEvent(new CustomEvent("wcs-sse:error", { detail: new Error("boom") }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-sse:error がnullなら error が off に戻る", () => {
    const el = createSseElement();
    el.dispatchEvent(new CustomEvent("wcs-sse:error", { detail: new Error("boom") }));
    el.dispatchEvent(new CustomEvent("wcs-sse:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsSse;
    try {
      expect(() => {
        el = document.createElement("wcs-sse") as WcsSse;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-sse:connected-changed", { detail: true }));
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

    let el!: WcsSse;
    try {
      expect(() => {
        el = document.createElement("wcs-sse") as WcsSse;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-sse:connected-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createSseElement();
    el.dispatchEvent(new CustomEvent("wcs-sse:loading-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["loading"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createSseElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-sse:connected-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-connected")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-sse:connected-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-connected")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-sse:loading-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-sse:error", { detail: new Error("boom") }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createSseElement();

    el.dispatchEvent(new CustomEvent("wcs-sse:connected-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-sse:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-sse:error", { detail: new Error("boom") }));

    expect(el.hasAttribute("data-wcs-state-connected")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
