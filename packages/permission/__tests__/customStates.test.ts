import { describe, it, expect, afterEach } from "vitest";
import { WcsPermission } from "../src/components/Permission";
import { registerComponents } from "../src/registerComponents";
import { getStates } from "./helpers";

// registerComponents経由でカスタム要素を登録
registerComponents();

// connectedCallback は navigator.permissions.query() を起動し（happy-domには
// 実装がなく即 unsupported へ）非同期に wcs-permission:change を発火してしまう。
// CustomStateSet 反映はコンストラクタで配線済みで DOM 接続を要さないため、ここでは
// 要素を接続せず直接 dispatchEvent する（タスク指示どおり）。
function createPermissionElement(): WcsPermission {
  return document.createElement("wcs-permission") as WcsPermission;
}

function dispatchChange(el: WcsPermission, state: string): void {
  el.dispatchEvent(new CustomEvent("wcs-permission:change", { detail: state }));
}

describe("Permission: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createPermissionElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-permission:change(granted) で granted が on になる（他は off）", () => {
    const el = createPermissionElement();
    dispatchChange(el, "granted");
    const states = getStates(el);
    expect(states?.has("granted")).toBe(true);
    expect(states?.has("denied")).toBe(false);
    expect(states?.has("prompt")).toBe(false);
    expect(states?.has("unsupported")).toBe(false);
  });

  it("wcs-permission:change(denied) で denied が on になり granted が off に戻る", () => {
    const el = createPermissionElement();
    dispatchChange(el, "granted");
    dispatchChange(el, "denied");
    const states = getStates(el);
    expect(states?.has("granted")).toBe(false);
    expect(states?.has("denied")).toBe(true);
  });

  it("wcs-permission:change(prompt) で prompt が on になる", () => {
    const el = createPermissionElement();
    dispatchChange(el, "prompt");
    expect(getStates(el)?.has("prompt")).toBe(true);
  });

  it("wcs-permission:change(unsupported) で unsupported が on になる", () => {
    const el = createPermissionElement();
    dispatchChange(el, "unsupported");
    expect(getStates(el)?.has("unsupported")).toBe(true);
  });

  it("相互排他群: 1イベントで4状態が整合的に切り替わる（granted→denied→prompt→unsupported の遷移で常に1つだけ on）", () => {
    const el = createPermissionElement();
    const order = ["granted", "denied", "prompt", "unsupported"] as const;

    for (const state of order) {
      dispatchChange(el, state);
      const states = getStates(el)!;
      for (const candidate of order) {
        expect(states.has(candidate)).toBe(candidate === state);
      }
    }
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsPermission;
    try {
      expect(() => {
        el = document.createElement("wcs-permission") as WcsPermission;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      dispatchChange(el, "granted");
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

    let el!: WcsPermission;
    try {
      expect(() => {
        el = document.createElement("wcs-permission") as WcsPermission;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      dispatchChange(el, "granted");
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createPermissionElement();
    dispatchChange(el, "granted");

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["granted"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createPermissionElement();
    el.setAttribute("debug-states", "");

    dispatchChange(el, "granted");
    expect(el.hasAttribute("data-wcs-state-granted")).toBe(true);
    expect(el.hasAttribute("data-wcs-state-denied")).toBe(false);

    dispatchChange(el, "denied");
    expect(el.hasAttribute("data-wcs-state-granted")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-denied")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createPermissionElement();

    dispatchChange(el, "granted");
    dispatchChange(el, "denied");

    expect(el.hasAttribute("data-wcs-state-granted")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-denied")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-prompt")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-unsupported")).toBe(false);
  });
});
