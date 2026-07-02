import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapEyedropper } from "../src/bootstrapEyedropper";
import { setConfig } from "../src/config";
import { WcsEyedropper } from "../src/components/Eyedropper";
import { installEyeDropper, removeEyeDropper } from "./mocks";

function createEyedropper(): WcsEyedropper {
  return document.createElement("wcs-eyedropper") as WcsEyedropper;
}

describe("Eyedropper (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { eyedropper: "wcs-eyedropper" } });
    bootstrapEyedropper();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removeEyeDropper();
  });

  it("接続時に display:none になる", () => {
    const el = createEyedropper();
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("接続前の getter は既定値を返す", () => {
    const el = createEyedropper();
    expect(el.value).toBeNull();
    expect(el.loading).toBe(false);
    expect(el.error).toBeNull();
    expect(el.cancelled).toBe(false);
  });

  it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する（SSR）", async () => {
    expect(WcsEyedropper.hasConnectedCallbackPromise).toBe(true);
    const el = createEyedropper();
    document.body.appendChild(el);
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
  });

  it("disconnectedCallback で dispose される（以後の stale resolve が状態を変えない）", async () => {
    const { pendingOpens } = installEyeDropper();
    const el = createEyedropper();
    document.body.appendChild(el);

    const promise = el.open();
    el.remove(); // disconnectedCallback → dispose()
    pendingOpens[0].resolve({ sRGBHex: "#aabbcc" });

    await promise;
    expect(el.value).toBeNull();
  });

  it("open() が成功すると value/loading が反映される", async () => {
    const { pendingOpens } = installEyeDropper();
    const el = createEyedropper();
    document.body.appendChild(el);

    const promise = el.open();
    pendingOpens[0].resolve({ sRGBHex: "#123456" });
    const result = await promise;

    expect(result).toEqual({ sRGBHex: "#123456" });
    expect(el.value).toEqual({ sRGBHex: "#123456" });
    expect(el.loading).toBe(false);
  });

  it("open() が AbortError で拒否されると cancelled が true になる", async () => {
    const { pendingOpens } = installEyeDropper();
    const el = createEyedropper();
    document.body.appendChild(el);

    const promise = el.open();
    pendingOpens[0].reject(new DOMException("The user aborted a request.", "AbortError"));
    await promise;

    expect(el.cancelled).toBe(true);
    expect(el.error).toBeNull();
  });

  it("open() がそれ以外の例外で拒否されると error が設定される", async () => {
    const { pendingOpens } = installEyeDropper();
    const el = createEyedropper();
    document.body.appendChild(el);

    const promise = el.open();
    pendingOpens[0].reject(new DOMException("boom", "NotAllowedError"));
    await promise;

    expect(el.error).not.toBeNull();
    expect(el.cancelled).toBe(false);
  });

  it("EyeDropper 不在時は error になる（unsupported）", async () => {
    removeEyeDropper();
    const el = createEyedropper();
    document.body.appendChild(el);

    const result = await el.open();

    expect(result).toBeNull();
    expect(el.error).toEqual({ message: "EyeDropper API is not supported in this browser." });
  });

  describe("abort()", () => {
    it("Core の abort() へ委譲し、進行中の open() を中断する", async () => {
      const { pendingOpens } = installEyeDropper();
      const el = createEyedropper();
      document.body.appendChild(el);

      const promise = el.open();
      el.abort();
      const result = await promise;

      expect(result).toBeNull();
      expect(el.cancelled).toBe(true);
      expect(pendingOpens[0].signal?.aborted).toBe(true);
    });

    it("open() 実行前に呼んでも例外を投げない", () => {
      installEyeDropper();
      const el = createEyedropper();
      expect(() => el.abort()).not.toThrow();
    });
  });

  it("wcBindable: inputs は空、commands は open(async)/abort、properties は Core を継承する", () => {
    expect(WcsEyedropper.wcBindable.inputs).toEqual([]);
    expect(WcsEyedropper.wcBindable.commands).toEqual([
      { name: "open", async: true },
      { name: "abort" },
    ]);
    expect(WcsEyedropper.wcBindable.properties.map((p) => p.name)).toEqual([
      "value", "loading", "error", "cancelled",
    ]);
  });

  it("再接続すると再度 observe() され、以後の open() が独立して動く", async () => {
    const { pendingOpens } = installEyeDropper();
    const el = createEyedropper();
    document.body.appendChild(el);
    el.remove();
    document.body.appendChild(el);

    const promise = el.open();
    pendingOpens[pendingOpens.length - 1].resolve({ sRGBHex: "#abcdef" });
    const result = await promise;
    expect(result).toEqual({ sRGBHex: "#abcdef" });
  });
});
