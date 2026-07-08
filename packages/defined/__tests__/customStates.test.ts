import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { WcsDefined } from "../src/components/Defined.js";
import { bootstrapDefined } from "../src/bootstrapDefined.js";
import { DefinedSnapshot } from "../src/types.js";
import { getStates, uniqueTag } from "./helpers.js";

beforeAll(() => {
  bootstrapDefined();
});

// A bare <wcs-defined> with no `tags` connects with an empty watch set, which
// DefinedCore reports synchronously as `error: "no tags specified"` — that
// would pollute the "all off" baseline these tests rely on. Give every element
// a single not-yet-registered tag instead: connecting then publishes a benign
// defined:false / error:null snapshot (no state flips), matching the real
// pre-registration state these tests want to drive by hand via dispatchEvent.
function createDefinedElement(): WcsDefined {
  const el = document.createElement("wcs-defined") as WcsDefined;
  el.setAttribute("tags", uniqueTag());
  document.body.appendChild(el);
  return el;
}

// wcs-defined:change の detail は DefinedSnapshot 全体。:state() 反映は defined /
// error の2フィールドのみを見るが、実イベントの形を模して他フィールドも埋める。
function makeSnapshot(overrides: Partial<DefinedSnapshot>): DefinedSnapshot {
  return {
    defined: false,
    pending: [],
    missing: [],
    count: 0,
    total: 0,
    error: null,
    ...overrides,
  };
}

describe("WcsDefined: CustomStateSet (:state()) reflection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createDefinedElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-defined:change(defined: true) で defined が on になる", () => {
    const el = createDefinedElement();
    el.dispatchEvent(new CustomEvent("wcs-defined:change", {
      detail: makeSnapshot({ defined: true, count: 1, total: 1 }),
    }));
    expect(getStates(el)?.has("defined")).toBe(true);
  });

  it("wcs-defined:change(defined: false) で defined が off に戻る", () => {
    const el = createDefinedElement();
    el.dispatchEvent(new CustomEvent("wcs-defined:change", {
      detail: makeSnapshot({ defined: true, count: 1, total: 1 }),
    }));
    el.dispatchEvent(new CustomEvent("wcs-defined:change", {
      detail: makeSnapshot({ defined: false, pending: ["x-a"], total: 1 }),
    }));
    expect(getStates(el)?.has("defined")).toBe(false);
  });

  it("error が非nullなら error が on になる", () => {
    const el = createDefinedElement();
    el.dispatchEvent(new CustomEvent("wcs-defined:change", {
      detail: makeSnapshot({ error: "invalid custom element name: x-a", missing: ["x-a"], total: 1 }),
    }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("error がnullなら error が off に戻る", () => {
    const el = createDefinedElement();
    el.dispatchEvent(new CustomEvent("wcs-defined:change", {
      detail: makeSnapshot({ error: "invalid custom element name: x-a", missing: ["x-a"], total: 1 }),
    }));
    el.dispatchEvent(new CustomEvent("wcs-defined:change", {
      detail: makeSnapshot({ error: null, count: 1, total: 1, defined: true }),
    }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsDefined;
    try {
      expect(() => {
        el = document.createElement("wcs-defined") as WcsDefined;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-defined:change", {
        detail: makeSnapshot({ defined: true, count: 1, total: 1 }),
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

    let el!: WcsDefined;
    try {
      expect(() => {
        el = document.createElement("wcs-defined") as WcsDefined;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-defined:change", {
        detail: makeSnapshot({ defined: true, count: 1, total: 1 }),
      }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createDefinedElement();
    el.dispatchEvent(new CustomEvent("wcs-defined:change", {
      detail: makeSnapshot({ defined: true, count: 1, total: 1 }),
    }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["defined"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createDefinedElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-defined:change", {
      detail: makeSnapshot({ defined: true, count: 1, total: 1 }),
    }));
    expect(el.hasAttribute("data-wcs-state-defined")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-defined:change", {
      detail: makeSnapshot({ defined: false, pending: ["x-a"], total: 1 }),
    }));
    expect(el.hasAttribute("data-wcs-state-defined")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-defined:change", {
      detail: makeSnapshot({ error: "invalid custom element name: x-a", missing: ["x-a"], total: 1 }),
    }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createDefinedElement();

    el.dispatchEvent(new CustomEvent("wcs-defined:change", {
      detail: makeSnapshot({ defined: true, count: 1, total: 1 }),
    }));
    el.dispatchEvent(new CustomEvent("wcs-defined:change", {
      detail: makeSnapshot({ error: "invalid custom element name: x-a", missing: ["x-a"], total: 1 }),
    }));

    expect(el.hasAttribute("data-wcs-state-defined")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
