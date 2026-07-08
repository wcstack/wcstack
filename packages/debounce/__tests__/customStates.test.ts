import { describe, it, expect, afterEach } from "vitest";
import { Debounce } from "../src/components/Debounce";
import { Throttle } from "../src/components/Throttle";
import { registerComponents } from "../src/registerComponents";
import { getStates } from "./helpers";

// registerComponents経由でカスタム要素を登録
registerComponents();

function createDebounceElement(): Debounce {
  const el = document.createElement("wcs-debounce") as Debounce;
  document.body.appendChild(el);
  return el;
}

function createThrottleElement(): Throttle {
  const el = document.createElement("wcs-throttle") as Throttle;
  document.body.appendChild(el);
  return el;
}

describe("Debounce: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createDebounceElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-debounce:pending-changed(true) で pending が on になる", () => {
    const el = createDebounceElement();
    el.dispatchEvent(new CustomEvent("wcs-debounce:pending-changed", { detail: true }));
    expect(getStates(el)?.has("pending")).toBe(true);
  });

  it("wcs-debounce:pending-changed(false) で pending が off に戻る", () => {
    const el = createDebounceElement();
    el.dispatchEvent(new CustomEvent("wcs-debounce:pending-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-debounce:pending-changed", { detail: false }));
    expect(getStates(el)?.has("pending")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: Debounce;
    try {
      expect(() => {
        el = document.createElement("wcs-debounce") as Debounce;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-debounce:pending-changed", { detail: true }));
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

    let el!: Debounce;
    try {
      expect(() => {
        el = document.createElement("wcs-debounce") as Debounce;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-debounce:pending-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createDebounceElement();
    el.dispatchEvent(new CustomEvent("wcs-debounce:pending-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["pending"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-pending がトグルされる", () => {
    const el = createDebounceElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-debounce:pending-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-pending")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-debounce:pending-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-pending")).toBe(false);
  });

  it("debug-states 属性なしでは data-wcs-state-pending が一切書かれない", () => {
    const el = createDebounceElement();

    el.dispatchEvent(new CustomEvent("wcs-debounce:pending-changed", { detail: true }));

    expect(el.hasAttribute("data-wcs-state-pending")).toBe(false);
  });
});

describe("Throttle: CustomStateSet (:state()) reflection（独立検証・wcs-throttle:pending-changed 経由）", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createThrottleElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-throttle:pending-changed(true) で pending が on になる（wcs-debounce:pending-changed には反応しない）", () => {
    const el = createThrottleElement();
    // eventPrefix が異なる基底イベント名は無視される（Throttle は wcs-throttle: のみ購読）。
    el.dispatchEvent(new CustomEvent("wcs-debounce:pending-changed", { detail: true }));
    expect(getStates(el)?.has("pending")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-throttle:pending-changed", { detail: true }));
    expect(getStates(el)?.has("pending")).toBe(true);
  });

  it("wcs-throttle:pending-changed(false) で pending が off に戻る", () => {
    const el = createThrottleElement();
    el.dispatchEvent(new CustomEvent("wcs-throttle:pending-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-throttle:pending-changed", { detail: false }));
    expect(getStates(el)?.has("pending")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-pending がトグルされる", () => {
    const el = createThrottleElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-throttle:pending-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-pending")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-throttle:pending-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-pending")).toBe(false);
  });

  it("debugStates はスナップショットを返す", () => {
    const el = createThrottleElement();
    el.dispatchEvent(new CustomEvent("wcs-throttle:pending-changed", { detail: true }));
    expect(el.debugStates).toEqual(["pending"]);
  });
});
