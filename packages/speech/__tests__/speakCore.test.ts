import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SpeakCore } from "../src/core/SpeakCore";
import { FakeSynth, installSpeechSynthesis, uninstallSpeechSynthesis, makeVoice } from "./mocks";

function collect(core: SpeakCore, type: string): any[] {
  const out: any[] = [];
  core.addEventListener(type, (e) => out.push((e as CustomEvent).detail));
  return out;
}

describe("SpeakCore", () => {
  let synth: FakeSynth;

  beforeEach(() => {
    synth = installSpeechSynthesis([makeVoice({ name: "Alice", lang: "en-US" })]);
  });

  afterEach(() => {
    uninstallSpeechSynthesis();
  });

  describe("構築と機能検出", () => {
    it("SpeechSynthesis が利用可能なら unsupported=false で初期化する", () => {
      const core = new SpeakCore();
      expect(core.unsupported).toBe(false);
      expect(core.speaking).toBe(false);
      expect(core.paused).toBe(false);
      expect(core.pending).toBe(false);
      expect(core.charIndex).toBeNull();
      expect(core.spokenWord).toBeNull();
      expect(core.error).toBeNull();
    });

    it("構築時に既存の voices を読み込む", () => {
      const core = new SpeakCore();
      expect(core.voices).toEqual([
        { name: "Alice", lang: "en-US", default: false, localService: true, voiceURI: "test-voice" },
      ]);
    });

    it("SpeechSynthesis 不在なら unsupported=true、unsupported-changed を発火する", () => {
      uninstallSpeechSynthesis();
      const core = new SpeakCore();
      const events: any[] = [];
      // 構築時の発火は購読前なので getter で確認する
      core.addEventListener("wcs-speak:unsupported-changed", (e) => events.push((e as CustomEvent).detail));
      expect(core.unsupported).toBe(true);
      expect(core.voices).toEqual([]);
    });
  });

  describe("voices の非同期ロード", () => {
    it("voiceschanged で voices を再読込し voices-changed を発火する", () => {
      const core = new SpeakCore();
      const events = collect(core, "wcs-speak:voices-changed");
      synth.setVoices([makeVoice({ name: "Bob", lang: "ja-JP" })]);
      expect(events).toHaveLength(1);
      expect(core.voices).toEqual([
        { name: "Bob", lang: "ja-JP", default: false, localService: true, voiceURI: "test-voice" },
      ]);
    });

    it("getVoices が null を返しても空配列として扱う", () => {
      const core = new SpeakCore();
      (synth as any).getVoices = () => null;
      synth.setVoices([]); // voiceschanged をトリガ（_voices は別管理なので getVoices 経由で null）
      expect(core.voices).toEqual([]);
    });

    it("同一内容の voiceschanged 再通知は voices-changed を発火しない（same-value ガード）", () => {
      const core = new SpeakCore();
      const events = collect(core, "wcs-speak:voices-changed");
      // 構築時と同一の voice リストを再通知（エンジンの warm-up 再アナウンス相当）
      synth.setVoices([makeVoice({ name: "Alice", lang: "en-US" })]);
      expect(events).toEqual([]);
      // フィールドが変われば発火する
      synth.setVoices([makeVoice({ name: "Alice", lang: "ja-JP" })]);
      expect(events).toHaveLength(1);
    });
  });

  describe("speak", () => {
    it("発話を開始し、ライフサイクルで speaking/pending を更新する", () => {
      const core = new SpeakCore();
      const speaking = collect(core, "wcs-speak:speaking-changed");
      const pending = collect(core, "wcs-speak:pending-changed");

      core.speak("hello world");
      expect(synth.speak).toHaveBeenCalledOnce();
      expect(core.pending).toBe(true);
      expect(pending).toEqual([true]);

      synth.fireStart();
      expect(core.speaking).toBe(true);
      expect(core.pending).toBe(false);
      expect(speaking).toEqual([true]);

      synth.fireEnd();
      expect(core.speaking).toBe(false);
      expect(speaking).toEqual([true, false]);
    });

    it("空文字・空白のみは no-op", () => {
      const core = new SpeakCore();
      core.speak("");
      core.speak("   ");
      expect(synth.speak).not.toHaveBeenCalled();
    });

    it("非文字列は no-op", () => {
      const core = new SpeakCore();
      core.speak(undefined as any);
      expect(synth.speak).not.toHaveBeenCalled();
    });

    it("options を utterance に反映する（voice は名前一致）", () => {
      const core = new SpeakCore();
      core.speak("hi", { rate: 1.5, pitch: 0.8, volume: 0.5, lang: "en-GB", voice: "Alice" });
      const u = synth.utterances[0];
      expect(u.rate).toBe(1.5);
      expect(u.pitch).toBe(0.8);
      expect(u.volume).toBe(0.5);
      expect(u.lang).toBe("en-GB");
      expect((u.voice as any).name).toBe("Alice");
    });

    it("options 省略時は utterance を既定のままにする", () => {
      const core = new SpeakCore();
      core.speak("hi");
      const u = synth.utterances[0];
      expect(u.rate).toBe(1);
      expect(u.lang).toBe("");
      expect(u.voice).toBeNull();
    });

    it("存在しない voice 名は無視する", () => {
      const core = new SpeakCore();
      core.speak("hi", { voice: "Nonexistent" });
      expect(synth.utterances[0].voice).toBeNull();
    });

    it("API 不在なら error を立てて return する", () => {
      uninstallSpeechSynthesis();
      const core = new SpeakCore();
      const errors = collect(core, "wcs-speak:error");
      core.speak("hi");
      expect(core.error).toEqual({ error: "unsupported", message: expect.stringContaining("not available") });
      expect(errors).toHaveLength(1);
    });

    it("キュー（複数発話）で pending/speaking を正しく遷移する", () => {
      const core = new SpeakCore();
      core.speak("A");
      core.speak("B");
      expect(core.pending).toBe(true);

      synth.fireStart(0);
      expect(core.speaking).toBe(true);
      expect(core.pending).toBe(true); // B が残っている

      synth.fireEnd(0);
      expect(core.speaking).toBe(false);
      expect(core.pending).toBe(true); // まだ B が queued

      synth.fireStart(1);
      expect(core.speaking).toBe(true);
      expect(core.pending).toBe(false);

      synth.fireEnd(1);
      expect(core.speaking).toBe(false);
      expect(core.pending).toBe(false);
    });

    it("onstart 前に error が来た発話でも pending が false に戻る", () => {
      // ブラウザは synthesis-unavailable / audio-busy などで onstart 無しに
      // onerror を出しうる。キュー待ちのまま失敗した発話は _queued から解放され、
      // pending が固着しないこと。
      const core = new SpeakCore();
      const pending = collect(core, "wcs-speak:pending-changed");
      core.speak("A");
      core.speak("B");
      expect(core.pending).toBe(true);

      // A は正常開始、B は開始前に error。
      synth.fireStart(0);
      expect(core.speaking).toBe(true);
      synth.fireError("audio-busy", 1); // B は onstart を経ずに失敗
      expect(core.error?.error).toBe("audio-busy");
      // B が解放され、残るのは開始済みの A のみ。
      expect(core.pending).toBe(false);
      expect(core.speaking).toBe(true);

      synth.fireEnd(0);
      expect(core.speaking).toBe(false);
      expect(core.pending).toBe(false);
      expect(pending).toEqual([true, false]);
    });

    it("onstart 前に end が来た発話でも pending が false に戻る", () => {
      const core = new SpeakCore();
      core.speak("A");
      expect(core.pending).toBe(true);
      synth.fireEnd(0); // onstart を経ずに end
      expect(core.pending).toBe(false);
      expect(core.speaking).toBe(false);
    });
  });

  describe("boundary（読み上げ位置）", () => {
    it("boundary で charIndex/spokenWord を更新する", () => {
      const core = new SpeakCore();
      const boundary = collect(core, "wcs-speak:boundary");
      core.speak("hello world");
      synth.fireStart();
      synth.fireBoundary({ charIndex: 0, charLength: 5 });
      expect(core.charIndex).toBe(0);
      expect(core.spokenWord).toBe("hello");
      synth.fireBoundary({ charIndex: 6, charLength: 5 });
      expect(core.spokenWord).toBe("world");
      // start の null リセットは初期値 null と同値のため発火せず、boundary 2回のみ
      expect(boundary).toEqual([
        { charIndex: 0, word: "hello" },
        { charIndex: 6, word: "world" },
      ]);
    });

    it("charLength 省略時は charIndex 以降の非空白語を導出する", () => {
      const core = new SpeakCore();
      core.speak("hello world");
      synth.fireStart();
      synth.fireBoundary({ charIndex: 6 }); // charLength なし → "world" を導出
      expect(core.charIndex).toBe(6);
      expect(core.spokenWord).toBe("world");
    });

    it("charLength 省略かつ末尾（語なし）なら空文字", () => {
      const core = new SpeakCore();
      core.speak("hi ");
      synth.fireStart();
      synth.fireBoundary({ charIndex: 3 }); // 末尾の空白以降 → 語なし
      expect(core.spokenWord).toBe("");
    });

    it("boundary 処理中の例外を握りつぶす", () => {
      const core = new SpeakCore();
      core.speak("hello");
      synth.fireStart();
      const evil: any = {};
      Object.defineProperty(evil, "charIndex", { get() { throw new Error("boom"); } });
      expect(() => synth.fireBoundary(evil)).not.toThrow();
    });

    it("発話完了時に boundary を null にリセットする", () => {
      const core = new SpeakCore();
      core.speak("hello");
      synth.fireStart();
      synth.fireBoundary({ charIndex: 0, charLength: 5 });
      synth.fireEnd();
      expect(core.charIndex).toBeNull();
      expect(core.spokenWord).toBeNull();
    });
  });

  describe("pause / resume", () => {
    it("pause/resume イベントで paused を更新する", () => {
      const core = new SpeakCore();
      const paused = collect(core, "wcs-speak:paused-changed");
      core.speak("hi");
      synth.fireStart();
      synth.firePause();
      expect(core.paused).toBe(true);
      synth.fireResume();
      expect(core.paused).toBe(false);
      expect(paused).toEqual([true, false]);
    });

    it("pause()/resume() はネイティブ API を呼ぶ", () => {
      const core = new SpeakCore();
      core.pause();
      core.resume();
      expect(synth.pause).toHaveBeenCalledOnce();
      expect(synth.resume).toHaveBeenCalledOnce();
    });

    it("API 不在なら pause()/resume()/cancel() は no-op", () => {
      uninstallSpeechSynthesis();
      const core = new SpeakCore();
      expect(() => { core.pause(); core.resume(); core.cancel(); }).not.toThrow();
    });
  });

  describe("error", () => {
    it("onerror で error を立て、発話を終了する", () => {
      const core = new SpeakCore();
      const errors = collect(core, "wcs-speak:error");
      core.speak("hi");
      synth.fireStart();
      synth.fireError("synthesis-failed");
      expect(core.error).toEqual({ error: "synthesis-failed", message: expect.stringContaining("synthesis-failed") });
      expect(core.speaking).toBe(false);
      // 初期 error は null のため speak の null クリアは同値ガードで発火せず、エラーのみ
      expect(errors).toEqual([{ error: "synthesis-failed", message: expect.any(String) }]);
    });

    it("error フィールド欠落時は synthesis-failed にフォールバックする", () => {
      const core = new SpeakCore();
      core.speak("hi");
      synth.fireStart();
      synth.utterances[0].onerror?.({});
      expect(core.error?.error).toBe("synthesis-failed");
    });
  });

  describe("cancel", () => {
    it("キューをクリアし状態をリセットする", () => {
      const core = new SpeakCore();
      core.speak("hi");
      synth.fireStart();
      synth.firePause();
      expect(core.speaking).toBe(true);
      expect(core.paused).toBe(true);

      core.cancel();
      expect(synth.cancel).toHaveBeenCalledOnce();
      expect(core.speaking).toBe(false);
      expect(core.pending).toBe(false);
      expect(core.paused).toBe(false);
      expect(core.charIndex).toBeNull();
    });

    it("paused 中の cancel は resume を先行呼びする（Chrome 無音バグ対策）", () => {
      const core = new SpeakCore();
      core.speak("hi");
      synth.fireStart();
      synth.firePause();
      expect(core.paused).toBe(true);
      synth.resume.mockClear();
      core.cancel();
      expect(synth.resume).toHaveBeenCalledOnce();
      expect(synth.cancel).toHaveBeenCalledOnce();
    });

    it("paused でない cancel は resume を呼ばない", () => {
      const core = new SpeakCore();
      core.speak("hi");
      synth.fireStart();
      core.cancel();
      expect(synth.resume).not.toHaveBeenCalled();
    });

    it("cancel が発火する canceled エラーは世代ガードで無視される", () => {
      const core = new SpeakCore();
      const errors = collect(core, "wcs-speak:error");
      core.speak("hi");
      synth.fireStart();
      core.cancel(); // mock は各 utterance に onerror("canceled") を発火
      // 初期 null クリアは発火せず、canceled は世代ガードで無視 → イベントなし
      expect(core.error).toBeNull();
      expect(errors).toEqual([]);
    });

    it("cancel 後の遅延コールバックは状態を変えない", () => {
      const core = new SpeakCore();
      core.speak("hi");
      synth.fireStart();
      core.cancel();
      // 遅れて end が来ても無視
      synth.fireEnd(0);
      expect(core.speaking).toBe(false);
    });

    it("cancel 後の boundary/pause/resume コールバックは世代ガードで無視される", () => {
      const core = new SpeakCore();
      core.speak("hello");
      synth.fireStart();
      core.cancel();
      synth.fireBoundary({ charIndex: 0, charLength: 5 }, 0);
      synth.firePause(0);
      synth.fireResume(0);
      expect(core.charIndex).toBeNull();
      expect(core.paused).toBe(false);
    });
  });

  describe("dispose / reinitVoices", () => {
    it("dispose で voiceschanged を解除する", () => {
      const core = new SpeakCore();
      expect(synth.voicesChangedListenerCount).toBe(1);
      core.dispose();
      expect(synth.voicesChangedListenerCount).toBe(0);
    });

    it("dispose 後の utterance コールバックは状態を変えない", () => {
      const core = new SpeakCore();
      core.speak("hi");
      core.dispose();
      synth.fireStart();
      expect(core.speaking).toBe(false);
    });

    it("reinitVoices は購読中なら no-op、dispose 後は再購読する", () => {
      const core = new SpeakCore();
      core.reinitVoices(); // 購読中 → no-op
      expect(synth.voicesChangedListenerCount).toBe(1);
      core.dispose();
      expect(synth.voicesChangedListenerCount).toBe(0);
      core.reinitVoices(); // 再購読
      expect(synth.voicesChangedListenerCount).toBe(1);
    });

    it("unsupported な Core の dispose は安全（no-op）", () => {
      uninstallSpeechSynthesis();
      const core = new SpeakCore();
      expect(() => core.dispose()).not.toThrow();
    });
  });

  describe("observe / ready（ライフサイクル）", () => {
    it("ready は解決済み Promise を返す（同期プローブ）", async () => {
      const core = new SpeakCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe() は ready を返し、購読中の再呼び出しは冪等（二重購読しない）", async () => {
      const core = new SpeakCore();
      expect(synth.voicesChangedListenerCount).toBe(1);
      await expect(core.observe()).resolves.toBeUndefined();
      await expect(core.observe()).resolves.toBeUndefined();
      expect(synth.voicesChangedListenerCount).toBe(1);
    });

    it("observe() は dispose 後に voiceschanged 購読を復活させる", async () => {
      const core = new SpeakCore();
      core.dispose();
      expect(synth.voicesChangedListenerCount).toBe(0);
      await core.observe();
      expect(synth.voicesChangedListenerCount).toBe(1);
    });
  });

  describe("wcBindable 宣言", () => {
    it("boundary の getter は event.detail から値を取り出す", () => {
      const props = SpeakCore.wcBindable.properties;
      const ci = props.find((p) => p.name === "charIndex")!.getter!;
      const sw = props.find((p) => p.name === "spokenWord")!.getter!;
      const ev = new CustomEvent("wcs-speak:boundary", { detail: { charIndex: 3, word: "lo" } });
      expect(ci(ev)).toBe(3);
      expect(sw(ev)).toBe("lo");
    });

    it("boundary の getter は detail 欠落時に null を返す（防御的）", () => {
      const props = SpeakCore.wcBindable.properties;
      const ci = props.find((p) => p.name === "charIndex")!.getter!;
      const sw = props.find((p) => p.name === "spokenWord")!.getter!;
      const ev = new CustomEvent("wcs-speak:boundary"); // detail なし（null）
      expect(ci(ev)).toBeNull();
      expect(sw(ev)).toBeNull();
    });
  });

  describe("target 指定", () => {
    it("指定した EventTarget にイベントを発火する", () => {
      const target = new EventTarget();
      const core = new SpeakCore(target);
      const events: any[] = [];
      target.addEventListener("wcs-speak:speaking-changed", (e) => events.push((e as CustomEvent).detail));
      core.speak("hi");
      synth.fireStart();
      expect(events).toEqual([true]);
    });
  });
});
