import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { WcsBroadcast } from "../src/components/Broadcast";
import { getStates } from "./helpers";

beforeAll(() => {
  if (!customElements.get("wcs-broadcast")) {
    customElements.define("wcs-broadcast", WcsBroadcast);
  }
});

function createBroadcastElement(): WcsBroadcast {
  const el = document.createElement("wcs-broadcast") as WcsBroadcast;
  document.body.appendChild(el);
  return el;
}

describe("WcsBroadcast: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createBroadcastElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-broadcast:error が非nullなら error が on になる", () => {
    const el = createBroadcastElement();
    el.dispatchEvent(new CustomEvent("wcs-broadcast:error", {
      detail: { name: "DataCloneError", message: "boom" },
    }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-broadcast:error がnullなら error が off に戻る", () => {
    const el = createBroadcastElement();
    el.dispatchEvent(new CustomEvent("wcs-broadcast:error", {
      detail: { name: "DataCloneError", message: "boom" },
    }));
    el.dispatchEvent(new CustomEvent("wcs-broadcast:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsBroadcast;
    try {
      expect(() => {
        el = document.createElement("wcs-broadcast") as WcsBroadcast;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-broadcast:error", {
        detail: { name: "DataCloneError", message: "boom" },
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

    let el!: WcsBroadcast;
    try {
      expect(() => {
        el = document.createElement("wcs-broadcast") as WcsBroadcast;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-broadcast:error", {
        detail: { name: "DataCloneError", message: "boom" },
      }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createBroadcastElement();
    el.dispatchEvent(new CustomEvent("wcs-broadcast:error", {
      detail: { name: "DataCloneError", message: "boom" },
    }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["error"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-error がトグルされる", () => {
    const el = createBroadcastElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-broadcast:error", {
      detail: { name: "DataCloneError", message: "boom" },
    }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-broadcast:error", { detail: null }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createBroadcastElement();

    el.dispatchEvent(new CustomEvent("wcs-broadcast:error", {
      detail: { name: "DataCloneError", message: "boom" },
    }));

    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
