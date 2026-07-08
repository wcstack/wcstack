import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WcsSpeak } from "../src/components/Speak";
import { WcsListen } from "../src/components/Listen";
import { registerComponents } from "../src/registerComponents";
import { config } from "../src/config";
import { getStates } from "./helpers";
import {
  installSpeechSynthesis, uninstallSpeechSynthesis,
  installSpeechRecognition, uninstallSpeechRecognition, removePermissions,
} from "./mocks";

// registerComponents経由でカスタム要素を登録
registerComponents();

function createSpeakElement(): WcsSpeak {
  const el = document.createElement(config.tagNames.speak) as WcsSpeak;
  document.body.appendChild(el);
  return el;
}

function createListenElement(): WcsListen {
  const el = document.createElement(config.tagNames.listen) as WcsListen;
  // 状態駆動は要素への直接 dispatchEvent で行うため、connect時の自動startを止める。
  el.setAttribute("manual", "");
  document.body.appendChild(el);
  return el;
}

describe("WcsSpeak: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    // SpeechSynthesis API を「対応」させておく（unsupported-changed の初期発火を防ぎ、
    // 初期状態が全てオフになる前提を揃える）。
    installSpeechSynthesis();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    uninstallSpeechSynthesis();
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createSpeakElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-speak:speaking-changed で speaking が on/off する", () => {
    const el = createSpeakElement();
    el.dispatchEvent(new CustomEvent("wcs-speak:speaking-changed", { detail: true }));
    expect(getStates(el)?.has("speaking")).toBe(true);
    el.dispatchEvent(new CustomEvent("wcs-speak:speaking-changed", { detail: false }));
    expect(getStates(el)?.has("speaking")).toBe(false);
  });

  it("wcs-speak:paused-changed で paused が on/off する", () => {
    const el = createSpeakElement();
    el.dispatchEvent(new CustomEvent("wcs-speak:paused-changed", { detail: true }));
    expect(getStates(el)?.has("paused")).toBe(true);
    el.dispatchEvent(new CustomEvent("wcs-speak:paused-changed", { detail: false }));
    expect(getStates(el)?.has("paused")).toBe(false);
  });

  it("wcs-speak:pending-changed で pending が on/off する", () => {
    const el = createSpeakElement();
    el.dispatchEvent(new CustomEvent("wcs-speak:pending-changed", { detail: true }));
    expect(getStates(el)?.has("pending")).toBe(true);
    el.dispatchEvent(new CustomEvent("wcs-speak:pending-changed", { detail: false }));
    expect(getStates(el)?.has("pending")).toBe(false);
  });

  it("wcs-speak:unsupported-changed で unsupported が on/off する", () => {
    const el = createSpeakElement();
    el.dispatchEvent(new CustomEvent("wcs-speak:unsupported-changed", { detail: true }));
    expect(getStates(el)?.has("unsupported")).toBe(true);
    el.dispatchEvent(new CustomEvent("wcs-speak:unsupported-changed", { detail: false }));
    expect(getStates(el)?.has("unsupported")).toBe(false);
  });

  it("wcs-speak:error が非nullなら error が on、nullなら off になる", () => {
    const el = createSpeakElement();
    el.dispatchEvent(new CustomEvent("wcs-speak:error", { detail: { error: "synthesis-failed", message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
    el.dispatchEvent(new CustomEvent("wcs-speak:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("複数の状態が独立して共存する", () => {
    const el = createSpeakElement();
    el.dispatchEvent(new CustomEvent("wcs-speak:speaking-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-speak:pending-changed", { detail: true }));
    expect(getStates(el)).toEqual(new Set(["speaking", "pending"]));
    el.dispatchEvent(new CustomEvent("wcs-speak:speaking-changed", { detail: false }));
    expect(getStates(el)).toEqual(new Set(["pending"]));
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsSpeak;
    try {
      expect(() => {
        el = document.createElement(config.tagNames.speak) as WcsSpeak;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-speak:speaking-changed", { detail: true }));
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

    let el!: WcsSpeak;
    try {
      expect(() => {
        el = document.createElement(config.tagNames.speak) as WcsSpeak;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-speak:speaking-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createSpeakElement();
    el.dispatchEvent(new CustomEvent("wcs-speak:speaking-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["speaking"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createSpeakElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-speak:speaking-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-speaking")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-speak:speaking-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-speaking")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-speak:error", { detail: { error: "canceled", message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createSpeakElement();

    el.dispatchEvent(new CustomEvent("wcs-speak:speaking-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-speak:error", { detail: { error: "canceled", message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-speaking")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});

describe("WcsListen: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    // SpeechRecognition API を「対応」させておく（unsupported-changed の初期発火を防ぎ、
    // 初期状態が全てオフになる前提を揃える）。permission は反映対象外だが、
    // navigator.permissions 未定義でも副作用なく初期化できるよう明示的に外す。
    installSpeechRecognition();
    removePermissions();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    uninstallSpeechRecognition();
    removePermissions();
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createListenElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-listen:listening-changed で listening が on/off する", () => {
    const el = createListenElement();
    el.dispatchEvent(new CustomEvent("wcs-listen:listening-changed", { detail: true }));
    expect(getStates(el)?.has("listening")).toBe(true);
    el.dispatchEvent(new CustomEvent("wcs-listen:listening-changed", { detail: false }));
    expect(getStates(el)?.has("listening")).toBe(false);
  });

  it("wcs-listen:unsupported-changed で unsupported が on/off する", () => {
    const el = createListenElement();
    el.dispatchEvent(new CustomEvent("wcs-listen:unsupported-changed", { detail: true }));
    expect(getStates(el)?.has("unsupported")).toBe(true);
    el.dispatchEvent(new CustomEvent("wcs-listen:unsupported-changed", { detail: false }));
    expect(getStates(el)?.has("unsupported")).toBe(false);
  });

  it("wcs-listen:error が非nullなら error が on、nullなら off になる", () => {
    const el = createListenElement();
    el.dispatchEvent(new CustomEvent("wcs-listen:error", { detail: { error: "not-allowed", message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
    el.dispatchEvent(new CustomEvent("wcs-listen:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("複数の状態が独立して共存する", () => {
    const el = createListenElement();
    el.dispatchEvent(new CustomEvent("wcs-listen:listening-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-listen:error", { detail: { error: "network", message: "boom" } }));
    expect(getStates(el)).toEqual(new Set(["listening", "error"]));
    el.dispatchEvent(new CustomEvent("wcs-listen:listening-changed", { detail: false }));
    expect(getStates(el)).toEqual(new Set(["error"]));
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsListen;
    try {
      expect(() => {
        el = document.createElement(config.tagNames.listen) as WcsListen;
        el.setAttribute("manual", "");
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-listen:listening-changed", { detail: true }));
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

    let el!: WcsListen;
    try {
      expect(() => {
        el = document.createElement(config.tagNames.listen) as WcsListen;
        el.setAttribute("manual", "");
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-listen:listening-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createListenElement();
    el.dispatchEvent(new CustomEvent("wcs-listen:listening-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["listening"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createListenElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-listen:listening-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-listening")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-listen:listening-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-listening")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-listen:error", { detail: { error: "aborted", message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createListenElement();

    el.dispatchEvent(new CustomEvent("wcs-listen:listening-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-listen:error", { detail: { error: "aborted", message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-listening")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
