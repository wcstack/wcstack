import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { bootstrapAccelerometer } from "../src/bootstrapAccelerometer";
import { setConfig } from "../src/config";
import { WcsAccelerometer } from "../src/components/Accelerometer";
import {
  installSensor, installThrowingSensor, removeSensor,
  installDeviceMotionEvent, removeDeviceMotionEvent, restoreDeviceMotionEvent, emitDeviceMotion,
} from "./mocks";

const GLOBAL_NAME = "Accelerometer";

function createAccelerometer(): WcsAccelerometer {
  return document.createElement("wcs-accelerometer") as WcsAccelerometer;
}

describe("Accelerometer (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { accelerometer: "wcs-accelerometer" } });
    bootstrapAccelerometer();
    // happy-dom は DeviceMotionEvent を持つ。既定では外し、フォールバックのテストだけが入れる。
    removeDeviceMotionEvent();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    removeSensor(GLOBAL_NAME);
    vi.restoreAllMocks();
    restoreDeviceMotionEvent();
  });

  it("接続時に display:none になる", () => {
    const el = createAccelerometer();
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("接続だけではセンサーは開始しない（start は明示コマンド）", () => {
    const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
    const el = createAccelerometer();
    document.body.appendChild(el);

    expect(handle.current).toBeUndefined();
  });

  it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する（SSR）", async () => {
    expect(WcsAccelerometer.hasConnectedCallbackPromise).toBe(true);
    const el = createAccelerometer();
    document.body.appendChild(el);
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
  });

  it("接続前の getter は既定値を返す", () => {
    const el = createAccelerometer();
    expect(el.x).toBeNull();
    expect(el.y).toBeNull();
    expect(el.z).toBeNull();
    expect(el.error).toBeNull();
  });

  it("start() コマンドでセンサーが開始し、frequency 属性がオプションに渡る", () => {
    const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
    const el = createAccelerometer();
    el.frequency = 60;
    document.body.appendChild(el);

    el.start();

    expect(handle.current?.started).toBe(true);
    expect(handle.current?.options).toEqual({ frequency: 60 });
  });

  it("frequency 未設定なら getter は null、start() はオプション無しで呼ぶ", () => {
    const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
    const el = createAccelerometer();
    expect(el.frequency).toBeNull();

    document.body.appendChild(el);
    el.start();

    expect(handle.current?.options).toBeUndefined();
  });

  it("frequency に不正値を設定すると null にフォールバックする", () => {
    const el = createAccelerometer();
    el.setAttribute("frequency", "not-a-number");
    expect(el.frequency).toBeNull();
  });

  it("非正値・非有限値の frequency は getter が null に正規化する（0/負値/NaN）", () => {
    const el = createAccelerometer();
    el.setAttribute("frequency", "0");
    expect(el.frequency).toBeNull();
    el.setAttribute("frequency", "-5");
    expect(el.frequency).toBeNull();
    el.setAttribute("frequency", "Infinity");
    expect(el.frequency).toBeNull();
  });

  it("set/get は非正値では非対称 — 属性は書かれるが getter は null（正規化仕様）", () => {
    // set は透明性のため属性を verbatim で書くが、getter は非正値を「未指定」
    // として null に正規化する。set→get のラウンドトリップは正の有限値のみ保存する。
    const el = createAccelerometer();
    el.frequency = 0;
    expect(el.getAttribute("frequency")).toBe("0"); // attribute is written verbatim
    expect(el.frequency).toBeNull(); // but reads back as "unset"

    el.frequency = 60;
    expect(el.getAttribute("frequency")).toBe("60");
    expect(el.frequency).toBe(60); // positive finite value survives round-trip
  });

  it("非有限値の frequency setter 直接セットも getter が null に正規化する（NaN/Infinity）", () => {
    // setter は String(value) を書くだけなので getter 正規化と等価にカバーされる
    // が、プロパティ経路の契約を明示的に固定しておく。
    const el = createAccelerometer();
    el.frequency = NaN;
    expect(el.frequency).toBeNull();
    el.frequency = Infinity;
    expect(el.frequency).toBeNull();
  });

  it("frequency に null を set すると属性が除去される", () => {
    const el = createAccelerometer();
    el.frequency = 30;
    expect(el.getAttribute("frequency")).toBe("30");
    el.frequency = null;
    expect(el.hasAttribute("frequency")).toBe(false);
  });

  it("frequency に undefined を set するとマークアップに書かれた属性へ戻る（P1）", () => {
    const host = document.createElement("div");
    host.innerHTML = '<wcs-accelerometer frequency="10"></wcs-accelerometer>';
    const el = host.firstElementChild as WcsAccelerometer;
    el.frequency = 60;
    el.frequency = undefined;
    expect(el.getAttribute("frequency")).toBe("10");
    expect(el.frequency).toBe(10);
    el.frequency = null;
    expect(el.hasAttribute("frequency")).toBe(false);
    expect(el.frequency).toBeNull();

    // マークアップに属性が無ければ、undefined は属性なし（プラットフォーム既定）に戻す
    const bare = createAccelerometer();
    bare.frequency = 30;
    bare.frequency = undefined;
    expect(bare.hasAttribute("frequency")).toBe(false);
  });

  it("reading イベントで x/y/z が要素の値に伝わる", () => {
    const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
    const el = createAccelerometer();
    document.body.appendChild(el);
    el.start();

    handle.current!.emitReading({ x: 1, y: 2, z: 3 });

    expect(el.x).toBe(1);
    expect(el.y).toBe(2);
    expect(el.z).toBe(3);
  });

  it("stop() コマンドでセンサーが停止する", () => {
    const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
    const el = createAccelerometer();
    document.body.appendChild(el);
    el.start();
    const sensor = handle.current!;

    el.stop();

    expect(sensor.stopped).toBe(true);
  });

  it("非対応環境では start() しても例外を投げず error が unsupported になる", () => {
    removeSensor(GLOBAL_NAME);
    const el = createAccelerometer();
    document.body.appendChild(el);

    expect(() => el.start()).not.toThrow();
    expect(el.error).toEqual({ error: "unsupported", message: "Accelerometer is not supported" });
  });

  it("コンストラクタが同期的に例外を投げても never-throw が保たれる", () => {
    installThrowingSensor(GLOBAL_NAME, "SecurityError", "denied");
    const el = createAccelerometer();
    document.body.appendChild(el);

    expect(() => el.start()).not.toThrow();
    expect(el.error).toEqual({ error: "SecurityError", message: "denied" });
  });

  it("errorInfo が Shell ゲッター経由で Core から読み取れる", () => {
    removeSensor(GLOBAL_NAME);
    const el = createAccelerometer();
    document.body.appendChild(el);
    expect(el.errorInfo).toBeNull();
    el.start(); // 非対応 → capability-missing
    expect(el.errorInfo).toEqual({
      code: "capability-missing", phase: "probe", recoverable: false,
      message: "Accelerometer is not supported",
    });
  });

  it("disconnectedCallback でセンサーが停止し、再接続後に start() で再開できる", () => {
    const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
    const el = createAccelerometer();
    document.body.appendChild(el);
    el.start();
    const sensor = handle.current!;

    el.remove();
    expect(sensor.stopped).toBe(true);

    document.body.appendChild(el);
    el.start();
    expect(handle.current).not.toBe(sensor);
    expect(handle.current?.started).toBe(true);
  });

  it("inputs は frequency のみ、commands は requestPermission/start/stop", () => {
    expect(WcsAccelerometer.wcBindable.inputs).toEqual([{ name: "frequency" }]);
    expect(WcsAccelerometer.wcBindable.commands).toEqual([
      { name: "requestPermission", async: true }, { name: "start" }, { name: "stop" },
    ]);
  });

  describe("devicemotion フォールバック（Accelerometer クラスの無いブラウザ）", () => {
    it("start() コマンドで devicemotion を購読し、x/y/z が要素の値に伝わる。frequency 属性は間引きになる", () => {
      installDeviceMotionEvent();
      const el = createAccelerometer();
      el.frequency = 10;
      document.body.appendChild(el);

      el.start();
      emitDeviceMotion({ accelerationIncludingGravity: { x: 1, y: 2, z: 3 }, timeStamp: 1000 });
      emitDeviceMotion({ accelerationIncludingGravity: { x: 4, y: 5, z: 6 }, timeStamp: 1050 });
      expect(el.x).toBe(1);
      expect(el.y).toBe(2);
      expect(el.z).toBe(3);
      emitDeviceMotion({ accelerationIncludingGravity: { x: 7, y: 8, z: 9 }, timeStamp: 1100 });
      expect(el.x).toBe(7);
      expect(el.error).toBeNull();
    });

    it("stop() コマンドと切断で購読を外し、再接続後の start() で再開できる", () => {
      installDeviceMotionEvent();
      const el = createAccelerometer();
      document.body.appendChild(el);

      el.start();
      el.stop();
      emitDeviceMotion({ accelerationIncludingGravity: { x: 1, y: 1, z: 1 } });
      expect(el.x).toBeNull();

      el.start();
      el.remove();
      emitDeviceMotion({ accelerationIncludingGravity: { x: 2, y: 2, z: 2 } });
      expect(el.x).toBeNull();

      document.body.appendChild(el);
      el.start();
      emitDeviceMotion({ accelerationIncludingGravity: { x: 3, y: 3, z: 3 } });
      expect(el.x).toBe(3);
    });
  });

  describe("requestPermission コマンドと permissionState", () => {
    it("接続前の permissionState は 'unknown'", () => {
      expect(createAccelerometer().permissionState).toBe("unknown");
    });

    it("requestPermission() が Core に委譲され、permissionState と wcs-accelerometer:permission-changed に出る", async () => {
      const ask = installDeviceMotionEvent(() => Promise.resolve("granted"))!;
      const el = createAccelerometer();
      document.body.appendChild(el);
      const events: any[] = [];
      el.addEventListener("wcs-accelerometer:permission-changed", (e) => events.push((e as CustomEvent).detail));

      await expect(el.requestPermission()).resolves.toBe("granted");

      expect(ask).toHaveBeenCalledTimes(1);
      expect(el.permissionState).toBe("granted");
      expect(events).toEqual(["granted"]);
    });

    it("reject では permissionState は変わらず、error / errorInfo（recoverable=true）に出る", async () => {
      const refusal = new Error("needs a user gesture");
      refusal.name = "NotAllowedError";
      installDeviceMotionEvent(() => Promise.reject(refusal));
      const el = createAccelerometer();
      document.body.appendChild(el);

      await expect(el.requestPermission()).resolves.toBe("unknown");

      expect(el.permissionState).toBe("unknown");
      expect(el.error).toEqual({ error: "NotAllowedError", message: "needs a user gesture" });
      expect(el.errorInfo?.recoverable).toBe(true);
    });
  });

  describe("supported", () => {
    it("接続前から getter が今の値を返し、接続時に wcs-accelerometer:supported-changed を出す（再接続では出さない）", () => {
      installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const el = createAccelerometer();
      expect(el.supported).toBe(true);
      const events: any[] = [];
      el.addEventListener("wcs-accelerometer:supported-changed", (e) => events.push((e as CustomEvent).detail));

      document.body.appendChild(el);
      expect(events).toEqual([true]);

      el.remove();
      document.body.appendChild(el);
      expect(events).toEqual([true]);
    });

    it("フォールバックだけがある環境でも true", () => {
      installDeviceMotionEvent();
      const el = createAccelerometer();
      document.body.appendChild(el);
      expect(el.supported).toBe(true);
    });

    it("どちらの API も無い環境では false のままで、接続しても何も出さない", () => {
      const el = createAccelerometer();
      const events: any[] = [];
      el.addEventListener("wcs-accelerometer:supported-changed", (e) => events.push((e as CustomEvent).detail));
      document.body.appendChild(el);
      expect(el.supported).toBe(false);
      expect(events).toEqual([]);
    });

    it("接続してもセンサーは開始しない（supported を出すだけ）", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      installDeviceMotionEvent();
      const addSpy = vi.spyOn(window, "addEventListener");
      const el = createAccelerometer();
      document.body.appendChild(el);
      expect(handle.current).toBeUndefined();
      expect(addSpy).not.toHaveBeenCalledWith("devicemotion", expect.anything());
    });
  });

  describe("使えない frequency の警告（[wcs/frequency-invalid]）", () => {
    it("正の数にならない frequency 属性で start() すると、要素ごとに 1 回だけ警告する（開始は既定の頻度で続く）", () => {
      const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const el = createAccelerometer();
      el.setAttribute("frequency", "60hz");
      document.body.appendChild(el);

      el.start();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[@wcstack/accelerometer] [wcs/frequency-invalid] <wcs-accelerometer> frequency="60hz" is not a positive ' +
          "number of Hz: the sensor runs at the browser's default rate. Write a number, e.g. frequency=\"30\".",
        el,
      );
      expect(handle.current?.started).toBe(true);
      expect(handle.current?.options).toBeUndefined();

      el.stop();
      el.start();
      el.setAttribute("frequency", "0");
      el.stop();
      el.start();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("\"0\"・負の数も警告する。別の要素は別に 1 回", () => {
      installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      for (const value of ["0", "-5"]) {
        const el = createAccelerometer();
        el.setAttribute("frequency", value);
        document.body.appendChild(el);
        el.start();
        expect(warn).toHaveBeenLastCalledWith(expect.stringContaining(`frequency="${value}" is not a positive number of Hz`), el);
      }
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it("属性が無い・空・正の数のときは警告しない", () => {
      installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      for (const value of [null, "", "   ", "30", "0.5"]) {
        const el = createAccelerometer();
        if (value !== null) el.setAttribute("frequency", value);
        document.body.appendChild(el);
        el.start();
      }
      expect(warn).not.toHaveBeenCalled();
    });

    it("start() するまでは警告しない（属性を書いただけ・接続しただけでは言わない）", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const el = createAccelerometer();
      el.setAttribute("frequency", "fast");
      document.body.appendChild(el);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
