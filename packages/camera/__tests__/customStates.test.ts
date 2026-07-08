import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { bootstrapCamera } from "../src/bootstrapCamera";
import { WcsCamera } from "../src/components/Camera";
import { WcsRecorder } from "../src/components/Recorder";
import { getStates } from "./helpers";

beforeAll(() => {
  bootstrapCamera();
});

function mount<T extends HTMLElement>(tag: string): T {
  const host = document.createElement("div");
  host.innerHTML = `<${tag}></${tag}>`;
  document.body.appendChild(host);
  return host.querySelector(tag) as T;
}

describe("<wcs-camera> Shell: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function mountCamera(): WcsCamera {
    return mount<WcsCamera>("wcs-camera");
  }

  it("初期状態は全てオフ（states が空）", () => {
    const el = mountCamera();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-camera:active-changed(true) で active が on になる", () => {
    const el = mountCamera();
    el.dispatchEvent(new CustomEvent("wcs-camera:active-changed", { detail: true }));
    expect(getStates(el)?.has("active")).toBe(true);
  });

  it("wcs-camera:active-changed(false) で active が off に戻る", () => {
    const el = mountCamera();
    el.dispatchEvent(new CustomEvent("wcs-camera:active-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-camera:active-changed", { detail: false }));
    expect(getStates(el)?.has("active")).toBe(false);
  });

  it("wcs-camera:error が非nullなら error が on になる", () => {
    const el = mountCamera();
    el.dispatchEvent(new CustomEvent("wcs-camera:error", { detail: { name: "NotAllowedError", message: "denied" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-camera:error がnullなら error が off に戻る", () => {
    const el = mountCamera();
    el.dispatchEvent(new CustomEvent("wcs-camera:error", { detail: { name: "NotAllowedError", message: "denied" } }));
    el.dispatchEvent(new CustomEvent("wcs-camera:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsCamera;
    try {
      expect(() => {
        el = mountCamera();
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-camera:active-changed", { detail: true }));
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

    let el!: WcsCamera;
    try {
      expect(() => {
        el = mountCamera();
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-camera:active-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = mountCamera();
    el.dispatchEvent(new CustomEvent("wcs-camera:active-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["active"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = mountCamera();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-camera:active-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-active")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-camera:active-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-active")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-camera:error", { detail: { name: "NotAllowedError" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = mountCamera();

    el.dispatchEvent(new CustomEvent("wcs-camera:active-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-camera:error", { detail: { name: "NotAllowedError" } }));

    expect(el.hasAttribute("data-wcs-state-active")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});

describe("<wcs-recorder> Shell: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function mountRecorder(): WcsRecorder {
    return mount<WcsRecorder>("wcs-recorder");
  }

  it("初期状態は全てオフ（states が空）", () => {
    const el = mountRecorder();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-recorder:recording-changed(true) で recording が on になる", () => {
    const el = mountRecorder();
    el.dispatchEvent(new CustomEvent("wcs-recorder:recording-changed", { detail: true }));
    expect(getStates(el)?.has("recording")).toBe(true);
  });

  it("wcs-recorder:recording-changed(false) で recording が off に戻る", () => {
    const el = mountRecorder();
    el.dispatchEvent(new CustomEvent("wcs-recorder:recording-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-recorder:recording-changed", { detail: false }));
    expect(getStates(el)?.has("recording")).toBe(false);
  });

  it("wcs-recorder:paused-changed(true) で paused が on になる", () => {
    const el = mountRecorder();
    el.dispatchEvent(new CustomEvent("wcs-recorder:paused-changed", { detail: true }));
    expect(getStates(el)?.has("paused")).toBe(true);
  });

  it("wcs-recorder:paused-changed(false) で paused が off に戻る", () => {
    const el = mountRecorder();
    el.dispatchEvent(new CustomEvent("wcs-recorder:paused-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-recorder:paused-changed", { detail: false }));
    expect(getStates(el)?.has("paused")).toBe(false);
  });

  it("wcs-recorder:error が非nullなら error が on になる", () => {
    const el = mountRecorder();
    el.dispatchEvent(new CustomEvent("wcs-recorder:error", { detail: { name: "NoStreamError", message: "no stream" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-recorder:error がnullなら error が off に戻る", () => {
    const el = mountRecorder();
    el.dispatchEvent(new CustomEvent("wcs-recorder:error", { detail: { name: "NoStreamError", message: "no stream" } }));
    el.dispatchEvent(new CustomEvent("wcs-recorder:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsRecorder;
    try {
      expect(() => {
        el = mountRecorder();
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-recorder:recording-changed", { detail: true }));
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

    let el!: WcsRecorder;
    try {
      expect(() => {
        el = mountRecorder();
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-recorder:recording-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = mountRecorder();
    el.dispatchEvent(new CustomEvent("wcs-recorder:recording-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["recording"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = mountRecorder();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-recorder:recording-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-recording")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-recorder:recording-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-recording")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-recorder:paused-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-paused")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-recorder:error", { detail: { name: "NoStreamError" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = mountRecorder();

    el.dispatchEvent(new CustomEvent("wcs-recorder:recording-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-recorder:paused-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-recorder:error", { detail: { name: "NoStreamError" } }));

    expect(el.hasAttribute("data-wcs-state-recording")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-paused")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
