import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerComponents } from "../src/registerComponents";
import { config, setConfig } from "../src/config";
import { WcsListen } from "../src/components/Listen";
import {
  FakeRecognition, installSpeechRecognition, uninstallSpeechRecognition, removePermissions, makeResults,
} from "./mocks";

registerComponents();

describe("<wcs-listen>", () => {
  let recs: FakeRecognition[];

  beforeEach(() => {
    recs = installSpeechRecognition();
    removePermissions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    uninstallSpeechRecognition();
    removePermissions();
  });

  function create(attrs: Record<string, string> = {}): WcsListen {
    const el = document.createElement(config.tagNames.listen) as WcsListen;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
  }

  describe("属性アクセサ", () => {
    it("lang は属性に反映、null で削除する", () => {
      const el = create({ manual: "" });
      expect(el.lang).toBe("");
      el.lang = "ja-JP";
      expect(el.getAttribute("lang")).toBe("ja-JP");
      el.lang = null;
      expect(el.hasAttribute("lang")).toBe(false);
    });

    it("continuous / interim / manual は boolean 属性", () => {
      const el = create({ manual: "" });
      expect(el.continuous).toBe(false);
      expect(el.interim).toBe(false);
      expect(el.manual).toBe(true);
      el.continuous = true;
      el.interim = true;
      el.manual = false;
      expect(el.hasAttribute("continuous")).toBe(true);
      expect(el.hasAttribute("interim")).toBe(true);
      expect(el.hasAttribute("manual")).toBe(false);
      el.manual = true;
      expect(el.hasAttribute("manual")).toBe(true);
      el.continuous = false;
      el.interim = false;
      expect(el.hasAttribute("continuous")).toBe(false);
      expect(el.hasAttribute("interim")).toBe(false);
    });

    it("maxRestarts は既定 0、数値をパース、不正・負値は 0", () => {
      const el = create({ manual: "" });
      expect(el.maxRestarts).toBe(0);
      el.maxRestarts = 5;
      expect(el.getAttribute("max-restarts")).toBe("5");
      expect(el.maxRestarts).toBe(5);
      el.setAttribute("max-restarts", "abc");
      expect(el.maxRestarts).toBe(0);
      el.setAttribute("max-restarts", "-2");
      expect(el.maxRestarts).toBe(0);
      el.setAttribute("max-restarts", "");
      expect(el.maxRestarts).toBe(0);
      // 小数は floor され、Core の実効値（同じく floor）と一致する。
      el.setAttribute("max-restarts", "1.9");
      expect(el.maxRestarts).toBe(1);
    });
  });

  describe("コマンド委譲", () => {
    it("start は属性 options を渡す", () => {
      const el = create({ manual: "", lang: "ja-JP", continuous: "", interim: "", "max-restarts": "2" });
      el.start();
      expect(recs[0].lang).toBe("ja-JP");
      expect(recs[0].continuous).toBe(true);
      expect(recs[0].interimResults).toBe(true);
    });

    it("stop / abort を委譲する", () => {
      const el = create({ manual: "" });
      el.start();
      el.stop();
      el.abort();
      expect(recs[0].stop).toHaveBeenCalledOnce();
      expect(recs[0].abort).toHaveBeenCalledOnce();
    });
  });

  describe("trigger（momentary）", () => {
    it("false→true で start し、false に戻して trigger-changed を発火する", () => {
      const el = create({ manual: "" });
      const events: any[] = [];
      el.addEventListener("wcs-listen:trigger-changed", (e) => events.push((e as CustomEvent).detail));
      el.trigger = true;
      expect(recs[0].start).toHaveBeenCalledOnce();
      expect(el.trigger).toBe(false);
      expect(events).toEqual([false]);
    });

    it("false の書き込みは no-op", () => {
      const el = create({ manual: "" });
      el.trigger = false;
      expect(recs[0].start).not.toHaveBeenCalled();
    });
  });

  describe("委譲 getter", () => {
    it("Core の観測状態を委譲する", () => {
      const el = create({ manual: "", interim: "" });
      expect(el.interimTranscript).toBe("");
      expect(el.finalTranscript).toBe("");
      expect(el.result).toBeNull();
      expect(el.listening).toBe(false);
      expect(el.permission).toBe("unsupported");
      expect(el.error).toBeNull();
      expect(el.unsupported).toBe(false);

      el.start();
      recs[0].fireStart();
      recs[0].fireResult(makeResults([{ transcript: "hi", isFinal: true }]));
      expect(el.listening).toBe(true);
      expect(el.finalTranscript).toBe("hi");
      expect(el.result?.transcript).toBe("hi");
    });

    it("API 不在時に unsupported を委譲する", () => {
      uninstallSpeechRecognition();
      const el = create({ manual: "" });
      expect(el.unsupported).toBe(true);
    });

    it("errorInfo が Shell ゲッター経由で Core から読み取れる（Phase 6）", () => {
      const el = create({ manual: "" });
      expect(el.errorInfo).toBeNull();
      el.start();
      recs[0].fireStart();
      recs[0].fireError("not-allowed");
      expect(el.errorInfo).toEqual({
        code: "not-allowed", phase: "start", recoverable: false,
        message: "Speech recognition failed: not-allowed.",
      });
    });
  });

  describe("ライフサイクル", () => {
    it("connectedCallback で display:none、manual でなければ start する", () => {
      const el = create();
      expect(el.style.display).toBe("none");
      expect(recs[0].start).toHaveBeenCalledOnce();
    });

    it("manual なら connect で start しない", () => {
      const el = create({ manual: "" });
      expect(recs[0].start).not.toHaveBeenCalled();
    });

    it("autoTrigger=false なら connectedCallback で listen autoTrigger を登録しない（分岐網羅）", () => {
      setConfig({ autoTrigger: false });
      try {
        const el = create({ manual: "" });
        expect(el.style.display).toBe("none");
      } finally {
        setConfig({ autoTrigger: true });
      }
    });

    it("disconnectedCallback で dispose する", () => {
      const el = create({ manual: "" });
      el.start();
      el.remove();
      expect(recs[0].abort).toHaveBeenCalled();
    });

    it("SSR: connectedCallbackPromise が解決し hasConnectedCallbackPromise=true", async () => {
      const el = create({ manual: "" });
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
      expect((el.constructor as typeof WcsListen).hasConnectedCallbackPromise).toBe(true);
    });

    it("イベントは要素から bubble する", () => {
      const el = create({ manual: "" });
      const events: any[] = [];
      document.body.addEventListener("wcs-listen:listening-changed", (e) => events.push((e as CustomEvent).detail));
      el.start();
      recs[0].fireStart();
      expect(events).toEqual([true]);
    });
  });

  describe("wcBindable 宣言", () => {
    it("properties に trigger を追加、inputs/commands を宣言する", () => {
      const props = WcsListen.wcBindable.properties.map((p) => p.name);
      expect(props).toContain("trigger");
      expect(props).toContain("interimTranscript");
      expect(props).toContain("errorInfo");
      const inputs = WcsListen.wcBindable.inputs!.map((i) => i.name);
      expect(inputs).toEqual(["lang", "continuous", "interim", "maxRestarts", "manual", "trigger"]);
      const commands = WcsListen.wcBindable.commands!.map((c) => c.name);
      expect(commands).toEqual(["start", "stop", "abort"]);
    });
  });
});
