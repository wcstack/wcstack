import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapBroadcast } from "../src/bootstrapBroadcast";
import { setConfig } from "../src/config";
import { WcsBroadcast } from "../src/components/Broadcast";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";
import { installBroadcastChannel, restoreBroadcastChannel } from "./mocks";

describe("autoTrigger", () => {
  beforeEach(() => {
    setConfig({ autoTrigger: false, triggerAttribute: "data-broadcast-target", tagNames: { broadcast: "wcs-broadcast" } });
    bootstrapBroadcast();
    installBroadcastChannel();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    restoreBroadcastChannel();
  });

  function appendBroadcast(id: string): WcsBroadcast {
    const el = document.createElement("wcs-broadcast") as WcsBroadcast;
    el.setAttribute("id", id);
    document.body.appendChild(el);
    return el;
  }

  function appendButton(attrs: Record<string, string>): HTMLButtonElement {
    const button = document.createElement("button");
    for (const [k, v] of Object.entries(attrs)) button.setAttribute(k, v);
    document.body.appendChild(button);
    return button;
  }

  it("data-broadcast-text のリテラルをクリックで post する", () => {
    registerAutoTrigger();
    const el = appendBroadcast("b1");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-broadcast-target": "b1", "data-broadcast-text": "hello" });

    button.click();
    expect(spy).toHaveBeenCalledWith("hello");
  });

  it("data-broadcast-from のセレクタから input の value を読む", () => {
    registerAutoTrigger();
    const el = appendBroadcast("b2");
    const spy = vi.spyOn(el, "post");
    const input = document.createElement("input");
    input.id = "src-input";
    input.value = "from input";
    document.body.appendChild(input);
    const button = appendButton({ "data-broadcast-target": "b2", "data-broadcast-from": "#src-input" });

    button.click();
    expect(spy).toHaveBeenCalledWith("from input");
  });

  it("data-broadcast-from のセレクタから textarea の value を読む", () => {
    registerAutoTrigger();
    const el = appendBroadcast("b2t");
    const spy = vi.spyOn(el, "post");
    const textarea = document.createElement("textarea");
    textarea.id = "src-textarea";
    textarea.value = "from textarea";
    document.body.appendChild(textarea);
    const button = appendButton({ "data-broadcast-target": "b2t", "data-broadcast-from": "#src-textarea" });

    button.click();
    expect(spy).toHaveBeenCalledWith("from textarea");
  });

  it("data-broadcast-from のセレクタから select の value を読む", () => {
    registerAutoTrigger();
    const el = appendBroadcast("b2s");
    const spy = vi.spyOn(el, "post");
    const select = document.createElement("select");
    select.id = "src-select";
    const option = document.createElement("option");
    option.value = "opt-1";
    option.textContent = "Option 1";
    select.appendChild(option);
    document.body.appendChild(select);
    select.value = "opt-1";
    const button = appendButton({ "data-broadcast-target": "b2s", "data-broadcast-from": "#src-select" });

    button.click();
    expect(spy).toHaveBeenCalledWith("opt-1");
  });

  it("value を持つ非テキスト入力要素（button 等）は textContent を読む", () => {
    registerAutoTrigger();
    const el = appendBroadcast("b2b");
    const spy = vi.spyOn(el, "post");
    const source = document.createElement("button");
    source.id = "src-button";
    source.value = "btn-value";
    source.textContent = "button text";
    document.body.appendChild(source);
    const button = appendButton({ "data-broadcast-target": "b2b", "data-broadcast-from": "#src-button" });

    button.click();
    expect(spy).toHaveBeenCalledWith("button text");
  });

  it("data-broadcast-from のセレクタから要素の textContent を読む", () => {
    registerAutoTrigger();
    const el = appendBroadcast("b3");
    const spy = vi.spyOn(el, "post");
    const div = document.createElement("div");
    div.id = "src-div";
    div.textContent = "from div";
    document.body.appendChild(div);
    const button = appendButton({ "data-broadcast-target": "b3", "data-broadcast-from": "#src-div" });

    button.click();
    expect(spy).toHaveBeenCalledWith("from div");
  });

  it("data-broadcast-from のセレクタが見つからなければ何もしない", () => {
    registerAutoTrigger();
    const el = appendBroadcast("b4");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-broadcast-target": "b4", "data-broadcast-from": "#nope" });

    button.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("不正な CSS セレクタ（SyntaxError）でもクラッシュせず何もしない", () => {
    registerAutoTrigger();
    const el = appendBroadcast("b4s");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-broadcast-target": "b4s", "data-broadcast-from": "[data-*" });

    expect(() => button.click()).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("テキスト指定が一切なければ何もしない", () => {
    registerAutoTrigger();
    const el = appendBroadcast("b5");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-broadcast-target": "b5" });

    button.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("存在しないIDの場合は何もしない", () => {
    registerAutoTrigger();
    const button = appendButton({ "data-broadcast-target": "nonexistent", "data-broadcast-text": "x" });
    expect(() => button.click()).not.toThrow();
  });

  it("空の triggerAttribute 値の場合は何もしない", () => {
    registerAutoTrigger();
    const button = appendButton({ "data-broadcast-target": "", "data-broadcast-text": "x" });
    expect(() => button.click()).not.toThrow();
  });

  it("wcs-broadcast 以外の要素では発火しない", () => {
    registerAutoTrigger();
    const div = document.createElement("div");
    div.setAttribute("id", "not-bc");
    document.body.appendChild(div);
    const button = appendButton({ "data-broadcast-target": "not-bc", "data-broadcast-text": "x" });
    expect(() => button.click()).not.toThrow();
  });

  it("unregisterAutoTrigger でリスナーが解除される", () => {
    registerAutoTrigger();
    unregisterAutoTrigger();
    const el = appendBroadcast("b6");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-broadcast-target": "b6", "data-broadcast-text": "x" });

    button.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("registerAutoTrigger を複数回呼んでも重複登録しない", () => {
    registerAutoTrigger();
    registerAutoTrigger();
    const el = appendBroadcast("b7");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-broadcast-target": "b7", "data-broadcast-text": "x" });

    button.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("event.target が Element でない場合は何もしない", () => {
    registerAutoTrigger();
    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: null });
    expect(() => document.dispatchEvent(event)).not.toThrow();
  });

  it("data-broadcast-target を持たない要素のクリックは無視する", () => {
    registerAutoTrigger();
    const button = appendButton({});
    expect(() => button.click()).not.toThrow();
  });

  it("ネストされた要素のクリックでも動作する", () => {
    registerAutoTrigger();
    const el = appendBroadcast("b8");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-broadcast-target": "b8", "data-broadcast-text": "nested" });
    const span = document.createElement("span");
    span.textContent = "Send";
    button.appendChild(span);

    span.click();
    expect(spy).toHaveBeenCalledWith("nested");
  });

  it("空文字リテラル（data-broadcast-text=\"\"）も post 対象", () => {
    registerAutoTrigger();
    const el = appendBroadcast("b9");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-broadcast-target": "b9", "data-broadcast-text": "" });

    button.click();
    expect(spy).toHaveBeenCalledWith("");
  });
});
