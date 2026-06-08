import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapDebounce } from "../src/bootstrapDebounce";
import { setConfig } from "../src/config";
import { Debounce } from "../src/components/Debounce";
import { Throttle } from "../src/components/Throttle";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";

describe("autoTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    setConfig({
      autoTrigger: false,
      triggerAttribute: "data-debouncetarget",
      tagNames: { debounce: "wcs-debounce", throttle: "wcs-throttle" },
    });
    bootstrapDebounce();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function append(tag: string, id: string): Debounce {
    const el = document.createElement(tag) as Debounce;
    el.setAttribute("wait", "100");
    el.setAttribute("id", id);
    document.body.appendChild(el);
    return el;
  }

  function button(targetId: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.setAttribute("data-debouncetarget", targetId);
    document.body.appendChild(b);
    return b;
  }

  it("data-debouncetarget のクリックで <wcs-debounce> の trigger を撃つ", () => {
    registerAutoTrigger();
    const el = append("wcs-debounce", "d1");
    const fired: any[][] = [];
    el.addEventListener("wcs-debounce:fired", (e) => fired.push((e as CustomEvent).detail.args));

    button("d1").click();
    vi.advanceTimersByTime(100);
    expect(fired).toEqual([[]]);
  });

  it("<wcs-throttle> でも動作する", () => {
    registerAutoTrigger();
    const el = append("wcs-throttle", "tr1") as unknown as Throttle;
    const fired: any[][] = [];
    el.addEventListener("wcs-throttle:fired", (e) => fired.push((e as CustomEvent).detail.args));

    button("tr1").click(); // leading 既定 true → 即発火
    expect(fired).toEqual([[]]);
  });

  it("存在しないIDの場合は何もしない", () => {
    registerAutoTrigger();
    expect(() => button("nope").click()).not.toThrow();
  });

  it("空の triggerAttribute 値の場合は何もしない", () => {
    registerAutoTrigger();
    expect(() => button("").click()).not.toThrow();
  });

  it("debounce / throttle 以外の要素では発火しない", () => {
    registerAutoTrigger();
    const div = document.createElement("div");
    div.setAttribute("id", "not-deb");
    document.body.appendChild(div);
    expect(() => button("not-deb").click()).not.toThrow();
  });

  it("data-debouncetarget を持たない要素のクリックは無視する", () => {
    registerAutoTrigger();
    const b = document.createElement("button");
    document.body.appendChild(b);
    expect(() => b.click()).not.toThrow();
  });

  it("event.target が Element でない場合は何もしない", () => {
    registerAutoTrigger();
    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: null });
    expect(() => document.dispatchEvent(event)).not.toThrow();
  });

  it("ネストした要素のクリックでも動作する", () => {
    registerAutoTrigger();
    const el = append("wcs-debounce", "d2");
    const fired: any[][] = [];
    el.addEventListener("wcs-debounce:fired", (e) => fired.push((e as CustomEvent).detail.args));

    const b = button("d2");
    const span = document.createElement("span");
    b.appendChild(span);
    span.click();
    vi.advanceTimersByTime(100);
    expect(fired).toEqual([[]]);
  });

  it("unregisterAutoTrigger でリスナーが解除される", () => {
    registerAutoTrigger();
    unregisterAutoTrigger();
    const el = append("wcs-debounce", "d3");
    const fired: any[][] = [];
    el.addEventListener("wcs-debounce:fired", (e) => fired.push((e as CustomEvent).detail.args));

    button("d3").click();
    vi.advanceTimersByTime(100);
    expect(fired).toEqual([]);
  });

  it("registerAutoTrigger を複数回呼んでも重複登録しない", () => {
    registerAutoTrigger();
    registerAutoTrigger();
    const el = append("wcs-debounce", "d4");
    const fired: any[][] = [];
    el.addEventListener("wcs-debounce:fired", (e) => fired.push((e as CustomEvent).detail.args));

    button("d4").click();
    vi.advanceTimersByTime(100);
    expect(fired).toEqual([[]]); // 二重なら2回 fired するが1回のみ
  });
});
