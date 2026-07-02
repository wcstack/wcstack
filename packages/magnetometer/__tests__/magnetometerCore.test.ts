import { describe, it, expect, afterEach } from "vitest";
import { MagnetometerCore } from "../src/core/MagnetometerCore";
import { installSensor, installThrowingSensor, removeSensor } from "./mocks";

const GLOBAL_NAME = "Magnetometer";

describe("MagnetometerCore", () => {
  afterEach(() => {
    removeSensor(GLOBAL_NAME);
  });

  describe("初期状態（start 前）", () => {
    it("x/y/z/error は既定値", () => {
      const core = new MagnetometerCore();
      expect(core.x).toBeNull();
      expect(core.y).toBeNull();
      expect(core.z).toBeNull();
      expect(core.error).toBeNull();
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new MagnetometerCore();
      await expect(core.ready).resolves.toBeUndefined();
    });
  });

  describe("start() — 非対応環境", () => {
    it("globalThis.Magnetometer が無ければ unsupported エラーになる（例外は投げない）", () => {
      removeSensor(GLOBAL_NAME);
      const core = new MagnetometerCore();
      expect(() => core.start()).not.toThrow();
      expect(core.error).toEqual({ error: "unsupported", message: "Magnetometer is not supported" });
    });
  });

  describe("start() — コンストラクタが同期的に例外を投げる場合（never-throw）", () => {
    it("SecurityError を投げるコンストラクタでも start() は例外を投げず error に変換する", () => {
      installThrowingSensor(GLOBAL_NAME, "SecurityError", "Permission denied");
      const core = new MagnetometerCore();
      expect(() => core.start()).not.toThrow();
      expect(core.error).toEqual({ error: "SecurityError", message: "Permission denied" });
    });

    it("name/message を持たない例外でもフォールバック文字列に変換される", () => {
      (globalThis as any)[GLOBAL_NAME] = function () {
        throw "plain string throw";
      };
      const core = new MagnetometerCore();
      expect(() => core.start()).not.toThrow();
      expect(core.error?.error).toBe("error");
      expect(core.error?.message).toBe("plain string throw");
    });

    it("非準拠実装が sensor.start() 自体で同期的に例外を投げても never-throw が保たれる", () => {
      // 仕様上 Sensor.start()/stop() は例外を投げない契約だが、Core の防御的
      // catch（MagnetometerCore.ts の start() 内）が非準拠実装からも状態を守ることを確認する。
      const core = new MagnetometerCore();
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
  });

  describe("start() — 対応環境", () => {
    it("start() でセンサーが構築され .start() が呼ばれる", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new MagnetometerCore();

      core.start();

      expect(handle.current?.started).toBe(true);
    });

    it("frequency を渡すとコンストラクタのオプションに渡る", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new MagnetometerCore();

      core.start(60);

      expect(handle.current?.options).toEqual({ frequency: 60 });
    });

    it("frequency 省略時はオプション無しでコンストラクタが呼ばれる", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new MagnetometerCore();

      core.start();

      expect(handle.current?.options).toBeUndefined();
    });

    it("start() は冪等 — 二重呼び出しでセンサーが二重生成されない", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new MagnetometerCore();

      core.start();
      const first = handle.current;
      core.start();

      expect(handle.current).toBe(first);
    });
  });

  describe("reading イベント", () => {
    it("reading で x/y/z が更新され、CustomEvent が dispatch される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new MagnetometerCore();
      const events: any[] = [];
      core.addEventListener("wcs-magnetometer:reading", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitReading({ x: 1, y: 2, z: 9.8 });

      expect(core.x).toBe(1);
      expect(core.y).toBe(2);
      expect(core.z).toBe(9.8);
      expect(events).toEqual([{ x: 1, y: 2, z: 9.8 }]);
    });

    it("同値の reading でも毎回 dispatch される（同値ガード対象外）", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 1, y: 2, z: 3 });
      const core = new MagnetometerCore();
      const events: any[] = [];
      core.addEventListener("wcs-magnetometer:reading", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitReading({ x: 1, y: 2, z: 3 });
      handle.current!.emitReading({ x: 1, y: 2, z: 3 });

      expect(events).toHaveLength(2);
    });
  });

  describe("error イベント", () => {
    it("センサーが error を発火すると error プロパティに反映される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new MagnetometerCore();
      const events: any[] = [];
      core.addEventListener("wcs-magnetometer:error", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitError("NotReadableError", "could not read from the sensor");

      expect(core.error).toEqual({ error: "NotReadableError", message: "could not read from the sensor" });
      expect(events).toHaveLength(1);
    });

    it("同値の error は同値ガードで再 dispatch しない", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new MagnetometerCore();
      const events: any[] = [];
      core.addEventListener("wcs-magnetometer:error", (e) => events.push((e as CustomEvent).detail));

      core.start();
      handle.current!.emitError("NotReadableError", "msg");
      handle.current!.emitError("NotReadableError", "msg");

      expect(events).toHaveLength(1);
    });

    it("error イベントに detail が無くてもフォールバック値になる", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new MagnetometerCore();

      core.start();
      handle.current!.dispatchEvent(new Event("error"));

      expect(core.error?.error).toBe("error");
    });
  });

  describe("stop()", () => {
    it("stop() でセンサーの .stop() が呼ばれ、listener が解除される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new MagnetometerCore();

      core.start();
      const sensor = handle.current!;
      core.stop();

      expect(sensor.stopped).toBe(true);

      sensor.emitReading({ x: 99, y: 99, z: 99 });
      expect(core.x).toBeNull();
    });

    it("stop() 後の reading は無視される（値が更新されない）", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 1, y: 1, z: 1 });
      const core = new MagnetometerCore();

      core.start();
      handle.current!.emitReading({ x: 5, y: 5, z: 5 });
      core.stop();
      handle.current!.emitReading({ x: 10, y: 10, z: 10 });

      expect(core.x).toBe(5);
    });

    it("開始していない stop() は安全な no-op", () => {
      const core = new MagnetometerCore();
      expect(() => core.stop()).not.toThrow();
    });

    it("stop() から再度 start() すると新しいセンサーが構築される", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new MagnetometerCore();

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
      const core = new MagnetometerCore();

      await expect(core.observe(30)).resolves.toBeUndefined();
      expect(handle.current?.started).toBe(true);
      expect(handle.current?.options).toEqual({ frequency: 30 });
    });

    it("dispose() は stop() 相当", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new MagnetometerCore();

      core.observe();
      const sensor = handle.current!;
      core.dispose();

      expect(sensor.stopped).toBe(true);
    });

    it("dispose() 後に observe() で再購読できる", async () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const core = new MagnetometerCore();

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
      target.addEventListener("wcs-magnetometer:reading", (e) => events.push((e as CustomEvent).detail));

      const core = new MagnetometerCore(target);
      core.start();
      handle.current!.emitReading({ x: 1, y: 1, z: 1 });

      expect(events).toHaveLength(1);
    });
  });

  describe("wcBindable プロトコル宣言", () => {
    it("commands は start/stop", () => {
      expect(MagnetometerCore.wcBindable.commands).toEqual([{ name: "start" }, { name: "stop" }]);
    });

    it("x/y/z の getter が reading イベントの detail から値を取り出す", () => {
      const byName = (n: string) => MagnetometerCore.wcBindable.properties.find((p) => p.name === n)!;
      const ev = new CustomEvent("wcs-magnetometer:reading", { detail: { x: 1, y: 2, z: 3 } });

      expect(byName("x").getter!(ev)).toBe(1);
      expect(byName("y").getter!(ev)).toBe(2);
      expect(byName("z").getter!(ev)).toBe(3);
    });

    it("error プロパティには getter が無い（detail がそのまま値）", () => {
      const byName = (n: string) => MagnetometerCore.wcBindable.properties.find((p) => p.name === n)!;
      expect(byName("error").getter).toBeUndefined();
    });
  });
});
