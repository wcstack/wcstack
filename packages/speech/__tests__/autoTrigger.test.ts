import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerComponents } from "../src/registerComponents";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";
import { config, setConfig } from "../src/config";
import { WcsSpeak } from "../src/components/Speak";
import { FakeSynth, installSpeechSynthesis, uninstallSpeechSynthesis } from "./mocks";

registerComponents();

describe("autoTrigger", () => {
  let synth: FakeSynth;

  beforeEach(() => {
    synth = installSpeechSynthesis();
    registerAutoTrigger();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    document.body.innerHTML = "";
    uninstallSpeechSynthesis();
  });

  function setup(triggerHtml: string): { speak: WcsSpeak; trigger: HTMLElement } {
    const speak = document.createElement(config.tagNames.speak) as WcsSpeak;
    speak.id = "spk";
    document.body.appendChild(speak);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = triggerHtml;
    document.body.appendChild(wrapper);
    return { speak, trigger: wrapper.firstElementChild as HTMLElement };
  }

  it("data-speaktarget クリックで textContent を発話する", () => {
    const { trigger } = setup(`<button data-speaktarget="spk">Read this</button>`);
    trigger.click();
    expect(synth.speak).toHaveBeenCalledOnce();
    expect(synth.utterances[0].text).toBe("Read this");
  });

  it("data-speaktext があればそれを優先する", () => {
    const { trigger } = setup(`<button data-speaktarget="spk" data-speaktext="explicit">label</button>`);
    trigger.click();
    expect(synth.utterances[0].text).toBe("explicit");
  });

  it("textContent フォールバックは前後の空白を trim する（data-speaktext は逐語）", () => {
    const { trigger } = setup(`<button data-speaktarget="spk">  spaced  </button>`);
    trigger.click();
    expect(synth.utterances[0].text).toBe("spaced");
    synth.speak.mockClear();
    const { trigger: t2 } = setup(`<button data-speaktarget="spk" data-speaktext="  kept  ">x</button>`);
    t2.click();
    expect(synth.utterances[synth.utterances.length - 1].text).toBe("  kept  ");
  });

  it("data-speaktarget の無いクリックは無視する", () => {
    setup(`<button data-speaktarget="spk">x</button>`);
    const other = document.createElement("button");
    document.body.appendChild(other);
    other.click();
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("data-speaktarget が空値なら無視する", () => {
    const { trigger } = setup(`<button data-speaktarget="">x</button>`);
    trigger.click();
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("data-speaktarget が <wcs-speak> 以外を指す場合は無視する", () => {
    const div = document.createElement("div");
    div.id = "notspeak";
    document.body.appendChild(div);
    const { trigger } = setup(`<button data-speaktarget="notspeak">x</button>`);
    trigger.click();
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("Element でない target（document クリック）でも例外を投げない", () => {
    expect(() => document.dispatchEvent(new MouseEvent("click", { bubbles: true }))).not.toThrow();
  });

  it("登録されていないタグ名を指す設定では無視する（SpeakCtor undefined 分岐）", () => {
    const { trigger } = setup(`<button data-speaktarget="spk">x</button>`);
    setConfig({ tagNames: { speak: "wcs-unregistered-xyz" } });
    try {
      trigger.click();
      expect(synth.speak).not.toHaveBeenCalled();
    } finally {
      setConfig({ tagNames: { speak: "wcs-speak" } });
    }
  });

  it("不正な triggerAttribute（セレクタ SyntaxError）でも他のクリックを壊さない", () => {
    setConfig({ triggerAttribute: "bad attr" }); // 空白入りは不正な属性セレクタ
    try {
      const { trigger } = setup(`<button data-speaktarget="spk">x</button>`);
      // closest() が SyntaxError を投げるが握りつぶして return するので例外なし
      expect(() => trigger.click()).not.toThrow();
      expect(synth.speak).not.toHaveBeenCalled();
    } finally {
      setConfig({ triggerAttribute: "data-speaktarget" });
    }
  });

  it("registerAutoTrigger は冪等、unregister で解除する", () => {
    registerAutoTrigger(); // 2回目は no-op
    const { trigger } = setup(`<button data-speaktarget="spk">once</button>`);
    trigger.click();
    expect(synth.speak).toHaveBeenCalledOnce(); // リスナ重複なし

    unregisterAutoTrigger();
    unregisterAutoTrigger(); // 2回目は no-op
    synth.speak.mockClear();
    trigger.click();
    expect(synth.speak).not.toHaveBeenCalled();
  });
});
