import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapShare } from "../src/bootstrapShare";
import { setConfig } from "../src/config";
import { WcsShare } from "../src/components/Share";
import { installShare, removeShare, installCanShare, removeCanShare } from "./mocks";

function createShare(): WcsShare {
  return document.createElement("wcs-share") as WcsShare;
}

describe("Share (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { share: "wcs-share" } });
    bootstrapShare();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removeShare();
    removeCanShare();
  });

  it("接続時に display:none になる", () => {
    const el = createShare();
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("接続前の getter は既定値を返す", () => {
    const el = createShare();
    expect(el.value).toBeNull();
    expect(el.loading).toBe(false);
    expect(el.error).toBeNull();
    expect(el.cancelled).toBe(false);
  });

  it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する（SSR）", async () => {
    expect(WcsShare.hasConnectedCallbackPromise).toBe(true);
    const el = createShare();
    document.body.appendChild(el);
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
  });

  it("disconnectedCallback で dispose される（以後の stale resolve が状態を変えない）", async () => {
    let resolveShare!: () => void;
    installShare(() => new Promise<void>((resolve) => { resolveShare = resolve; }));
    const el = createShare();
    document.body.appendChild(el);

    const promise = el.share({ url: "https://example.com" });
    el.remove(); // disconnectedCallback → dispose()
    resolveShare();

    await promise;
    expect(el.value).toBeNull();
  });

  it("share() が成功すると value/loading が反映される", async () => {
    installShare(() => Promise.resolve());
    const el = createShare();
    document.body.appendChild(el);

    const data = { title: "t", url: "https://example.com" };
    const result = await el.share(data);

    expect(result).toEqual(data);
    expect(el.value).toEqual(data);
    expect(el.loading).toBe(false);
  });

  it("share() が AbortError で拒否されると cancelled が true になる", async () => {
    installShare(() => Promise.reject(new DOMException("Share canceled", "AbortError")));
    const el = createShare();
    document.body.appendChild(el);

    await el.share({ url: "https://example.com" });

    expect(el.cancelled).toBe(true);
    expect(el.error).toBeNull();
  });

  it("share() がそれ以外の例外で拒否されると error が設定される", async () => {
    installShare(() => Promise.reject(new DOMException("boom", "NotAllowedError")));
    const el = createShare();
    document.body.appendChild(el);

    await el.share({ url: "https://example.com" });

    expect(el.error).not.toBeNull();
    expect(el.cancelled).toBe(false);
  });

  it("navigator.share 不在時は error になる（unsupported）", async () => {
    removeShare();
    const el = createShare();
    document.body.appendChild(el);

    const result = await el.share({ url: "https://example.com" });

    expect(result).toBeNull();
    expect(el.error).toEqual({ message: "Web Share API is not supported in this browser." });
  });

  describe("canShare()", () => {
    it("navigator.canShare に同期委譲する", () => {
      installCanShare((data) => !!data?.url);
      const el = createShare();
      expect(el.canShare({ url: "https://example.com" })).toBe(true);
      expect(el.canShare({ title: "no url" })).toBe(false);
    });

    it("navigator.canShare 不在時は false を返し例外を投げない", () => {
      removeCanShare();
      const el = createShare();
      expect(() => el.canShare({ url: "https://example.com" })).not.toThrow();
      expect(el.canShare({ url: "https://example.com" })).toBe(false);
    });

    it("引数無しでも呼べる", () => {
      installCanShare(() => false);
      const el = createShare();
      expect(el.canShare()).toBe(false);
    });
  });

  it("wcBindable: inputs は空、commands は share(async) のみ、properties は Core を継承する", () => {
    expect(WcsShare.wcBindable.inputs).toEqual([]);
    expect(WcsShare.wcBindable.commands).toEqual([{ name: "share", async: true }]);
    expect(WcsShare.wcBindable.properties.map((p) => p.name)).toEqual([
      "value", "loading", "error", "cancelled",
    ]);
  });

  it("再接続すると再度 observe() され、以後の share() が独立して動く", async () => {
    installShare(() => Promise.resolve());
    const el = createShare();
    document.body.appendChild(el);
    el.remove();
    document.body.appendChild(el);

    const result = await el.share({ url: "https://example.com" });
    expect(result).toEqual({ url: "https://example.com" });
  });
});
