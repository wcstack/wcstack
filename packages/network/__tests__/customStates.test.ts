import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WcsNetwork } from "../src/components/Network";
import { bootstrapNetwork } from "../src/bootstrapNetwork";
import { setConfig } from "../src/config";
import { removeConnection } from "./mocks";
import { getStates } from "./helpers";
import { WcsNetworkSnapshot } from "../src/types";

function createNetworkElement(): WcsNetwork {
  const el = document.createElement("wcs-network") as WcsNetwork;
  document.body.appendChild(el);
  return el;
}

// wcs-network:change の detail は常に5フィールド全てを持つスナップショット
// （NetworkCore._read() 参照）。テストでは必要なフィールドだけ上書きする。
function makeDetail(overrides: Partial<WcsNetworkSnapshot> = {}): WcsNetworkSnapshot {
  return {
    effectiveType: null,
    downlink: null,
    rtt: null,
    saveData: null,
    supported: false,
    ...overrides,
  };
}

describe("Network: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    setConfig({ tagNames: { network: "wcs-network" } });
    bootstrapNetwork();
    removeConnection();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    removeConnection();
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createNetworkElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-network:change(saveData: true) で save-data が on になる", () => {
    const el = createNetworkElement();
    el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ saveData: true }) }));
    expect(getStates(el)?.has("save-data")).toBe(true);
  });

  it("wcs-network:change(saveData: false) で save-data が off に戻る", () => {
    const el = createNetworkElement();
    el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ saveData: true }) }));
    el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ saveData: false }) }));
    expect(getStates(el)?.has("save-data")).toBe(false);
  });

  it("wcs-network:change(saveData: null) では save-data は on にならない（非対応環境）", () => {
    const el = createNetworkElement();
    el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ saveData: null }) }));
    expect(getStates(el)?.has("save-data")).toBe(false);
  });

  it("wcs-network:change(supported: true) で supported が on になる", () => {
    const el = createNetworkElement();
    el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ supported: true }) }));
    expect(getStates(el)?.has("supported")).toBe(true);
  });

  it("wcs-network:change(supported: false) で supported が off に戻る", () => {
    const el = createNetworkElement();
    el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ supported: true }) }));
    el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ supported: false }) }));
    expect(getStates(el)?.has("supported")).toBe(false);
  });

  it("1回の wcs-network:change で save-data と supported が整合的に同時更新される", () => {
    const el = createNetworkElement();
    el.dispatchEvent(new CustomEvent("wcs-network:change", {
      detail: makeDetail({ effectiveType: "3g", saveData: true, supported: true }),
    }));
    expect(getStates(el)).toEqual(new Set(["save-data", "supported"]));

    el.dispatchEvent(new CustomEvent("wcs-network:change", {
      detail: makeDetail({ saveData: false, supported: false }),
    }));
    expect(getStates(el)).toEqual(new Set());
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsNetwork;
    try {
      expect(() => {
        el = document.createElement("wcs-network") as WcsNetwork;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ supported: true }) }));
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

    let el!: WcsNetwork;
    try {
      expect(() => {
        el = document.createElement("wcs-network") as WcsNetwork;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ supported: true }) }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createNetworkElement();
    el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ supported: true }) }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["supported"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createNetworkElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ saveData: true, supported: true }) }));
    expect(el.hasAttribute("data-wcs-state-save-data")).toBe(true);
    expect(el.hasAttribute("data-wcs-state-supported")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ saveData: false, supported: false }) }));
    expect(el.hasAttribute("data-wcs-state-save-data")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-supported")).toBe(false);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createNetworkElement();

    el.dispatchEvent(new CustomEvent("wcs-network:change", { detail: makeDetail({ saveData: true, supported: true }) }));

    expect(el.hasAttribute("data-wcs-state-save-data")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-supported")).toBe(false);
  });
});
