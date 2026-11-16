import { describe, it, expect, afterEach, vi } from "vitest";
import { CredentialCore } from "../src/core/CredentialCore";
import {
  FakeCredential, FakePasswordCredential,
  installGet, installStore, installPreventSilentAccess, installCredentialClasses,
  removeCredentials, removePasswordCredential, removeCredentialClass,
} from "./mocks";

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
    it("properties が value/loading/error/cancelled/errorInfo/supported を宣言している", () => {
      const names = CredentialCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual(["value", "loading", "error", "cancelled", "errorInfo", "supported"]);
    });

    it("supported の event が wcs-credential:supported-changed で getter を持たない（detail が値）・semantics は state", () => {
      const prop = CredentialCore.wcBindable.properties.find((p) => p.name === "supported")!;
      expect(prop.event).toBe("wcs-credential:supported-changed");
      expect(prop.getter).toBeUndefined();
      expect(prop.semantics).toBe("state");
    });

    it("errorInfo の event が wcs-credential:error-info-changed で getter を持たない（detail が値）", () => {
      const prop = CredentialCore.wcBindable.properties.find((p) => p.name === "errorInfo")!;
      expect(prop.event).toBe("wcs-credential:error-info-changed");
      expect(prop.getter).toBeUndefined();
    });

    it("commands は get(async)/store(async)/preventSilentAccess(async) の3つを宣言している", () => {
      const commands = CredentialCore.wcBindable.commands!;
      expect(commands.map((c) => c.name)).toEqual(["get", "store", "preventSilentAccess"]);
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

    it("get(null) / get(undefined) / オブジェクトでない引数でも投げず、空の options でブラウザに聞く", async () => {
      const fn = installGet(() => Promise.resolve(null));
      const core = new CredentialCore();

      await expect(core.get(null)).resolves.toBeNull();
      await expect(core.get(undefined)).resolves.toBeNull();
      await expect(core.get("password" as any)).resolves.toBeNull();

      expect(fn.mock.calls).toEqual([[{}], [{}], [{}]]);
      expect(core.error).toBeNull();
    });
  });

  describe("PasswordCredential の無いブラウザ（Firefox / Safari: navigator.credentials は WebAuthn 用にある）", () => {
    const expectedError = { name: "NotSupportedError", message: "Password credentials are not supported in this browser." };
    const expectedInfo = {
      code: "capability-missing", phase: "start", recoverable: false,
      capabilityId: "web.password-credential",
      message: "Password credentials are not supported in this browser.",
    };

    it("get({ password: true }) はブラウザを呼ばず capability-missing になる（credential-failed ではない）", async () => {
      const fn = installGet(() => Promise.reject(new TypeError("should not be called")));
      removePasswordCredential();
      const core = new CredentialCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-credential:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const result = await core.get({ password: true, mediation: "silent" });

      expect(result).toBeNull();
      expect(fn).not.toHaveBeenCalled();
      expect(core.error).toEqual(expectedError);
      expect(core.errorInfo).toEqual(expectedInfo);
      expect(loadingEvents).toEqual([]);
    });

    it("get({ federated }) も capability-missing になる", async () => {
      const fn = installGet(() => Promise.resolve(null));
      removePasswordCredential();
      const core = new CredentialCore();

      await core.get({ federated: { providers: ["https://accounts.example.com"] } });

      expect(fn).not.toHaveBeenCalled();
      expect(core.errorInfo).toEqual(expectedInfo);
    });

    it("password も federated も求めない get() は、これまでどおりブラウザに聞く", async () => {
      const fn = installGet(() => Promise.resolve(null));
      removePasswordCredential();
      const core = new CredentialCore();

      await core.get({ mediation: "silent" });
      await core.get({ password: false });
      await core.get();

      expect(fn).toHaveBeenCalledTimes(3);
      expect(core.error).toBeNull();
    });

    it("store() はどの引数でもブラウザを呼ばず capability-missing になる", async () => {
      const fn = installStore(() => Promise.resolve());
      removePasswordCredential();
      const core = new CredentialCore();

      expect(await core.store({ id: "user@example.com", password: "secret" })).toBeNull();
      expect(fn).not.toHaveBeenCalled();
      expect(core.error).toEqual(expectedError);
      expect(core.errorInfo).toEqual(expectedInfo);
      expect(core.value).toBeNull();

      expect(await core.store(new FakeCredential("u", "password") as any)).toBeNull();
      expect(fn).not.toHaveBeenCalled();
    });

    it("supported は false・readiness は idle（credentials はあるが PasswordCredential が無い）", () => {
      installGet(() => Promise.resolve(null));
      removePasswordCredential();
      const core = new CredentialCore();
      expect(core.supported).toBe(false);
      expect(core.platformAssessment.readiness).toBe("idle");
      expect(core.platformAssessment.availability.get("web.credentials")).toBe("available");
      expect(core.platformAssessment.availability.get("web.password-credential")).toBe("missing");
    });

    it("PasswordCredential が関数でない値でも非対応として扱う", async () => {
      const fn = installGet(() => Promise.resolve(null));
      (globalThis as any).PasswordCredential = {};
      const core = new CredentialCore();
      await core.get({ password: true });
      expect(fn).not.toHaveBeenCalled();
      expect(core.errorInfo?.code).toBe("capability-missing");
      expect(core.supported).toBe(false);
    });
  });

  describe("supported（このページでパスワード資格情報が使えるか）", () => {
    it("navigator.credentials と PasswordCredential の両方があれば true（呼び出し時に読む・キャッシュしない）", () => {
      const core = new CredentialCore();
      expect(core.supported).toBe(false);
      installGet(() => Promise.resolve(null));
      expect(core.supported).toBe(true);
      removePasswordCredential();
      expect(core.supported).toBe(false);
      installCredentialClasses();
      expect(core.supported).toBe(true);
      removeCredentials();
      expect(core.supported).toBe(false);
    });

    it("observe() は、最後に知らせた値（初期は false）と違うときだけ supported-changed を流す", async () => {
      installGet(() => Promise.resolve(null));
      const core = new CredentialCore();
      const events: Array<{ detail: boolean; bubbles: boolean }> = [];
      core.addEventListener("wcs-credential:supported-changed", (e) => events.push({ detail: (e as CustomEvent).detail, bubbles: e.bubbles }));

      await core.observe();
      expect(events).toEqual([{ detail: true, bubbles: true }]);

      // 同じ値は流さない（dispose をまたいでも）
      await core.observe();
      core.dispose();
      await core.observe();
      expect(events).toHaveLength(1);

      // 使えなくなったら false を流す
      removePasswordCredential();
      await core.observe();
      expect(events.map((e) => e.detail)).toEqual([true, false]);
    });

    it("使えないページの observe() は何も流さない（初期値 false と同じ）", async () => {
      removeCredentials();
      const core = new CredentialCore();
      const events: boolean[] = [];
      core.addEventListener("wcs-credential:supported-changed", (e) => events.push((e as CustomEvent).detail));
      await core.observe();
      expect(events).toEqual([]);
    });

    it("target 指定時は supported-changed が target に流れる", async () => {
      installGet(() => Promise.resolve(null));
      const target = new EventTarget();
      const core = new CredentialCore(target);
      const events: boolean[] = [];
      target.addEventListener("wcs-credential:supported-changed", (e) => events.push((e as CustomEvent).detail));
      await core.observe();
      expect(events).toEqual([true]);
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
        name: "NotSupportedError",
        message: "WebAuthn (publicKey) is out of scope for @wcstack/credential v1. Use a dedicated WebAuthn node instead.",
      });
      // out-of-scope taxonomy（既存 error shape は不変・errorInfo は追加）
      expect(core.errorInfo).toEqual({
        code: "out-of-scope", phase: "start", recoverable: false,
        message: "WebAuthn (publicKey) is out of scope for @wcstack/credential v1. Use a dedicated WebAuthn node instead.",
      });
    });
  });

  describe("store() — WebAuthn(publicKey)スコープ違反", () => {
    it("type が 'public-key' の credential は プラットフォームAPIへ転送せず即 error になる", async () => {
      const fn = installStore(() => Promise.resolve());
      const core = new CredentialCore();

      const result = await core.store({ type: "public-key", id: "cred-1" } as any);

      expect(result).toBeNull();
      expect(fn).not.toHaveBeenCalled();
      expect(core.value).toBeNull();
      expect(core.loading).toBe(false);
      expect(core.error).toEqual({
        name: "NotSupportedError",
        message: "WebAuthn (publicKey) credentials are out of scope for @wcstack/credential v1. Use a dedicated WebAuthn node instead.",
      });
      expect(core.errorInfo).toEqual({
        code: "out-of-scope", phase: "start", recoverable: false,
        message: "WebAuthn (publicKey) credentials are out of scope for @wcstack/credential v1. Use a dedicated WebAuthn node instead.",
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
      // capability-missing taxonomy
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "start", recoverable: false,
        capabilityId: "web.credentials",
        message: "Credential Management API is not supported in this browser.",
      });
      expect(core.supported).toBe(false);
      expect(core.platformAssessment.readiness).toBe("idle");
    });
  });

  describe("get() — NotAllowedError（ユーザーキャンセル）", () => {
    it("ユーザーがアカウント選択UIを閉じた（NotAllowedError）と cancelled が true になり error は変化しない", async () => {
      // Credential Management API rejects with NotAllowedError (not AbortError)
      // when the user dismisses the native account-chooser UI — see
      // docs/credential-tag-design.md §2.
      installGet(() => Promise.reject(new DOMException("Permission denied", "NotAllowedError")));
      const core = new CredentialCore();

      const result = await core.get();

      expect(result).toBeNull();
      expect(core.cancelled).toBe(true);
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull(); // NotAllowedError=cancelled は errorInfo を立てない
    });
  });

  describe("get() — それ以外の例外（真の失敗）", () => {
    it("DOMException(SecurityError) は cancelled にはならず正規化された error になる", async () => {
      installGet(() => Promise.reject(new DOMException("Not a secure context", "SecurityError")));
      const core = new CredentialCore();

      const result = await core.get();

      expect(result).toBeNull();
      expect(core.error).toEqual({ name: "SecurityError", message: "Not a secure context" });
      expect(core.cancelled).toBe(false);
    });

    it("AbortError（プログラム的 abort 等）は cancelled ではなく error に流れる（credential では AbortError はユーザーキャンセルではない）", async () => {
      // Unlike Web Share/Contact Picker, the Credential Management API does not
      // use AbortError to signal user dismissal; only NotAllowedError maps to
      // cancelled (docs/credential-tag-design.md §2). A programmatic signal
      // abort (AbortError) is therefore a real failure surfaced via `error`.
      installGet(() => Promise.reject(new DOMException("The operation was aborted", "AbortError")));
      const core = new CredentialCore();

      const result = await core.get();

      expect(result).toBeNull();
      expect(core.error).toEqual({ name: "AbortError", message: "The operation was aborted" });
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

    it("同一 credential 参照で連続して store() を成功させても wcs-credential:complete は毎回発火する（value に同値ガード無し、成功完了シグナル。clipboard/broadcast と同方針）", async () => {
      // store() は呼び出し側の credential 引数をそのまま value へ echo する。value を
      // 参照等価ガードすると2回目の成功で complete が抑制される回帰を防ぐ。
      const credential = { id: "user@example.com", type: "password" };
      installStore(() => Promise.resolve()); // store() は void を resolve、value は引数を echo
      const core = new CredentialCore();
      const completes: any[] = [];
      core.addEventListener("wcs-credential:complete", (e) => completes.push((e as CustomEvent).detail));

      await core.store(credential as any);
      await core.store(credential as any); // same reference as the first call

      expect(completes).toEqual([{ value: credential }, { value: credential }]);
      expect(core.value).toBe(credential);
    });
  });

  describe("store() — 素の { id, password } から PasswordCredential を作る", () => {
    it("id と password だけなら、その 2 つだけで PasswordCredential を作って保存し、value は作った資格情報になる", async () => {
      const fn = installStore(() => Promise.resolve());
      const core = new CredentialCore();
      const completes: any[] = [];
      core.addEventListener("wcs-credential:complete", (e) => completes.push((e as CustomEvent).detail.value));

      const result = await core.store({ id: "user@example.com", password: "secret" });

      expect(FakePasswordCredential.inits).toEqual([{ id: "user@example.com", password: "secret" }]);
      expect(result).toBeInstanceOf(FakePasswordCredential);
      expect(fn).toHaveBeenCalledWith(result);
      expect(core.value).toBe(result);
      expect(completes).toEqual([result]);
      expect((result as any).id).toBe("user@example.com");
      expect((result as any).password).toBe("secret");
    });

    it("name / iconURL は与えられたものだけを渡す（null と undefined は渡さない）", async () => {
      installStore(() => Promise.resolve());
      const core = new CredentialCore();

      await core.store({ id: "a", password: "p", name: "山田 花子", iconURL: "https://example.com/a.png" });
      await core.store({ id: "b", password: "p", name: "B" });
      await core.store({ id: "c", password: "p", name: null, iconURL: undefined } as any);

      expect(FakePasswordCredential.inits).toEqual([
        { id: "a", password: "p", name: "山田 花子", iconURL: "https://example.com/a.png" },
        { id: "b", password: "p", name: "B" },
        { id: "c", password: "p" },
      ]);
    });

    it("Credential のインスタンスは、これまでどおりそのまま保存する（作り直さない）", async () => {
      const fn = installStore(() => Promise.resolve());
      const core = new CredentialCore();
      const credential = new FakePasswordCredential({ id: "user@example.com", password: "secret" });
      FakePasswordCredential.inits = [];

      const result = await core.store(credential as any);

      expect(result).toBe(credential);
      expect(fn).toHaveBeenCalledWith(credential);
      expect(FakePasswordCredential.inits).toEqual([]);
    });

    it("Credential クラスの無いブラウザでも、素の { id, password } から作れる（instanceof の前にクラスを確かめる）", async () => {
      const fn = installStore(() => Promise.resolve());
      removeCredentialClass();
      const core = new CredentialCore();

      const result = await core.store({ id: "user@example.com", password: "secret" });

      expect(result).toBeInstanceOf(FakePasswordCredential);
      expect(fn).toHaveBeenCalledWith(result);
    });

    it("id か password が文字列でないものは、これまでどおりそのままブラウザに渡す", async () => {
      const fn = installStore(() => Promise.resolve());
      const core = new CredentialCore();
      const noPassword = { id: "user@example.com" };
      const numericPassword = { id: "user@example.com", password: 1234 };
      const noId = { password: "secret" };

      await core.store(noPassword as any);
      await core.store(numericPassword as any);
      await core.store(noId as any);
      await core.store(null as any);

      expect(fn.mock.calls.map((c) => c[0])).toEqual([noPassword, numericPassword, noId, null]);
      expect(FakePasswordCredential.inits).toEqual([]);
    });

    it("PasswordCredential の構築が投げても reject せず、credential-failed になる（never-throw）", async () => {
      const fn = installStore(() => Promise.resolve());
      const core = new CredentialCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-credential:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      await expect(core.store({ id: "", password: "secret" })).resolves.toBeNull();

      expect(fn).not.toHaveBeenCalled();
      expect(core.error?.name).toBe("TypeError");
      expect(core.errorInfo?.code).toBe("credential-failed");
      expect(core.value).toBeNull();
      expect(loadingEvents).toEqual([true, false]);
    });
  });

  describe("preventSilentAccess()（サインアウト）", () => {
    it("navigator.credentials.preventSilentAccess() を呼び、value / loading には触れない", async () => {
      installGet(() => Promise.resolve({ id: "user@example.com" }));
      const fn = installPreventSilentAccess(() => Promise.resolve());
      const core = new CredentialCore();
      await core.get();
      const events: string[] = [];
      for (const name of ["wcs-credential:complete", "wcs-credential:loading-changed", "wcs-credential:error", "wcs-credential:cancelled-changed"]) {
        core.addEventListener(name, () => events.push(name));
      }

      await expect(core.preventSilentAccess()).resolves.toBeUndefined();

      expect(fn).toHaveBeenCalledTimes(1);
      expect(core.value).toEqual({ id: "user@example.com" });
      expect(core.loading).toBe(false);
      expect(events).toEqual([]);
    });

    it("成功すると、残っていた error / errorInfo を消す", async () => {
      installGet(() => Promise.reject(new DOMException("boom", "SecurityError")));
      installPreventSilentAccess(() => Promise.resolve());
      const core = new CredentialCore();
      await core.get();
      expect(core.error).not.toBeNull();

      await core.preventSilentAccess();

      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("reject は error / errorInfo（credential-failed）に入り、reject しない", async () => {
      installPreventSilentAccess(() => Promise.reject(new DOMException("not allowed here", "InvalidStateError")));
      const core = new CredentialCore();

      await expect(core.preventSilentAccess()).resolves.toBeUndefined();

      expect(core.error).toEqual({ name: "InvalidStateError", message: "not allowed here" });
      expect(core.errorInfo).toEqual({ code: "credential-failed", phase: "execute", recoverable: true, message: "not allowed here" });
      expect(core.cancelled).toBe(false);
    });

    it("同期的に投げる実装でも reject しない", async () => {
      installPreventSilentAccess(() => { throw new TypeError("sync boom"); });
      const core = new CredentialCore();
      await expect(core.preventSilentAccess()).resolves.toBeUndefined();
      expect(core.error).toEqual({ name: "TypeError", message: "sync boom" });
    });

    it("navigator.credentials が無ければ、何もせず静かに resolve する（error を立てない）", async () => {
      removeCredentials();
      const core = new CredentialCore();
      await expect(core.preventSilentAccess()).resolves.toBeUndefined();
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("preventSilentAccess メソッドが無ければ、何もせず静かに resolve する", async () => {
      installGet(() => Promise.resolve(null)); // credentials はあるが preventSilentAccess は無い
      const core = new CredentialCore();
      await expect(core.preventSilentAccess()).resolves.toBeUndefined();
      expect(core.error).toBeNull();
    });

    it("PasswordCredential の無いブラウザ（Firefox / Safari）でも呼べる", async () => {
      const fn = installPreventSilentAccess(() => Promise.resolve());
      removePasswordCredential();
      const core = new CredentialCore();
      await core.preventSilentAccess();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(core.error).toBeNull();
    });

    it("lane を通らない: 進行中の get() を supersede せず、get() の結果はそのまま反映される", async () => {
      let resolveGet!: (c: any) => void;
      installGet(() => new Promise((resolve) => { resolveGet = resolve; }));
      installPreventSilentAccess(() => Promise.resolve());
      const core = new CredentialCore();

      const getPromise = core.get();
      await core.preventSilentAccess();
      expect(core.loading).toBe(true);

      resolveGet({ id: "from-get" });
      expect(await getPromise).toEqual({ id: "from-get" });
      expect(core.value).toEqual({ id: "from-get" });
      expect(core.loading).toBe(false);
    });

    it("dispose 後に決着した preventSilentAccess() は状態を書かない（成功でも失敗でも）", async () => {
      installGet(() => Promise.reject(new DOMException("boom", "SecurityError")));
      const core = new CredentialCore();
      await core.get();
      const before = core.error;

      let resolvePrevent!: () => void;
      installPreventSilentAccess(() => new Promise<void>((resolve) => { resolvePrevent = resolve; }));
      const p1 = core.preventSilentAccess();
      core.dispose();
      resolvePrevent();
      await p1;
      expect(core.error).toBe(before); // 成功の「error を消す」は書かれない

      let rejectPrevent!: (e: unknown) => void;
      installPreventSilentAccess(() => new Promise<void>((_resolve, reject) => { rejectPrevent = reject; }));
      const p2 = core.preventSilentAccess();
      core.dispose();
      rejectPrevent(new TypeError("late"));
      await p2;
      expect(core.error).toBe(before); // 失敗の error も書かれない
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

  describe("store() — NotAllowedError（ユーザーキャンセル）/ 真の失敗", () => {
    it("NotAllowedError は cancelled に倒れ error は変化しない", async () => {
      // store() applies the same §2 cancellation rule as get().
      installStore(() => Promise.reject(new DOMException("declined", "NotAllowedError")));
      const core = new CredentialCore();
      await core.store({} as any);
      expect(core.cancelled).toBe(true);
      expect(core.error).toBeNull();
    });

    it("AbortError は cancelled ではなく error に流れる", async () => {
      installStore(() => Promise.reject(new DOMException("aborted", "AbortError")));
      const core = new CredentialCore();
      await core.store({} as any);
      expect(core.cancelled).toBe(false);
      expect(core.error).toEqual({ name: "AbortError", message: "aborted" });
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
      fn.mockRejectedValueOnce(new DOMException("declined", "NotAllowedError"));
      const core = new CredentialCore();

      await core.get();
      expect(core.cancelled).toBe(true);

      await core.get();
      expect(core.cancelled).toBe(false);
    });

    it("前回 get() の error が store() 成功時にリセットされる", async () => {
      installGet(() => Promise.reject(new DOMException("boom", "SecurityError")));
      const core = new CredentialCore();
      await core.get();
      expect(core.error).not.toBeNull();

      installStore(() => Promise.resolve({ id: "x" } as any));
      await core.store({} as any);
      expect(core.error).toBeNull();
    });
  });

  describe("dispose / supersede 世代ガード（get()/store() 共有 lane・latest）", () => {
    it("dispose は進行中の loading を false に戻してイベントで知らせる", async () => {
      let resolveGet!: (c: any) => void;
      installGet(() => new Promise((resolve) => { resolveGet = resolve; }));
      const core = new CredentialCore();
      const loadings: unknown[] = [];
      core.addEventListener("wcs-credential:loading-changed", (e) => loadings.push((e as CustomEvent).detail));
      const p = core.get();
      core.dispose();
      expect(core.loading).toBe(false);
      expect(loadings).toEqual([true, false]);
      resolveGet({ id: "stale" });
      await p;
      expect(loadings).toEqual([true, false]);
    });

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
      expect(getResult).toBeNull(); // stale — store() が supersede した（latest 共有 lane）
      expect(core.value).toEqual({ id: "stored" }); // store() の結果が保持されたまま
    });
  });

  describe("errorInfo（bindable 出力・wcs-credential:error-info-changed）", () => {
    it("真の失敗で errorInfo=credential-failed が detail 付きで発火し、次の呼び出し開始時に null で発火する", async () => {
      installGet(() => Promise.reject(new DOMException("Not a secure context", "SecurityError")));
      const core = new CredentialCore();
      const details: unknown[] = [];
      core.addEventListener("wcs-credential:error-info-changed", (e) => details.push((e as CustomEvent).detail));

      await core.get();
      expect(details).toHaveLength(1);
      expect((details[0] as { code: string }).code).toBe("credential-failed");
      expect(core.errorInfo?.message).toBe("Not a secure context");

      installGet(() => Promise.resolve({ id: "u@example.com" } as any));
      await core.get();
      expect(details).toHaveLength(2);
      expect(details[1]).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("成功のみでは error-info-changed を発火しない（同値ガード）", async () => {
      installGet(() => Promise.resolve({ id: "u" } as any));
      const core = new CredentialCore();
      const details: unknown[] = [];
      core.addEventListener("wcs-credential:error-info-changed", (e) => details.push((e as CustomEvent).detail));
      await core.get();
      expect(details).toHaveLength(0);
      expect(core.errorInfo).toBeNull();
    });

    it("NotAllowedError キャンセルは errorInfo を立てない", async () => {
      installGet(() => Promise.reject(new DOMException("declined", "NotAllowedError")));
      const core = new CredentialCore();
      await core.get();
      expect(core.cancelled).toBe(true);
      expect(core.errorInfo).toBeNull();
    });

    it("イベントは bubbles する", async () => {
      installGet(() => Promise.reject(new DOMException("x", "SecurityError")));
      const core = new CredentialCore();
      let bubbles = false;
      core.addEventListener("wcs-credential:error-info-changed", (e) => { bubbles = e.bubbles; });
      await core.get();
      expect(bubbles).toBe(true);
    });

    it("navigator.credentials があれば supported=true・readiness=ready", () => {
      installGet(() => Promise.resolve(null));
      const core = new CredentialCore();
      expect(core.supported).toBe(true);
      expect(core.platformAssessment.readiness).toBe("ready");
      expect(core.platformAssessment.availability.get("web.credentials")).toBe("available");
    });

    it("store() の真の失敗も errorInfo=credential-failed（get と共有 lane）", async () => {
      installStore(() => Promise.reject(new DOMException("boom", "SecurityError")));
      const core = new CredentialCore();
      await core.store({ id: "u" } as any);
      expect(core.errorInfo?.code).toBe("credential-failed");
      expect(core.cancelled).toBe(false);
    });

    it("非 Error rejection は _normalizeError で {name:'Error', message:String(e)} に正規化される", async () => {
      installGet(() => Promise.reject("plain string"));
      const core = new CredentialCore();
      await core.get();
      expect(core.error).toEqual({ name: "Error", message: "plain string" });
      expect(core.errorInfo).toEqual({ code: "credential-failed", phase: "execute", recoverable: true, message: "plain string" });
    });
  });

  describe("commit guard（latest の同期 supersede）", () => {
    it("setter が同期発火した event で同 lane を supersede すると残りの commit を止める（guard 後検査）", async () => {
      installGet(() => Promise.resolve({ id: "op1" } as any));
      const core = new CredentialCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-credential:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));
      let superseded = false;
      core.addEventListener("wcs-credential:complete", () => {
        if (!superseded) {
          superseded = true;
          installGet(() => Promise.resolve({ id: "op2" } as any));
          core.get(); // op1 の setValue 途中で op2 が supersede
        }
      });

      await core.get();
      await new Promise((r) => setTimeout(r, 0));

      // op1 の setLoading(false) は guard で抑止され、loading は true→false（op2 の完了のみ）。
      expect(loadingEvents).toEqual([true, false]);
      expect(core.loading).toBe(false);
      expect((core.value as { id?: string } | null)?.id).toBe("op2");
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
