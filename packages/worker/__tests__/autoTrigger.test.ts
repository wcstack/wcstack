import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapWorker } from "../src/bootstrapWorker";
import { setConfig } from "../src/config";
import { WcsWorker } from "../src/components/Worker";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";
import { installWorker, restoreWorker } from "./mocks";

describe("autoTrigger", () => {
  beforeEach(() => {
    setConfig({ autoTrigger: false, triggerAttribute: "data-worker-target", tagNames: { worker: "wcs-worker" } });
    bootstrapWorker();
    installWorker();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    restoreWorker();
  });

  // Every <wcs-worker> needs a src so it spawns a (fake) worker and `post`
  // delegates to a live Core — otherwise post() would error InvalidStateError.
  function appendWorker(id: string): WcsWorker {
    const el = document.createElement("wcs-worker") as WcsWorker;
    el.setAttribute("id", id);
    el.setAttribute("src", "w.js");
    document.body.appendChild(el);
    return el;
  }

  function appendButton(attrs: Record<string, string>): HTMLButtonElement {
    const button = document.createElement("button");
    for (const [k, v] of Object.entries(attrs)) button.setAttribute(k, v);
    document.body.appendChild(button);
    return button;
  }

  it("data-worker-text のリテラルをクリックで post する", () => {
    registerAutoTrigger();
    const el = appendWorker("w1");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-worker-target": "w1", "data-worker-text": "hello" });

    button.click();
    expect(spy).toHaveBeenCalledWith("hello");
  });

  it("data-worker-from のセレクタから input の value を読む", () => {
    registerAutoTrigger();
    const el = appendWorker("w2");
    const spy = vi.spyOn(el, "post");
    const input = document.createElement("input");
    input.id = "src-input";
    input.value = "from input";
    document.body.appendChild(input);
    const button = appendButton({ "data-worker-target": "w2", "data-worker-from": "#src-input" });

    button.click();
    expect(spy).toHaveBeenCalledWith("from input");
  });

  it("data-worker-from のセレクタから textarea の value を読む", () => {
    registerAutoTrigger();
    const el = appendWorker("w2t");
    const spy = vi.spyOn(el, "post");
    const textarea = document.createElement("textarea");
    textarea.id = "src-textarea";
    textarea.value = "from textarea";
    document.body.appendChild(textarea);
    const button = appendButton({ "data-worker-target": "w2t", "data-worker-from": "#src-textarea" });

    button.click();
    expect(spy).toHaveBeenCalledWith("from textarea");
  });

  it("data-worker-from のセレクタから select の value を読む", () => {
    registerAutoTrigger();
    const el = appendWorker("w2s");
    const spy = vi.spyOn(el, "post");
    const select = document.createElement("select");
    select.id = "src-select";
    const option = document.createElement("option");
    option.value = "opt-1";
    option.textContent = "Option 1";
    select.appendChild(option);
    document.body.appendChild(select);
    select.value = "opt-1";
    const button = appendButton({ "data-worker-target": "w2s", "data-worker-from": "#src-select" });

    button.click();
    expect(spy).toHaveBeenCalledWith("opt-1");
  });

  it("value を持つ非テキスト入力要素（button 等）は textContent を読む", () => {
    registerAutoTrigger();
    const el = appendWorker("w2b");
    const spy = vi.spyOn(el, "post");
    const source = document.createElement("button");
    source.id = "src-button";
    source.value = "btn-value";
    source.textContent = "button text";
    document.body.appendChild(source);
    const button = appendButton({ "data-worker-target": "w2b", "data-worker-from": "#src-button" });

    button.click();
    expect(spy).toHaveBeenCalledWith("button text");
  });

  it("data-worker-from のセレクタから要素の textContent を読む", () => {
    registerAutoTrigger();
    const el = appendWorker("w3");
    const spy = vi.spyOn(el, "post");
    const div = document.createElement("div");
    div.id = "src-div";
    div.textContent = "from div";
    document.body.appendChild(div);
    const button = appendButton({ "data-worker-target": "w3", "data-worker-from": "#src-div" });

    button.click();
    expect(spy).toHaveBeenCalledWith("from div");
  });

  it("data-worker-from のセレクタが見つからなければ何もしない", () => {
    registerAutoTrigger();
    const el = appendWorker("w4");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-worker-target": "w4", "data-worker-from": "#nope" });

    button.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("不正な CSS セレクタ（SyntaxError）でもクラッシュせず何もしない", () => {
    registerAutoTrigger();
    const el = appendWorker("w4s");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-worker-target": "w4s", "data-worker-from": "[data-*" });

    expect(() => button.click()).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("テキスト指定が一切なければ何もしない", () => {
    registerAutoTrigger();
    const el = appendWorker("w5");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-worker-target": "w5" });

    button.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("存在しないIDの場合は何もしない", () => {
    registerAutoTrigger();
    const button = appendButton({ "data-worker-target": "nonexistent", "data-worker-text": "x" });
    expect(() => button.click()).not.toThrow();
  });

  it("空の triggerAttribute 値の場合は何もしない", () => {
    registerAutoTrigger();
    const button = appendButton({ "data-worker-target": "", "data-worker-text": "x" });
    expect(() => button.click()).not.toThrow();
  });

  it("wcs-worker 以外の要素では発火しない", () => {
    registerAutoTrigger();
    const div = document.createElement("div");
    div.setAttribute("id", "not-w");
    document.body.appendChild(div);
    const button = appendButton({ "data-worker-target": "not-w", "data-worker-text": "x" });
    expect(() => button.click()).not.toThrow();
  });

  it("unregisterAutoTrigger でリスナーが解除される", () => {
    registerAutoTrigger();
    unregisterAutoTrigger();
    const el = appendWorker("w6");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-worker-target": "w6", "data-worker-text": "x" });

    button.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("registerAutoTrigger を複数回呼んでも重複登録しない", () => {
    registerAutoTrigger();
    registerAutoTrigger();
    const el = appendWorker("w7");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-worker-target": "w7", "data-worker-text": "x" });

    button.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("event.target が Element でない場合は何もしない", () => {
    registerAutoTrigger();
    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: null });
    expect(() => document.dispatchEvent(event)).not.toThrow();
  });

  it("data-worker-target を持たない要素のクリックは無視する", () => {
    registerAutoTrigger();
    const button = appendButton({});
    expect(() => button.click()).not.toThrow();
  });

  it("ネストされた要素のクリックでも動作する", () => {
    registerAutoTrigger();
    const el = appendWorker("w8");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-worker-target": "w8", "data-worker-text": "nested" });
    const span = document.createElement("span");
    span.textContent = "Send";
    button.appendChild(span);

    span.click();
    expect(spy).toHaveBeenCalledWith("nested");
  });

  it("空文字リテラル（data-worker-text=\"\"）も post 対象", () => {
    registerAutoTrigger();
    const el = appendWorker("w9");
    const spy = vi.spyOn(el, "post");
    const button = appendButton({ "data-worker-target": "w9", "data-worker-text": "" });

    button.click();
    expect(spy).toHaveBeenCalledWith("");
  });
});
