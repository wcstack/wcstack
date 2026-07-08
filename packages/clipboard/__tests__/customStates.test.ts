import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bootstrapClipboard } from "../src/bootstrapClipboard";
import { setConfig } from "../src/config";
import { WcsClipboard } from "../src/components/Clipboard";
import { removePermissions } from "./mocks";
import { getStates } from "./helpers";

function createClipboardElement(): WcsClipboard {
  const el = document.createElement("wcs-clipboard") as WcsClipboard;
  document.body.appendChild(el);
  return el;
}

describe("Clipboard: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    setConfig({ autoTrigger: false, triggerAttribute: "data-clipboardtarget", tagNames: { clipboard: "wcs-clipboard" } });
    bootstrapClipboard();
    // Permissions API を除去しておく（未サポート分岐は状態反映に無関係だが、
    // 他テストの副作用でイベントが飛ぶのを避けるため一貫して無効化する）。
    removePermissions();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    removePermissions();
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createClipboardElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-clipboard:loading-changed(true) で loading が on になる", () => {
    const el = createClipboardElement();
    el.dispatchEvent(new CustomEvent("wcs-clipboard:loading-changed", { detail: true }));
    expect(getStates(el)?.has("loading")).toBe(true);
  });

  it("wcs-clipboard:loading-changed(false) で loading が off に戻る", () => {
    const el = createClipboardElement();
    el.dispatchEvent(new CustomEvent("wcs-clipboard:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-clipboard:loading-changed", { detail: false }));
    expect(getStates(el)?.has("loading")).toBe(false);
  });

  it("wcs-clipboard:monitoring-changed(true) で monitoring が on になる", () => {
    const el = createClipboardElement();
    el.dispatchEvent(new CustomEvent("wcs-clipboard:monitoring-changed", { detail: true }));
    expect(getStates(el)?.has("monitoring")).toBe(true);
  });

  it("wcs-clipboard:monitoring-changed(false) で monitoring が off に戻る", () => {
    const el = createClipboardElement();
    el.dispatchEvent(new CustomEvent("wcs-clipboard:monitoring-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-clipboard:monitoring-changed", { detail: false }));
    expect(getStates(el)?.has("monitoring")).toBe(false);
  });

  it("wcs-clipboard:error が非nullなら error が on になる", () => {
    const el = createClipboardElement();
    el.dispatchEvent(new CustomEvent("wcs-clipboard:error", { detail: { name: "NotAllowedError", message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-clipboard:error がnullなら error が off に戻る", () => {
    const el = createClipboardElement();
    el.dispatchEvent(new CustomEvent("wcs-clipboard:error", { detail: { name: "NotAllowedError", message: "boom" } }));
    el.dispatchEvent(new CustomEvent("wcs-clipboard:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsClipboard;
    try {
      expect(() => {
        el = document.createElement("wcs-clipboard") as WcsClipboard;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-clipboard:loading-changed", { detail: true }));
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

    let el!: WcsClipboard;
    try {
      expect(() => {
        el = document.createElement("wcs-clipboard") as WcsClipboard;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-clipboard:loading-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createClipboardElement();
    el.dispatchEvent(new CustomEvent("wcs-clipboard:loading-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["loading"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createClipboardElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-clipboard:loading-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-clipboard:loading-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-clipboard:monitoring-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-monitoring")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-clipboard:error", { detail: { name: "NotAllowedError", message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createClipboardElement();

    el.dispatchEvent(new CustomEvent("wcs-clipboard:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-clipboard:monitoring-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-clipboard:error", { detail: { name: "NotAllowedError", message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-monitoring")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
