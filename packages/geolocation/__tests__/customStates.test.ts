import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WcsGeolocation } from "../src/components/Geolocation";
import { registerComponents } from "../src/registerComponents";
import { getStates } from "./helpers";
import { removePermissions } from "./mocks";

// registerComponents経由でカスタム要素を登録
registerComponents();

function createGeoElement(): WcsGeolocation {
  const el = document.createElement("wcs-geo") as WcsGeolocation;
  // manual を付けて接続時の自動取得（getCurrentPosition）を止める。
  // navigator.geolocation が未実装の環境では、自動取得が即座に
  // wcs-geo:error / loading を発火してしまい、CustomStateSet のテストを
  // 汚染してしまうため。
  el.setAttribute("manual", "");
  document.body.appendChild(el);
  return el;
}

describe("Geolocation: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    removePermissions();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    removePermissions();
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createGeoElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-geo:watching-changed(true) で watching が on になる", () => {
    const el = createGeoElement();
    el.dispatchEvent(new CustomEvent("wcs-geo:watching-changed", { detail: true }));
    expect(getStates(el)?.has("watching")).toBe(true);
  });

  it("wcs-geo:watching-changed(false) で watching が off に戻る", () => {
    const el = createGeoElement();
    el.dispatchEvent(new CustomEvent("wcs-geo:watching-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-geo:watching-changed", { detail: false }));
    expect(getStates(el)?.has("watching")).toBe(false);
  });

  it("wcs-geo:loading-changed(true) で loading が on になる", () => {
    const el = createGeoElement();
    el.dispatchEvent(new CustomEvent("wcs-geo:loading-changed", { detail: true }));
    expect(getStates(el)?.has("loading")).toBe(true);
  });

  it("wcs-geo:loading-changed(false) で loading が off に戻る", () => {
    const el = createGeoElement();
    el.dispatchEvent(new CustomEvent("wcs-geo:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-geo:loading-changed", { detail: false }));
    expect(getStates(el)?.has("loading")).toBe(false);
  });

  it("wcs-geo:error が非nullなら error が on になる", () => {
    const el = createGeoElement();
    el.dispatchEvent(new CustomEvent("wcs-geo:error", { detail: { code: 2, message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-geo:error がnullなら error が off に戻る", () => {
    const el = createGeoElement();
    el.dispatchEvent(new CustomEvent("wcs-geo:error", { detail: { code: 2, message: "boom" } }));
    el.dispatchEvent(new CustomEvent("wcs-geo:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsGeolocation;
    try {
      expect(() => {
        el = document.createElement("wcs-geo") as WcsGeolocation;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-geo:loading-changed", { detail: true }));
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

    let el!: WcsGeolocation;
    try {
      expect(() => {
        el = document.createElement("wcs-geo") as WcsGeolocation;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-geo:loading-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createGeoElement();
    el.dispatchEvent(new CustomEvent("wcs-geo:watching-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["watching"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createGeoElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-geo:watching-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-watching")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-geo:watching-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-watching")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-geo:loading-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-geo:error", { detail: { code: 2, message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createGeoElement();

    el.dispatchEvent(new CustomEvent("wcs-geo:watching-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-geo:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-geo:error", { detail: { code: 2, message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-watching")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
