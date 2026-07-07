import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapTilt } from "../src/bootstrapTilt";
import { setConfig } from "../src/config";
import { WcsTilt } from "../src/components/Tilt";
import { installRequestPermission, removeRequestPermission, emitDeviceOrientation } from "./mocks";

function createTilt(): WcsTilt {
  return document.createElement("wcs-tilt") as WcsTilt;
}

describe("Tilt (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { tilt: "wcs-tilt" } });
    bootstrapTilt();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removeRequestPermission();
  });

  it("接続時に display:none になる", () => {
    const el = createTilt();
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("接続前の getter は既定値を返す", () => {
    const el = createTilt();
    expect(el.alpha).toBeNull();
    expect(el.beta).toBeNull();
    expect(el.gamma).toBeNull();
    expect(el.absolute).toBeNull();
    expect(el.permissionState).toBe("unknown");
    expect(el.error).toBeNull();
  });

  it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する（SSR）", async () => {
    expect(WcsTilt.hasConnectedCallbackPromise).toBe(true);
    const el = createTilt();
    document.body.appendChild(el);
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
  });

  it("接続しても start() を自動的に呼ばない", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const el = createTilt();
    document.body.appendChild(el);
    expect(addSpy).not.toHaveBeenCalledWith("deviceorientation", expect.anything());
  });

  it("requestPermission()/start()/stop() が Core に委譲される", async () => {
    const fn = installRequestPermission(() => Promise.resolve("granted"));
    const el = createTilt();
    document.body.appendChild(el);

    await el.requestPermission();
    expect(fn).toHaveBeenCalled();

    el.start();
    emitDeviceOrientation({ alpha: 5, beta: 6, gamma: 7 });
    expect(el.alpha).toBe(5);

    el.stop();
    emitDeviceOrientation({ alpha: 99, beta: 99, gamma: 99 });
    expect(el.alpha).toBe(5); // stop 後は反映されない
  });

  it("beta/gamma/absolute/permissionState の getter が Core の値に委譲される", async () => {
    const fn = installRequestPermission(() => Promise.resolve("granted"));
    const el = createTilt();
    document.body.appendChild(el);

    el.start();
    emitDeviceOrientation({ alpha: 5, beta: 6, gamma: 7, absolute: true });
    expect(el.beta).toBe(6);
    expect(el.gamma).toBe(7);
    expect(el.absolute).toBe(true);

    await el.requestPermission();
    expect(fn).toHaveBeenCalled();
    expect(el.permissionState).toBe("granted");
  });

  it("requestPermission() の reject が error getter に委譲される", async () => {
    installRequestPermission(() => Promise.reject(new Error("not in a user gesture")));
    const el = createTilt();
    document.body.appendChild(el);

    await el.requestPermission();
    expect(el.error).not.toBeNull();
  });

  it("切断で dispose される", () => {
    const el = createTilt();
    document.body.appendChild(el);
    el.start();
    el.remove();

    emitDeviceOrientation({ alpha: 1, beta: 1, gamma: 1 });
    expect(el.alpha).toBeNull();
  });

  it("wcBindable: inputs は空、commands は Core を継承する", () => {
    expect(WcsTilt.wcBindable.inputs).toEqual([]);
    expect(WcsTilt.wcBindable.commands!.map((c) => c.name)).toEqual(["requestPermission", "start", "stop"]);
  });
});
