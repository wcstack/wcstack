import { describe, it, expect, afterEach, vi } from "vitest";
import { TiltCore } from "../src/core/TiltCore";
import {
  installRequestPermission, removeRequestPermission, removeDeviceOrientationEventCtor, removeAbsoluteOrientationHandler,
  emitDeviceOrientation, emitDeviceOrientationAbsolute,
} from "./mocks";

describe("TiltCore", () => {
  afterEach(() => {
    removeRequestPermission();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document as { featurePolicy?: unknown }).featurePolicy;
  });

  it("EventTarget を継承している", () => {
    const core = new TiltCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  describe("wcBindable プロトコル宣言", () => {
    it("properties が alpha/beta/gamma/absolute/heading/permissionState/error/errorInfo/supported を宣言している", () => {
      const names = TiltCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual([
        "alpha", "beta", "gamma", "absolute", "heading", "permissionState", "error", "errorInfo", "supported",
      ]);
      expect(TiltCore.wcBindable.properties.every((p) => p.semantics === "state")).toBe(true);
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
      expect(byName("heading").event).toBe("wcs-tilt:heading-changed");
      expect(byName("supported").event).toBe("wcs-tilt:supported-changed");
    });

    it("heading / supported は getter を持たない（detail 自体が値）", () => {
      const byName = (n: string) => TiltCore.wcBindable.properties.find((p) => p.name === n)!;
      expect(byName("heading").getter).toBeUndefined();
      expect(byName("supported").getter).toBeUndefined();
    });
  });

  describe("初期状態", () => {
    it("alpha/beta/gamma/absolute/heading が既定値 null、permissionState は 'unknown'、error は null", () => {
      const core = new TiltCore();
      expect(core.alpha).toBeNull();
      expect(core.beta).toBeNull();
      expect(core.gamma).toBeNull();
      expect(core.absolute).toBeNull();
      expect(core.heading).toBeNull();
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

    it("DeviceOrientationEvent 自体が存在しない場合は 'granted' にしない: 状態はそのまま、error が capability-missing を言う", async () => {
      const restore = removeDeviceOrientationEventCtor();
      try {
        const core = new TiltCore();
        const states: any[] = [];
        core.addEventListener("wcs-tilt:permission-changed", (e) => states.push((e as CustomEvent).detail));
        const result = await core.requestPermission();
        expect(result).toBe("unknown");
        expect(core.permissionState).toBe("unknown");
        expect(states).toEqual([]);
        expect(core.error).toEqual({
          error: { name: "unsupported", message: "DeviceOrientationEvent is not supported in this browser." },
        });
        expect(core.errorInfo).toEqual({
          code: "capability-missing", phase: "probe", recoverable: false,
          message: "DeviceOrientationEvent is not supported in this browser.",
        });
      } finally {
        restore();
      }
    });

    it("DeviceOrientationEvent が関数でない（オブジェクトだけある）場合も API なしとして扱う", async () => {
      vi.stubGlobal("DeviceOrientationEvent", {});
      const core = new TiltCore();
      expect(await core.requestPermission()).toBe("unknown");
      expect(core.errorInfo?.code).toBe("capability-missing");
    });

    it("API なしの error は共有の定数なので、何度呼んでも wcs-tilt:error は 1 回だけ（requestPermission と start をまたいでも）", async () => {
      const restore = removeDeviceOrientationEventCtor();
      try {
        const core = new TiltCore();
        const events: any[] = [];
        core.addEventListener("wcs-tilt:error", (e) => events.push((e as CustomEvent).detail));
        await core.requestPermission();
        await core.requestPermission();
        core.start();
        expect(events).toHaveLength(1);
      } finally {
        restore();
      }
    });

    it("API なしでは、前に得た答え（granted）を書き換えない", async () => {
      installRequestPermission(() => Promise.resolve("granted"));
      const core = new TiltCore();
      await core.requestPermission();
      const restore = removeDeviceOrientationEventCtor();
      try {
        expect(await core.requestPermission()).toBe("granted");
        expect(core.permissionState).toBe("granted");
        expect(core.errorInfo?.code).toBe("capability-missing");
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

    it("gesture 文脈外呼び出し等の reject は never-throw。利用者の拒否ではないので permissionState は変えない（'unknown' のまま）", async () => {
      installRequestPermission(() => Promise.reject(new Error("not in a user gesture")));
      const core = new TiltCore();
      const states: any[] = [];
      core.addEventListener("wcs-tilt:permission-changed", (e) => states.push((e as CustomEvent).detail));
      const result = await core.requestPermission();
      expect(result).toBe("unknown");
      expect(core.permissionState).toBe("unknown");
      expect(states).toEqual([]);
      expect(core.error).not.toBeNull();
    });

    it("reject は前の答えも変えない（'granted' の後の reject は 'granted' のまま、'denied' の後は 'denied' のまま）", async () => {
      for (const answer of ["granted", "denied"] as const) {
        installRequestPermission(() => Promise.resolve(answer));
        const core = new TiltCore();
        await core.requestPermission();

        installRequestPermission(() => Promise.reject(new Error("not in a user gesture")));
        const result = await core.requestPermission();
        expect(result).toBe(answer);
        expect(core.permissionState).toBe(answer);
        expect(core.error).not.toBeNull();
      }
    });

    it("タップの外で reject された後、タップからの呼び出しが許可されれば 'granted' になり error は消える", async () => {
      const refusal = new Error("Requesting device orientation access requires a user gesture to prompt");
      refusal.name = "NotAllowedError";
      installRequestPermission(() => Promise.reject(refusal));
      const core = new TiltCore();
      expect(await core.requestPermission()).toBe("unknown");
      expect(core.errorInfo?.recoverable).toBe(true);

      installRequestPermission(() => Promise.resolve("granted"));
      expect(await core.requestPermission()).toBe("granted");
      expect(core.permissionState).toBe("granted");
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("'granted' 以外で resolve した値は 'denied' として扱う", async () => {
      installRequestPermission(() => Promise.resolve("default" as any));
      const core = new TiltCore();
      expect(await core.requestPermission()).toBe("denied");
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

      expect(result).toBe("unknown");
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

  describe("start() — DeviceOrientationEvent が無い環境", () => {
    it("購読せず、error が capability-missing を言う（例外は投げない）", () => {
      const restore = removeDeviceOrientationEventCtor();
      const addSpy = vi.spyOn(window, "addEventListener");
      try {
        const core = new TiltCore();
        expect(() => core.start()).not.toThrow();
        expect(addSpy).not.toHaveBeenCalledWith("deviceorientation", expect.anything());
        expect(addSpy).not.toHaveBeenCalledWith("deviceorientationabsolute", expect.anything());
        expect(core.permissionState).toBe("unknown");
        expect(core.error).toEqual({
          error: { name: "unsupported", message: "DeviceOrientationEvent is not supported in this browser." },
        });
        expect(core.errorInfo).toEqual({
          code: "capability-missing", phase: "probe", recoverable: false,
          message: "DeviceOrientationEvent is not supported in this browser.",
        });
      } finally {
        restore();
      }
    });

    it("購読していないので、API が現れた後の start() は購読する（毎回その場で判定する）", () => {
      const restore = removeDeviceOrientationEventCtor();
      const core = new TiltCore();
      core.start();
      restore();

      core.start();
      emitDeviceOrientation({ alpha: 1, beta: 2, gamma: 3 });
      expect(core.alpha).toBe(1);
      core.stop();
    });
  });

  describe("heading（北からの時計回りの角度）", () => {
    it("deviceorientation の webkitCompassHeading（iOS Safari）をそのまま使う。alpha は相対のまま", () => {
      const core = new TiltCore();
      const events: any[] = [];
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-tilt:heading-changed", (e) => {
        events.push((e as CustomEvent).detail);
        bubbles = e.bubbles;
      });
      core.start();

      emitDeviceOrientation({ alpha: 200, beta: 1, gamma: 2, absolute: false, webkitCompassHeading: 123.5 });

      expect(core.heading).toBe(123.5);
      expect(events).toEqual([123.5]);
      expect(bubbles).toBe(true);
      expect(core.alpha).toBe(200);
      expect(core.absolute).toBe(false);
      core.stop();
    });

    it("webkitCompassHeading があれば absolute: true の alpha より優先する", () => {
      const core = new TiltCore();
      core.start();
      emitDeviceOrientation({ alpha: 90, absolute: true, webkitCompassHeading: 10 });
      expect(core.heading).toBe(10);
      core.stop();
    });

    it("deviceorientationabsolute（Android Chrome）の alpha から (360 - alpha) % 360", () => {
      const core = new TiltCore();
      const events: any[] = [];
      core.addEventListener("wcs-tilt:heading-changed", (e) => events.push((e as CustomEvent).detail));
      core.start();

      emitDeviceOrientationAbsolute({ alpha: 90, beta: 5, gamma: 6 });
      expect(core.heading).toBe(270);
      emitDeviceOrientationAbsolute({ alpha: 0 });
      expect(core.heading).toBe(0);
      emitDeviceOrientationAbsolute({ alpha: 359 });
      expect(core.heading).toBe(1);

      expect(events).toEqual([270, 0, 1]);
      core.stop();
    });

    it("deviceorientationabsolute は alpha/beta/gamma/absolute を書かず、wcs-tilt:change も出さない", () => {
      const core = new TiltCore();
      core.start();
      emitDeviceOrientation({ alpha: 10, beta: 20, gamma: 30, absolute: false });
      const changes: any[] = [];
      core.addEventListener("wcs-tilt:change", (e) => changes.push((e as CustomEvent).detail));

      emitDeviceOrientationAbsolute({ alpha: 90, beta: 77, gamma: 88 });

      expect(core.heading).toBe(270);
      expect(core.alpha).toBe(10);
      expect(core.beta).toBe(20);
      expect(core.gamma).toBe(30);
      expect(core.absolute).toBe(false);
      expect(changes).toEqual([]);
      core.stop();
    });

    it("absolute: true の deviceorientation の alpha からも求める", () => {
      const core = new TiltCore();
      core.start();
      emitDeviceOrientation({ alpha: 45, beta: 0, gamma: 0, absolute: true });
      expect(core.heading).toBe(315);
      expect(core.alpha).toBe(45);
      core.stop();
    });

    it("相対の deviceorientation（absolute: false、webkitCompassHeading なし）は heading を変えない", () => {
      const core = new TiltCore();
      const events: any[] = [];
      core.addEventListener("wcs-tilt:heading-changed", (e) => events.push((e as CustomEvent).detail));
      core.start();

      emitDeviceOrientation({ alpha: 45, beta: 0, gamma: 0, absolute: false });
      expect(core.heading).toBeNull();

      emitDeviceOrientationAbsolute({ alpha: 90 });
      emitDeviceOrientation({ alpha: 46, beta: 0, gamma: 0, absolute: false });
      expect(core.heading).toBe(270);
      expect(events).toEqual([270]);
      core.stop();
    });

    it("有限の数でない値（null・NaN・文字列）は heading を変えない", () => {
      const core = new TiltCore();
      const events: any[] = [];
      core.addEventListener("wcs-tilt:heading-changed", (e) => events.push((e as CustomEvent).detail));
      core.start();

      emitDeviceOrientationAbsolute({ alpha: null });
      emitDeviceOrientationAbsolute({ alpha: NaN });
      emitDeviceOrientation({ alpha: null, absolute: true });
      emitDeviceOrientation({ alpha: 1, absolute: false, webkitCompassHeading: NaN });
      emitDeviceOrientation({ alpha: 2, absolute: false, webkitCompassHeading: "12" });
      emitDeviceOrientation({ alpha: 3, absolute: false, webkitCompassHeading: null });
      expect(core.heading).toBeNull();
      expect(events).toEqual([]);

      // webkitCompassHeading が有限でないときは (b) に進む: absolute: true の alpha を使う
      emitDeviceOrientation({ alpha: 180, absolute: true, webkitCompassHeading: NaN });
      expect(core.heading).toBe(180);
      core.stop();
    });

    it("同じ値では再 dispatch しない（同値ガード）", () => {
      const core = new TiltCore();
      const events: any[] = [];
      core.addEventListener("wcs-tilt:heading-changed", (e) => events.push((e as CustomEvent).detail));
      core.start();

      emitDeviceOrientationAbsolute({ alpha: 90 });
      emitDeviceOrientationAbsolute({ alpha: 90 });
      emitDeviceOrientation({ alpha: 5, absolute: false, webkitCompassHeading: 270 });
      expect(events).toEqual([270]);
      core.stop();
    });

    it("start() は ondeviceorientationabsolute が window にあるときだけ deviceorientationabsolute を購読する", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const core = new TiltCore();
      core.start();
      expect(addSpy.mock.calls.filter((c) => c[0] === "deviceorientationabsolute")).toHaveLength(1);
      core.stop();
      addSpy.mockClear();

      const restore = removeAbsoluteOrientationHandler();
      try {
        expect("ondeviceorientationabsolute" in window).toBe(false);
        core.start();
        expect(addSpy.mock.calls.filter((c) => c[0] === "deviceorientationabsolute")).toHaveLength(0);
        expect(addSpy.mock.calls.filter((c) => c[0] === "deviceorientation")).toHaveLength(1);
        emitDeviceOrientationAbsolute({ alpha: 90 });
        expect(core.heading).toBeNull();
        core.stop();
      } finally {
        restore();
      }
      expect("ondeviceorientationabsolute" in window).toBe(true);
    });

    it("stop() / dispose() は両方の購読を外す。heading は最後の値のまま", () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const core = new TiltCore();
      core.start();
      emitDeviceOrientationAbsolute({ alpha: 90 });
      core.stop();
      expect(removeSpy).toHaveBeenCalledWith("deviceorientation", expect.anything());
      expect(removeSpy).toHaveBeenCalledWith("deviceorientationabsolute", expect.anything());

      emitDeviceOrientationAbsolute({ alpha: 10 });
      expect(core.heading).toBe(270);

      core.start();
      core.dispose();
      emitDeviceOrientationAbsolute({ alpha: 20 });
      emitDeviceOrientation({ alpha: 1, webkitCompassHeading: 5 });
      expect(core.heading).toBe(270);
    });
  });

  describe("supported（このページで Device Orientation を使えるか）", () => {
    function policy(blocked: string[]): void {
      (document as any).featurePolicy = { allowsFeature: (f: string) => !blocked.includes(f) };
    }

    it("DeviceOrientationEvent があり、ポリシーが切っていなければ true", () => {
      expect(new TiltCore().supported).toBe(true);
      policy([]);
      expect(new TiltCore().supported).toBe(true);
    });

    it("DeviceOrientationEvent が無ければ false（呼ぶたびに判定する）", () => {
      const core = new TiltCore();
      const restore = removeDeviceOrientationEventCtor();
      try {
        expect(core.supported).toBe(false);
      } finally {
        restore();
      }
      expect(core.supported).toBe(true);
    });

    it("Permissions-Policy が accelerometer か gyroscope を切っていれば false", () => {
      const core = new TiltCore();
      policy(["accelerometer"]);
      expect(core.supported).toBe(false);
      policy(["gyroscope"]);
      expect(core.supported).toBe(false);
      policy(["camera"]);
      expect(core.supported).toBe(true);
    });

    it("安全でないコンテキストでは false", () => {
      vi.stubGlobal("isSecureContext", false);
      expect(new TiltCore().supported).toBe(false);
    });

    it("observe() / publishSupported() は、最後に dispatch した値（初めは false）と違うときだけ wcs-tilt:supported-changed を出す", () => {
      const core = new TiltCore();
      const events: any[] = [];
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-tilt:supported-changed", (e) => {
        events.push((e as CustomEvent).detail);
        bubbles = e.bubbles;
      });

      core.observe();
      expect(events).toEqual([true]);
      expect(bubbles).toBe(true);
      core.observe();
      core.publishSupported();
      expect(events).toEqual([true]);

      policy(["gyroscope"]);
      core.publishSupported();
      expect(events).toEqual([true, false]);
    });

    it("使えない環境では、初めの値（false）と同じなので何も dispatch しない", () => {
      const restore = removeDeviceOrientationEventCtor();
      try {
        const core = new TiltCore();
        const events: any[] = [];
        core.addEventListener("wcs-tilt:supported-changed", (e) => events.push((e as CustomEvent).detail));
        core.observe();
        expect(core.supported).toBe(false);
        expect(events).toEqual([]);
      } finally {
        restore();
      }
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

    it("NotAllowedError の reject（iOS: タップの外では質問が出ない）→ not-allowed / start / recoverable=true", async () => {
      const e = new Error("Permission denied");
      e.name = "NotAllowedError";
      installRequestPermission(() => Promise.reject(e));
      const core = new TiltCore();
      await core.requestPermission();
      // タップから呼び直せば質問が出るので recoverable。
      expect(core.errorInfo).toEqual({ code: "not-allowed", phase: "start", recoverable: true, message: "Permission denied" });
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
