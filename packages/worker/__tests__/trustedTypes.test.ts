import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TRUSTED_TYPES_POLICY_SLOT,
  _resetAuthoredFallbackWarning,
  _resetInternalTrustedTypesPolicy,
  getTrustedTypesPolicy,
  setTrustedTypesPolicy,
  trustAuthoredScriptURL,
} from "../src/trustedTypes";
import { WorkerCore } from "../src/core/WorkerCore";
import { FakeWorker, installWorker, restoreWorker } from "./mocks";

/** Trusted Types のポリシーファクトリをスタブする（happy-dom には実装が無い）。 */
function stubTrustedTypes(createPolicy: (name: string, rules: any) => any): void {
  (globalThis as any).trustedTypes = { createPolicy };
}

describe("trustedTypes", () => {
  beforeEach(() => {
    setTrustedTypesPolicy(null);
    _resetInternalTrustedTypesPolicy();
    _resetAuthoredFallbackWarning();
  });

  afterEach(() => {
    setTrustedTypesPolicy(null);
    _resetInternalTrustedTypesPolicy();
    _resetAuthoredFallbackWarning();
    delete (globalThis as any).trustedTypes;
    vi.restoreAllMocks();
  });

  describe("policy スロット", () => {
    it("未設定なら null を返すこと", () => {
      expect(getTrustedTypesPolicy()).toBeNull();
    });

    it("グローバルスロットに直接入れた policy も読めること（buildless 経路）", () => {
      const policy = { createScriptURL: (s: string) => s };
      (globalThis as any)[TRUSTED_TYPES_POLICY_SLOT] = policy;
      expect(getTrustedTypesPolicy()).toBe(policy);
    });

    it("オブジェクト以外がスロットに入っていたら null を返すこと", () => {
      (globalThis as any)[TRUSTED_TYPES_POLICY_SLOT] = 0;
      expect(getTrustedTypesPolicy()).toBeNull();
    });
  });

  describe("trustAuthoredScriptURL", () => {
    it("Trusted Types 非対応ブラウザでは生文字列のまま返すこと", () => {
      expect(trustAuthoredScriptURL("./w.js")).toBe("./w.js");
    });

    // 利用側 policy は「信頼できない値の sanitizer」として設定される想定なので、
    // 作者が書いた src をそこに通さない。
    it("利用側 policy が入っていても作者の src は identity policy を通ること", () => {
      const createScriptURL = vi.fn((s: string) => s);
      stubTrustedTypes((_name, rules) => ({ createScriptURL: (s: string) => `[internal]${rules.createScriptURL(s)}` }));
      setTrustedTypesPolicy({ createScriptURL });
      expect(trustAuthoredScriptURL("/w.js")).toBe("[internal]/w.js");
      expect(createScriptURL).not.toHaveBeenCalled();
    });

    it("Trusted Types 非対応ブラウザなら、利用側 policy があっても素通しすること", () => {
      const createScriptURL = vi.fn((s: string) => s);
      setTrustedTypesPolicy({ createScriptURL });
      expect(trustAuthoredScriptURL("/w.js")).toBe("/w.js");
      expect(createScriptURL).not.toHaveBeenCalled();
    });

    it("identity policy を作れなかった場合だけ利用側 policy に落ち、1 度だけ警告すること", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      stubTrustedTypes(() => { throw new TypeError('Policy "wcstack" disallowed.'); });
      setTrustedTypesPolicy({ createScriptURL: (s: string) => `/cdn${s}` });

      expect(trustAuthoredScriptURL("/a.js")).toBe("/cdn/a.js");
      expect(trustAuthoredScriptURL("/b.js")).toBe("/cdn/b.js");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("trusted-types wcstack;");
      // フォールバック先があるときの報告は warn 1 回だけ（error は「注入せよ」と言う文面なので出さない）
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('policy 名 "wcstack" で 1 度だけ createPolicy すること（重複生成は例外になるため）', () => {
      const createPolicy = vi.fn((_name: string, rules: any) => ({ createScriptURL: rules.createScriptURL }));
      stubTrustedTypes(createPolicy);
      trustAuthoredScriptURL("/a.js");
      trustAuthoredScriptURL("/b.js");
      expect(createPolicy).toHaveBeenCalledTimes(1);
      expect(createPolicy.mock.calls[0][0]).toBe("wcstack");
      expect(createPolicy.mock.calls[0][1].createScriptURL("/w.js")).toBe("/w.js");
      expect(createPolicy.mock.calls[0][1].createHTML("<p>x</p>")).toBe("<p>x</p>");
    });

    it("createPolicy が弾かれたら直し方を 1 度だけ報告し、生文字列で進むこと", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      stubTrustedTypes(() => { throw new TypeError('Policy "wcstack" disallowed.'); });
      expect(trustAuthoredScriptURL("/a.js")).toBe("/a.js");
      expect(trustAuthoredScriptURL("/b.js")).toBe("/b.js");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain("trusted-types wcstack;");
    });
  });

  describe("WorkerCore との結線", () => {
    beforeEach(() => {
      installWorker();
    });

    afterEach(() => {
      restoreWorker();
    });

    it("new Worker に渡す URL が policy を通ること", () => {
      stubTrustedTypes((_name, rules) => ({ createScriptURL: (s: string) => `${rules.createScriptURL(s)}?signed` }));
      const core = new WorkerCore();
      core.start("/worker.js");
      expect(FakeWorker.last!.src).toBe("/worker.js?signed");
      core.dispose();
    });

    it("Trusted Types 非対応ブラウザでは URL がそのまま渡ること", () => {
      const core = new WorkerCore();
      core.start("/worker.js");
      expect(FakeWorker.last!.src).toBe("/worker.js");
      core.dispose();
    });
  });
});
