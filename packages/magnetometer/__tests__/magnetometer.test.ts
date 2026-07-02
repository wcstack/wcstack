import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bootstrapMagnetometer } from "../src/bootstrapMagnetometer";
import { setConfig } from "../src/config";
import { WcsMagnetometer } from "../src/components/Magnetometer";
import { installSensor, installThrowingSensor, removeSensor } from "./mocks";

const GLOBAL_NAME = "Magnetometer";

function createMagnetometer(): WcsMagnetometer {
  return document.createElement("wcs-magnetometer") as WcsMagnetometer;
}

describe("Magnetometer (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { magnetometer: "wcs-magnetometer" } });
    bootstrapMagnetometer();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    removeSensor(GLOBAL_NAME);
  });

  it("接続時に display:none になる", () => {
    const el = createMagnetometer();
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("接続だけではセンサーは開始しない（start は明示コマンド）", () => {
    const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
    const el = createMagnetometer();
    document.body.appendChild(el);

    expect(handle.current).toBeUndefined();
  });

  it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する（SSR）", async () => {
    expect(WcsMagnetometer.hasConnectedCallbackPromise).toBe(true);
    const el = createMagnetometer();
    document.body.appendChild(el);
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
  });

  it("接続前の getter は既定値を返す", () => {
    const el = createMagnetometer();
    expect(el.x).toBeNull();
    expect(el.y).toBeNull();
    expect(el.z).toBeNull();
    expect(el.error).toBeNull();
  });

  it("start() コマンドでセンサーが開始し、frequency 属性がオプションに渡る", () => {
    const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
    const el = createMagnetometer();
    el.frequency = 60;
    document.body.appendChild(el);

    el.start();

    expect(handle.current?.started).toBe(true);
    expect(handle.current?.options).toEqual({ frequency: 60 });
  });

  it("frequency 未設定なら getter は null、start() はオプション無しで呼ぶ", () => {
    const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
    const el = createMagnetometer();
    expect(el.frequency).toBeNull();

    document.body.appendChild(el);
    el.start();

    expect(handle.current?.options).toBeUndefined();
  });

  it("frequency に不正値を設定すると null にフォールバックする", () => {
    const el = createMagnetometer();
    el.setAttribute("frequency", "not-a-number");
    expect(el.frequency).toBeNull();
  });

  it("frequency に null/undefined を set すると属性が除去される", () => {
    const el = createMagnetometer();
    el.frequency = 30;
    expect(el.getAttribute("frequency")).toBe("30");
    el.frequency = null;
    expect(el.hasAttribute("frequency")).toBe(false);
  });

  it("reading イベントで x/y/z が要素の値に伝わる", () => {
    const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
    const el = createMagnetometer();
    document.body.appendChild(el);
    el.start();

    handle.current!.emitReading({ x: 1, y: 2, z: 3 });

    expect(el.x).toBe(1);
    expect(el.y).toBe(2);
    expect(el.z).toBe(3);
  });

  it("stop() コマンドでセンサーが停止する", () => {
    const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
    const el = createMagnetometer();
    document.body.appendChild(el);
    el.start();
    const sensor = handle.current!;

    el.stop();

    expect(sensor.stopped).toBe(true);
  });

  it("非対応環境では start() しても例外を投げず error が unsupported になる", () => {
    removeSensor(GLOBAL_NAME);
    const el = createMagnetometer();
    document.body.appendChild(el);

    expect(() => el.start()).not.toThrow();
    expect(el.error).toEqual({ error: "unsupported", message: "Magnetometer is not supported" });
  });

  it("コンストラクタが同期的に例外を投げても never-throw が保たれる", () => {
    installThrowingSensor(GLOBAL_NAME, "SecurityError", "denied");
    const el = createMagnetometer();
    document.body.appendChild(el);

    expect(() => el.start()).not.toThrow();
    expect(el.error).toEqual({ error: "SecurityError", message: "denied" });
  });

  it("disconnectedCallback でセンサーが停止し、再接続後に start() で再開できる", () => {
    const handle = installSensor(GLOBAL_NAME, { x: 0, y: 0, z: 0 });
    const el = createMagnetometer();
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
    expect(WcsMagnetometer.wcBindable.inputs).toEqual([{ name: "frequency" }]);
    expect(WcsMagnetometer.wcBindable.commands).toEqual([{ name: "start" }, { name: "stop" }]);
  });
});
