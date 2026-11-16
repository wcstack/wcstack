import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { bootstrapAmbientLightSensor } from "../src/bootstrapAmbientLightSensor";
import { setConfig } from "../src/config";
import { WcsAmbientLightSensor } from "../src/components/AmbientLightSensor";
import { installSensor, installThrowingSensor, removeSensor } from "./mocks";

const GLOBAL_NAME = "AmbientLightSensor";

function createAmbientLightSensor(): WcsAmbientLightSensor {
  return document.createElement("wcs-ambient-light-sensor") as WcsAmbientLightSensor;
}

describe("AmbientLightSensor (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { ambientLightSensor: "wcs-ambient-light-sensor" } });
    bootstrapAmbientLightSensor();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    removeSensor(GLOBAL_NAME);
    vi.restoreAllMocks();
  });

  it("接続時に display:none になる", () => {
    const el = createAmbientLightSensor();
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("接続だけではセンサーは開始しない（start は明示コマンド）", () => {
    const handle = installSensor(GLOBAL_NAME, { illuminance: 0 });
    const el = createAmbientLightSensor();
    document.body.appendChild(el);

    expect(handle.current).toBeUndefined();
  });

  it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する（SSR）", async () => {
    expect(WcsAmbientLightSensor.hasConnectedCallbackPromise).toBe(true);
    const el = createAmbientLightSensor();
    document.body.appendChild(el);
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
  });

  it("接続前の getter は既定値を返す", () => {
    const el = createAmbientLightSensor();
    expect(el.illuminance).toBeNull();
    expect(el.error).toBeNull();
  });

  it("start() コマンドでセンサーが開始し、frequency 属性がオプションに渡る", () => {
    const handle = installSensor(GLOBAL_NAME, { illuminance: 0 });
    const el = createAmbientLightSensor();
    el.frequency = 60;
    document.body.appendChild(el);

    el.start();

    expect(handle.current?.started).toBe(true);
    expect(handle.current?.options).toEqual({ frequency: 60 });
  });

  it("frequency 未設定なら getter は null、start() はオプション無しで呼ぶ", () => {
    const handle = installSensor(GLOBAL_NAME, { illuminance: 0 });
    const el = createAmbientLightSensor();
    expect(el.frequency).toBeNull();

    document.body.appendChild(el);
    el.start();

    expect(handle.current?.options).toBeUndefined();
  });

  it("frequency に不正値を設定すると null にフォールバックする", () => {
    const el = createAmbientLightSensor();
    el.setAttribute("frequency", "not-a-number");
    expect(el.frequency).toBeNull();
  });

  it("非正値・非有限値の frequency は getter が null に正規化する（0/負値/Infinity）", () => {
    const el = createAmbientLightSensor();
    el.setAttribute("frequency", "0");
    expect(el.frequency).toBeNull();
    el.setAttribute("frequency", "-5");
    expect(el.frequency).toBeNull();
    el.setAttribute("frequency", "Infinity");
    expect(el.frequency).toBeNull();
  });

  it("非有限値の frequency setter 直接セットも getter が null に正規化する（NaN/Infinity）", () => {
    // setter は String(value) を書くだけなので getter 正規化と等価にカバーされる
    // が、プロパティ経路の契約を明示的に固定しておく。
    const el = createAmbientLightSensor();
    el.frequency = NaN;
    expect(el.frequency).toBeNull();
    el.frequency = Infinity;
    expect(el.frequency).toBeNull();
  });

  it("frequency に null を set すると属性が除去される", () => {
    const el = createAmbientLightSensor();
    el.frequency = 30;
    expect(el.getAttribute("frequency")).toBe("30");
    el.frequency = null;
    expect(el.hasAttribute("frequency")).toBe(false);
  });

  it("frequency に undefined を set するとマークアップに書かれた属性へ戻る（P1）", () => {
    const host = document.createElement("div");
    host.innerHTML = '<wcs-ambient-light-sensor frequency="10"></wcs-ambient-light-sensor>';
    const el = host.firstElementChild as WcsAmbientLightSensor;
    el.frequency = 60;
    el.frequency = undefined;
    expect(el.getAttribute("frequency")).toBe("10");
    expect(el.frequency).toBe(10);
    el.frequency = null;
    expect(el.hasAttribute("frequency")).toBe(false);
    expect(el.frequency).toBeNull();

    // マークアップに属性が無ければ、undefined は属性なし（プラットフォーム既定）に戻す
    const bare = createAmbientLightSensor();
    bare.frequency = 30;
    bare.frequency = undefined;
    expect(bare.hasAttribute("frequency")).toBe(false);
  });

  it("reading イベントで illuminance が要素の値に伝わる", () => {
    const handle = installSensor(GLOBAL_NAME, { illuminance: 0 });
    const el = createAmbientLightSensor();
    document.body.appendChild(el);
    el.start();

    handle.current!.emitReading({ illuminance: 42 });

    expect(el.illuminance).toBe(42);
  });

  it("stop() コマンドでセンサーが停止する", () => {
    const handle = installSensor(GLOBAL_NAME, { illuminance: 0 });
    const el = createAmbientLightSensor();
    document.body.appendChild(el);
    el.start();
    const sensor = handle.current!;

    el.stop();

    expect(sensor.stopped).toBe(true);
  });

  it("非対応環境では start() しても例外を投げず error が unsupported になる", () => {
    removeSensor(GLOBAL_NAME);
    const el = createAmbientLightSensor();
    document.body.appendChild(el);

    expect(() => el.start()).not.toThrow();
    expect(el.error).toEqual({ error: "unsupported", message: "AmbientLightSensor is not supported" });
  });

  it("コンストラクタが同期的に例外を投げても never-throw が保たれる", () => {
    installThrowingSensor(GLOBAL_NAME, "SecurityError", "denied");
    const el = createAmbientLightSensor();
    document.body.appendChild(el);

    expect(() => el.start()).not.toThrow();
    expect(el.error).toEqual({ error: "SecurityError", message: "denied" });
  });

  it("errorInfo が Shell ゲッター経由で Core から読み取れる", () => {
    removeSensor(GLOBAL_NAME);
    const el = createAmbientLightSensor();
    document.body.appendChild(el);
    expect(el.errorInfo).toBeNull();
    el.start(); // 非対応 → capability-missing
    expect(el.errorInfo).toEqual({
      code: "capability-missing", phase: "probe", recoverable: false,
      message: "AmbientLightSensor is not supported",
    });
  });

  it("disconnectedCallback でセンサーが停止し、再接続後に start() で再開できる", () => {
    const handle = installSensor(GLOBAL_NAME, { illuminance: 0 });
    const el = createAmbientLightSensor();
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

  it("inputs は frequency のみ、commands は start/stop", () => {
    expect(WcsAmbientLightSensor.wcBindable.inputs).toEqual([{ name: "frequency" }]);
    expect(WcsAmbientLightSensor.wcBindable.commands).toEqual([{ name: "start" }, { name: "stop" }]);
  });

  describe("supported", () => {
    it("接続前から getter が今の値を返し、接続時に wcs-ambient-light-sensor:supported-changed を出す（再接続では出さない）", () => {
      installSensor(GLOBAL_NAME, { illuminance: 0 });
      const el = createAmbientLightSensor();
      expect(el.supported).toBe(true);
      const events: any[] = [];
      el.addEventListener("wcs-ambient-light-sensor:supported-changed", (e) => events.push((e as CustomEvent).detail));

      document.body.appendChild(el);
      expect(events).toEqual([true]);

      el.remove();
      document.body.appendChild(el);
      expect(events).toEqual([true]);
    });

    it("AmbientLightSensor クラスの無い環境では false のままで、接続しても何も出さない", () => {
      const el = createAmbientLightSensor();
      const events: any[] = [];
      el.addEventListener("wcs-ambient-light-sensor:supported-changed", (e) => events.push((e as CustomEvent).detail));
      document.body.appendChild(el);
      expect(el.supported).toBe(false);
      expect(events).toEqual([]);
    });

    it("接続してもセンサーは開始しない（supported を出すだけ）", () => {
      const handle = installSensor(GLOBAL_NAME, { illuminance: 0 });
      const el = createAmbientLightSensor();
      document.body.appendChild(el);
      expect(handle.current).toBeUndefined();
    });
  });

  describe("使えない frequency の警告（[wcs/frequency-invalid]）", () => {
    it("正の数にならない frequency 属性で start() すると、要素ごとに 1 回だけ警告する（開始は既定の頻度で続く）", () => {
      const handle = installSensor(GLOBAL_NAME, { illuminance: 0 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const el = createAmbientLightSensor();
      el.setAttribute("frequency", "60hz");
      document.body.appendChild(el);

      el.start();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[@wcstack/ambient-light-sensor] [wcs/frequency-invalid] <wcs-ambient-light-sensor> frequency="60hz" is not a positive ' +
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
      installSensor(GLOBAL_NAME, { illuminance: 0 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      for (const value of ["0", "-5"]) {
        const el = createAmbientLightSensor();
        el.setAttribute("frequency", value);
        document.body.appendChild(el);
        el.start();
        expect(warn).toHaveBeenLastCalledWith(expect.stringContaining(`frequency="${value}" is not a positive number of Hz`), el);
      }
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it("属性が無い・空・正の数のときは警告しない", () => {
      installSensor(GLOBAL_NAME, { illuminance: 0 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      for (const value of [null, "", "   ", "30", "0.5"]) {
        const el = createAmbientLightSensor();
        if (value !== null) el.setAttribute("frequency", value);
        document.body.appendChild(el);
        el.start();
      }
      expect(warn).not.toHaveBeenCalled();
    });

    it("start() するまでは警告しない（属性を書いただけ・接続しただけでは言わない）", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const el = createAmbientLightSensor();
      el.setAttribute("frequency", "fast");
      document.body.appendChild(el);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
