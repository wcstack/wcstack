import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerComponents } from "../src/registerComponents";
import { config, setConfig } from "../src/config";
import { WcsSpeak } from "../src/components/Speak";
import { FakeSynth, installSpeechSynthesis, uninstallSpeechSynthesis, makeVoice } from "./mocks";

registerComponents();

function create(): WcsSpeak {
  const el = document.createElement(config.tagNames.speak) as WcsSpeak;
  document.body.appendChild(el);
  return el;
}

describe("<wcs-speak>", () => {
  let synth: FakeSynth;

  beforeEach(() => {
    synth = installSpeechSynthesis([makeVoice({ name: "Alice", lang: "en-US" })]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    uninstallSpeechSynthesis();
  });

  describe("属性アクセサ", () => {
    it("rate/pitch/volume は既定 1、数値をパースする", () => {
      const el = create();
      expect(el.rate).toBe(1);
      expect(el.pitch).toBe(1);
      expect(el.volume).toBe(1);
      el.setAttribute("rate", "1.5");
      el.setAttribute("pitch", "0.8");
      el.setAttribute("volume", "0.5");
      expect(el.rate).toBe(1.5);
      expect(el.pitch).toBe(0.8);
      expect(el.volume).toBe(0.5);
    });

    it("不正・空の数値属性は既定にフォールバックする", () => {
      const el = create();
      el.setAttribute("rate", "abc");
      expect(el.rate).toBe(1);
      el.setAttribute("rate", "");
      expect(el.rate).toBe(1);
    });

    it("rate/pitch/volume の setter は属性へ反映する", () => {
      const el = create();
      el.rate = 2;
      el.pitch = 0.5;
      el.volume = 0.25;
      expect(el.getAttribute("rate")).toBe("2");
      expect(el.getAttribute("pitch")).toBe("0.5");
      expect(el.getAttribute("volume")).toBe("0.25");
    });

    it("voice/lang は属性に反映、null で削除する", () => {
      const el = create();
      expect(el.voice).toBe("");
      expect(el.lang).toBe("");
      el.voice = "Alice";
      el.lang = "en-GB";
      expect(el.getAttribute("voice")).toBe("Alice");
      expect(el.getAttribute("lang")).toBe("en-GB");
      el.voice = null;
      el.lang = null;
      expect(el.hasAttribute("voice")).toBe(false);
      expect(el.hasAttribute("lang")).toBe(false);
    });

    it("manual は boolean 属性", () => {
      const el = create();
      expect(el.manual).toBe(false);
      el.manual = true;
      expect(el.hasAttribute("manual")).toBe(true);
      el.manual = false;
      expect(el.hasAttribute("manual")).toBe(false);
    });
  });

  describe("say（reactive input）", () => {
    it("値を書くと発話する", () => {
      const el = create();
      el.say = "hello";
      expect(synth.speak).toHaveBeenCalledOnce();
      expect(synth.utterances[0].text).toBe("hello");
      expect(el.say).toBe("hello");
    });

    it("同値の書き込みは発話しない（same-value ガード）", () => {
      const el = create();
      el.say = "hello";
      el.say = "hello";
      expect(synth.speak).toHaveBeenCalledOnce();
    });

    it("値が変われば再発話する", () => {
      const el = create();
      el.say = "a";
      el.say = "b";
      expect(synth.speak).toHaveBeenCalledTimes(2);
    });

    it("manual 時は say を無視する", () => {
      const el = create();
      el.manual = true;
      el.say = "hello";
      expect(synth.speak).not.toHaveBeenCalled();
    });

    it("null/undefined の書き込みは no-op", () => {
      const el = create();
      el.say = null;
      el.say = undefined as any;
      expect(synth.speak).not.toHaveBeenCalled();
      expect(el.say).toBe("");
    });

    it("say は現在の属性 options で発話する", () => {
      const el = create();
      el.setAttribute("rate", "1.5");
      el.setAttribute("voice", "Alice");
      el.say = "hi";
      const u = synth.utterances[0];
      expect(u.rate).toBe(1.5);
      expect((u.voice as any).name).toBe("Alice");
    });
  });

  describe("コマンド委譲", () => {
    it("speak() は属性 options を渡す", () => {
      const el = create();
      el.setAttribute("pitch", "0.7");
      el.speak("hi");
      expect(synth.utterances[0].pitch).toBe(0.7);
    });

    it("cancel()/pause()/resume() は Core 経由でネイティブを呼ぶ", () => {
      const el = create();
      el.pause();
      el.resume();
      el.cancel();
      expect(synth.pause).toHaveBeenCalledOnce();
      expect(synth.resume).toHaveBeenCalledOnce();
      expect(synth.cancel).toHaveBeenCalledOnce();
    });
  });

  describe("委譲 getter", () => {
    it("Core の観測状態を委譲する", () => {
      const el = create();
      expect(el.voices).toEqual([
        { name: "Alice", lang: "en-US", default: false, localService: true, voiceURI: "test-voice" },
      ]);
      expect(el.speaking).toBe(false);
      expect(el.paused).toBe(false);
      expect(el.pending).toBe(false);
      expect(el.charIndex).toBeNull();
      expect(el.spokenWord).toBeNull();
      expect(el.error).toBeNull();
      expect(el.unsupported).toBe(false);

      el.say = "hi";
      synth.fireStart();
      synth.fireBoundary({ charIndex: 0, charLength: 2 });
      expect(el.speaking).toBe(true);
      expect(el.charIndex).toBe(0);
      expect(el.spokenWord).toBe("hi");
    });

    it("API 不在時に unsupported を委譲する", () => {
      uninstallSpeechSynthesis();
      const el = create();
      expect(el.unsupported).toBe(true);
    });
  });

  describe("ライフサイクル", () => {
    it("connectedCallback で display:none にする", () => {
      const el = create();
      expect(el.style.display).toBe("none");
    });

    it("autoTrigger=false なら connectedCallback で autoTrigger を登録しない（分岐網羅）", () => {
      setConfig({ autoTrigger: false });
      try {
        const el = create();
        expect(el.style.display).toBe("none");
      } finally {
        setConfig({ autoTrigger: true });
      }
    });

    it("イベントは要素から bubble する", () => {
      const el = create();
      const events: any[] = [];
      document.body.addEventListener("wcs-speak:speaking-changed", (e) => events.push((e as CustomEvent).detail));
      el.say = "hi";
      synth.fireStart();
      expect(events).toEqual([true]);
    });

    it("disconnectedCallback で dispose する（voiceschanged 解除）", () => {
      const el = create();
      expect(synth.voicesChangedListenerCount).toBe(1);
      el.remove();
      expect(synth.voicesChangedListenerCount).toBe(0);
    });

    it("再接続で voiceschanged を再購読する", () => {
      const el = create();
      el.remove();
      expect(synth.voicesChangedListenerCount).toBe(0);
      document.body.appendChild(el);
      expect(synth.voicesChangedListenerCount).toBe(1);
    });

    it("SSR: connectedCallbackPromise が解決し hasConnectedCallbackPromise=true", async () => {
      const el = create();
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
      expect((el.constructor as typeof WcsSpeak).hasConnectedCallbackPromise).toBe(true);
    });
  });

  describe("wcBindable 宣言", () => {
    it("properties に Core の観測面、inputs に say を含む", () => {
      const inputs = WcsSpeak.wcBindable.inputs!.map((i) => i.name);
      expect(inputs).toContain("say");
      expect(inputs).toContain("rate");
      const props = WcsSpeak.wcBindable.properties.map((p) => p.name);
      expect(props).toContain("speaking");
      expect(props).toContain("charIndex");
      const commands = WcsSpeak.wcBindable.commands!.map((c) => c.name);
      expect(commands).toEqual(["speak", "cancel", "pause", "resume"]);
    });
  });
});
