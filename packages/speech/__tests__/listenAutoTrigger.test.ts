import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerComponents } from "../src/registerComponents";
import { registerListenAutoTrigger, unregisterListenAutoTrigger } from "../src/listenAutoTrigger";
import { config, setConfig } from "../src/config";
import { WcsListen } from "../src/components/Listen";
import { FakeRecognition, installSpeechRecognition, uninstallSpeechRecognition, removePermissions } from "./mocks";

registerComponents();

describe("listenAutoTrigger", () => {
  let recs: FakeRecognition[];

  beforeEach(() => {
    recs = installSpeechRecognition();
    removePermissions();
    registerListenAutoTrigger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    unregisterListenAutoTrigger();
    document.body.innerHTML = "";
    uninstallSpeechRecognition();
    removePermissions();
  });

  function setup(triggerHtml: string): { listen: WcsListen; trigger: HTMLElement } {
    const listen = document.createElement(config.tagNames.listen) as WcsListen;
    listen.id = "lst";
    listen.setAttribute("manual", ""); // connect で自動 start しない
    document.body.appendChild(listen);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = triggerHtml;
    document.body.appendChild(wrapper);
    return { listen, trigger: wrapper.firstElementChild as HTMLElement };
  }

  it("data-listentarget クリックで start、再クリックで stop（トグル）", () => {
    const { listen, trigger } = setup(`<button data-listentarget="lst">mic</button>`);
    trigger.click();
    expect(recs[0].start).toHaveBeenCalledOnce();
    recs[0].fireStart(); // listening=true
    trigger.click();
    expect(recs[0].stop).toHaveBeenCalledOnce();
    expect(listen).toBeDefined();
  });

  it("data-listentarget の無いクリックは無視する", () => {
    setup(`<button data-listentarget="lst">x</button>`);
    const other = document.createElement("button");
    document.body.appendChild(other);
    other.click();
    expect(recs[0].start).not.toHaveBeenCalled();
  });

  it("空値の data-listentarget は無視する", () => {
    const { trigger } = setup(`<button data-listentarget="">x</button>`);
    trigger.click();
    expect(recs[0].start).not.toHaveBeenCalled();
  });

  it("<wcs-listen> 以外を指す場合は無視する", () => {
    const div = document.createElement("div");
    div.id = "notlisten";
    document.body.appendChild(div);
    const { trigger } = setup(`<button data-listentarget="notlisten">x</button>`);
    trigger.click();
    expect(recs[0].start).not.toHaveBeenCalled();
  });

  it("未登録のタグ名設定では無視する（ListenCtor undefined 分岐）", () => {
    const { trigger } = setup(`<button data-listentarget="lst">x</button>`);
    setConfig({ tagNames: { listen: "wcs-unregistered-listen" } });
    try {
      trigger.click();
      expect(recs[0].start).not.toHaveBeenCalled();
    } finally {
      setConfig({ tagNames: { listen: "wcs-listen" } });
    }
  });

  it("Element でない target でも例外を投げない", () => {
    expect(() => document.dispatchEvent(new MouseEvent("click", { bubbles: true }))).not.toThrow();
  });

  it("不正な listenTriggerAttribute（セレクタ SyntaxError）でも他のクリックを壊さない", () => {
    setConfig({ listenTriggerAttribute: "bad attr" });
    try {
      const { trigger } = setup(`<button data-listentarget="lst">x</button>`);
      expect(() => trigger.click()).not.toThrow();
      expect(recs[0].start).not.toHaveBeenCalled();
    } finally {
      setConfig({ listenTriggerAttribute: "data-listentarget" });
    }
  });

  it("registerListenAutoTrigger は冪等、unregister で解除する", () => {
    registerListenAutoTrigger(); // no-op
    const { trigger } = setup(`<button data-listentarget="lst">x</button>`);
    trigger.click();
    expect(recs[0].start).toHaveBeenCalledOnce();

    unregisterListenAutoTrigger();
    unregisterListenAutoTrigger(); // no-op
    recs[0].start.mockClear();
    trigger.click();
    expect(recs[0].start).not.toHaveBeenCalled();
  });
});
