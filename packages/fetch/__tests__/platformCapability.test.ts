import { describe, it, expect, afterEach, vi } from "vitest";
import {
  assessCapabilities,
  requiredCapabilitiesAvailable,
  featureUnavailable,
  featureUnavailableMessage,
  type CapabilityRegistry,
  type CapabilitySpec,
} from "../src/core/platformCapability";
import { FETCH_CAPABILITIES, WCS_FETCH_ERROR_CODE } from "../src/core/fetchCapabilities";

function registry(entries: Record<string, CapabilitySpec>): CapabilityRegistry {
  return new Map(Object.entries(entries));
}

describe("platformCapability — error codes", () => {
  it("安定した taxonomy code を公開する", () => {
    expect(WCS_FETCH_ERROR_CODE).toEqual({
      CapabilityMissing: "capability-missing",
      InvalidArgument: "invalid-argument",
      Network: "network",
      HttpError: "http-error",
      Timeout: "timeout",
      Aborted: "aborted",
    });
  });
});

describe("platformCapability — FETCH_CAPABILITIES registry", () => {
  const origFetch = globalThis.fetch;
  const origAC = globalThis.AbortController;
  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = origFetch;
    (globalThis as { AbortController?: unknown }).AbortController = origAC;
  });

  it("web.fetch / web.abort-controller の probe は presence を副作用なく返す", () => {
    expect(FETCH_CAPABILITIES.get("web.fetch")!.probe()).toBe(true);
    expect(FETCH_CAPABILITIES.get("web.abort-controller")!.probe()).toBe(true);
    (globalThis as { fetch?: unknown }).fetch = undefined;
    (globalThis as { AbortController?: unknown }).AbortController = undefined;
    expect(FETCH_CAPABILITIES.get("web.fetch")!.probe()).toBe(false);
    expect(FETCH_CAPABILITIES.get("web.abort-controller")!.probe()).toBe(false);
  });
});

describe("assessCapabilities", () => {
  it("全 available なら readiness=ready", () => {
    const reg = registry({ a: { probe: () => true }, b: { probe: () => true } });
    const a = assessCapabilities(reg, { required: ["a"], optional: ["b"] });
    expect(a.readiness).toBe("ready");
    expect(a.availability.get("a")).toBe("available");
    expect(a.availability.get("b")).toBe("available");
  });

  it("optional 欠如は readiness=degraded(required は揃う)", () => {
    const reg = registry({ a: { probe: () => true }, b: { probe: () => false } });
    const a = assessCapabilities(reg, { required: ["a"], optional: ["b"] });
    expect(a.readiness).toBe("degraded");
    expect(a.availability.get("b")).toBe("missing");
  });

  it("required 欠如は readiness=idle(開始不可)", () => {
    const reg = registry({ a: { probe: () => false } });
    const a = assessCapabilities(reg, { required: ["a"] });
    expect(a.readiness).toBe("idle");
    expect(a.availability.get("a")).toBe("missing");
  });

  it("registry 未登録の ID は unknown(required なら idle)", () => {
    const a = assessCapabilities(registry({}), { required: ["nope"] });
    expect(a.availability.get("nope")).toBe("unknown");
    expect(a.readiness).toBe("idle");
  });

  it("secure-context を要求する capability は isSecureContext で判定する", () => {
    const reg = registry({ s: { probe: () => true, requiresSecureContext: true } });
    const orig = (globalThis as { isSecureContext?: unknown }).isSecureContext;
    try {
      (globalThis as { isSecureContext?: unknown }).isSecureContext = true;
      expect(assessCapabilities(reg, { required: ["s"] }).preconditions.secureContext).toBe("satisfied");
      (globalThis as { isSecureContext?: unknown }).isSecureContext = false;
      expect(assessCapabilities(reg, { required: ["s"] }).preconditions.secureContext).toBe("required");
    } finally {
      (globalThis as { isSecureContext?: unknown }).isSecureContext = orig;
    }
  });

  it("secure-context / user-activation を要求しない場合は not-applicable", () => {
    const reg = registry({ a: { probe: () => true } });
    const p = assessCapabilities(reg, { required: ["a"] }).preconditions;
    expect(p).toEqual({ secureContext: "not-applicable", userActivation: "not-applicable" });
  });

  it("user-activation を要求する capability は required", () => {
    const reg = registry({ u: { probe: () => true, requiresUserActivation: true } });
    expect(assessCapabilities(reg, { required: ["u"] }).preconditions.userActivation).toBe("required");
  });

  it("permission / activity / epoch / lastError を素通しする", () => {
    const reg = registry({ a: { probe: () => true } });
    const lastError = { code: WCS_FETCH_ERROR_CODE.Network, phase: "execute" as const, recoverable: true, message: "x" };
    const a = assessCapabilities(reg, { required: ["a"], permission: "granted", activity: "active", epoch: 7, lastError });
    expect(a.permission).toBe("granted");
    expect(a.activity).toBe("active");
    expect(a.epoch).toBe(7);
    expect(a.lastError).toBe(lastError);
  });

  it("既定値: permission=not-applicable / activity=inactive / epoch=0 / lastError=undefined", () => {
    const a = assessCapabilities(registry({ a: { probe: () => true } }), { required: ["a"] });
    expect(a.permission).toBe("not-applicable");
    expect(a.activity).toBe("inactive");
    expect(a.epoch).toBe(0);
    expect(a.lastError).toBeUndefined();
  });
});

