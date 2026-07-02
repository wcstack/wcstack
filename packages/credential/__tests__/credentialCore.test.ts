import { describe, it, expect, afterEach, vi } from "vitest";
import { CredentialCore } from "../src/core/CredentialCore";
import { installGet, installStore, removeCredentials } from "./mocks";

describe("CredentialCore", () => {
  afterEach(() => {
    removeCredentials();
    vi.restoreAllMocks();
  });

  it("EventTarget を継承している", () => {
    const core = new CredentialCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  describe("wcBindable プロトコル宣言", () => {
    it("properties が value/loading/error/cancelled を宣言している", () => {
      const names = CredentialCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual(["value", "loading", "error", "cancelled"]);
    });

    it("commands は get(async)/store(async) の2つを宣言している（このバッチ唯一の複数command）", () => {
      const commands = CredentialCore.wcBindable.commands!;
      expect(commands.map((c) => c.name)).toEqual(["get", "store"]);
      expect(commands.every((c) => c.async)).toBe(true);
    });

    it("value の event が wcs-credential:complete で getter が detail.value を返す", () => {
      const prop = CredentialCore.wcBindable.properties.find((p) => p.name === "value")!;
      expect(prop.event).toBe("wcs-credential:complete");
      const ev = new CustomEvent("wcs-credential:complete", { detail: { value: { id: "user@example.com" } } });
      expect(prop.getter!(ev)).toEqual({ id: "user@example.com" });
    });
  });

  describe("初期状態", () => {
    it("value/loading/error/cancelled が既定値", () => {
      const core = new CredentialCore();
      expect(core.value).toBeNull();
      expect(core.loading).toBe(false);
      expect(core.error).toBeNull();
      expect(core.cancelled).toBe(false);
    });

    it("ready は即 resolve する", async () => {
      const core = new CredentialCore();
      await expect(core.ready).resolves.toBeUndefined();
    });
  });

  describe("get() 成功時", () => {
    it("value に credential が反映され、loading が true→false と遷移する", async () => {
      const credential = { id: "user@example.com", type: "password" };
      installGet(() => Promise.resolve(credential));
      const core = new CredentialCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-credential:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const result = await core.get({ password: true });

      expect(result).toEqual(credential);
      expect(core.value).toEqual(credential);
      expect(core.loading).toBe(false);
      expect(loadingEvents).toEqual([true, false]);
    });

    it("options がそのまま navigator.credentials.get() へ渡る", async () => {
      const fn = installGet(() => Promise.resolve(null));
      const core = new CredentialCore();
      await core.get({ password: true, mediation: "silent" });
      expect(fn).toHaveBeenCalledWith({ password: true, mediation: "silent" });
    });
  });

  describe("get() — WebAuthn(publicKey)スコープ違反", () => {
    it("publicKey が渡されるとプラットフォームAPIへ転送せず即 error になる", async () => {
      const fn = installGet(() => Promise.resolve(null));
      const core = new CredentialCore();

      const result = await core.get({ publicKey: {} } as any);

      expect(result).toBeNull();
      expect(fn).not.toHaveBeenCalled();
      expect(core.error).toEqual({
        message: "WebAuthn (publicKey) is out of scope for @wcstack/credential v1. Use a dedicated WebAuthn node instead.",
      });
    });
  });

  describe("get() — unsupported 環境", () => {
    it("navigator.credentials 不在時は即 error になり loading は true にすらならない", async () => {
      removeCredentials();
      const core = new CredentialCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-credential:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const result = await core.get();

      expect(result).toBeNull();
      expect(core.error).toEqual({ message: "Credential Management API is not supported in this browser." });
      expect(loadingEvents).toEqual([]);
    });
  });

  describe("get() — AbortError（ユーザーキャンセル）", () => {
    it("cancelled が true になり error は変化しない", async () => {
      installGet(() => Promise.reject(new DOMException("The user aborted a request", "AbortError")));
      const core = new CredentialCore();

      const result = await core.get();

      expect(result).toBeNull();
      expect(core.cancelled).toBe(true);
      expect(core.error).toBeNull();
    });
  });

  describe("get() — それ以外の例外（真の失敗）", () => {
    it("DOMException(NotAllowedError) は正規化された error になる", async () => {
      installGet(() => Promise.reject(new DOMException("Permission denied", "NotAllowedError")));
      const core = new CredentialCore();

      const result = await core.get();

      expect(result).toBeNull();
      expect(core.error).toEqual({ name: "NotAllowedError", message: "Permission denied" });
      expect(core.cancelled).toBe(false);
    });

    it("Errorでない値でreject されても正規化されたerrorになる（never-throw）", async () => {
      installGet(() => Promise.reject("plain string rejection"));
      const core = new CredentialCore();

      const result = await core.get();

      expect(result).toBeNull();
      expect(core.error).toEqual({ name: "Error", message: "plain string rejection" });
    });
  });

  describe("store() 成功時", () => {
    it("value に保存された credential が反映される", async () => {
      const credential = { id: "user@example.com", type: "password" };
      const fn = installStore(() => Promise.resolve(credential));
      const core = new CredentialCore();

      const result = await core.store(credential as any);

      expect(fn).toHaveBeenCalledWith(credential);
      expect(result).toEqual(credential);
      expect(core.value).toEqual(credential);
      expect(core.loading).toBe(false);
    });
  });

  describe("store() — unsupported 環境", () => {
    it("navigator.credentials 不在時は即 error", async () => {
      removeCredentials();
      const core = new CredentialCore();
      const result = await core.store({} as any);
      expect(result).toBeNull();
      expect(core.error).toEqual({ message: "Credential Management API is not supported in this browser." });
    });
  });

  describe("store() — AbortError / 真の失敗", () => {
    it("AbortError は cancelled に倒れる", async () => {
      installStore(() => Promise.reject(new DOMException("aborted", "AbortError")));
      const core = new CredentialCore();
      await core.store({} as any);
      expect(core.cancelled).toBe(true);
      expect(core.error).toBeNull();
    });

    it("それ以外は正規化された error になる", async () => {
      installStore(() => Promise.reject(new TypeError("boom")));
      const core = new CredentialCore();
      await core.store({} as any);
      expect(core.error).toEqual({ name: "TypeError", message: "boom" });
    });
  });

  describe("次回呼び出しでのリセット", () => {
    it("前回 get() の cancelled が次回成功時にリセットされる", async () => {
      const fn = installGet(() => Promise.resolve(null));
      fn.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
      const core = new CredentialCore();

      await core.get();
      expect(core.cancelled).toBe(true);

      await core.get();
      expect(core.cancelled).toBe(false);
    });

    it("前回 get() の error が store() 成功時にリセットされる", async () => {
      installGet(() => Promise.reject(new DOMException("boom", "NotAllowedError")));
      const core = new CredentialCore();
      await core.get();
      expect(core.error).not.toBeNull();

      installStore(() => Promise.resolve({ id: "x" } as any));
      await core.store({} as any);
      expect(core.error).toBeNull();
    });
  });

  describe("_gen 世代ガード（get()/store() 共有、既知の並行呼び出し制限あり）", () => {
    it("dispose 後に resolve した stale な get() は状態を書かない", async () => {
      let resolveGet!: (c: any) => void;
      installGet(() => new Promise((resolve) => { resolveGet = resolve; }));
      const core = new CredentialCore();

      const p = core.get();
      core.dispose();
      resolveGet({ id: "stale" });

      const result = await p;
      expect(result).toBeNull();
      expect(core.value).toBeNull();
    });

    it("dispose 後に reject した stale な get() は状態を書かない", async () => {
      let rejectGet!: (e: unknown) => void;
      installGet(() => new Promise((_resolve, reject) => { rejectGet = reject; }));
      const core = new CredentialCore();

      const p = core.get();
      core.dispose();
      rejectGet(new DOMException("boom", "NotAllowedError"));

      const result = await p;
      expect(result).toBeNull();
      expect(core.error).toBeNull();
    });

    it("dispose 後に resolve した stale な store() は状態を書かない", async () => {
      let resolveStore!: () => void;
      installStore(() => new Promise((resolve) => { resolveStore = resolve as () => void; }));
      const core = new CredentialCore();

      const p = core.store({ id: "stale" } as any);
      core.dispose();
      resolveStore();

      const result = await p;
      expect(result).toBeNull();
      expect(core.value).toBeNull();
    });

    it("dispose 後に reject した stale な store() は状態を書かない", async () => {
      let rejectStore!: (e: unknown) => void;
      installStore(() => new Promise((_resolve, reject) => { rejectStore = reject; }));
      const core = new CredentialCore();

      const p = core.store({} as any);
      core.dispose();
      rejectStore(new DOMException("boom", "NotAllowedError"));

      const result = await p;
      expect(result).toBeNull();
      expect(core.error).toBeNull();
    });

    it("get()進行中にstore()を呼ぶと、後発のstore()がget()完了時の世代を上書きする（既知の制限の回帰確認）", async () => {
      let resolveGet!: (c: any) => void;
      installGet(() => new Promise((resolve) => { resolveGet = resolve; }));
      installStore(() => Promise.resolve()); // store() resolves void per lib.dom.d.ts; value echoes the input instead
      const core = new CredentialCore();

      const getPromise = core.get();
      const storePromise = core.store({ id: "stored" } as any);
      await storePromise;
      expect(core.value).toEqual({ id: "stored" });

      // get() が後から resolve しても、store() が既に進めた世代のため無視される
      resolveGet({ id: "from-get" });
      const getResult = await getPromise;
      expect(getResult).toBeNull(); // stale — this is the documented single-_gen limitation
      expect(core.value).toEqual({ id: "stored" }); // store() の結果が保持されたまま
    });
  });

  describe("never-throw", () => {
    it("get() はどの経路でも例外を投げず常に resolve する", async () => {
      installGet(() => Promise.reject(new Error("network down")));
      const core = new CredentialCore();
      await expect(core.get()).resolves.toBeNull();
    });

    it("store() はどの経路でも例外を投げず常に resolve する", async () => {
      installStore(() => Promise.reject(new Error("network down")));
      const core = new CredentialCore();
      await expect(core.store({} as any)).resolves.toBeNull();
    });
  });

  describe("target 指定", () => {
    it("target を渡すとそこへイベントが dispatch される", async () => {
      installGet(() => Promise.resolve({ id: "x" } as any));
      const target = new EventTarget();
      const events: string[] = [];
      target.addEventListener("wcs-credential:complete", () => events.push("complete"));
      const core = new CredentialCore(target);

      await core.get();

      expect(events).toEqual(["complete"]);
    });
  });

  describe("dispose()", () => {
    it("一度も get/store していない dispose は安全な no-op", () => {
      const core = new CredentialCore();
      expect(() => core.dispose()).not.toThrow();
    });
  });
});
