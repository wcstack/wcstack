import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapGeolocation } from "../src/bootstrapGeolocation";
import { setConfig } from "../src/config";
import { WcsGeolocation } from "../src/components/Geolocation";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";
import { installGeolocation, removeGeolocation, removePermissions } from "./mocks";

describe("autoTrigger", () => {
  beforeEach(() => {
    setConfig({ autoTrigger: false, triggerAttribute: "data-geotarget", tagNames: { geo: "wcs-geo" } });
    bootstrapGeolocation();
    installGeolocation();
    removePermissions();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removeGeolocation();
    removePermissions();
  });

  function appendGeo(id: string): WcsGeolocation {
    const el = document.createElement("wcs-geo") as WcsGeolocation;
    el.setAttribute("manual", "");
    el.setAttribute("id", id);
    document.body.appendChild(el);
    return el;
  }

  it("data-geotarget 属性のクリックで一発取得する", () => {
    registerAutoTrigger();
    const el = appendGeo("g1");
    const spy = vi.spyOn(el, "getCurrentPosition");

    const button = document.createElement("button");
    button.setAttribute("data-geotarget", "g1");
    document.body.appendChild(button);

    button.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("存在しないIDの場合は何もしない", () => {
    registerAutoTrigger();
    const button = document.createElement("button");
    button.setAttribute("data-geotarget", "nonexistent");
    document.body.appendChild(button);
    expect(() => button.click()).not.toThrow();
  });

  it("空の triggerAttribute 値の場合は何もしない", () => {
    registerAutoTrigger();
    const button = document.createElement("button");
    button.setAttribute("data-geotarget", "");
    document.body.appendChild(button);
    expect(() => button.click()).not.toThrow();
  });

  it("wcs-geo 以外の要素では発火しない", () => {
    registerAutoTrigger();
    const div = document.createElement("div");
    div.setAttribute("id", "not-geo");
    document.body.appendChild(div);

    const button = document.createElement("button");
    button.setAttribute("data-geotarget", "not-geo");
    document.body.appendChild(button);
    expect(() => button.click()).not.toThrow();
  });

  it("unregisterAutoTrigger でリスナーが解除される", () => {
    registerAutoTrigger();
    unregisterAutoTrigger();
    const el = appendGeo("g2");
    const spy = vi.spyOn(el, "getCurrentPosition");

    const button = document.createElement("button");
    button.setAttribute("data-geotarget", "g2");
    document.body.appendChild(button);

    button.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("registerAutoTrigger を複数回呼んでも重複登録しない", () => {
    registerAutoTrigger();
    registerAutoTrigger();
    const el = appendGeo("g3");
    const spy = vi.spyOn(el, "getCurrentPosition");

    const button = document.createElement("button");
    button.setAttribute("data-geotarget", "g3");
    document.body.appendChild(button);

    button.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("event.target が Element でない場合は何もしない", () => {
    registerAutoTrigger();
    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: null });
    expect(() => document.dispatchEvent(event)).not.toThrow();
  });

  it("data-geotarget を持たない要素のクリックは無視する", () => {
    registerAutoTrigger();
    const button = document.createElement("button");
    document.body.appendChild(button);
    expect(() => button.click()).not.toThrow();
  });

  it("ネストされた要素のクリックでも動作する", () => {
    registerAutoTrigger();
    const el = appendGeo("g4");
    const spy = vi.spyOn(el, "getCurrentPosition");

    const button = document.createElement("button");
    button.setAttribute("data-geotarget", "g4");
    const span = document.createElement("span");
    span.textContent = "Locate";
    button.appendChild(span);
    document.body.appendChild(button);

    span.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