describe("requiredCapabilitiesAvailable", () => {
  it("required が全 available のときだけ true", () => {
    const reg = registry({ a: { probe: () => true }, b: { probe: () => false } });
    expect(requiredCapabilitiesAvailable(assessCapabilities(reg, { required: ["a"] }), ["a"])).toBe(true);
    expect(requiredCapabilitiesAvailable(assessCapabilities(reg, { required: ["b"] }), ["b"])).toBe(false);
  });
});

describe("platformCapability — featureUnavailable（このページで使えない理由）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (document as { featurePolicy?: unknown }).featurePolicy;
    delete (document as { permissionsPolicy?: unknown }).permissionsPolicy;
  });

  it("安全なコンテキストでなければ insecure-context（ポリシーで制御されない機能も）", () => {
    vi.stubGlobal("isSecureContext", false);
    expect(featureUnavailable("camera")).toBe("insecure-context");
    expect(featureUnavailable("notifications")).toBe("insecure-context");
  });

  it("isSecureContext が無い環境（SSR・テスト）は判断しない", () => {
    vi.stubGlobal("isSecureContext", undefined);
    expect(featureUnavailable("camera")).toBeNull();
  });

  it("Permissions-Policy が切った機能は policy-blocked、許した機能は null", () => {
    vi.stubGlobal("isSecureContext", true);
    (document as any).featurePolicy = { allowsFeature: (f: string) => f !== "camera" };
    expect(featureUnavailable("camera")).toBe("policy-blocked");
    expect(featureUnavailable("microphone")).toBeNull();
  });

  it("permissionsPolicy を featurePolicy より先に読む", () => {
    vi.stubGlobal("isSecureContext", true);
    (document as any).permissionsPolicy = { allowsFeature: () => false };
    (document as any).featurePolicy = { allowsFeature: () => true };
    expect(featureUnavailable("geolocation")).toBe("policy-blocked");
  });

  it("ポリシーが制御しない名前は allowsFeature に聞かない（未知の機能は false を返すため）", () => {
    vi.stubGlobal("isSecureContext", true);
    const allowsFeature = vi.fn(() => false);
    (document as any).featurePolicy = { allowsFeature };
    expect(featureUnavailable("notifications")).toBeNull();
    expect(allowsFeature).not.toHaveBeenCalled();
  });

  it("ポリシーの API が無い、または投げるときは判断しない", () => {
    vi.stubGlobal("isSecureContext", true);
    expect(featureUnavailable("camera")).toBeNull();
    (document as any).featurePolicy = {};
    expect(featureUnavailable("camera")).toBeNull();
    (document as any).featurePolicy = { allowsFeature: () => { throw new Error("x"); } };
    expect(featureUnavailable("camera")).toBeNull();
  });

  it("理由ごとに直し方の読める文を返す", () => {
    expect(featureUnavailableMessage("The camera", "camera", "insecure-context")).toBe(
      "The camera needs a secure context (https:, or http://localhost), and this page is not one.",
    );
    const blocked = featureUnavailableMessage("The camera", "camera", "policy-blocked");
    expect(blocked).toContain("Permissions-Policy");
    expect(blocked).toContain('allow="camera"');
  });
});
