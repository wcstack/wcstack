import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WcsMediaQuery } from "../src/components/MediaQuery";
import { bootstrapMediaQuery } from "../src/bootstrapMediaQuery";
import { setConfig } from "../src/config";
import { removeMatchMedia, restoreMatchMedia } from "./mocks";
import { getStates } from "./helpers";
import { WcsMediaQuerySnapshot } from "../src/types";

function createMediaQueryElement(): WcsMediaQuery {
  const el = document.createElement("wcs-media-query") as WcsMediaQuery;
  document.body.appendChild(el);
  return el;
}

// wcs-media-query:change の detail は常に 3 フィールド全てを持つスナップショット
// （MediaQueryCore._read() 参照）。テストでは必要なフィールドだけ上書きする。
function makeDetail(overrides: Partial<WcsMediaQuerySnapshot> = {}): WcsMediaQuerySnapshot {
  return {
    matched: false,
    media: "",
    supported: false,
    ...overrides,
  };
}

describe("MediaQuery: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    setConfig({ tagNames: { mediaQuery: "wcs-media-query" } });
    bootstrapMediaQuery();
    removeMatchMedia();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    restoreMatchMedia();
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createMediaQueryElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-media-query:change(matched: true) で matched が on になる", () => {
    const el = createMediaQueryElement();
    el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ matched: true }) }));
    expect(getStates(el)?.has("matched")).toBe(true);
  });

  it("wcs-media-query:change(matched: false) で matched が off に戻る", () => {
    const el = createMediaQueryElement();
    el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ matched: true }) }));
    el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ matched: false }) }));
    expect(getStates(el)?.has("matched")).toBe(false);
  });

  it("wcs-media-query:change(supported: true) で supported が on になる", () => {
    const el = createMediaQueryElement();
    el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ supported: true }) }));
    expect(getStates(el)?.has("supported")).toBe(true);
  });

  it("wcs-media-query:change(supported: false) で supported が off に戻る", () => {
    const el = createMediaQueryElement();
    el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ supported: true }) }));
    el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ supported: false }) }));
    expect(getStates(el)?.has("supported")).toBe(false);
  });

  it("1回の wcs-media-query:change で matched と supported が整合的に同時更新される", () => {
    const el = createMediaQueryElement();
    el.dispatchEvent(new CustomEvent("wcs-media-query:change", {
      detail: makeDetail({ matched: true, media: "(max-width: 600px)", supported: true }),
    }));
    expect(getStates(el)).toEqual(new Set(["matched", "supported"]));

    el.dispatchEvent(new CustomEvent("wcs-media-query:change", {
      detail: makeDetail({ matched: false, supported: false }),
    }));
    expect(getStates(el)).toEqual(new Set());
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsMediaQuery;
    try {
      expect(() => {
        el = document.createElement("wcs-media-query") as WcsMediaQuery;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ supported: true }) }));
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

    let el!: WcsMediaQuery;
    try {
      expect(() => {
        el = document.createElement("wcs-media-query") as WcsMediaQuery;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ supported: true }) }));
    }).not.toThrow();
  });

  it("states.add が後から throw しても never-throw（反映だけが黙って抜ける）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    let armed = false;
    proto.attachInternals = function (): ElementInternals {
      const set = new Set<string>();
      return {
        states: {
          add: (name: string) => { if (armed) throw new DOMException("boom", "SyntaxError"); set.add(name); },
          delete: (name: string) => { set.delete(name); },
          has: (name: string) => set.has(name),
          [Symbol.iterator]: () => set[Symbol.iterator](),
        },
      } as unknown as ElementInternals;
    };

    let el!: WcsMediaQuery;
    try {
      el = document.createElement("wcs-media-query") as WcsMediaQuery;
    } finally {
      proto.attachInternals = original;
    }
    armed = true;

    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ matched: true, supported: true }) }));
    }).not.toThrow();
    expect(el.debugStates).toEqual([]);
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createMediaQueryElement();
    el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ supported: true }) }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["supported"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createMediaQueryElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ matched: true, supported: true }) }));
    expect(el.hasAttribute("data-wcs-state-matched")).toBe(true);
    expect(el.hasAttribute("data-wcs-state-supported")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ matched: false, supported: false }) }));
    expect(el.hasAttribute("data-wcs-state-matched")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-supported")).toBe(false);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createMediaQueryElement();

    el.dispatchEvent(new CustomEvent("wcs-media-query:change", { detail: makeDetail({ matched: true, supported: true }) }));

    expect(el.hasAttribute("data-wcs-state-matched")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-supported")).toBe(false);
  });
});
