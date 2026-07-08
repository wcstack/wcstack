import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { WcsIntersect } from "../src/components/Intersect";
import { getStates } from "./helpers";

// customElements は同じタグ名を1度しか登録できないため、先頭でまとめて登録する
// （intersect.test.ts と同じ流儀）。
beforeAll(() => {
  if (!customElements.get("wcs-intersect")) {
    customElements.define("wcs-intersect", WcsIntersect);
  }
});

// `manual` を付けて生成する: connectedCallback は `manual` なら自動 observe() を
// 呼ばないため（happy-dom には本物の IntersectionObserver が存在し、放置すると
// connect 時点で observing が意図せず on になってしまう）、状態遷移をイベントの
// 直接 dispatch だけで制御できるようにする。
function createIntersectElement(): WcsIntersect {
  const el = document.createElement("wcs-intersect") as WcsIntersect;
  el.setAttribute("manual", "");
  document.body.appendChild(el);
  return el;
}

describe("WcsIntersect: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createIntersectElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-intersect:visible-changed(true) で visible が on になる", () => {
    const el = createIntersectElement();
    el.dispatchEvent(new CustomEvent("wcs-intersect:visible-changed", { detail: true }));
    expect(getStates(el)?.has("visible")).toBe(true);
  });

  it("wcs-intersect:visible-changed(false) で visible が off に戻る", () => {
    const el = createIntersectElement();
    el.dispatchEvent(new CustomEvent("wcs-intersect:visible-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-intersect:visible-changed", { detail: false }));
    expect(getStates(el)?.has("visible")).toBe(false);
  });

  it("wcs-intersect:observing-changed(true) で observing が on になる", () => {
    const el = createIntersectElement();
    el.dispatchEvent(new CustomEvent("wcs-intersect:observing-changed", { detail: true }));
    expect(getStates(el)?.has("observing")).toBe(true);
  });

  it("wcs-intersect:observing-changed(false) で observing が off に戻る", () => {
    const el = createIntersectElement();
    el.dispatchEvent(new CustomEvent("wcs-intersect:observing-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-intersect:observing-changed", { detail: false }));
    expect(getStates(el)?.has("observing")).toBe(false);
  });

  it("wcs-intersect:change(isIntersecting:true) で intersecting が on になる", () => {
    const el = createIntersectElement();
    el.dispatchEvent(new CustomEvent("wcs-intersect:change", { detail: { isIntersecting: true } }));
    expect(getStates(el)?.has("intersecting")).toBe(true);
  });

  it("wcs-intersect:change(isIntersecting:false) で intersecting が off に戻る", () => {
    const el = createIntersectElement();
    el.dispatchEvent(new CustomEvent("wcs-intersect:change", { detail: { isIntersecting: true } }));
    el.dispatchEvent(new CustomEvent("wcs-intersect:change", { detail: { isIntersecting: false } }));
    expect(getStates(el)?.has("intersecting")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsIntersect;
    try {
      expect(() => {
        el = document.createElement("wcs-intersect") as WcsIntersect;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-intersect:visible-changed", { detail: true }));
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

    let el!: WcsIntersect;
    try {
      expect(() => {
        el = document.createElement("wcs-intersect") as WcsIntersect;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-intersect:visible-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createIntersectElement();
    el.dispatchEvent(new CustomEvent("wcs-intersect:visible-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["visible"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createIntersectElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-intersect:visible-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-visible")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-intersect:visible-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-visible")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-intersect:observing-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-observing")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-intersect:change", { detail: { isIntersecting: true } }));
    expect(el.hasAttribute("data-wcs-state-intersecting")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createIntersectElement();

    el.dispatchEvent(new CustomEvent("wcs-intersect:visible-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-intersect:observing-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-intersect:change", { detail: { isIntersecting: true } }));

    expect(el.hasAttribute("data-wcs-state-visible")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-observing")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-intersecting")).toBe(false);
  });

  it("visible / observing / intersecting は独立に切り替わる（相互排他ではない）", () => {
    const el = createIntersectElement();
    el.dispatchEvent(new CustomEvent("wcs-intersect:observing-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-intersect:change", { detail: { isIntersecting: true } }));
    expect(getStates(el)).toEqual(new Set(["observing", "intersecting"]));

    el.dispatchEvent(new CustomEvent("wcs-intersect:visible-changed", { detail: true }));
    expect(getStates(el)).toEqual(new Set(["observing", "intersecting", "visible"]));

    el.dispatchEvent(new CustomEvent("wcs-intersect:change", { detail: { isIntersecting: false } }));
    // intersecting だけが off になり、observing / visible はそのまま。
    expect(getStates(el)).toEqual(new Set(["observing", "visible"]));
  });
});
