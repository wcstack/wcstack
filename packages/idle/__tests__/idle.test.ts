import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapIdle } from "../src/bootstrapIdle";
import { setConfig } from "../src/config";
import { WcsIdle } from "../src/components/Idle";
import { installIdleDetector, removeIdleDetector } from "./mocks";

function createIdle(attrs: Record<string, string> = {}): WcsIdle {
  const el = document.createElement("wcs-idle") as WcsIdle;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

describe("Idle (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { idle: "wcs-idle" } });
    bootstrapIdle();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removeIdleDetector();
  });

  it("接続時に display:none になる", () => {
    const el = createIdle();
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("接続前の getter は既定値を返す", () => {
    const el = createIdle();
    expect(el.userState).toBeNull();
    expect(el.screenState).toBeNull();
    expect(el.active).toBe(false);
    expect(el.error).toBeNull();
  });

  it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する（SSR）", async () => {
    expect(WcsIdle.hasConnectedCallbackPromise).toBe(true);
    const el = createIdle();
    document.body.appendChild(el);
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
  });

  it("接続しても start() を自動的に呼ばない（§6 の決定の検証）", () => {
    const { instances } = installIdleDetector();
    const el = createIdle();
    document.body.appendChild(el);
    expect(instances).toHaveLength(0);
  });

  it("threshold 属性の getter/setter", () => {
    const el = createIdle();
    expect(el.threshold).toBe(60000); // 既定値
    el.threshold = 120000;
    expect(el.getAttribute("threshold")).toBe("120000");
    expect(el.threshold).toBe(120000);
  });

  it("threshold 属性が不正な値のときは既定値にフォールバックする", () => {
    const el = createIdle({ threshold: "not-a-number" });
    expect(el.threshold).toBe(60000);
  });

  it("threshold 属性が空文字/空白のときも既定値にフォールバックする（Number('')===0 の抜け穴防止）", () => {
    const empty = createIdle({ threshold: "" });
    expect(empty.threshold).toBe(60000);

    const blank = createIdle({ threshold: "   " });
    expect(blank.threshold).toBe(60000);
  });

  it("requestPermission()/start()/stop() が Core に委譲される", async () => {
    const { instances, requestPermission } = installIdleDetector();
    const el = createIdle({ threshold: "90000" });
    document.body.appendChild(el);

    await el.requestPermission();
    expect(requestPermission).toHaveBeenCalled();

    await el.start();
    expect(instances[0].start).toHaveBeenCalledWith({ threshold: 90000, signal: expect.any(AbortSignal) });

    el.stop();
    instances[0].emitChange("idle", "locked");
    expect(el.userState).toBe("active"); // stop 後は反映されない
  });

  it("start() に明示的な threshold を渡すとそちらが優先される", async () => {
    const { instances } = installIdleDetector();
    const el = createIdle({ threshold: "90000" });
    document.body.appendChild(el);

    await el.start(70000);
    expect(instances[0].start).toHaveBeenCalledWith({ threshold: 70000, signal: expect.any(AbortSignal) });
  });

  it("切断で dispose される", async () => {
    const { instances } = installIdleDetector();
    const el = createIdle();
    document.body.appendChild(el);
    await el.start();
    el.remove();

    instances[0].emitChange("idle", "locked");
    expect(el.userState).toBe("active");
  });

  it("wcBindable: inputs は threshold のみ、commands は Core を継承する", () => {
    expect(WcsIdle.wcBindable.inputs).toEqual([{ name: "threshold", attribute: "threshold" }]);
    expect(WcsIdle.wcBindable.commands!.map((c) => c.name)).toEqual(["requestPermission", "start", "stop"]);
  });

  it("wcBindable: properties は Core を継承し errorInfo を含む", () => {
    const names = WcsIdle.wcBindable.properties.map((p) => p.name);
    expect(names).toEqual(["userState", "screenState", "active", "error", "errorInfo"]);
  });

  it("errorInfo が Shell ゲッター経由で Core から読み取れる", async () => {
    removeIdleDetector();
    const el = createIdle();
    document.body.appendChild(el);
    expect(el.errorInfo).toBeNull();
    await el.start(); // 非対応 → capability-missing
    expect(el.errorInfo).toEqual({
      code: "capability-missing", phase: "probe", recoverable: false,
      message: "IdleDetector is not supported in this browser",
    });
  });
});
