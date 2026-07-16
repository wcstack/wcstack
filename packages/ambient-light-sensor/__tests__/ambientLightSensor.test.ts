import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  it("frequency に null/undefined を set すると属性が除去される", () => {
    const el = createAmbientLightSensor();
    el.frequency = 30;
    expect(el.getAttribute("frequency")).toBe("30");
    el.frequency = null;
    expect(el.hasAttribute("frequency")).toBe(false);
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
});
