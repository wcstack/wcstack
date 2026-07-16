import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapCredential } from "../src/bootstrapCredential";
import { setConfig } from "../src/config";
import { WcsCredential } from "../src/components/Credential";
import { installGet, installStore, removeCredentials } from "./mocks";

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

  it("wcBindable: inputs は空、commands は get(async)/store(async)", () => {
    expect(WcsCredential.wcBindable.inputs).toEqual([]);
    expect(WcsCredential.wcBindable.commands).toEqual([
      { name: "get", async: true },
      { name: "store", async: true },
    ]);
  });
});
