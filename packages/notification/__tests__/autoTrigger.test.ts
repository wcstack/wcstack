import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WcsNotify } from "../src/components/Notify.js";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger.js";
import { setConfig } from "../src/config.js";
import { installNotification, removeNotification, removePermissions } from "./mocks.js";

if (!customElements.get("wcs-notify")) {
  customElements.define("wcs-notify", WcsNotify);
}

let el: WcsNotify;

async function mount(): Promise<WcsNotify> {
  el = document.createElement("wcs-notify") as WcsNotify;
  el.id = "n";
  document.body.appendChild(el);
  await el.connectedCallbackPromise;
  return el;
}

beforeEach(() => {
  installNotification({ permission: "granted" });
  removePermissions();
  registerAutoTrigger();
});

afterEach(() => {
  el?.remove();
  document.body.innerHTML = "";
  unregisterAutoTrigger();
  removeNotification();
  removePermissions();
  setConfig({ triggerAttribute: "data-notifytarget" });
});

describe("data-notifytarget の click ショートカット", () => {
  it("trigger のテキストを title として notification を表示する", async () => {
    await mount();
    const spy = vi.spyOn(el, "notify");
    const btn = document.createElement("button");
    btn.setAttribute("data-notifytarget", "n");
    btn.textContent = "  Ping  ";
    document.body.appendChild(btn);
    btn.click();
    expect(spy).toHaveBeenCalledWith("Ping", undefined);
  });

  it("data-notifytitle と data-notifybody があればそれを使う", async () => {
    await mount();
    const spy = vi.spyOn(el, "notify");
    const btn = document.createElement("button");
    btn.setAttribute("data-notifytarget", "n");
    btn.setAttribute("data-notifytitle", "Title");
    btn.setAttribute("data-notifybody", "Body");
    document.body.appendChild(btn);
    btn.click();
    expect(spy).toHaveBeenCalledWith("Title", { body: "Body" });
  });

  it("trigger 祖先のない click を無視する", async () => {
    await mount();
    const spy = vi.spyOn(el, "notify");
    const plain = document.createElement("div");
    document.body.appendChild(plain);
    plain.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("空の id 参照を持つ trigger を無視する", async () => {
    await mount();
    const spy = vi.spyOn(el, "notify");
    const btn = document.createElement("button");
    btn.setAttribute("data-notifytarget", "");
    document.body.appendChild(btn);
    btn.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("<wcs-notify> 以外の要素を指す trigger を無視する", async () => {
    await mount();
    const spy = vi.spyOn(el, "notify");
    const other = document.createElement("div");
    other.id = "other";
    document.body.appendChild(other);
    const btn = document.createElement("button");
    btn.setAttribute("data-notifytarget", "other");
    document.body.appendChild(btn);
    btn.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("不正な triggerAttribute（無効なセレクタ）に耐える", async () => {
    setConfig({ triggerAttribute: "bad attr" });
    await mount();
    // The invalid selector `[bad attr]` makes closest() throw; the handler must
    // swallow it. Any click on an element exercises the guard.
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    expect(() => btn.click()).not.toThrow();
  });

  it("target が Element でない click を無視する", () => {
    // Dispatch a click with no composed Element target path: dispatch on document.
    expect(() => document.dispatchEvent(new Event("click"))).not.toThrow();
  });
});

describe("register/unregister の冪等性", () => {
  it("1 度だけ register し、きれいに unregister する", () => {
    // Already registered in beforeEach; a second call is a no-op.
    registerAutoTrigger();
    unregisterAutoTrigger();
    // A second unregister is also a no-op.
    expect(() => unregisterAutoTrigger()).not.toThrow();
  });
});
