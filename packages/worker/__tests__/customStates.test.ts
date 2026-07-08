import { describe, it, expect, afterEach } from "vitest";
import { WcsWorker } from "../src/components/Worker";
import { registerComponents } from "../src/registerComponents";
import { getStates } from "./helpers";

// registerComponents経由でカスタム要素を登録
registerComponents();

function createWorkerElement(): WcsWorker {
  const el = document.createElement("wcs-worker") as WcsWorker;
  document.body.appendChild(el);
  return el;
}

describe("WcsWorker: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createWorkerElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-worker:running-changed(true) で running が on になる", () => {
    const el = createWorkerElement();
    el.dispatchEvent(new CustomEvent("wcs-worker:running-changed", { detail: true }));
    expect(getStates(el)?.has("running")).toBe(true);
  });

  it("wcs-worker:running-changed(false) で running が off に戻る", () => {
    const el = createWorkerElement();
    el.dispatchEvent(new CustomEvent("wcs-worker:running-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-worker:running-changed", { detail: false }));
    expect(getStates(el)?.has("running")).toBe(false);
  });

  it("wcs-worker:error が非nullなら error が on になる", () => {
    const el = createWorkerElement();
    el.dispatchEvent(new CustomEvent("wcs-worker:error", { detail: { name: "Error", message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-worker:error がnullなら error が off に戻る", () => {
    const el = createWorkerElement();
    el.dispatchEvent(new CustomEvent("wcs-worker:error", { detail: { name: "Error", message: "boom" } }));
    el.dispatchEvent(new CustomEvent("wcs-worker:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsWorker;
    try {
      expect(() => {
        el = document.createElement("wcs-worker") as WcsWorker;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-worker:running-changed", { detail: true }));
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

    let el!: WcsWorker;
    try {
      expect(() => {
        el = document.createElement("wcs-worker") as WcsWorker;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-worker:running-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createWorkerElement();
    el.dispatchEvent(new CustomEvent("wcs-worker:running-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["running"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createWorkerElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-worker:running-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-running")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-worker:running-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-running")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-worker:error", { detail: { name: "Error", message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createWorkerElement();

    el.dispatchEvent(new CustomEvent("wcs-worker:running-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-worker:error", { detail: { name: "Error", message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-running")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
