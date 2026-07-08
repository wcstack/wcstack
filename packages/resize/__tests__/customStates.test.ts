import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { WcsResize } from "../src/components/Resize.js";
import { getStates } from "./helpers.js";

// customElements への登録は一度きり。resize.test.ts と同じ流儀で beforeAll に置く。
beforeAll(() => {
  if (!customElements.get("wcs-resize")) {
    customElements.define("wcs-resize", WcsResize);
  }
});

function createResizeElement(): WcsResize {
  const el = document.createElement("wcs-resize") as WcsResize;
  document.body.appendChild(el);
  return el;
}

// `manual` suppresses the connect-time auto-observe (see resize.test.ts
// "manual / lifecycle"), so the element never dispatches
// `wcs-resize:observing-changed` on its own — needed to observe a clean,
// untouched initial states set.
function createManualResizeElement(): WcsResize {
  const el = document.createElement("wcs-resize") as WcsResize;
  el.setAttribute("manual", "");
  document.body.appendChild(el);
  return el;
}

describe("WcsResize: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createManualResizeElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-resize:observing-changed(true) で observing が on になる", () => {
    const el = createResizeElement();
    el.dispatchEvent(new CustomEvent("wcs-resize:observing-changed", { detail: true }));
    expect(getStates(el)?.has("observing")).toBe(true);
  });

  it("wcs-resize:observing-changed(false) で observing が off に戻る", () => {
    const el = createResizeElement();
    el.dispatchEvent(new CustomEvent("wcs-resize:observing-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-resize:observing-changed", { detail: false }));
    expect(getStates(el)?.has("observing")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsResize;
    try {
      expect(() => {
        el = document.createElement("wcs-resize") as WcsResize;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-resize:observing-changed", { detail: true }));
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

    let el!: WcsResize;
    try {
      expect(() => {
        el = document.createElement("wcs-resize") as WcsResize;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-resize:observing-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createResizeElement();
    el.dispatchEvent(new CustomEvent("wcs-resize:observing-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["observing"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createResizeElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-resize:observing-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-observing")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-resize:observing-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-observing")).toBe(false);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createResizeElement();

    el.dispatchEvent(new CustomEvent("wcs-resize:observing-changed", { detail: true }));

    expect(el.hasAttribute("data-wcs-state-observing")).toBe(false);
  });
});
