import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapCredential } from "../src/bootstrapCredential";
import { setConfig } from "../src/config";
import { WcsCredential } from "../src/components/Credential";
import {
  FakePasswordCredential, installGet, installStore, installPreventSilentAccess,
  removeCredentials, removePasswordCredential,
} from "./mocks";

function createCredential(): WcsCredential {
  return document.createElement("wcs-credential") as WcsCredential;
}

describe("Credential (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { credential: "wcs-credential" } });
    bootstrapCredential();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removeCredentials();
  });

  it("接続時に display:none になる", () => {
    const el = createCredential();
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("接続前の getter は既定値を返す", () => {
    const el = createCredential();
    expect(el.value).toBeNull();
    expect(el.loading).toBe(false);
    expect(el.error).toBeNull();
    expect(el.cancelled).toBe(false);
    expect(el.supported).toBe(false);
  });

  it("supported は Core に委譲され、接続時に wcs-credential:supported-changed が流れる（再接続では同じ値を流さない）", () => {
    installGet(() => Promise.resolve(null));
    const el = createCredential();
    // 接続前でも、束縛が読む値は正しい
    expect(el.supported).toBe(true);
    const events: boolean[] = [];
    el.addEventListener("wcs-credential:supported-changed", (e) => events.push((e as CustomEvent).detail));

    document.body.appendChild(el);
    expect(events).toEqual([true]);

    el.remove();
    document.body.appendChild(el);
    expect(events).toEqual([true]);
  });

  it("PasswordCredential の無いブラウザでは supported は false のままで、イベントも流れない", async () => {
    const fn = installGet(() => Promise.resolve(null));
    removePasswordCredential();
    const el = createCredential();
    const events: boolean[] = [];
    el.addEventListener("wcs-credential:supported-changed", (e) => events.push((e as CustomEvent).detail));
    document.body.appendChild(el);
    expect(el.supported).toBe(false);
    expect(events).toEqual([]);

    // パスワードを求める get() はブラウザを呼ばず capability-missing
    await el.get({ password: true });
    expect(fn).not.toHaveBeenCalled();
    expect(el.errorInfo?.code).toBe("capability-missing");
  });

  it("store() に素の { id, password } を渡すと PasswordCredential を作って保存する", async () => {
    const fn = installStore(() => Promise.resolve());
    const el = createCredential();
    document.body.appendChild(el);

    const result = await el.store({ id: "user@example.com", password: "secret" });

    expect(result).toBeInstanceOf(FakePasswordCredential);
    expect(fn).toHaveBeenCalledWith(result);
    expect(el.value).toBe(result);
  });

  it("preventSilentAccess() が Core に委譲される", async () => {
    const fn = installPreventSilentAccess(() => Promise.resolve());
    const el = createCredential();
    document.body.appendChild(el);

    await expect(el.preventSilentAccess()).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("get(null) でも投げない", async () => {
    installGet(() => Promise.resolve(null));
    const el = createCredential();
    await expect(el.get(null)).resolves.toBeNull();
  });

  it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する（SSR）", async () => {
    expect(WcsCredential.hasConnectedCallbackPromise).toBe(true);
    const el = createCredential();
    document.body.appendChild(el);
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
  });

  it("get() が成功すると value/loading が反映される", async () => {
    const credential = { id: "user@example.com" };
    installGet(() => Promise.resolve(credential));
    const el = createCredential();
    document.body.appendChild(el);

    const result = await el.get({ password: true });

    expect(result).toEqual(credential);
    expect(el.value).toEqual(credential);
    expect(el.loading).toBe(false);
  });

  it("errorInfo は Core から転送される（unsupported で capability-missing）", async () => {
    removeCredentials();
    const el = createCredential();
    await el.get();
    expect(el.errorInfo).toEqual({
      code: "capability-missing", phase: "start", recoverable: false,
      capabilityId: "web.credentials",
      message: "Credential Management API is not supported in this browser.",
    });
  });

  it("store() が成功すると value が反映される", async () => {
    const credential = { id: "user@example.com" };
    installStore(() => Promise.resolve(credential));
    const el = createCredential();
    document.body.appendChild(el);

    const result = await el.store(credential as any);

    expect(result).toEqual(credential);
    expect(el.value).toEqual(credential);
  });

  it("get() が NotAllowedError（ユーザーがアカウント選択UIを閉じた）で拒否されると cancelled が true になる", async () => {
    // The Credential Management API rejects with NotAllowedError, not
    // AbortError, on user dismissal — see docs/credential-tag-design.md §2.
    installGet(() => Promise.reject(new DOMException("Permission denied", "NotAllowedError")));
    const el = createCredential();
    document.body.appendChild(el);

    await el.get();

    expect(el.cancelled).toBe(true);
    expect(el.error).toBeNull();
  });

  it("navigator.credentials 不在時は error になる（unsupported）", async () => {
    removeCredentials();
    const el = createCredential();
    document.body.appendChild(el);

    const result = await el.get();

    expect(result).toBeNull();
    expect(el.error).toEqual({ message: "Credential Management API is not supported in this browser." });
  });

  it("disconnectedCallback で dispose される（以後の stale resolve が状態を変えない）", async () => {
    let resolveGet!: (c: any) => void;
    installGet(() => new Promise((resolve) => { resolveGet = resolve; }));
    const el = createCredential();
    document.body.appendChild(el);

    const promise = el.get();
    el.remove();
    resolveGet({ id: "stale" });

    await promise;
    expect(el.value).toBeNull();
  });

  it("wcBindable: inputs は空、commands は get(async)/store(async)/preventSilentAccess(async)、properties は Core を継承する", () => {
    expect(WcsCredential.wcBindable.inputs).toEqual([]);
    expect(WcsCredential.wcBindable.commands).toEqual([
      { name: "get", async: true },
      { name: "store", async: true },
      { name: "preventSilentAccess", async: true },
    ]);
    expect(WcsCredential.wcBindable.properties.map((p) => p.name)).toEqual([
      "value", "loading", "error", "cancelled", "errorInfo", "supported",
    ]);
  });
});
