import { describe, it, expect, afterEach, vi } from "vitest";
import { TiltCore } from "../src/core/TiltCore";
import { installRequestPermission, removeRequestPermission, removeDeviceOrientationEventCtor, emitDeviceOrientation } from "./mocks";

describe("TiltCore", () => {
  afterEach(() => {
    removeRequestPermission();
    vi.restoreAllMocks();
  });

  it("EventTarget を継承している", () => {
    const core = new TiltCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  describe("wcBindable プロトコル宣言", () => {
    it("properties が alpha/beta/gamma/absolute/permissionState を宣言している", () => {
      const names = TiltCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual(["alpha", "beta", "gamma", "absolute", "permissionState"]);
    });

    it("commands が requestPermission(async)/start/stop を宣言している", () => {
      const commands = TiltCore.wcBindable.commands!;
      expect(commands.map((c) => c.name)).toEqual(["requestPermission", "start", "stop"]);
      expect(commands.find((c) => c.name === "requestPermission")!.async).toBe(true);
    });

    it("alpha/beta/gamma/absolute の getter が event.detail から値を取り出す", () => {
      const byName = (n: string) => TiltCore.wcBindable.properties.find((p) => p.name === n)!;
      const ev = new CustomEvent("wcs-tilt:change", { detail: { alpha: 1, beta: 2, gamma: 3, absolute: true } });
      expect(byName("alpha").getter!(ev)).toBe(1);
      expect(byName("beta").getter!(ev)).toBe(2);
      expect(byName("gamma").getter!(ev)).toBe(3);
      expect(byName("absolute").getter!(ev)).toBe(true);
    });

    it("permissionState は getter を持たない（detail 自体が値）", () => {
      const prop = TiltCore.wcBindable.properties.find((p) => p.name === "permissionState")!;
      expect(prop.getter).toBeUndefined();
    });
  });

  describe("初期状態", () => {
    it("alpha/beta/gamma/absolute が既定値 null、permissionState は 'unknown'", () => {
      const core = new TiltCore();
      expect(core.alpha).toBeNull();
      expect(core.beta).toBeNull();
      expect(core.gamma).toBeNull();
      expect(core.absolute).toBeNull();
      expect(core.permissionState).toBe("unknown");
    });

    it("ready は即 resolve する（connect 時に自動 start しないため）", async () => {
      const core = new TiltCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe() は同期的な no-op で start() を自動的に呼ばない", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const core = new TiltCore();
      core.observe();
      expect(addSpy).not.toHaveBeenCalledWith("deviceorientation", expect.anything());
    });
  });

  describe("requestPermission() — 分岐（iOS gating の有無）", () => {
    it("requestPermission 関数が存在しない場合（Android/デスクトップ）は即 'granted'", async () => {
      removeRequestPermission();
      const core = new TiltCore();
      const result = await core.requestPermission();
      expect(result).toBe("granted");
      expect(core.permissionState).toBe("granted");
    });

    it("DeviceOrientationEvent 自体が存在しない場合も即 'granted'", async () => {
      const restore = removeDeviceOrientationEventCtor();
      try {
        const core = new TiltCore();
        const result = await core.requestPermission();
        expect(result).toBe("granted");
      } finally {
        restore();
      }
    });

    it("requestPermission 関数が存在する場合（iOS）は実際に呼び、'granted' を反映する", async () => {
      const fn = installRequestPermission(() => Promise.resolve("granted"));
      const core = new TiltCore();
      const result = await core.requestPermission();
      expect(fn).toHaveBeenCalled();
      expect(result).toBe("granted");
      expect(core.permissionState).toBe("granted");
    });

    it("iOS で 'denied' が返れば反映する", async () => {
      installRequestPermission(() => Promise.resolve("denied"));
      const core = new TiltCore();
      const result = await core.requestPermission();
      expect(result).toBe("denied");
      expect(core.permissionState).toBe("denied");
    });

    it("gesture 文脈外呼び出し等の reject は never-throw で 'denied' に倒す", async () => {
      installRequestPermission(() => Promise.reject(new Error("not in a user gesture")));
      const core = new TiltCore();
      const result = await core.requestPermission();
      expect(result).toBe("denied");
      expect(core.permissionState).toBe("denied");
    });

    it("同値の permissionState が続けて確定しても再 dispatch しない（同値ガード）", async () => {
      installRequestPermission(() => Promise.resolve("granted"));
      const core = new TiltCore();
      await core.requestPermission();
      const events: any[] = [];
      core.addEventListener("wcs-tilt:permission-changed", (e) => events.push((e as CustomEvent).detail));

      await core.requestPermission();
      expect(events).toEqual([]);
    });
  });

  describe("start()/stop() — 対応環境（同期購読、_gen 不要）", () => {
    it("start() で deviceorientation イベントを購読し、値が反映される", () => {
      const core = new TiltCore();
      core.start();
      emitDeviceOrientation({ alpha: 10, beta: 20, gamma: 30, absolute: true });

      expect(core.alpha).toBe(10);
      expect(core.beta).toBe(20);
      expect(core.gamma).toBe(30);
      expect(core.absolute).toBe(true);
    });

    it("1回のイベントにつき wcs-tilt:change が1回だけ dispatch される", () => {
      const core = new TiltCore();
      core.start();
      const events: any[] = [];
      core.addEventListener("wcs-tilt:change", (e) => events.push((e as CustomEvent).detail));

      emitDeviceOrientation({ alpha: 1, beta: 2, gamma: 3 });
      expect(events).toHaveLength(1);
    });

    it("同値の連続発火では再 dispatch しない（同値ガード）", () => {
      const core = new TiltCore();
      core.start();
      emitDeviceOrientation({ alpha: 1, beta: 2, gamma: 3, absolute: false });
      const events: any[] = [];
      core.addEventListener("wcs-tilt:change", (e) => events.push((e as CustomEvent).detail));

      emitDeviceOrientation({ alpha: 1, beta: 2, gamma: 3, absolute: false });
      expect(events).toEqual([]);
    });

    it("start() は冪等 — 二重呼び出しでリスナーが二重登録されない", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const core = new TiltCore();
      core.start();
      core.start();
      const calls = addSpy.mock.calls.filter((c) => c[0] === "deviceorientation");
      expect(calls).toHaveLength(1);
    });

    it("stop() 後に deviceorientation が来ても状態が変わらない", () => {
      const core = new TiltCore();
      core.start();
      core.stop();
      emitDeviceOrientation({ alpha: 99, beta: 99, gamma: 99 });
      expect(core.alpha).toBeNull();
    });

    it("一度も start していない stop は安全な no-op", () => {
      const core = new TiltCore();
      expect(() => core.stop()).not.toThrow();
    });

    it("dispose() は stop() のエイリアスとして機能する", () => {
      const core = new TiltCore();
      core.start();
      core.dispose();
      emitDeviceOrientation({ alpha: 99, beta: 99, gamma: 99 });
      expect(core.alpha).toBeNull();
    });
  });

  describe("target 指定", () => {
    it("target を渡すとそこへ change を dispatch する", () => {
      const target = new EventTarget();
      const events: any[] = [];
      target.addEventListener("wcs-tilt:change", (e) => events.push((e as CustomEvent).detail));
      const core = new TiltCore(target);
      core.start();
      emitDeviceOrientation({ alpha: 1, beta: 2, gamma: 3 });

      expect(events).toHaveLength(1);
    });
  });
});
