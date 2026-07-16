import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ListenCore } from "../src/core/ListenCore";
import { deriveListenErrorInfo, WCS_LISTEN_ERROR_CODE } from "../src/core/speechCapabilities";
import {
  FakeRecognition, installSpeechRecognition, uninstallSpeechRecognition,
  installPermissions, removePermissions, makeResults,
} from "./mocks";

const flush = () => new Promise((r) => setTimeout(r, 0));

function collect(core: ListenCore, type: string): any[] {
  const out: any[] = [];
  core.addEventListener(type, (e) => out.push((e as CustomEvent).detail));
  return out;
}

describe("ListenCore", () => {
  let recs: FakeRecognition[];

  beforeEach(() => {
    recs = installSpeechRecognition();
    removePermissions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    uninstallSpeechRecognition();
    removePermissions();
  });

  describe("構築と機能検出", () => {
    it("SpeechRecognition があれば unsupported=false で初期化する", () => {
      const core = new ListenCore();
      expect(core.unsupported).toBe(false);
      expect(core.listening).toBe(false);
      expect(core.interimTranscript).toBe("");
      expect(core.finalTranscript).toBe("");
      expect(core.result).toBeNull();
      expect(core.error).toBeNull();
      expect(recs).toHaveLength(1);
    });

    it("webkit プレフィクスの実装も検出する", () => {
      uninstallSpeechRecognition();
      const prefixed = installSpeechRecognition({ prefixed: true });
      const core = new ListenCore();
      expect(core.unsupported).toBe(false);
      expect(prefixed).toHaveLength(1);
    });

    it("SpeechRecognition 不在なら unsupported=true", () => {
      uninstallSpeechRecognition();
      const core = new ListenCore();
      expect(core.unsupported).toBe(true);
    });
  });

  describe("start / stop / abort", () => {
    it("start で認識を開始し listening を更新する", () => {
      const core = new ListenCore();
      const listening = collect(core, "wcs-listen:listening-changed");
      core.start({ lang: "en-US" });
      expect(recs[0].start).toHaveBeenCalledOnce();
      expect(recs[0].lang).toBe("en-US");
      recs[0].fireStart();
      expect(core.listening).toBe(true);
      expect(listening).toEqual([true]);
    });

    it("二重 start は無視する（idempotent）", () => {
      const core = new ListenCore();
      core.start();
      core.start();
      expect(recs[0].start).toHaveBeenCalledOnce();
    });

    it("options を recognition に反映する", () => {
      const core = new ListenCore();
      core.start({ lang: "ja-JP", continuous: true, interimResults: true, maxAlternatives: 3 });
      expect(recs[0].lang).toBe("ja-JP");
      expect(recs[0].continuous).toBe(true);
      expect(recs[0].interimResults).toBe(true);
      expect(recs[0].maxAlternatives).toBe(3);
    });

    it("options 省略時は既定値を使う", () => {
      const core = new ListenCore();
      core.start();
      expect(recs[0].lang).toBe("");
      expect(recs[0].continuous).toBe(false);
      expect(recs[0].interimResults).toBe(false);
    });

    it("負の maxRestarts は 0 に丸める", () => {
      const core = new ListenCore();
      core.start({ continuous: true, maxRestarts: -5 });
      recs[0].fireStart();
      recs[0].fireEnd();
      expect(recs[0].start).toHaveBeenCalledOnce(); // 再開なし
    });

    it("API 不在なら start は error を立てる", () => {
      uninstallSpeechRecognition();
      const core = new ListenCore();
      core.start();
      expect(core.error).toEqual({ error: "unsupported", message: expect.stringContaining("not available") });
    });

    it("stop は intent をクリアしてから recognition.stop を呼ぶ", () => {
      const core = new ListenCore();
      core.start({ continuous: true, maxRestarts: 3 });
      recs[0].fireStart();
      core.stop();
      expect(recs[0].stop).toHaveBeenCalledOnce();
      recs[0].fireEnd();
      expect(recs[0].start).toHaveBeenCalledOnce(); // stop 後は再開しない
      expect(core.listening).toBe(false);
    });

    it("abort は recognition.abort を呼ぶ", () => {
      const core = new ListenCore();
      core.start();
      core.abort();
      expect(recs[0].abort).toHaveBeenCalledOnce();
    });

    it("API 不在なら stop/abort は no-op", () => {
      uninstallSpeechRecognition();
      const core = new ListenCore();
      expect(() => { core.stop(); core.abort(); }).not.toThrow();
    });

    it("start が throw しても握りつぶし active をリセットする", () => {
      const core = new ListenCore();
      core.start({ continuous: true, maxRestarts: 1 });
      recs[0].fireStart();
      recs[0].start.mockImplementation(() => { throw new Error("already started"); });
      recs[0].fireEnd(); // 再開 → start throw → catch
      expect(core.listening).toBe(false);
    });
  });

  describe("result（interim / final）", () => {
    it("interim と final を分離して蓄積する", () => {
      const core = new ListenCore();
      const interim = collect(core, "wcs-listen:interim-changed");
      const final = collect(core, "wcs-listen:final-changed");
      core.start({ interimResults: true });
      recs[0].fireStart();

      recs[0].fireResult(makeResults([{ transcript: "hello", isFinal: false }]));
      expect(core.interimTranscript).toBe("hello");
      expect(core.finalTranscript).toBe("");

      recs[0].fireResult(makeResults([{ transcript: "hello world", isFinal: true }]));
      expect(core.finalTranscript).toBe("hello world");
      expect(core.interimTranscript).toBe("");
      expect(interim).toEqual(["hello", ""]);
      expect(final).toEqual(["hello world"]);
    });

    it("result detail を正規化して公開する（alternatives 付き）", () => {
      const core = new ListenCore();
      core.start();
      recs[0].fireStart();
      recs[0].fireResult(makeResults([{
        transcript: "main", isFinal: true,
        alternatives: [{ transcript: "main", confidence: 0.9 }, { transcript: "mane", confidence: 0.4 }],
      }]));
      expect(core.result).toEqual({
        transcript: "main",
        confidence: 0.9,
        isFinal: true,
        alternatives: [{ transcript: "main", confidence: 0.9 }, { transcript: "mane", confidence: 0.4 }],
      });
    });

    it("同一イベント内の final+interim を処理する", () => {
      const core = new ListenCore();
      core.start({ interimResults: true });
      recs[0].fireStart();
      recs[0].fireResult(makeResults([
        { transcript: "done ", isFinal: true },
        { transcript: "typing", isFinal: false },
      ]), 0);
      expect(core.finalTranscript).toBe("done ");
      expect(core.interimTranscript).toBe("typing");
    });

    it("resultIndex 省略時は 0 として扱う", () => {
      const core = new ListenCore();
      core.start();
      recs[0].fireStart();
      recs[0].onresult?.({ results: makeResults([{ transcript: "x", isFinal: true }]) });
      expect(core.finalTranscript).toBe("x");
    });

    it("空の results は no-op（result は null のまま）", () => {
      const core = new ListenCore();
      core.start();
      recs[0].fireStart();
      recs[0].fireResult(makeResults([]));
      expect(core.result).toBeNull();
      expect(core.finalTranscript).toBe("");
    });

    it("alternatives が空でも安全に正規化する", () => {
      const core = new ListenCore();
      core.start();
      recs[0].fireStart();
      recs[0].fireResult(makeResults([{ transcript: "", isFinal: true, alternatives: [] }]));
      expect(core.result).toEqual({ transcript: "", confidence: 0, isFinal: true, alternatives: [] });
    });

    it("transcript/confidence 欠落の alternative は既定値で埋める", () => {
      const core = new ListenCore();
      core.start();
      recs[0].fireStart();
      recs[0].fireResult(makeResults([{ transcript: "x", isFinal: true, alternatives: [{} as any] }]));
      expect(core.result).toEqual({ transcript: "", confidence: 0, isFinal: true, alternatives: [{ transcript: "", confidence: 0 }] });
    });

    it("不正な result イベントは握りつぶす", () => {
      const core = new ListenCore();
      core.start();
      recs[0].fireStart();
      expect(() => recs[0].onresult?.(undefined)).not.toThrow();
    });
  });

  describe("自動再開（continuous）", () => {
    it("continuous かつ maxRestarts 内なら end で再開する", () => {
      const core = new ListenCore();
      core.start({ continuous: true, maxRestarts: 2 });
      recs[0].fireStart();
      recs[0].fireEnd();
      expect(recs[0].start).toHaveBeenCalledTimes(2);
      recs[0].fireEnd();
      expect(recs[0].start).toHaveBeenCalledTimes(3);
      recs[0].fireEnd(); // restartCount 2 >= max 2 → 再開しない
      expect(recs[0].start).toHaveBeenCalledTimes(3);
    });

    it("result があれば restart 予算をリセットする", () => {
      const core = new ListenCore();
      core.start({ continuous: true, maxRestarts: 1, interimResults: true });
      recs[0].fireStart();
      recs[0].fireEnd(); // restartCount=1, start#2
      recs[0].fireResult(makeResults([{ transcript: "x", isFinal: true }])); // reset
      recs[0].fireEnd(); // restartCount=1 again, start#3
      expect(recs[0].start).toHaveBeenCalledTimes(3);
    });

    it("非 continuous は end で再開しない", () => {
      const core = new ListenCore();
      core.start();
      recs[0].fireStart();
      recs[0].fireEnd();
      expect(recs[0].start).toHaveBeenCalledOnce();
    });

    it("自動再開時 listening を true に保ち true→false→true のフリッカを起こさない", () => {
      const core = new ListenCore();
      const listening = collect(core, "wcs-listen:listening-changed");
      core.start({ continuous: true, maxRestarts: 1 });
      recs[0].fireStart();
      expect(core.listening).toBe(true);

      recs[0].fireEnd(); // silence による end → 再開（restartCount 0<1）
      // 再開分岐では listening を落とさない。
      expect(core.listening).toBe(true);
      recs[0].fireStart(); // 再 start の onstart（同値ガードで no-op）
      expect(core.listening).toBe(true);

      // 予算を使い切る最後の end（restartCount 1<1 偽）で初めて false。
      recs[0].fireEnd();
      expect(core.listening).toBe(false);
      // dispatch は開始時の true と終了時の false のみ（フリッカ無し）。
      expect(listening).toEqual([true, false]);
    });

    it("小数の maxRestarts は floor して整数として扱う", () => {
      // 1.9 を floor せず使うと restartCount 1 < 1.9 で 2 回目も再開してしまう。
      // floor(1.9)=1 なら end は 1 回だけ再開する。
      const core = new ListenCore();
      core.start({ continuous: true, maxRestarts: 1.9 });
      recs[0].fireStart();
      recs[0].fireEnd(); // restartCount 0 < 1 → 再開（start #2）, restartCount=1
      recs[0].fireEnd(); // restartCount 1 < 1 偽 → 再開しない（未 floor の 1.9 なら再開していた）
      expect(recs[0].start).toHaveBeenCalledTimes(2);
    });
  });

  describe("error", () => {
    it("onerror で error を立てる（非終端は active 継続）", () => {
      const core = new ListenCore();
      core.start({ continuous: true, maxRestarts: 1 });
      recs[0].fireStart();
      recs[0].fireError("network");
      expect(core.error).toEqual({ error: "network", message: expect.stringContaining("network") });
      recs[0].fireEnd();
      expect(recs[0].start).toHaveBeenCalledTimes(2); // network は再開する
    });

    it("not-allowed は終端扱いで自動再開を止める", () => {
      const core = new ListenCore();
      core.start({ continuous: true, maxRestarts: 5 });
      recs[0].fireStart();
      recs[0].fireError("not-allowed");
      recs[0].fireEnd();
      expect(recs[0].start).toHaveBeenCalledOnce();
      expect(core.error?.error).toBe("not-allowed");
    });

    it("service-not-allowed も終端扱い", () => {
      const core = new ListenCore();
      core.start({ continuous: true, maxRestarts: 5 });
      recs[0].fireStart();
      recs[0].fireError("service-not-allowed");
      recs[0].fireEnd();
      expect(recs[0].start).toHaveBeenCalledOnce();
    });

    it("error フィールド欠落時は aborted にフォールバックする", () => {
      const core = new ListenCore();
      core.start();
      recs[0].fireStart();
      recs[0].onerror?.({});
      expect(core.error?.error).toBe("aborted");
    });
  });

  describe("permission", () => {
    it("permissions API 不在なら unsupported", () => {
      const core = new ListenCore();
      expect(core.permission).toBe("unsupported");
    });

    it("query 解決で permission を反映し change を購読する", async () => {
      const status = installPermissions({ state: "granted" });
      const core = new ListenCore();
      const events = collect(core, "wcs-listen:permission-changed");
      await flush();
      expect(core.permission).toBe("granted");
      status.change("denied");
      expect(core.permission).toBe("denied");
      expect(events).toEqual(["granted", "denied"]);
    });

    it("query が reject されたら unsupported", async () => {
      installPermissions({ reject: true });
      const core = new ListenCore();
      await flush();
      expect(core.permission).toBe("unsupported");
    });

    it("dispose 後に解決した query は購読しない（世代ガード）", async () => {
      const status = installPermissions({ state: "granted" });
      const core = new ListenCore();
      core.dispose();
      await flush();
      expect(core.permission).toBe("prompt"); // 反映されない
      status.change("denied");
      expect(core.permission).toBe("prompt");
    });

    it("dispose 後に reject した query も無視する（世代ガード）", async () => {
      installPermissions({ reject: true });
      const core = new ListenCore();
      core.dispose();
      await flush();
      expect(core.permission).toBe("prompt");
    });

    it("reinitPermission は購読中なら no-op、dispose 後は再購読する", async () => {
      const status = installPermissions({ state: "granted" });
      const core = new ListenCore();
      await flush();
      core.reinitPermission(); // no-op
      core.dispose();
      core.reinitPermission(); // 再購読
      await flush();
      expect(core.permission).toBe("granted");
    });
  });

  describe("observe / ready（ライフサイクル）", () => {
    it("ready は解決済み Promise を返す（同期プローブ）", async () => {
      const core = new ListenCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe() は ready を返し、購読中の再呼び出しは冪等（二重購読しない）", async () => {
      const status = installPermissions({ state: "granted" });
      const core = new ListenCore();
      await flush();
      await expect(core.observe()).resolves.toBeUndefined();
      // 冪等: 既に購読中なので再 query は走らず、change が依然反映される。
      await expect(core.observe()).resolves.toBeUndefined();
      status.change("denied");
      expect(core.permission).toBe("denied");
    });

    it("observe() は dispose 後に購読を復活させる", async () => {
      const status = installPermissions({ state: "granted" });
      const core = new ListenCore();
      await flush();
      core.dispose();
      await core.observe(); // 再購読
      await flush();
      expect(core.permission).toBe("granted");
      status.change("denied");
      expect(core.permission).toBe("denied");
    });
  });

  describe("dispose", () => {
    it("dispose で recognition を abort し listening をリセットする", () => {
      const core = new ListenCore();
      core.start();
      recs[0].fireStart();
      core.dispose();
      expect(recs[0].abort).toHaveBeenCalled();
      expect(core.listening).toBe(false);
    });

    it("abort が throw しても dispose は安全", () => {
      const core = new ListenCore();
      recs[0].abort.mockImplementation(() => { throw new Error("idle"); });
      expect(() => core.dispose()).not.toThrow();
    });

    it("unsupported な Core の dispose は安全", () => {
      uninstallSpeechRecognition();
      const core = new ListenCore();
      expect(() => core.dispose()).not.toThrow();
    });
  });

  describe("target 指定", () => {
    it("指定した EventTarget にイベントを発火する", () => {
      const target = new EventTarget();
      const core = new ListenCore(target);
      const events: any[] = [];
      target.addEventListener("wcs-listen:listening-changed", (e) => events.push((e as CustomEvent).detail));
      core.start();
      recs[0].fireStart();
      expect(events).toEqual([true]);
    });
  });

  describe("errorInfo taxonomy (Phase 6)", () => {
    it("初期状態の errorInfo は null", () => {
      expect(new ListenCore().errorInfo).toBeNull();
    });

    it("errorInfo は wcBindable property(error の直後)として宣言される", () => {
      const names = ListenCore.wcBindable.properties.map((p) => p.name);
      expect(names).toContain("errorInfo");
      expect(names.indexOf("errorInfo")).toBe(names.indexOf("error") + 1);
    });

    it("unsupported → capability-missing / probe / recoverable=false（error shape は不変）", () => {
      uninstallSpeechRecognition();
      const core = new ListenCore();
      core.start();
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "probe", recoverable: false,
        message: "SpeechRecognition API is not available in this environment.",
      });
      // 公開 error shape は不変。
      expect(core.error).toEqual({ error: "unsupported", message: "SpeechRecognition API is not available in this environment." });
    });

    it("recognition error を taxonomy に写す（network → network-error / execute / recoverable）", () => {
      const core = new ListenCore();
      core.start();
      recs[0].fireStart();
      recs[0].fireError("network");
      expect(core.errorInfo).toEqual({
        code: "network-error", phase: "execute", recoverable: true,
        message: "Speech recognition failed: network.",
      });
    });

    it("errorInfo は error と同期して遷移し、error より前に error-info-changed が流れる", () => {
      const core = new ListenCore();
      core.start();
      recs[0].fireStart();
      const order: string[] = [];
      core.addEventListener("wcs-listen:error-info-changed", () => order.push("errorInfo"));
      core.addEventListener("wcs-listen:error", () => order.push("error"));
      recs[0].fireError("not-allowed");
      expect(order).toEqual(["errorInfo", "error"]);
      expect(core.errorInfo).not.toBeNull();
    });

    it("次の start() は直前の error を晴らし、errorInfo も null に戻す(clear 経路)", () => {
      const core = new ListenCore();
      core.start({ continuous: true, maxRestarts: 5 });
      recs[0].fireStart();
      // not-allowed は終端で _active を落とすので、次の start() が実行され error をクリアする。
      recs[0].fireError("not-allowed");
      expect(core.errorInfo).not.toBeNull();
      const infoEvents = collect(core, "wcs-listen:error-info-changed");
      core.start();
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
      // clear も error-info-changed を 1 度発火する（null 遷移）。
      expect(infoEvents).toEqual([null]);
    });

    // Direct map coverage: exercises every code branch of deriveListenErrorInfo,
    // including the defensive `default` fallback the Core never emits itself.
    it("deriveListenErrorInfo が全コードを taxonomy に写す(未知コードは speech-error へ畳む)", () => {
      expect(deriveListenErrorInfo({ error: "unsupported", message: "m" })).toEqual({
        code: WCS_LISTEN_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message: "m",
      });
      expect(deriveListenErrorInfo({ error: "not-allowed", message: "m" })).toEqual({
        code: WCS_LISTEN_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message: "m",
      });
      expect(deriveListenErrorInfo({ error: "service-not-allowed", message: "m" })).toEqual({
        code: WCS_LISTEN_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message: "m",
      });
      expect(deriveListenErrorInfo({ error: "audio-capture", message: "m" })).toEqual({
        code: WCS_LISTEN_ERROR_CODE.NotReadable, phase: "start", recoverable: false, message: "m",
      });
      expect(deriveListenErrorInfo({ error: "no-speech", message: "m" })).toEqual({
        code: WCS_LISTEN_ERROR_CODE.NoSpeech, phase: "execute", recoverable: true, message: "m",
      });
      expect(deriveListenErrorInfo({ error: "network", message: "m" })).toEqual({
        code: WCS_LISTEN_ERROR_CODE.NetworkError, phase: "execute", recoverable: true, message: "m",
      });
      expect(deriveListenErrorInfo({ error: "aborted", message: "m" })).toEqual({
        code: WCS_LISTEN_ERROR_CODE.Aborted, phase: "execute", recoverable: true, message: "m",
      });
      expect(deriveListenErrorInfo({ error: "language-not-supported", message: "m" })).toEqual({
        code: WCS_LISTEN_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message: "m",
      });
      expect(deriveListenErrorInfo({ error: "bad-grammar", message: "m" })).toEqual({
        code: WCS_LISTEN_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message: "m",
      });
      expect(deriveListenErrorInfo({ error: "totally-unknown", message: "m" })).toEqual({
        code: WCS_LISTEN_ERROR_CODE.SpeechError, phase: "execute", recoverable: false, message: "m",
      });
    });
  });
});
