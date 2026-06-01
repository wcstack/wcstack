import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapTimer } from "../src/bootstrapTimer";
import { setConfig } from "../src/config";
import { Timer } from "../src/components/Timer";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";

describe("autoTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setConfig({ autoTrigger: false, triggerAttribute: "data-timertarget", tagNames: { timer: "wcs-timer" } });
    bootstrapTimer();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function appendTimer(id: string): Timer {
    const el = document.createElement("wcs-timer") as Timer;
    el.setAttribute("interval", "1000");
    el.setAttribute("manual", "");
    el.setAttribute("id", id);
    document.body.appendChild(el);
    return el;
  }

  it("data-timertarget 属性のクリックで開始する", () => {
    registerAutoTrigger();
    const el = appendTimer("t1");

    const button = document.createElement("button");
    button.setAttribute("data-timertarget", "t1");
    document.body.appendChild(button);

    button.click();
    expect(el.running).toBe(true);
  });

  it("存在しないIDの場合は何もしない", () => {
    registerAutoTrigger();
    const button = document.createElement("button");
    button.setAttribute("data-timertarget", "nonexistent");
    document.body.appendChild(button);
    expect(() => button.click()).not.toThrow();
  });

  it("空の triggerAttribute 値の場合は何もしない", () => {
    registerAutoTrigger();
    const button = document.createElement("button");
    button.setAttribute("data-timertarget", "");
    document.body.appendChild(button);
    expect(() => button.click()).not.toThrow();
  });

  it("wcs-timer 以外の要素では発火しない", () => {
    registerAutoTrigger();
    const div = document.createElement("div");
    div.setAttribute("id", "not-timer");
    document.body.appendChild(div);

    const button = document.createElement("button");
    button.setAttribute("data-timertarget", "not-timer");
    document.body.appendChild(button);
    expect(() => button.click()).not.toThrow();
  });

  it("unregisterAutoTrigger でリスナーが解除される", () => {
    registerAutoTrigger();
    unregisterAutoTrigger();
    const el = appendTimer("t2");

    const button = document.createElement("button");
    button.setAttribute("data-timertarget", "t2");
    document.body.appendChild(button);

    button.click();
    expect(el.running).toBe(false);
  });

  it("registerAutoTrigger を複数回呼んでも重複登録しない", () => {
    registerAutoTrigger();
    registerAutoTrigger();
    const el = appendTimer("t3");

    const button = document.createElement("button");
    button.setAttribute("data-timertarget", "t3");
    document.body.appendChild(button);

    button.click();
    // 重複していたら start が2回呼ばれるが running は等しく true、二重 setInterval を確認
    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(1);
  });

  it("event.target が Element でない場合は何もしない", () => {
    registerAutoTrigger();
    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: null });
    expect(() => document.dispatchEvent(event)).not.toThrow();
  });

  it("data-timertarget を持たない要素のクリックは無視する", () => {
    registerAutoTrigger();
    const button = document.createElement("button");
    document.body.appendChild(button);
    expect(() => button.click()).not.toThrow();
  });

  it("ネストされた要素のクリックでも動作する", () => {
    registerAutoTrigger();
    const el = appendTimer("t4");

    const button = document.createElement("button");
    button.setAttribute("data-timertarget", "t4");
    const span = document.createElement("span");
    span.textContent = "Start";
    button.appendChild(span);
    document.body.appendChild(button);

    span.click();
    expect(el.running).toBe(true);
  });
});
