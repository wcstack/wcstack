import { describe, it, expect, afterEach } from "vitest";
import { AccelerometerCore } from "../src/core/AccelerometerCore";
import { FakeSensor, installSensor, installThrowingSensor, removeSensor } from "./mocks";

const GLOBAL_NAME = "Accelerometer";

describe("AccelerometerCore", () => {
  afterEach(() => {
    removeSensor(GLOBAL_NAME);
  });

  describe("初期状態（start 前）", () => {
    it("x/y/z/error は既定値", () => {
      const core = new AccelerometerCore();
      expect(core.x).toBeNull();
      expect(core.y).toBeNull();
      expect(core.z).toBeNull();
      expect(core.error).toBeNull();
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new AccelerometerCore();
      await expect(core.ready).resolves.toBeUndefined();
    });
  });

  describe("start() — 非対応環境", () => {
    it("globalThis.Accelerometer が無ければ unsupported エラーになる（例外は投げない）", () => {
      removeSensor(GLOBAL_NAME);
      const core = new AccelerometerCore();
      expect(() => core.start()).not.toThrow();
      expect(core.error).toEqual({ error: "unsupported", message: "Accelerometer is not supported" });
    });
  });

  describe("start() — コンストラクタが同期的に例外を投げる場合（never-throw）", () => {
    it("SecurityError を投げるコンストラクタでも start() は例外を投げず error に変換する", () => {
      installThrowingSensor(GLOBAL_NAME, "SecurityError", "Permission denied");
      const core = new AccelerometerCore();
      expect(() => core.start()).not.toThrow();
      expect(core.error).toEqual({ error: "SecurityError", message: "Permission denied" });
    });

    it("name/message を持たない例外でもフォールバック文字列に変換される", () => {
      (globalThis as any)[GLOBAL_NAME] = function () {
        throw "plain string throw";
      };
      const core = new AccelerometerCore();
      expect(() => core.start()).not.toThrow();
      expect(core.error?.error).toBe("error");
      expect(core.error?.message).toBe("plain string throw");
    });

    it("非準拠実装が sensor.start() 自体で同期的に例外を投げても never-throw が保たれる", () => {
      // 仕様上 Sensor.start()/stop() は例外を投げない契約だが、Core の防御的
      // catch（AccelerometerCore.ts の start() 内）が非準拠実装からも状態を守ることを確認する。
      const core = new AccelerometerCore();
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
      const core = new AccelerometerCore();
      const events: any[] = [];
      core.addEventListener("wcs-accelerometer:reading", (e) => events.push((e as CustomEvent).detail));

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
      const core = new AccelerometerCore();

      core.start();

      expect(handle.current?.started).toBe(true);
    });

    it("frequency を渡すとコンストラクタのオプションに渡る", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();

      core.start(60);

      expect(handle.current?.options).toEqual({ frequency: 60 });
    });

    it("frequency 省略時はオプション無しでコンストラクタが呼ばれる", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();

      core.start();

      expect(handle.current?.options).toBeUndefined();
    });

    it("start() は冪等 — 二重呼び出しでセンサーが二重生成されない", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();

      core.start();
      const first = handle.current;
      core.start();

      expect(handle.current).toBe(first);
    });
  });

  describe("reading イベント", () => {
    it("reading で x/y/z が更新され、CustomEvent が dispatch される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();
      const events: any[] = [];
      core.addEventListener("wcs-accelerometer:reading", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitReading({ x: 1, y: 2, z: 9.8 });

      expect(core.x).toBe(1);
      expect(core.y).toBe(2);
      expect(core.z).toBe(9.8);
      expect(events).toEqual([{ x: 1, y: 2, z: 9.8 }]);
    });

    it("同値の reading でも毎回 dispatch される（同値ガード対象外）", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 1, y: 2, z: 3 });
      const core = new AccelerometerCore();
      const events: any[] = [];
      core.addEventListener("wcs-accelerometer:reading", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitReading({ x: 1, y: 2, z: 3 });
      handle.current!.emitReading({ x: 1, y: 2, z: 3 });

      expect(events).toHaveLength(2);
    });
  });

  describe("error イベント", () => {
    it("センサーが error を発火すると error プロパティに反映される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();
      const events: any[] = [];
      core.addEventListener("wcs-accelerometer:error", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitError("NotReadableError", "could not read from the sensor");

      expect(core.error).toEqual({ error: "NotReadableError", message: "could not read from the sensor" });
      expect(events).toHaveLength(1);
    });

    it("同値の error は同値ガードで再 dispatch しない", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();
      const events: any[] = [];
      core.addEventListener("wcs-accelerometer:error", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitError("NotReadableError", "msg");
      handle.current!.emitError("NotReadableError", "msg");

      expect(events).toHaveLength(1);
    });

    it("同一 name・異なる message では再 dispatch され error.message が更新される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();
      const events: any[] = [];
      core.addEventListener("wcs-accelerometer:error", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitError("NotReadableError", "first message");
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
      const core = new AccelerometerCore();
      const events: any[] = [];
      core.addEventListener("wcs-accelerometer:error", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitError("NotReadableError", "same message");
      handle.current!.emitError("SecurityError", "same message");

      expect(events).toHaveLength(2);
      expect(core.error).toEqual({ error: "SecurityError", message: "same message" });
    });

    it("error イベントに detail が無くてもフォールバック値になる", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();

      core.start();
      handle.current!.dispatchEvent(new Event("error"));

      // The message fallback must be a meaningful constant, not the literal
      // string "undefined" (String(undefined)) — sensor-family aligned.
      expect(core.error).toEqual({ error: "error", message: "Sensor error" });
    });

    // Spec fix (monitoring-sensor family): unlike ScreenOrientationCore's
    // bidirectional `lock()` command (which calls _setError(null) on success),
    // the monitoring sensors (accelerometer/gyroscope/magnetometer) deliberately
    // do NOT clear `error` on a successful (re)start. `error` here is a sticky,
    // state-like signal reflecting the last observed failure — a `reading` after
    // an error does not retroactively "cancel" that error. This test pins that
    // contract so a future change cannot silently start clearing it (which would
    // then need to be aligned across all three twins). See docs/sensor-tag-design.md §1.5.
    it("失敗→リトライ成功しても error は据え置かれる（監視系は成功時にクリアしない）", () => {
      // First attempt: unsupported → error is set.
      removeSensor(GLOBAL_NAME);
      const core = new AccelerometerCore();
      core.start();
      expect(core.error).toEqual({ error: "unsupported", message: "Accelerometer is not supported" });

      // Retry: the API becomes available and start() succeeds, and readings flow.
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      core.start();
      expect(handle.current?.started).toBe(true);
      handle.current!.emitReading({ x: 1, y: 2, z: 3 });
      expect(core.x).toBe(1);

      // The prior error stays put — a successful start does not clear it.
      expect(core.error).toEqual({ error: "unsupported", message: "Accelerometer is not supported" });
    });
  });

  describe("stop()", () => {
    it("stop() でセンサーの .stop() が呼ばれ、listener が解除される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();

      core.start();
      const sensor = handle.current!;
      core.stop();

      expect(sensor.stopped).toBe(true);

      sensor.emitReading({ x: 99, y: 99, z: 99 });
      expect(core.x).toBeNull();
    });

    it("stop() 後の reading は無視される（値が更新されない）", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 1, y: 1, z: 1 });
      const core = new AccelerometerCore();

      core.start();
      handle.current!.emitReading({ x: 5, y: 5, z: 5 });
      core.stop();
      handle.current!.emitReading({ x: 10, y: 10, z: 10 });

      expect(core.x).toBe(5);
    });

    it("開始していない stop() は安全な no-op", () => {
      const core = new AccelerometerCore();
      expect(() => core.stop()).not.toThrow();
    });

    it("stop() から再度 start() すると新しいセンサーが構築される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();

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
      const core = new AccelerometerCore();

      await expect(core.observe(30)).resolves.toBeUndefined();
      expect(handle.current?.started).toBe(true);
      expect(handle.current?.options).toEqual({ frequency: 30 });
    });

    it("dispose() は stop() 相当", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();

      core.observe();
      const sensor = handle.current!;
      core.dispose();

      expect(sensor.stopped).toBe(true);
    });

    it("dispose() 後に observe() で再購読できる", async () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();

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
      target.addEventListener("wcs-accelerometer:reading", (e) => events.push((e as CustomEvent).detail));

      const core = new AccelerometerCore(target);
      core.start();
      handle.current!.emitReading({ x: 1, y: 1, z: 1 });

      expect(events).toHaveLength(1);
    });
  });

  describe("errorInfo taxonomy (Phase 6)", () => {
    it("初期状態の errorInfo は null", () => {
      expect(new AccelerometerCore().errorInfo).toBeNull();
    });

    it("errorInfo は wcBindable property(error の直後)として宣言される", () => {
      const names = AccelerometerCore.wcBindable.properties.map((p) => p.name);
      expect(names).toContain("errorInfo");
      expect(names.indexOf("errorInfo")).toBe(names.indexOf("error") + 1);
    });

    it("unsupported → capability-missing / probe / recoverable=false", () => {
      removeSensor(GLOBAL_NAME);
      const core = new AccelerometerCore();
      core.start();
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "probe", recoverable: false,
        message: "Accelerometer is not supported",
      });
    });

    it("SecurityError → not-allowed / start / recoverable=false", () => {
      installThrowingSensor(GLOBAL_NAME, "SecurityError", "Permission denied");
      const core = new AccelerometerCore();
      core.start();
      expect(core.errorInfo).toEqual({ code: "not-allowed", phase: "start", recoverable: false, message: "Permission denied" });
      // 公開 error shape は不変。
      expect(core.error).toEqual({ error: "SecurityError", message: "Permission denied" });
    });

    it("NotReadableError(稼働中)→ not-readable / execute / recoverable=false", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();
      core.start();
      handle.current!.emitError("NotReadableError", "could not read");
      expect(core.errorInfo).toEqual({ code: "not-readable", phase: "execute", recoverable: false, message: "could not read" });
    });

    it("その他 name → sensor-error / execute", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();
      core.start();
      handle.current!.emitError("GenericFailure", "weird");
      expect(core.errorInfo).toEqual({ code: "sensor-error", phase: "execute", recoverable: false, message: "weird" });
    });

    it("error が null にクリアされると errorInfo も null になる(同期・防御的 clear 経路)", () => {
      // sensor は通常 error を sticky に保つ(clear 経路が無い)が、errorInfo は error と
      // 厳密に同期する契約。_setError(null) を直接呼び、mirror のクリアを固定する。
      const core = new AccelerometerCore();
      (core as unknown as { _setError(e: { error: string; message: string } | null): void })
        ._setError({ error: "SecurityError", message: "x" });
      expect(core.errorInfo).not.toBeNull();
      (core as unknown as { _setError(e: { error: string; message: string } | null): void })._setError(null);
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("errorInfo は error と同期して遷移し、error より前に error-info-changed が流れる", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new AccelerometerCore();
      const order: string[] = [];
      core.addEventListener("wcs-accelerometer:error-info-changed", () => order.push("errorInfo"));
      core.addEventListener("wcs-accelerometer:error", () => order.push("error"));
      core.start();
      handle.current!.emitError("NotReadableError", "x");
      expect(order).toEqual(["errorInfo", "error"]);
      expect(core.errorInfo).not.toBeNull();
    });
  });

  describe("wcBindable プロトコル宣言", () => {
    it("commands は start/stop", () => {
      expect(AccelerometerCore.wcBindable.commands).toEqual([{ name: "start" }, { name: "stop" }]);
    });

    it("x/y/z の getter が reading イベントの detail から値を取り出す", () => {
      const byName = (n: string) => AccelerometerCore.wcBindable.properties.find((p) => p.name === n)!;
      const ev = new CustomEvent("wcs-accelerometer:reading", { detail: { x: 1, y: 2, z: 3 } });

      expect(byName("x").getter!(ev)).toBe(1);
      expect(byName("y").getter!(ev)).toBe(2);
      expect(byName("z").getter!(ev)).toBe(3);
    });

    it("error プロパティには getter が無い（detail がそのまま値）", () => {
      const byName = (n: string) => AccelerometerCore.wcBindable.properties.find((p) => p.name === n)!;
      expect(byName("error").getter).toBeUndefined();
    });
  });
});
