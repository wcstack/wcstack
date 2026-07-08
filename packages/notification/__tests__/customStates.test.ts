import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WcsNotify } from "../src/components/Notify.js";
import { getStates } from "./helpers";
import { installNotification, removeNotification, removePermissions } from "./mocks.js";

// 既存テスト（notify.test.ts / autoTrigger.test.ts）の流儀に従い、
// customElements に直接登録する。
if (!customElements.get("wcs-notify")) {
  customElements.define("wcs-notify", WcsNotify);
}

function createNotifyElement(): WcsNotify {
  const el = document.createElement("wcs-notify") as WcsNotify;
  document.body.appendChild(el);
  return el;
}

describe("WcsNotify: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    // permission "default"（→ 正規化後 "prompt"）は NotificationCore の初期値
    // "prompt" と一致するため、接続時の実際の許可検出は same-value ガードに
    // より wcs-notify:permission-change を発火しない。これにより、状態駆動を
    // 直接 dispatchEvent する各テストの前提（初期状態は全オフ）が決定的になる。
    installNotification({ permission: "default" });
    removePermissions();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    removeNotification();
    removePermissions();
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createNotifyElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-notify:permission-change(granted) で granted が on になり、他の3値は off のまま", () => {
    const el = createNotifyElement();
    el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "granted" }));
    const states = getStates(el);
    expect(states?.has("granted")).toBe(true);
    expect(states?.has("denied")).toBe(false);
    expect(states?.has("prompt")).toBe(false);
    expect(states?.has("unsupported")).toBe(false);
  });

  it("wcs-notify:permission-change(denied) で denied が on になり、granted は off に戻る", () => {
    const el = createNotifyElement();
    el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "granted" }));
    el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "denied" }));
    const states = getStates(el);
    expect(states?.has("denied")).toBe(true);
    expect(states?.has("granted")).toBe(false);
    expect(states?.has("prompt")).toBe(false);
    expect(states?.has("unsupported")).toBe(false);
  });

  it("wcs-notify:permission-change(prompt) で prompt が on になり、denied は off に戻る", () => {
    const el = createNotifyElement();
    el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "denied" }));
    el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "prompt" }));
    const states = getStates(el);
    expect(states?.has("prompt")).toBe(true);
    expect(states?.has("denied")).toBe(false);
    expect(states?.has("granted")).toBe(false);
    expect(states?.has("unsupported")).toBe(false);
  });

  it("wcs-notify:permission-change(unsupported) で unsupported が on になり、prompt は off に戻る", () => {
    const el = createNotifyElement();
    el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "prompt" }));
    el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "unsupported" }));
    const states = getStates(el);
    expect(states?.has("unsupported")).toBe(true);
    expect(states?.has("prompt")).toBe(false);
    expect(states?.has("granted")).toBe(false);
    expect(states?.has("denied")).toBe(false);
  });

  it("相互排他群の整合性: 一連の permission-change を通じて常に1状態のみが on", () => {
    const el = createNotifyElement();
    const all = ["granted", "denied", "prompt", "unsupported"] as const;
    for (const value of all) {
      el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: value }));
      const states = getStates(el);
      for (const name of all) {
        expect(states?.has(name)).toBe(name === value);
      }
    }
  });

  it("wcs-notify:error が非nullなら error が on になる", () => {
    const el = createNotifyElement();
    el.dispatchEvent(new CustomEvent("wcs-notify:error", { detail: { error: "show-failed", message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-notify:error がnullなら error が off に戻る", () => {
    const el = createNotifyElement();
    el.dispatchEvent(new CustomEvent("wcs-notify:error", { detail: { error: "show-failed", message: "boom" } }));
    el.dispatchEvent(new CustomEvent("wcs-notify:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsNotify;
    try {
      expect(() => {
        el = document.createElement("wcs-notify") as WcsNotify;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "granted" }));
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

    let el!: WcsNotify;
    try {
      expect(() => {
        el = document.createElement("wcs-notify") as WcsNotify;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "granted" }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createNotifyElement();
    el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "granted" }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["granted"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createNotifyElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "granted" }));
    expect(el.hasAttribute("data-wcs-state-granted")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "denied" }));
    expect(el.hasAttribute("data-wcs-state-granted")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-denied")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-notify:error", { detail: { error: "show-failed", message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createNotifyElement();

    el.dispatchEvent(new CustomEvent("wcs-notify:permission-change", { detail: "granted" }));
    el.dispatchEvent(new CustomEvent("wcs-notify:error", { detail: { error: "show-failed", message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-granted")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-denied")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-prompt")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-unsupported")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
