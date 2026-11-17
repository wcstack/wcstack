import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GyroscopeCore } from "../src/core/GyroscopeCore";
import {
  FakeSensor, installSensor, installThrowingSensor, removeSensor,
  installDeviceMotionEvent, removeDeviceMotionEvent, restoreDeviceMotionEvent, emitDeviceMotion,
} from "./mocks";

const GLOBAL_NAME = "Gyroscope";

// devicemotion の rotationRate は度/秒、Gyroscope（と x/y/z）はラジアン/秒。
const RAD = Math.PI / 180;

describe("GyroscopeCore", () => {
  // happy-dom は DeviceMotionEvent を持つ。センサーのクラスだけを外したテストが devicemotion の
  // フォールバックに入らないよう、既定では外しておく（フォールバックのテストは自分で入れる）。
  beforeEach(() => {
    removeDeviceMotionEvent();
  });

  afterEach(() => {
    removeSensor(GLOBAL_NAME);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document as { featurePolicy?: unknown }).featurePolicy;
    restoreDeviceMotionEvent();
  });

  describe("初期状態（start 前）", () => {
    it("x/y/z/error は既定値、permissionState は 'unknown'", () => {
      const core = new GyroscopeCore();
      expect(core.x).toBeNull();
      expect(core.y).toBeNull();
      expect(core.z).toBeNull();
      expect(core.error).toBeNull();
      expect(core.permissionState).toBe("unknown");
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new GyroscopeCore();
      await expect(core.ready).resolves.toBeUndefined();
    });
  });

  describe("start() — 非対応環境", () => {
    it("globalThis.Gyroscope も DeviceMotionEvent も無ければ unsupported エラーになる（例外は投げない）", () => {
      removeSensor(GLOBAL_NAME);
      const addSpy = vi.spyOn(window, "addEventListener");
      const core = new GyroscopeCore();
      expect(() => core.start()).not.toThrow();
      expect(core.error).toEqual({ error: "unsupported", message: "Gyroscope is not supported" });
      expect(addSpy).not.toHaveBeenCalledWith("devicemotion", expect.anything());
    });

    it("DeviceMotionEvent が関数でない（オブジェクトだけある）場合もフォールバックに入らない", () => {
      vi.stubGlobal("DeviceMotionEvent", {});
      const core = new GyroscopeCore();
      core.start();
      expect(core.error).toEqual({ error: "unsupported", message: "Gyroscope is not supported" });
    });
  });

  describe("start() — コンストラクタが同期的に例外を投げる場合（never-throw）", () => {
    it("SecurityError を投げるコンストラクタでも start() は例外を投げず error に変換する", () => {
      installThrowingSensor(GLOBAL_NAME, "SecurityError", "Permission denied");
      const core = new GyroscopeCore();
      expect(() => core.start()).not.toThrow();
      expect(core.error).toEqual({ error: "SecurityError", message: "Permission denied" });
    });

    it("name/message を持たない例外でもフォールバック文字列に変換される", () => {
      (globalThis as any)[GLOBAL_NAME] = function () {
        throw "plain string throw";
      };
      const core = new GyroscopeCore();
      expect(() => core.start()).not.toThrow();
      expect(core.error?.error).toBe("error");
      expect(core.error?.message).toBe("plain string throw");
    });

    it("非準拠実装が sensor.start() 自体で同期的に例外を投げても never-throw が保たれる", () => {
      // 仕様上 Sensor.start()/stop() は例外を投げない契約だが、Core の防御的
      // catch（GyroscopeCore.ts の start() 内）が非準拠実装からも状態を守ることを確認する。
      const core = new GyroscopeCore();
      // installSensor が使う Ctor をラップし、生成された FakeSensor の start() だけを
      // 差し替える（Core の _createSensor() が構築した直後に .start() を呼ぶため）。
      installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const OriginalCtor = (globalThis as any)[GLOBAL_NAME];
      (globalThis as any)[GLOBAL_NAME] = function (this: any, options?: { frequency?: number }) {
        const sensor = new OriginalCtor(options);
        // Plain-value throw (no name/message) exercises the same `?? "error"` /
        // `?? String(e)` fallback branches this catch shares with _createSensor()'s.
        sensor.start = () => {
          throw "non-conformant start() throw";
        };
        return sensor;
      };
      expect(() => core.start()).not.toThrow();
      expect(core.error).toEqual({ error: "error", message: "non-conformant start() throw" });
    });

    it("sensor.start() が throw した後も teardown され、次の start() で新しいセンサーが構築される（dead listener も残らない）", () => {
      // Guards against a regression that drops `this._teardownSensor();` from
      // start()'s catch block: without it, `_sensor` would stay set to the
      // failed instance, permanently short-circuiting every future start()
      // via the `if (this._sensor) return;` idempotency guard at its top, and
      // the failed instance's listeners would keep firing into this Core.
      const constructed: FakeSensor[] = [];
      (globalThis as any)[GLOBAL_NAME] = function (this: any, options?: { frequency?: number }) {
        const sensor = new FakeSensor({ x: 0, y: 0, z: 0 }, options);
        sensor.start = () => {
          throw new Error("boom");
        };
        constructed.push(sensor);
        return sensor;
      };
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:reading", (e) => events.push((e as CustomEvent).detail));

      core.start();
      expect(constructed).toHaveLength(1);

      core.start();
      expect(constructed).toHaveLength(2);

      // The abandoned first sensor's listeners must have been detached.
      constructed[0].emitReading({ x: 1, y: 1, z: 1 });
      expect(events).toHaveLength(0);
      expect(core.x).toBeNull();
    });
  });

  describe("start() — 対応環境", () => {
    it("start() でセンサーが構築され .start() が呼ばれる", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();

      core.start();

      expect(handle.current?.started).toBe(true);
    });

    it("frequency を渡すとコンストラクタのオプションに渡る", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();

      core.start(60);

      expect(handle.current?.options).toEqual({ frequency: 60 });
    });

    it("frequency 省略時はオプション無しでコンストラクタが呼ばれる", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();

      core.start();

      expect(handle.current?.options).toBeUndefined();
    });

    it("start() は冪等 — 二重呼び出しでセンサーが二重生成されない", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();

      core.start();
      const first = handle.current;
      core.start();

      expect(handle.current).toBe(first);
    });
  });

  describe("reading イベント", () => {
    it("reading で x/y/z が更新され、CustomEvent が dispatch される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      const events: any[] = [];
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-gyroscope:reading", (e) => {
        events.push((e as CustomEvent).detail);
        bubbles = e.bubbles;
      });

      core.start();
      handle.current!.emitReading({ x: 1, y: 2, z: 9.8 });

      expect(core.x).toBe(1);
      expect(core.y).toBe(2);
      expect(core.z).toBe(9.8);
      expect(events).toEqual([{ x: 1, y: 2, z: 9.8 }]);
      expect(bubbles).toBe(true);
    });

    it("同値の reading でも毎回 dispatch される（同値ガード対象外）", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 1, y: 2, z: 3 });
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:reading", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitReading({ x: 1, y: 2, z: 3 });
      handle.current!.emitReading({ x: 1, y: 2, z: 3 });

      expect(events).toHaveLength(2);
    });
  });

  describe("error イベント", () => {
    it("センサーが error を発火すると error プロパティに反映される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      const events: any[] = [];
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-gyroscope:error", (e) => {
        events.push((e as CustomEvent).detail);
        bubbles = e.bubbles;
      });

      core.start();
      handle.current!.emitError("NotReadableError", "could not read from the sensor");

      expect(core.error).toEqual({ error: "NotReadableError", message: "could not read from the sensor" });
      expect(events).toHaveLength(1);
      expect(bubbles).toBe(true);
    });

    // error イベントを出したセンサーは片付けられる（下の「error イベントの後の start()」）ので、
    // 2 回目の error は start() し直した新しいセンサーから出す。
    it("同値の error は同値ガードで再 dispatch しない", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:error", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitError("NotReadableError", "msg");
      core.start();
      handle.current!.emitError("NotReadableError", "msg");

      expect(events).toHaveLength(1);
    });

    it("同一 name・異なる message では再 dispatch され error.message が更新される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:error", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitError("NotReadableError", "first message");
      core.start();
      handle.current!.emitError("NotReadableError", "second message");

      expect(events).toHaveLength(2);
      expect(core.error).toEqual({ error: "NotReadableError", message: "second message" });
    });

    it("異なる name・同一 message でも再 dispatch され error.error が更新される", () => {
      // Mirrors the previous test in the opposite direction: the same-value
      // guard in _setError() compares BOTH `error` (name) and `message` — a
      // match on message alone must not suppress a redispatch when the name
      // differs.
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:error", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitError("NotReadableError", "same message");
      core.start();
      handle.current!.emitError("SecurityError", "same message");

      expect(events).toHaveLength(2);
      expect(core.error).toEqual({ error: "SecurityError", message: "same message" });
    });

    it("error イベントに detail が無くてもフォールバック値になる", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();

      core.start();
      handle.current!.dispatchEvent(new Event("error"));

      // The message fallback must be a meaningful constant, not the literal
      // string "undefined" (String(undefined)) — sensor-family aligned.
      expect(core.error).toEqual({ error: "error", message: "Sensor error" });
    });

    // Spec fix (monitoring-sensor family): unlike ScreenOrientationCore's
    // bidirectional `lock()` command (which calls _setError(null) on success),
    // the monitoring sensors (accelerometer/gyroscope/magnetometer/ambient-light-sensor)
    // deliberately do NOT clear `error` on a successful (re)start. `error` here is a
    // sticky, state-like signal reflecting the last observed failure — a `reading`
    // after an error does not retroactively "cancel" that error. This test pins that
    // contract so a future change cannot silently start clearing it (which would then
    // need to be aligned across all twins). See docs/sensor-tag-design.md §1.5.
    it("失敗→リトライ成功しても error は据え置かれる（監視系は成功時にクリアしない）", () => {
      // First attempt: unsupported → error is set.
      removeSensor(GLOBAL_NAME);
      const core = new GyroscopeCore();
      core.start();
      expect(core.error).toEqual({ error: "unsupported", message: "Gyroscope is not supported" });

      // Retry: the API becomes available and start() succeeds, and readings flow.
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      core.start();
      expect(handle.current?.started).toBe(true);
      handle.current!.emitReading({ x: 1, y: 2, z: 3 });
      expect(core.x).toBe(1);

      // The prior error stays put — a successful start does not clear it.
      expect(core.error).toEqual({ error: "unsupported", message: "Gyroscope is not supported" });
    });
  });

  describe("error イベントの後の start()", () => {
    it("error イベントを出したセンサーは片付けられ、次の start() が新しいセンサーを作る（stop() を挟まなくてよい）", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      const readings: any[] = [];
      core.addEventListener("wcs-gyroscope:reading", (e) => readings.push((e as CustomEvent).detail));

      core.start();
      const failed = handle.current!;
      failed.emitError("NotReadableError", "could not read from the sensor");

      core.start();
      const fresh = handle.current!;
      expect(fresh).not.toBe(failed);
      expect(fresh.started).toBe(true);

      fresh.emitReading({ x: 1, y: 2, z: 3 });
      expect(readings).toEqual([{ x: 1, y: 2, z: 3 }]);

      // 片付けたセンサーの listener は外れている: 後から何が来ても届かない
      failed.emitReading({ x: 9, y: 9, z: 9 });
      failed.emitError("SecurityError", "late");
      expect(core.x).toBe(1);
      // error は据え置き（成功した再開では消えない）
      expect(core.error).toEqual({ error: "NotReadableError", message: "could not read from the sensor" });
    });

    it("wcs-gyroscope:error のリスナーの中からの start() も新しいセンサーを作る（片付けは dispatch の前）", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      let restarted = false;
      core.addEventListener("wcs-gyroscope:error", () => {
        if (restarted) return;
        restarted = true;
        core.start();
      });

      core.start();
      const failed = handle.current!;
      failed.emitError("NotReadableError", "x");

      expect(handle.current).not.toBe(failed);
      expect(handle.current!.started).toBe(true);
    });

    it("error イベントの後の stop() は安全な no-op（片付け済み）", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      core.start();
      const failed = handle.current!;
      failed.emitError("NotReadableError", "x");

      expect(() => core.stop()).not.toThrow();
      expect(failed.stopped).toBe(false);
    });

    it("start() の最中に error イベントが来て、さらに start() が throw しても never-throw（二重の片付け）", () => {
      const constructed: FakeSensor[] = [];
      (globalThis as any)[GLOBAL_NAME] = function (this: any, options?: { frequency?: number }) {
        const sensor = new FakeSensor({ x: 0, y: 0, z: 0 }, options);
        if (constructed.length === 0) {
          sensor.start = () => {
            sensor.emitError("NotReadableError", "during start");
            throw new Error("boom");
          };
        }
        constructed.push(sensor);
        return sensor;
      };
      const core = new GyroscopeCore();

      expect(() => core.start()).not.toThrow();
      expect(core.error).toEqual({ error: "Error", message: "boom" });

      core.start();
      expect(constructed).toHaveLength(2);
      expect(constructed[1].started).toBe(true);
    });

    it("start() の最中の error イベントのリスナーが start() し直し、その後で元の start() が throw しても、新しいセンサーは現役のまま", () => {
      const constructed: FakeSensor[] = [];
      (globalThis as any)[GLOBAL_NAME] = function (this: any, options?: { frequency?: number }) {
        const sensor = new FakeSensor({ x: 0, y: 0, z: 0 }, options);
        if (constructed.length === 0) {
          sensor.start = () => {
            sensor.emitError("NotReadableError", "during start");
            throw new Error("boom");
          };
        }
        constructed.push(sensor);
        return sensor;
      };
      const core = new GyroscopeCore();
      const readings: any[] = [];
      core.addEventListener("wcs-gyroscope:reading", (e) => readings.push((e as CustomEvent).detail));
      let restarted = false;
      core.addEventListener("wcs-gyroscope:error", () => {
        if (restarted) return;
        restarted = true;
        core.start();
      });

      expect(() => core.start()).not.toThrow();
      expect(constructed).toHaveLength(2);

      // 2 つ目が現役: もう一度 start() しても 3 つ目は作られず、読み取りは 1 回ずつ届き、stop() で止まる
      core.start();
      expect(constructed).toHaveLength(2);
      constructed[1].emitReading({ x: 1, y: 2, z: 3 });
      expect(readings).toEqual([{ x: 1, y: 2, z: 3 }]);
      core.stop();
      expect(constructed[1].stopped).toBe(true);
    });
  });

  describe("devicemotion フォールバック（Gyroscope クラスの無いブラウザ: iPhone / iPad の Safari、Android の Firefox）", () => {
    it("クラスが無く DeviceMotionEvent があれば、start() は window の devicemotion を購読する（error は出さない）", () => {
      installDeviceMotionEvent();
      const addSpy = vi.spyOn(window, "addEventListener");
      const core = new GyroscopeCore();

      core.start();

      expect(addSpy.mock.calls.filter((c) => c[0] === "devicemotion")).toHaveLength(1);
      expect(core.error).toBeNull();
      core.stop();
    });

    it("rotationRate（度/秒）が x = beta、y = gamma、z = alpha のラジアン/秒として同じ reading イベントで届く", () => {
      installDeviceMotionEvent();
      const core = new GyroscopeCore();
      const events: any[] = [];
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-gyroscope:reading", (e) => {
        events.push((e as CustomEvent).detail);
        bubbles = e.bubbles;
      });

      core.start();
      emitDeviceMotion({ rotationRate: { alpha: 10, beta: 20, gamma: -30 } });

      expect(core.x).toBe(20 * RAD);
      expect(core.y).toBe(-30 * RAD);
      expect(core.z).toBe(10 * RAD);
      expect(events).toEqual([{ x: 20 * RAD, y: -30 * RAD, z: 10 * RAD }]);
      expect(bubbles).toBe(true);
      core.stop();
    });

    it("単位の換算: 180 度/秒は π ラジアン/秒、90 度/秒は π/2", () => {
      installDeviceMotionEvent();
      const core = new GyroscopeCore();

      core.start();
      emitDeviceMotion({ rotationRate: { alpha: -90, beta: 180, gamma: 90 } });

      expect(core.x).toBeCloseTo(Math.PI, 12);
      expect(core.y).toBeCloseTo(Math.PI / 2, 12);
      expect(core.z).toBeCloseTo(-Math.PI / 2, 12);
      core.stop();
    });

    it("同値の reading でも毎回 dispatch される（センサーの経路と同じ）", () => {
      installDeviceMotionEvent();
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:reading", (e) => events.push((e as CustomEvent).detail));

      core.start();
      emitDeviceMotion({ rotationRate: { alpha: 3, beta: 1, gamma: 2 } });
      emitDeviceMotion({ rotationRate: { alpha: 3, beta: 1, gamma: 2 } });

      expect(events).toHaveLength(2);
      core.stop();
    });

    it("値の無いイベント（PC が出す）は読み飛ばす: オブジェクトが null、または有限の数でない軸がある", () => {
      installDeviceMotionEvent();
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:reading", (e) => events.push((e as CustomEvent).detail));

      core.start();
      emitDeviceMotion({ rotationRate: null });
      emitDeviceMotion({ rotationRate: { alpha: null, beta: null, gamma: null } });
      emitDeviceMotion({ rotationRate: { alpha: 0, beta: NaN, gamma: 0 } });
      emitDeviceMotion({ rotationRate: { alpha: 0, beta: 0, gamma: null } });
      emitDeviceMotion({ rotationRate: { alpha: Infinity, beta: 0, gamma: 0 } });
      const noField = new Event("devicemotion");
      window.dispatchEvent(noField);

      expect(events).toEqual([]);
      expect(core.x).toBeNull();
      core.stop();
    });

    it("frequency があれば間引く: 最後に出した reading から 1000 / frequency ms 未満のものは落とす（event.timeStamp）", () => {
      installDeviceMotionEvent();
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:reading", (e) => events.push((e as CustomEvent).detail.x));

      core.start(10); // 100ms に 1 回まで
      emitDeviceMotion({ rotationRate: { alpha: 0, beta: 1, gamma: 0 }, timeStamp: 1000 });
      emitDeviceMotion({ rotationRate: { alpha: 0, beta: 2, gamma: 0 }, timeStamp: 1016 });
      emitDeviceMotion({ rotationRate: { alpha: 0, beta: 3, gamma: 0 }, timeStamp: 1099 });
      emitDeviceMotion({ rotationRate: { alpha: 0, beta: 4, gamma: 0 }, timeStamp: 1100 });
      emitDeviceMotion({ rotationRate: { alpha: 0, beta: 5, gamma: 0 }, timeStamp: 1150 });
      emitDeviceMotion({ rotationRate: { alpha: 0, beta: 6, gamma: 0 }, timeStamp: 1200 });

      expect(events).toEqual([1 * RAD, 4 * RAD, 6 * RAD]);
      expect(core.x).toBe(6 * RAD);
      core.stop();
    });

    it("読み飛ばした（値の無い）イベントは間引きの基準にならない", () => {
      installDeviceMotionEvent();
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:reading", (e) => events.push((e as CustomEvent).detail.x));

      core.start(10);
      emitDeviceMotion({ rotationRate: { alpha: 0, beta: 1, gamma: 0 }, timeStamp: 1000 });
      emitDeviceMotion({ rotationRate: null, timeStamp: 1099 });
      emitDeviceMotion({ rotationRate: { alpha: 0, beta: 2, gamma: 0 }, timeStamp: 1100 });

      expect(events).toEqual([1 * RAD, 2 * RAD]);
      core.stop();
    });

    it("frequency が無ければ（または正の数でなければ）すべてのイベントを出す", () => {
      installDeviceMotionEvent();
      for (const frequency of [undefined, 0, -5, NaN]) {
        const core = new GyroscopeCore();
        const events: any[] = [];
        core.addEventListener("wcs-gyroscope:reading", (e) => events.push((e as CustomEvent).detail.x));

        core.start(frequency);
        emitDeviceMotion({ rotationRate: { alpha: 0, beta: 1, gamma: 0 }, timeStamp: 1000 });
        emitDeviceMotion({ rotationRate: { alpha: 0, beta: 2, gamma: 0 }, timeStamp: 1000 });
        emitDeviceMotion({ rotationRate: { alpha: 0, beta: 3, gamma: 0 }, timeStamp: 1001 });

        expect(events).toEqual([1 * RAD, 2 * RAD, 3 * RAD]);
        core.stop();
      }
    });

    it("start() は冪等 — 二重呼び出しで二重に購読しない", () => {
      installDeviceMotionEvent();
      const addSpy = vi.spyOn(window, "addEventListener");
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:reading", (e) => events.push((e as CustomEvent).detail));

      core.start();
      core.start();
      emitDeviceMotion({ rotationRate: { alpha: 3, beta: 1, gamma: 2 } });

      expect(addSpy.mock.calls.filter((c) => c[0] === "devicemotion")).toHaveLength(1);
      expect(events).toHaveLength(1);
      core.stop();
    });

    it("stop() / dispose() で購読を外す。値は最後の reading のまま", () => {
      installDeviceMotionEvent();
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const core = new GyroscopeCore();

      core.start();
      emitDeviceMotion({ rotationRate: { alpha: 3, beta: 1, gamma: 2 } });
      core.stop();
      expect(removeSpy.mock.calls.filter((c) => c[0] === "devicemotion")).toHaveLength(1);
      emitDeviceMotion({ rotationRate: { alpha: 9, beta: 9, gamma: 9 } });
      expect(core.x).toBe(1 * RAD);

      core.start();
      core.dispose();
      emitDeviceMotion({ rotationRate: { alpha: 8, beta: 8, gamma: 8 } });
      expect(core.x).toBe(1 * RAD);

      // 止まっているときの stop() は no-op
      expect(() => core.stop()).not.toThrow();
      expect(removeSpy.mock.calls.filter((c) => c[0] === "devicemotion")).toHaveLength(2);
    });

    it("stop() の後の start() は間引きをやり直す（前の reading の時刻を引き継がない）", () => {
      installDeviceMotionEvent();
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:reading", (e) => events.push((e as CustomEvent).detail.x));

      core.start(10);
      emitDeviceMotion({ rotationRate: { alpha: 0, beta: 1, gamma: 0 }, timeStamp: 1000 });
      core.stop();
      core.start(10);
      emitDeviceMotion({ rotationRate: { alpha: 0, beta: 2, gamma: 0 }, timeStamp: 1001 });

      expect(events).toEqual([1 * RAD, 2 * RAD]);
      core.stop();
    });

    it("Gyroscope クラスがあればそちらを使う（DeviceMotionEvent があっても devicemotion は購読しない）", () => {
      installDeviceMotionEvent();
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const addSpy = vi.spyOn(window, "addEventListener");
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:reading", (e) => events.push((e as CustomEvent).detail));

      core.start();
      expect(handle.current?.started).toBe(true);
      expect(addSpy).not.toHaveBeenCalledWith("devicemotion", expect.anything());
      emitDeviceMotion({ rotationRate: { alpha: 3, beta: 1, gamma: 2 } });
      expect(events).toEqual([]);
      core.stop();
    });

    it("stop() の後の start() は、どちらの経路を使うかをその場で決め直す", () => {
      installDeviceMotionEvent();
      const core = new GyroscopeCore();

      // 1 回目: クラスが無い → devicemotion
      core.start();
      emitDeviceMotion({ rotationRate: { alpha: 3, beta: 1, gamma: 2 } });
      expect(core.x).toBe(1 * RAD);
      core.stop();

      // 2 回目: クラスがある → センサー。devicemotion はもう読まない
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      core.start();
      expect(handle.current?.started).toBe(true);
      emitDeviceMotion({ rotationRate: { alpha: 7, beta: 7, gamma: 7 } });
      expect(core.x).toBe(1 * RAD);
      handle.current!.emitReading({ x: 4, y: 5, z: 6 });
      expect(core.x).toBe(4);
      const sensor = handle.current!;
      core.stop();
      expect(sensor.stopped).toBe(true);

      // 3 回目: クラスが消えた → また devicemotion
      removeSensor(GLOBAL_NAME);
      core.start();
      emitDeviceMotion({ rotationRate: { alpha: 2, beta: 2, gamma: 2 } });
      expect(core.x).toBe(2 * RAD);
      core.stop();
    });
  });

  describe("requestPermission() と permissionState", () => {
    it("フォールバックで DeviceMotionEvent.requestPermission がある（iOS）: 呼んで、'granted' を反映する", async () => {
      const ask = installDeviceMotionEvent(() => Promise.resolve("granted"))!;
      const core = new GyroscopeCore();
      const events: any[] = [];
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-gyroscope:permission-changed", (e) => {
        events.push((e as CustomEvent).detail);
        bubbles = e.bubbles;
      });

      const result = await core.requestPermission();

      expect(ask).toHaveBeenCalledTimes(1);
      expect(result).toBe("granted");
      expect(core.permissionState).toBe("granted");
      expect(events).toEqual(["granted"]);
      expect(bubbles).toBe(true);
      expect(core.error).toBeNull();
    });

    it("iOS で 'denied' が返れば 'denied'。'granted' 以外で resolve した値も 'denied'", async () => {
      installDeviceMotionEvent(() => Promise.resolve("denied"));
      const core = new GyroscopeCore();
      expect(await core.requestPermission()).toBe("denied");
      expect(core.permissionState).toBe("denied");

      installDeviceMotionEvent(() => Promise.resolve("default"));
      const other = new GyroscopeCore();
      expect(await other.requestPermission()).toBe("denied");
      expect(other.permissionState).toBe("denied");
    });

    it("reject（iOS: タップの外では質問が出ない）は利用者の拒否ではない: 状態はそのまま、error が載り、not-allowed / recoverable=true", async () => {
      const refusal = new Error("Requesting device motion access requires a user gesture to prompt");
      refusal.name = "NotAllowedError";
      installDeviceMotionEvent(() => Promise.reject(refusal));
      const core = new GyroscopeCore();
      const states: any[] = [];
      core.addEventListener("wcs-gyroscope:permission-changed", (e) => states.push((e as CustomEvent).detail));

      const result = await core.requestPermission();

      expect(result).toBe("unknown");
      expect(core.permissionState).toBe("unknown");
      expect(states).toEqual([]);
      expect(core.error).toEqual({ error: "NotAllowedError", message: refusal.message });
      expect(core.errorInfo).toEqual({ code: "not-allowed", phase: "start", recoverable: true, message: refusal.message });
    });

    it("reject は前の答えも変えない。その後、タップからの呼び出しが許可されれば 'granted' になり error は消える", async () => {
      installDeviceMotionEvent(() => Promise.resolve("denied"));
      const core = new GyroscopeCore();
      await core.requestPermission();

      const refusal = new Error("needs a user gesture");
      refusal.name = "NotAllowedError";
      installDeviceMotionEvent(() => Promise.reject(refusal));
      expect(await core.requestPermission()).toBe("denied");
      expect(core.permissionState).toBe("denied");
      expect(core.error).not.toBeNull();

      installDeviceMotionEvent(() => Promise.resolve("granted"));
      expect(await core.requestPermission()).toBe("granted");
      expect(core.permissionState).toBe("granted");
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("name/message を持たない reject でもフォールバック文字列に変換される（sensor-error / recoverable=false）", async () => {
      installDeviceMotionEvent(() => Promise.reject("plain string"));
      const core = new GyroscopeCore();
      expect(await core.requestPermission()).toBe("unknown");
      expect(core.error).toEqual({ error: "error", message: "plain string" });
      expect(core.errorInfo).toEqual({ code: "sensor-error", phase: "execute", recoverable: false, message: "plain string" });
    });

    it("フォールバックで requestPermission が無い（Android の Firefox など）: 質問が無いので即 'granted'", async () => {
      installDeviceMotionEvent();
      const core = new GyroscopeCore();
      expect(await core.requestPermission()).toBe("granted");
      expect(core.permissionState).toBe("granted");
      expect(core.error).toBeNull();
    });

    it("Gyroscope クラスがある: 質問が無いので即 'granted'（DeviceMotionEvent.requestPermission があっても呼ばない）", async () => {
      const ask = installDeviceMotionEvent(() => Promise.resolve("denied"))!;
      installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      expect(await core.requestPermission()).toBe("granted");
      expect(ask).not.toHaveBeenCalled();
      expect(core.permissionState).toBe("granted");
    });

    it("どちらの API も無い: unsupported の error、状態はそのまま", async () => {
      const core = new GyroscopeCore();
      const states: any[] = [];
      core.addEventListener("wcs-gyroscope:permission-changed", (e) => states.push((e as CustomEvent).detail));

      expect(await core.requestPermission()).toBe("unknown");
      expect(core.permissionState).toBe("unknown");
      expect(states).toEqual([]);
      expect(core.error).toEqual({ error: "unsupported", message: "Gyroscope is not supported" });
      expect(core.errorInfo?.code).toBe("capability-missing");
    });

    it("同値の permissionState が続けて確定しても再 dispatch しない（同値ガード）", async () => {
      installDeviceMotionEvent(() => Promise.resolve("granted"));
      const core = new GyroscopeCore();
      await core.requestPermission();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:permission-changed", (e) => events.push((e as CustomEvent).detail));

      await core.requestPermission();
      expect(events).toEqual([]);
    });

    it("答えが出ると、前の試みの error（start() の失敗も）は消える", async () => {
      installThrowingSensor(GLOBAL_NAME, "SecurityError", "Permission denied");
      const core = new GyroscopeCore();
      core.start();
      expect(core.error).not.toBeNull();

      await core.requestPermission(); // クラスがある → 即 'granted'
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("start() は許可を確かめない（許可の前でも購読する）", () => {
      installDeviceMotionEvent(() => Promise.resolve("denied"));
      const addSpy = vi.spyOn(window, "addEventListener");
      const core = new GyroscopeCore();
      core.start();
      expect(addSpy.mock.calls.filter((c) => c[0] === "devicemotion")).toHaveLength(1);
      expect(core.permissionState).toBe("unknown");
      core.stop();
    });
  });

  describe("supported（このページでセンサーを使えるか）", () => {
    function policy(blocked: string[]): void {
      (document as any).featurePolicy = { allowsFeature: (f: string) => !blocked.includes(f) };
    }

    it("Gyroscope クラスがあれば true", () => {
      installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      expect(new GyroscopeCore().supported).toBe(true);
    });

    it("クラスが無くても DeviceMotionEvent（フォールバック）があれば true", () => {
      installDeviceMotionEvent();
      expect(new GyroscopeCore().supported).toBe(true);
    });

    it("どちらも無ければ false（呼ぶたびに判定する）", () => {
      const core = new GyroscopeCore();
      expect(core.supported).toBe(false);
      installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      expect(core.supported).toBe(true);
    });

    it("Permissions-Policy が gyroscope を切っていれば、API があっても false", () => {
      installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      installDeviceMotionEvent();
      const core = new GyroscopeCore();
      policy(["gyroscope"]);
      expect(core.supported).toBe(false);
      policy(["accelerometer"]);
      expect(core.supported).toBe(true);
    });

    it("安全でないコンテキストでは false", () => {
      installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      vi.stubGlobal("isSecureContext", false);
      expect(new GyroscopeCore().supported).toBe(false);
    });

    it("publishSupported() は、最後に dispatch した値（初めは false）と違うときだけ wcs-gyroscope:supported-changed を出す", () => {
      installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      const events: any[] = [];
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-gyroscope:supported-changed", (e) => {
        events.push((e as CustomEvent).detail);
        bubbles = e.bubbles;
      });

      core.publishSupported();
      expect(events).toEqual([true]);
      expect(bubbles).toBe(true);
      core.publishSupported();
      expect(events).toEqual([true]);

      policy(["gyroscope"]);
      core.publishSupported();
      expect(events).toEqual([true, false]);
    });

    it("使えない環境では、初めの値（false）と同じなので何も dispatch しない", () => {
      const core = new GyroscopeCore();
      const events: any[] = [];
      core.addEventListener("wcs-gyroscope:supported-changed", (e) => events.push((e as CustomEvent).detail));
      core.publishSupported();
      expect(events).toEqual([]);
    });
  });

  describe("stop()", () => {
    it("stop() でセンサーの .stop() が呼ばれ、listener が解除される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();

      core.start();
      const sensor = handle.current!;
      core.stop();

      expect(sensor.stopped).toBe(true);

      sensor.emitReading({ x: 99, y: 99, z: 99 });
      expect(core.x).toBeNull();
    });

    it("stop() 後の reading は無視される（値が更新されない）", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 1, y: 1, z: 1 });
      const core = new GyroscopeCore();

      core.start();
      handle.current!.emitReading({ x: 5, y: 5, z: 5 });
      core.stop();
      handle.current!.emitReading({ x: 10, y: 10, z: 10 });

      expect(core.x).toBe(5);
    });

    it("開始していない stop() は安全な no-op", () => {
      const core = new GyroscopeCore();
      expect(() => core.stop()).not.toThrow();
    });

    it("stop() から再度 start() すると新しいセンサーが構築される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();

      core.start();
      const first = handle.current;
      core.stop();
      core.start();

      expect(handle.current).not.toBe(first);
      expect(handle.current?.started).toBe(true);
    });
  });

  describe("observe()/dispose() ライフサイクルエイリアス", () => {
    it("observe() は start() 相当で ready を返す", async () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();

      await expect(core.observe(30)).resolves.toBeUndefined();
      expect(handle.current?.started).toBe(true);
      expect(handle.current?.options).toEqual({ frequency: 30 });
    });

    it("dispose() は stop() 相当", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();

      core.observe();
      const sensor = handle.current!;
      core.dispose();

      expect(sensor.stopped).toBe(true);
    });

    it("dispose() 後に observe() で再購読できる", async () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();

      await core.observe();
      core.dispose();
      await core.observe();

      expect(handle.current?.started).toBe(true);
    });
  });

  describe("target 指定", () => {
    it("target を渡すとそこへ reading/error を dispatch する", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const target = new EventTarget();
      const events: any[] = [];
      target.addEventListener("wcs-gyroscope:reading", (e) => events.push((e as CustomEvent).detail));

      const core = new GyroscopeCore(target);
      core.start();
      handle.current!.emitReading({ x: 1, y: 1, z: 1 });

      expect(events).toHaveLength(1);
    });
  });

  describe("errorInfo taxonomy (Phase 6)", () => {
    it("初期状態の errorInfo は null", () => {
      expect(new GyroscopeCore().errorInfo).toBeNull();
    });

    it("errorInfo は wcBindable property(error の直後)として宣言される", () => {
      const names = GyroscopeCore.wcBindable.properties.map((p) => p.name);
      expect(names).toContain("errorInfo");
      expect(names.indexOf("errorInfo")).toBe(names.indexOf("error") + 1);
    });

    it("unsupported → capability-missing / probe / recoverable=false", () => {
      removeSensor(GLOBAL_NAME);
      const core = new GyroscopeCore();
      core.start();
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "probe", recoverable: false,
        message: "Gyroscope is not supported",
      });
    });

    it("SecurityError → not-allowed / start / recoverable=false", () => {
      installThrowingSensor(GLOBAL_NAME, "SecurityError", "Permission denied");
      const core = new GyroscopeCore();
      core.start();
      expect(core.errorInfo).toEqual({ code: "not-allowed", phase: "start", recoverable: false, message: "Permission denied" });
      // 公開 error shape は不変。
      expect(core.error).toEqual({ error: "SecurityError", message: "Permission denied" });
    });

    it("NotReadableError(稼働中)→ not-readable / execute / recoverable=false", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      core.start();
      handle.current!.emitError("NotReadableError", "could not read");
      expect(core.errorInfo).toEqual({ code: "not-readable", phase: "execute", recoverable: false, message: "could not read" });
    });

    it("その他 name → sensor-error / execute", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      core.start();
      handle.current!.emitError("GenericFailure", "weird");
      expect(core.errorInfo).toEqual({ code: "sensor-error", phase: "execute", recoverable: false, message: "weird" });
    });

    it("error が null にクリアされると errorInfo も null になる(同期・防御的 clear 経路)", () => {
      // sensor は通常 error を sticky に保つ(clear 経路が無い)が、errorInfo は error と
      // 厳密に同期する契約。_setError(null) を直接呼び、mirror のクリアを固定する。
      const core = new GyroscopeCore();
      (core as unknown as { _setError(e: { error: string; message: string } | null): void })
        ._setError({ error: "SecurityError", message: "x" });
      expect(core.errorInfo).not.toBeNull();
      (core as unknown as { _setError(e: { error: string; message: string } | null): void })._setError(null);
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("errorInfo は error と同期して遷移し、error より前に error-info-changed が流れる", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new GyroscopeCore();
      const order: string[] = [];
      core.addEventListener("wcs-gyroscope:error-info-changed", () => order.push("errorInfo"));
      core.addEventListener("wcs-gyroscope:error", () => order.push("error"));
      core.start();
      handle.current!.emitError("NotReadableError", "x");
      expect(order).toEqual(["errorInfo", "error"]);
      expect(core.errorInfo).not.toBeNull();
    });
  });

  describe("wcBindable プロトコル宣言", () => {
    it("commands は requestPermission(async)/start/stop", () => {
      expect(GyroscopeCore.wcBindable.commands).toEqual([
        { name: "requestPermission", async: true }, { name: "start" }, { name: "stop" },
      ]);
    });

    it("properties は x/y/z/permissionState/error/errorInfo/supported（すべて semantics: state）", () => {
      const props = GyroscopeCore.wcBindable.properties;
      expect(props.map((p) => p.name)).toEqual(["x", "y", "z", "permissionState", "error", "errorInfo", "supported"]);
      expect(props.every((p) => p.semantics === "state")).toBe(true);
      const byName = (n: string) => props.find((p) => p.name === n)!;
      expect(byName("permissionState").event).toBe("wcs-gyroscope:permission-changed");
      expect(byName("permissionState").getter).toBeUndefined();
      expect(byName("supported").event).toBe("wcs-gyroscope:supported-changed");
      expect(byName("supported").getter).toBeUndefined();
    });

    it("x/y/z の getter が reading イベントの detail から値を取り出す", () => {
      const byName = (n: string) => GyroscopeCore.wcBindable.properties.find((p) => p.name === n)!;
      const ev = new CustomEvent("wcs-gyroscope:reading", { detail: { x: 1, y: 2, z: 3 } });

      expect(byName("x").getter!(ev)).toBe(1);
      expect(byName("y").getter!(ev)).toBe(2);
      expect(byName("z").getter!(ev)).toBe(3);
    });

    it("error プロパティには getter が無い（detail がそのまま値）", () => {
      const byName = (n: string) => GyroscopeCore.wcBindable.properties.find((p) => p.name === n)!;
      expect(byName("error").getter).toBeUndefined();
    });
  });
});
