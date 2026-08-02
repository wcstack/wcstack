import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { WcsMidi } from "../src/components/Midi";
import { registerComponents } from "../src/registerComponents";
import { getStates } from "./helpers";

const make = (): WcsMidi => {
  const el = document.createElement("wcs-midi") as WcsMidi;
  document.body.appendChild(el);
  return el;
};

const dispatch = (el: WcsMidi, event: string, detail: unknown): void => {
  el.dispatchEvent(new CustomEvent(event, { detail }));
};

describe("Midi: CustomStateSet (:state()) reflection", () => {
  beforeAll(() => {
    registerComponents();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ", () => {
    expect(make().debugStates).toEqual([]);
  });

  it("permission イベントで granted / denied / unsupported が排他的に切り替わる", () => {
    const el = make();
    dispatch(el, "wcs-midi:permission", "granted");
    expect(getStates(el)).toEqual(new Set(["granted"]));
    dispatch(el, "wcs-midi:permission", "denied");
    expect(getStates(el)).toEqual(new Set(["denied"]));
    dispatch(el, "wcs-midi:permission", "unsupported");
    expect(getStates(el)).toEqual(new Set(["unsupported"]));
    dispatch(el, "wcs-midi:permission", "prompt");
    expect(getStates(el)).toEqual(new Set());
  });

  it("statechange で connected がトグルされる", () => {
    const el = make();
    dispatch(el, "wcs-midi:statechange", true);
    expect(el.debugStates).toContain("connected");
    dispatch(el, "wcs-midi:statechange", false);
    expect(el.debugStates).not.toContain("connected");
  });

  it("error の有無が :state(error) に反映される", () => {
    const el = make();
    dispatch(el, "wcs-midi:error", "boom");
    expect(el.debugStates).toContain("error");
    dispatch(el, "wcs-midi:error", null);
    expect(el.debugStates).not.toContain("error");
  });

  it("debugStates はスナップショット（変更しても states に影響しない）", () => {
    const el = make();
    dispatch(el, "wcs-midi:statechange", true);
    const snapshot = el.debugStates;
    snapshot.push("tampered");
    expect(el.debugStates).toEqual(["connected"]);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = make();
    el.setAttribute("debug-states", "");
    dispatch(el, "wcs-midi:statechange", true);
    expect(el.hasAttribute("data-wcs-state-connected")).toBe(true);
    dispatch(el, "wcs-midi:statechange", false);
    expect(el.hasAttribute("data-wcs-state-connected")).toBe(false);
  });

  it("debug-states 属性なしでは data-wcs-state-* を書かない", () => {
    const el = make();
    dispatch(el, "wcs-midi:statechange", true);
    expect(el.hasAttribute("data-wcs-state-connected")).toBe(false);
  });

  it("attachInternals 不在でも throw せず debugStates は空", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsMidi;
    try {
      expect(() => { el = document.createElement("wcs-midi") as WcsMidi; }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => dispatch(el, "wcs-midi:statechange", true)).not.toThrow();
  });

  it("probe が SyntaxError を投げる環境（旧 Chromium 相当）でも動作継続する", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    proto.attachInternals = function (): ElementInternals {
      return {
        states: {
          add: () => { throw new DOMException("bad state name", "SyntaxError"); },
          delete: () => {},
          has: () => false,
        },
      } as unknown as ElementInternals;
    };

    let el!: WcsMidi;
    try {
      expect(() => { el = document.createElement("wcs-midi") as WcsMidi; }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
  });

  it("states.add が個別に throw しても never-throw を維持する", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    let probing = true;
    proto.attachInternals = function (): ElementInternals {
      return {
        states: {
          add: () => { if (!probing) throw new DOMException("nope", "SyntaxError"); },
          delete: () => {},
          has: () => false,
        },
      } as unknown as ElementInternals;
    };

    let el!: WcsMidi;
    try {
      el = document.createElement("wcs-midi") as WcsMidi;
      document.body.appendChild(el);
      probing = false;
      expect(() => dispatch(el, "wcs-midi:statechange", true)).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }
  });
});
