import { describe, it, expect, afterEach } from "vitest";
import { Raf } from "../src/components/Raf";
import { registerComponents } from "../src/registerComponents";
import { getStates } from "./helpers";

// registerComponents経由でカスタム要素を登録
registerComponents();

// manual属性を付けて生成する: connectedCallback の自動 start() による
// 意図しない running-changed 発火を避け、状態遷移はテストから直接 dispatchEvent
// で駆動する（設計 §3.6 の方針）。
function createRafElement(): Raf {
  const el = document.createElement("wcs-raf") as Raf;
  el.setAttribute("manual", "");
  document.body.appendChild(el);
  return el;
}

describe("Raf: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createRafElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-raf:running-changed(true) で running が on になる", () => {
    const el = createRafElement();
    el.dispatchEvent(new CustomEvent("wcs-raf:running-changed", { detail: true }));
    expect(getStates(el)?.has("running")).toBe(true);
  });

  it("wcs-raf:running-changed(false) で running が off に戻る", () => {
    const el = createRafElement();
    el.dispatchEvent(new CustomEvent("wcs-raf:running-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-raf:running-changed", { detail: false }));
    expect(getStates(el)?.has("running")).toBe(false);
  });

  it("wcs-raf:suspended-changed で suspended が on/off される（G2 二相の反映）", () => {
    const el = createRafElement();
    el.dispatchEvent(new CustomEvent("wcs-raf:suspended-changed", { detail: true }));
    expect(getStates(el)?.has("suspended")).toBe(true);
    el.dispatchEvent(new CustomEvent("wcs-raf:suspended-changed", { detail: false }));
    expect(getStates(el)?.has("suspended")).toBe(false);
  });

  it("running と suspended は独立にトグルされる", () => {
    const el = createRafElement();
    el.dispatchEvent(new CustomEvent("wcs-raf:running-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-raf:suspended-changed", { detail: true }));
    expect(getStates(el)).toEqual(new Set(["running", "suspended"]));
    el.dispatchEvent(new CustomEvent("wcs-raf:suspended-changed", { detail: false }));
    expect(getStates(el)).toEqual(new Set(["running"]));
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: Raf;
    try {
      expect(() => {
        el = document.createElement("wcs-raf") as Raf;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-raf:running-changed", { detail: true }));
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

    let el!: Raf;
    try {
      expect(() => {
        el = document.createElement("wcs-raf") as Raf;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-raf:running-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createRafElement();
    el.dispatchEvent(new CustomEvent("wcs-raf:running-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["running"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createRafElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-raf:running-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-running")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-raf:suspended-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-suspended")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-raf:running-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-running")).toBe(false);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createRafElement();

    el.dispatchEvent(new CustomEvent("wcs-raf:running-changed", { detail: true }));

    expect(el.hasAttribute("data-wcs-state-running")).toBe(false);
  });
});
