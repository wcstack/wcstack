import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WcsContacts } from "../src/components/Contacts";
import { bootstrapContacts } from "../src/bootstrapContacts";
import { setConfig } from "../src/config";
import { getStates } from "./helpers";

function createContactsElement(): WcsContacts {
  const el = document.createElement("wcs-contacts") as WcsContacts;
  document.body.appendChild(el);
  return el;
}

describe("Contacts: CustomStateSet (:state()) reflection", () => {
  beforeEach(() => {
    setConfig({ tagNames: { contacts: "wcs-contacts" } });
    bootstrapContacts();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("初期状態は全てオフ（states が空）", () => {
    const el = createContactsElement();
    expect(getStates(el)).toEqual(new Set());
  });

  it("wcs-contacts:loading-changed(true) で loading が on になる", () => {
    const el = createContactsElement();
    el.dispatchEvent(new CustomEvent("wcs-contacts:loading-changed", { detail: true }));
    expect(getStates(el)?.has("loading")).toBe(true);
  });

  it("wcs-contacts:loading-changed(false) で loading が off に戻る", () => {
    const el = createContactsElement();
    el.dispatchEvent(new CustomEvent("wcs-contacts:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-contacts:loading-changed", { detail: false }));
    expect(getStates(el)?.has("loading")).toBe(false);
  });

  it("wcs-contacts:cancelled-changed(true) で cancelled が on になる", () => {
    const el = createContactsElement();
    el.dispatchEvent(new CustomEvent("wcs-contacts:cancelled-changed", { detail: true }));
    expect(getStates(el)?.has("cancelled")).toBe(true);
  });

  it("wcs-contacts:cancelled-changed(false) で cancelled が off に戻る", () => {
    const el = createContactsElement();
    el.dispatchEvent(new CustomEvent("wcs-contacts:cancelled-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-contacts:cancelled-changed", { detail: false }));
    expect(getStates(el)?.has("cancelled")).toBe(false);
  });

  it("wcs-contacts:error が非nullなら error が on になる", () => {
    const el = createContactsElement();
    el.dispatchEvent(new CustomEvent("wcs-contacts:error", { detail: { message: "boom" } }));
    expect(getStates(el)?.has("error")).toBe(true);
  });

  it("wcs-contacts:error がnullなら error が off に戻る", () => {
    const el = createContactsElement();
    el.dispatchEvent(new CustomEvent("wcs-contacts:error", { detail: { message: "boom" } }));
    el.dispatchEvent(new CustomEvent("wcs-contacts:error", { detail: null }));
    expect(getStates(el)?.has("error")).toBe(false);
  });

  it("attachInternals 不在でも throw しない（debugStates は空配列）", () => {
    const proto = HTMLElement.prototype as any;
    const original = proto.attachInternals;
    delete proto.attachInternals;

    let el!: WcsContacts;
    try {
      expect(() => {
        el = document.createElement("wcs-contacts") as WcsContacts;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-contacts:loading-changed", { detail: true }));
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

    let el!: WcsContacts;
    try {
      expect(() => {
        el = document.createElement("wcs-contacts") as WcsContacts;
      }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }

    expect(el.debugStates).toEqual([]);
    expect(() => {
      el.dispatchEvent(new CustomEvent("wcs-contacts:loading-changed", { detail: true }));
    }).not.toThrow();
  });

  it("debugStates はスナップショットを返す（返り値を変更しても states に影響しない）", () => {
    const el = createContactsElement();
    el.dispatchEvent(new CustomEvent("wcs-contacts:loading-changed", { detail: true }));

    const snapshot = el.debugStates;
    snapshot.push("injected");

    expect(el.debugStates).toEqual(["loading"]);
    expect(getStates(el)?.has("injected")).toBe(false);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = createContactsElement();
    el.setAttribute("debug-states", "");

    el.dispatchEvent(new CustomEvent("wcs-contacts:loading-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-contacts:loading-changed", { detail: false }));
    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);

    el.dispatchEvent(new CustomEvent("wcs-contacts:cancelled-changed", { detail: true }));
    expect(el.hasAttribute("data-wcs-state-cancelled")).toBe(true);

    el.dispatchEvent(new CustomEvent("wcs-contacts:error", { detail: { message: "boom" } }));
    expect(el.hasAttribute("data-wcs-state-error")).toBe(true);
  });

  it("debug-states 属性なしでは data-wcs-state-* が一切書かれない", () => {
    const el = createContactsElement();

    el.dispatchEvent(new CustomEvent("wcs-contacts:loading-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-contacts:cancelled-changed", { detail: true }));
    el.dispatchEvent(new CustomEvent("wcs-contacts:error", { detail: { message: "boom" } }));

    expect(el.hasAttribute("data-wcs-state-loading")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-cancelled")).toBe(false);
    expect(el.hasAttribute("data-wcs-state-error")).toBe(false);
  });
});
