import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bootstrapIdle } from "../src/bootstrapIdle";
import { setConfig } from "../src/config";
import { WcsIdle } from "../src/components/Idle";
import { getStates } from "./helpers";

function createIdleElement(): WcsIdle {
  const el = document.createElement("wcs-idle") as WcsIdle;
  document.body.appendChild(el);
  return el;
}

describe("Idle: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    setConfig({ tagNames: { idle: "wcs-idle" } });
    bootstrapIdle();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createIdleElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-idle:change(userState: \"active\") で active が on になる", () => {
    const el = createIdleElement();
    el.dispatchEvent(new CustomEvent("wcs-idle:change", {
      detail: { userState: "active", screenState: "unlocked" },
    }));
    expect(getStates(el)?.has("active")).toBe(true);
  });

  it("wcs-idle:change(userState: \"idle\") で active が off に戻る", () => {
    const el = createIdleElement();
    el.dispatchEvent(new CustomEvent("wcs-idle:change", {
      detail: { userState: "active", screenState: "unlocked" },
    }));
    el.dispatchEvent(new CustomEvent("wcs-idle:change", {
      detail: { userState: "idle", screenState: "locked" },
    }));
    expect(getStates(el)?.has("active")).toBe(false);
  });

  it("wcs-idle:error が非nullなら error が on になる", () => {
    const el = createIdleElement();
    el.dispatchEvent(new CustomEvent("wcs-idle:error", { detail: { message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-idle:error がnullなら error が off に戻る", () => {
    const el = createIdleElement();
    el.dispatchEvent(new CustomEvent("wcs-idle:error", { detail: { message: "boom" } }));
    el.dispatchEvent(new CustomEvent("wcs-idle:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsIdle;
    try {
      expect(() => {
        el = document.createElement("wcs-idle") as WcsIdle;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-idle:change", {
        detail: { userState: "active", screenState: "unlocked" },
      }));
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

    let el!: WcsIdle;
    try {
      expect(() => {
        el = document.createElement("wcs-idle") as WcsIdle;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-idle:change", {
        detail: { userState: "active", screenState: "unlocked" },
      }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createIdleElement();
    el.dispatchEvent(new CustomEvent("wcs-idle:change", {
      detail: { userState: "active", screenState: "unlocked" },
    }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["active"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createIdleElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-idle:change", {
      detail: { userState: "active", screenState: "unlocked" },
    }));
    expect(el.hasAttribute("data-wcs-state-active")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-idle:change", {
      detail: { userState: "idle", screenState: "locked" },
    }));
    expect(el.hasAttribute("data-wcs-state-active")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-idle:error", { detail: { message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createIdleElement();

    el.dispatchEvent(new CustomEvent("wcs-idle:change", {
      detail: { userState: "active", screenState: "unlocked" },
    }));
    el.dispatchEvent(new CustomEvent("wcs-idle:error", { detail: { message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-active")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
