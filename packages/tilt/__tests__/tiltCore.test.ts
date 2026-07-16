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
    it("properties が alpha/beta/gamma/absolute/permissionState/error/errorInfo を宣言している", () => {
      const names = TiltCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual(["alpha", "beta", "gamma", "absolute", "permissionState", "error", "errorInfo"]);
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

    it("properties の event が実際に dispatch されるイベント名と一致する", () => {
      const byName = (n: string) => TiltCore.wcBindable.properties.find((p) => p.name === n)!;
      expect(byName("alpha").event).toBe("wcs-tilt:change");
      expect(byName("beta").event).toBe("wcs-tilt:change");
      expect(byName("gamma").event).toBe("wcs-tilt:change");
      expect(byName("absolute").event).toBe("wcs-tilt:change");
      expect(byName("permissionState").event).toBe("wcs-tilt:permission-changed");
      expect(byName("error").event).toBe("wcs-tilt:error");
      expect(byName("errorInfo").event).toBe("wcs-tilt:error-info-changed");
    });
  });

  describe("初期状態", () => {
    it("alpha/beta/gamma/absolute が既定値 null、permissionState は 'unknown'、error は null", () => {
      const core = new TiltCore();
      expect(core.alpha).toBeNull();
      expect(core.beta).toBeNull();
      expect(core.gamma).toBeNull();
      expect(core.absolute).toBeNull();
      expect(core.permissionState).toBe("unknown");
      expect(core.error).toBeNull();
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

    it("wcs-tilt:permission-changed が実際に dispatch される（'unknown'→'granted'）", async () => {
      installRequestPermission(() => Promise.resolve("granted"));
      const core = new TiltCore();
      const events: any[] = [];
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-tilt:permission-changed", (e) => {
        events.push((e as CustomEvent).detail);
        bubbles = e.bubbles;
      });

      const result = await core.requestPermission();

      expect(result).toBe("granted");
      expect(events).toEqual(["granted"]);
      // async-io-node-guidelines.md §3.3 MUST: イベントは必ず bubbles: true（族横断で共通）
      expect(bubbles).toBe(true);
    });

    it("wcs-tilt:permission-changed は値が変わるたびに dispatch される（'granted'→'denied'）", async () => {
      installRequestPermission(() => Promise.resolve("granted"));
      const core = new TiltCore();
      await core.requestPermission();

      const events: any[] = [];
      core.addEventListener("wcs-tilt:permission-changed", (e) => events.push((e as CustomEvent).detail));

      installRequestPermission(() => Promise.resolve("denied"));
      const result = await core.requestPermission();

      expect(result).toBe("denied");
      expect(events).toEqual(["denied"]);
    });
  });

  describe("error プロパティ（never-throw, §3.6 MUST）", () => {
    it("gesture 文脈外呼び出し等の reject で error に生の失敗オブジェクトが載る", async () => {
      const failure = new Error("not in a user gesture");
      installRequestPermission(() => Promise.reject(failure));
      const core = new TiltCore();

      const result = await core.requestPermission();

      expect(result).toBe("denied");
      expect(core.error).toEqual({ error: failure });
    });

    it("wcs-tilt:error が dispatch される（bubbles: true）", async () => {
      const failure = new Error("not in a user gesture");
      installRequestPermission(() => Promise.reject(failure));
      const core = new TiltCore();
      const events: any[] = [];
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-tilt:error", (e) => {
        events.push((e as CustomEvent).detail);
        bubbles = e.bubbles;
      });

      await core.requestPermission();

      expect(events).toEqual([{ error: failure }]);
      expect(bubbles).toBe(true);
    });

    it("失敗のたびに新しい error オブジェクトなので毎回 dispatch される（同値ガードは参照比較）", async () => {
      installRequestPermission(() => Promise.reject(new Error("first")));
      const core = new TiltCore();
      await core.requestPermission();

      const events: any[] = [];
      core.addEventListener("wcs-tilt:error", (e) => events.push((e as CustomEvent).detail));

      installRequestPermission(() => Promise.reject(new Error("second")));
      await core.requestPermission();

      expect(events).toHaveLength(1);
    });

    it("その後の成功（granted/denied）で直前の error がクリアされる", async () => {
      installRequestPermission(() => Promise.reject(new Error("not in a user gesture")));
      const core = new TiltCore();
      await core.requestPermission();
      expect(core.error).not.toBeNull();

      installRequestPermission(() => Promise.resolve("granted"));
      await core.requestPermission();

      expect(core.error).toBeNull();
    });

    it("requestPermission 関数が存在しない環境（Android/デスクトップ）でも error は null のまま", async () => {
      removeRequestPermission();
      const core = new TiltCore();
      await core.requestPermission();
      expect(core.error).toBeNull();
    });

    it("成功経路（'unknown'→'granted'）では error が既に null なので wcs-tilt:error は dispatch されない", async () => {
      installRequestPermission(() => Promise.resolve("granted"));
      const core = new TiltCore();
      const events: any[] = [];
      core.addEventListener("wcs-tilt:error", (e) => events.push((e as CustomEvent).detail));

      await core.requestPermission();

      expect(core.error).toBeNull();
      expect(events).toHaveLength(0);
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

    it("wcs-tilt:change は bubbles: true で dispatch される", () => {
      const core = new TiltCore();
      core.start();
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-tilt:change", (e) => {
        bubbles = e.bubbles;
      });

      emitDeviceOrientation({ alpha: 1, beta: 2, gamma: 3 });
      // async-io-node-guidelines.md §3.3 MUST: イベントは必ず bubbles: true（族横断で共通）
      expect(bubbles).toBe(true);
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

    it("wcs-tilt:change の detail に alpha/beta/gamma/absolute の実値がそのまま届く", () => {
      const core = new TiltCore();
      core.start();
      const events: any[] = [];
      core.addEventListener("wcs-tilt:change", (e) => events.push((e as CustomEvent).detail));

      emitDeviceOrientation({ alpha: 5, beta: 6, gamma: 7, absolute: true });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ alpha: 5, beta: 6, gamma: 7, absolute: true });
    });

    describe("同値ガードはフィールド単位で判定する", () => {
      const base = { alpha: 1, beta: 2, gamma: 3, absolute: false } as const;
      const cases: Array<[string, Partial<typeof base>]> = [
        ["alpha", { alpha: 100 }],
        ["beta", { beta: 100 }],
        ["gamma", { gamma: 100 }],
        ["absolute", { absolute: true }],
      ];

      it.each(cases)("%s だけが変化しても再 dispatch される", (_field, patch) => {
        const core = new TiltCore();
        core.start();
        emitDeviceOrientation(base);

        const events: any[] = [];
        core.addEventListener("wcs-tilt:change", (e) => events.push((e as CustomEvent).detail));

        emitDeviceOrientation({ ...base, ...patch });

        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({ ...base, ...patch });
      });
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

  describe("errorInfo taxonomy (Phase 6)", () => {
    it("初期状態の errorInfo は null", () => {
      expect(new TiltCore().errorInfo).toBeNull();
    });

    it("errorInfo は wcBindable property(error の直後)として宣言される", () => {
      const names = TiltCore.wcBindable.properties.map((p) => p.name);
      expect(names).toContain("errorInfo");
      expect(names.indexOf("errorInfo")).toBe(names.indexOf("error") + 1);
    });

    it("NotAllowedError の reject → not-allowed / start / recoverable=false", async () => {
      const e = new Error("Permission denied");
      e.name = "NotAllowedError";
      installRequestPermission(() => Promise.reject(e));
      const core = new TiltCore();
      await core.requestPermission();
      expect(core.errorInfo).toEqual({ code: "not-allowed", phase: "start", recoverable: false, message: "Permission denied" });
      // 公開 error shape は不変（生の reason を wrap した { error } のまま）。
      expect(core.error).toEqual({ error: e });
    });

    it("その他の reject（gesture 文脈外の汎用 Error）→ tilt-error / execute", async () => {
      installRequestPermission(() => Promise.reject(new Error("not in a user gesture")));
      const core = new TiltCore();
      await core.requestPermission();
      expect(core.errorInfo).toEqual({ code: "tilt-error", phase: "execute", recoverable: false, message: "not in a user gesture" });
    });

    it("非 Error reason（message を持たない）でも message は String() で導出される", async () => {
      installRequestPermission(() => Promise.reject(undefined));
      const core = new TiltCore();
      await core.requestPermission();
      expect(core.errorInfo).toEqual({ code: "tilt-error", phase: "execute", recoverable: false, message: "undefined" });
    });

    it("その後の成功で error が null にクリアされると errorInfo も null になる", async () => {
      installRequestPermission(() => Promise.reject(new Error("boom")));
      const core = new TiltCore();
      await core.requestPermission();
      expect(core.errorInfo).not.toBeNull();

      installRequestPermission(() => Promise.resolve("granted"));
      await core.requestPermission();
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("errorInfo は error と同期して遷移し、error より前に error-info-changed が流れる", async () => {
      installRequestPermission(() => Promise.reject(new Error("boom")));
      const core = new TiltCore();
      const order: string[] = [];
      core.addEventListener("wcs-tilt:error-info-changed", () => order.push("errorInfo"));
      core.addEventListener("wcs-tilt:error", () => order.push("error"));
      await core.requestPermission();
      expect(order).toEqual(["errorInfo", "error"]);
      expect(core.errorInfo).not.toBeNull();
    });

    it("wcs-tilt:error-info-changed は bubbles: true で dispatch される", async () => {
      installRequestPermission(() => Promise.reject(new Error("boom")));
      const core = new TiltCore();
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-tilt:error-info-changed", (e) => { bubbles = e.bubbles; });
      await core.requestPermission();
      expect(bubbles).toBe(true);
    });
  });
});
