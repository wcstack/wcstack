import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bootstrapRaf } from "../src/bootstrapRaf";
import { setConfig } from "../src/config";
import { Raf } from "../src/components/Raf";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";
import { FakeScheduler, installGlobalRafMock } from "./helpers";

describe("autoTrigger", () => {
  let scheduler: FakeScheduler;
  let uninstall: () => void;

  beforeEach(() => {
    scheduler = new FakeScheduler();
    uninstall = installGlobalRafMock(scheduler);
    setConfig({ autoTrigger: false, triggerAttribute: "data-raftarget", tagNames: { raf: "wcs-raf" } });
    bootstrapRaf();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    document.body.innerHTML = "";
    uninstall();
  });

  function appendRaf(id: string): Raf {
    const el = document.createElement("wcs-raf") as Raf;
    el.setAttribute("manual", "");
    el.setAttribute("id", id);
    document.body.appendChild(el);
    return el;
  }

  it("data-raftarget 属性のクリックで開始する", () => {
    registerAutoTrigger();
    const el = appendRaf("r1");

    const button = document.createElement("button");
    button.setAttribute("data-raftarget", "r1");
    document.body.appendChild(button);

    button.click();
    expect(el.running).toBe(true);
  });

  it("マッチしたクリックは preventDefault される（README の契約）", () => {
    registerAutoTrigger();
    const el = appendRaf("r5");

    const button = document.createElement("button");
    button.setAttribute("data-raftarget", "r5");
    document.body.appendChild(button);

    const event = new Event("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(el.running).toBe(true);
  });

  it("存在しないIDの場合は何もしない（番兵は start されず preventDefault もされない）", () => {
    registerAutoTrigger();
    const sentinel = appendRaf("sentinel");
    const button = document.createElement("button");
    button.setAttribute("data-raftarget", "nonexistent");
    document.body.appendChild(button);

    const event = new Event("click", { bubbles: true, cancelable: true });
    expect(() => button.dispatchEvent(event)).not.toThrow();
    expect(sentinel.running).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("空の triggerAttribute 値の場合は何もしない（番兵は start されず preventDefault もされない）", () => {
    registerAutoTrigger();
    const sentinel = appendRaf("sentinel");
    const button = document.createElement("button");
    button.setAttribute("data-raftarget", "");
    document.body.appendChild(button);

    const event = new Event("click", { bubbles: true, cancelable: true });
    expect(() => button.dispatchEvent(event)).not.toThrow();
    expect(sentinel.running).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("wcs-raf 以外の要素では発火しない（番兵は start されず preventDefault もされない）", () => {
    registerAutoTrigger();
    const sentinel = appendRaf("sentinel");
    const div = document.createElement("div");
    div.setAttribute("id", "not-raf");
    document.body.appendChild(div);

    const button = document.createElement("button");
    button.setAttribute("data-raftarget", "not-raf");
    document.body.appendChild(button);

    const event = new Event("click", { bubbles: true, cancelable: true });
    expect(() => button.dispatchEvent(event)).not.toThrow();
    expect(sentinel.running).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("unregisterAutoTrigger でリスナーが解除される", () => {
    registerAutoTrigger();
    unregisterAutoTrigger();
    const el = appendRaf("r2");

    const button = document.createElement("button");
    button.setAttribute("data-raftarget", "r2");
    document.body.appendChild(button);

    button.click();
    expect(el.running).toBe(false);
  });

  it("registerAutoTrigger を複数回呼んでも重複登録しない", () => {
    registerAutoTrigger();
    registerAutoTrigger();
    const el = appendRaf("r3");

    const button = document.createElement("button");
    button.setAttribute("data-raftarget", "r3");
    document.body.appendChild(button);

    button.click();
    scheduler.pump(1000);
    expect(el.tick).toBe(1);
  });

  it("event.target が Element でない場合は何もしない", () => {
    registerAutoTrigger();
    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: null });
    expect(() => document.dispatchEvent(event)).not.toThrow();
  });

  it("data-raftarget を持たない要素のクリックは無視する", () => {
    registerAutoTrigger();
    const button = document.createElement("button");
    document.body.appendChild(button);
    expect(() => button.click()).not.toThrow();
  });

  it("ネストされた要素のクリックでも動作する", () => {
    registerAutoTrigger();
    const el = appendRaf("r4");

    const button = document.createElement("button");
    button.setAttribute("data-raftarget", "r4");
    const span = document.createElement("span");
    span.textContent = "Start";
    button.appendChild(span);
    document.body.appendChild(button);

    span.click();
    expect(el.running).toBe(true);
  });
});
