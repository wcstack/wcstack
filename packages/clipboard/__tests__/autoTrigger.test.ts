import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapClipboard } from "../src/bootstrapClipboard";
import { setConfig } from "../src/config";
import { WcsClipboard } from "../src/components/Clipboard";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";
import { installClipboard, removeClipboard, removePermissions } from "./mocks";

describe("autoTrigger", () => {
  beforeEach(() => {
    setConfig({ autoTrigger: false, triggerAttribute: "data-clipboardtarget", tagNames: { clipboard: "wcs-clipboard" } });
    bootstrapClipboard();
    installClipboard();
    removePermissions();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removeClipboard();
    removePermissions();
  });

  function appendClipboard(id: string): WcsClipboard {
    const el = document.createElement("wcs-clipboard") as WcsClipboard;
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

  it("data-clipboard-text のリテラルをクリックで書き込む", () => {
    registerAutoTrigger();
    const el = appendClipboard("c1");
    const spy = vi.spyOn(el, "writeText");
    const button = appendButton({ "data-clipboardtarget": "c1", "data-clipboard-text": "hello" });

    button.click();
    expect(spy).toHaveBeenCalledWith("hello");
  });

  it("data-clipboard-from のセレクタから input の value を読む", () => {
    registerAutoTrigger();
    const el = appendClipboard("c2");
    const spy = vi.spyOn(el, "writeText");
    const input = document.createElement("input");
    input.id = "src-input";
    input.value = "from input";
    document.body.appendChild(input);
    const button = appendButton({ "data-clipboardtarget": "c2", "data-clipboard-from": "#src-input" });

    button.click();
    expect(spy).toHaveBeenCalledWith("from input");
  });

  it("data-clipboard-from のセレクタから textarea の value を読む", () => {
    registerAutoTrigger();
    const el = appendClipboard("c2t");
    const spy = vi.spyOn(el, "writeText");
    const textarea = document.createElement("textarea");
    textarea.id = "src-textarea";
    textarea.value = "from textarea";
    document.body.appendChild(textarea);
    const button = appendButton({ "data-clipboardtarget": "c2t", "data-clipboard-from": "#src-textarea" });

    button.click();
    expect(spy).toHaveBeenCalledWith("from textarea");
  });

  it("data-clipboard-from のセレクタから select の value を読む", () => {
    registerAutoTrigger();
    const el = appendClipboard("c2s");
    const spy = vi.spyOn(el, "writeText");
    const select = document.createElement("select");
    select.id = "src-select";
    const option = document.createElement("option");
    option.value = "opt-1";
    option.textContent = "Option 1";
    select.appendChild(option);
    document.body.appendChild(select);
    select.value = "opt-1";
    const button = appendButton({ "data-clipboardtarget": "c2s", "data-clipboard-from": "#src-select" });

    button.click();
    expect(spy).toHaveBeenCalledWith("opt-1");
  });

  it("value を持つ非テキスト入力要素（button 等）は textContent を読む", () => {
    // `"value" in source` だと <button>（value=""）の value 側に分岐してしまうが、
    // instanceof 厳密判定により textContent にフォールバックする。
    registerAutoTrigger();
    const el = appendClipboard("c2b");
    const spy = vi.spyOn(el, "writeText");
    const source = document.createElement("button");
    source.id = "src-button";
    source.value = "btn-value";
    source.textContent = "button text";
    document.body.appendChild(source);
    const button = appendButton({ "data-clipboardtarget": "c2b", "data-clipboard-from": "#src-button" });

    button.click();
    expect(spy).toHaveBeenCalledWith("button text");
  });

  it("data-clipboard-from のセレクタから要素の textContent を読む", () => {
    registerAutoTrigger();
    const el = appendClipboard("c3");
    const spy = vi.spyOn(el, "writeText");
    const div = document.createElement("div");
    div.id = "src-div";
    div.textContent = "from div";
    document.body.appendChild(div);
    const button = appendButton({ "data-clipboardtarget": "c3", "data-clipboard-from": "#src-div" });

    button.click();
    expect(spy).toHaveBeenCalledWith("from div");
  });

  it("data-clipboard-from のセレクタが見つからなければ何もしない", () => {
    registerAutoTrigger();
    const el = appendClipboard("c4");
    const spy = vi.spyOn(el, "writeText");
    const button = appendButton({ "data-clipboardtarget": "c4", "data-clipboard-from": "#nope" });

    button.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("テキスト指定が一切なければ何もしない", () => {
    registerAutoTrigger();
    const el = appendClipboard("c5");
    const spy = vi.spyOn(el, "writeText");
    const button = appendButton({ "data-clipboardtarget": "c5" });

    button.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("存在しないIDの場合は何もしない", () => {
    registerAutoTrigger();
    const button = appendButton({ "data-clipboardtarget": "nonexistent", "data-clipboard-text": "x" });
    expect(() => button.click()).not.toThrow();
  });

  it("空の triggerAttribute 値の場合は何もしない", () => {
    registerAutoTrigger();
    const button = appendButton({ "data-clipboardtarget": "", "data-clipboard-text": "x" });
    expect(() => button.click()).not.toThrow();
  });

  it("wcs-clipboard 以外の要素では発火しない", () => {
    registerAutoTrigger();
    const div = document.createElement("div");
    div.setAttribute("id", "not-clip");
    document.body.appendChild(div);
    const button = appendButton({ "data-clipboardtarget": "not-clip", "data-clipboard-text": "x" });
    expect(() => button.click()).not.toThrow();
  });

  it("unregisterAutoTrigger でリスナーが解除される", () => {
    registerAutoTrigger();
    unregisterAutoTrigger();
    const el = appendClipboard("c6");
    const spy = vi.spyOn(el, "writeText");
    const button = appendButton({ "data-clipboardtarget": "c6", "data-clipboard-text": "x" });

    button.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("registerAutoTrigger を複数回呼んでも重複登録しない", () => {
    registerAutoTrigger();
    registerAutoTrigger();
    const el = appendClipboard("c7");
    const spy = vi.spyOn(el, "writeText");
    const button = appendButton({ "data-clipboardtarget": "c7", "data-clipboard-text": "x" });

    button.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("event.target が Element でない場合は何もしない", () => {
    registerAutoTrigger();
    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: null });
    expect(() => document.dispatchEvent(event)).not.toThrow();
  });

  it("data-clipboardtarget を持たない要素のクリックは無視する", () => {
    registerAutoTrigger();
    const button = appendButton({});
    expect(() => button.click()).not.toThrow();
  });

  it("ネストされた要素のクリックでも動作する", () => {
    registerAutoTrigger();
    const el = appendClipboard("c8");
    const spy = vi.spyOn(el, "writeText");
    const button = appendButton({ "data-clipboardtarget": "c8", "data-clipboard-text": "nested" });
    const span = document.createElement("span");
    span.textContent = "Copy";
    button.appendChild(span);

    span.click();
    expect(spy).toHaveBeenCalledWith("nested");
  });

  it("空文字リテラル（data-clipboard-text=\"\"）も書き込み対象", () => {
    registerAutoTrigger();
    const el = appendClipboard("c9");
    const spy = vi.spyOn(el, "writeText");
    const button = appendButton({ "data-clipboardtarget": "c9", "data-clipboard-text": "" });

    button.click();
    expect(spy).toHaveBeenCalledWith("");
  });
});
