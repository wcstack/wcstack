import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapScreenOrientation } from "../src/bootstrapScreenOrientation";
import { setConfig } from "../src/config";
import { WcsScreenOrientation } from "../src/components/ScreenOrientation";
import { installOrientation, removeOrientation } from "./mocks";

function createScreenOrientation(): WcsScreenOrientation {
  return document.createElement("wcs-screen-orientation") as WcsScreenOrientation;
}

describe("ScreenOrientation (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { screenOrientation: "wcs-screen-orientation" } });
    bootstrapScreenOrientation();
    removeOrientation();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removeOrientation();
  });

  it("接続時に display:none になり、既存 orientation の値を反映する", () => {
    installOrientation({ type: "landscape-primary", angle: 90 });
    const el = createScreenOrientation();
    document.body.appendChild(el);

    expect(el.style.display).toBe("none");
    expect(el.type).toBe("landscape-primary");
    expect(el.angle).toBe(90);
    expect(el.landscape).toBe(true);
  });

  it("portrait-primary 接続時に el.portrait が true になる（Shell 委譲の検証）", () => {
    installOrientation({ type: "portrait-primary", angle: 0 });
    const el = createScreenOrientation();
    document.body.appendChild(el);

    expect(el.portrait).toBe(true);
  });

  it("接続前の getter は既定値を返す", () => {
    const el = createScreenOrientation();
    expect(el.type).toBeNull();
    expect(el.angle).toBeNull();
    expect(el.portrait).toBe(false);
    expect(el.landscape).toBe(false);
    expect(el.error).toBeNull();
  });

  it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する（SSR）", async () => {
    installOrientation({ type: "portrait-primary" });
    expect(WcsScreenOrientation.hasConnectedCallbackPromise).toBe(true);
    const el = createScreenOrientation();
    document.body.appendChild(el);

    await el.connectedCallbackPromise;
    expect(el.type).toBe("portrait-primary");
  });

  it("非対応環境では type/angle が null のまま", async () => {
    removeOrientation();
    const el = createScreenOrientation();
    document.body.appendChild(el);
    await el.connectedCallbackPromise;
    expect(el.type).toBeNull();
  });

  it("live change が要素の値に伝わる", () => {
    const orientation = installOrientation({ type: "portrait-primary" });
    const el = createScreenOrientation();
    document.body.appendChild(el);

    orientation.change({ type: "landscape-primary" });
    expect(el.type).toBe("landscape-primary");
    expect(el.landscape).toBe(true);
  });

  it("切断で change 購読を解除し、再接続で再度反映する", () => {
    const orientation = installOrientation({ type: "portrait-primary" });
    const el = createScreenOrientation();
    document.body.appendChild(el);
    expect(el.type).toBe("portrait-primary");

    el.remove();
    orientation.change({ type: "landscape-primary" });
    expect(el.type).toBe("portrait-primary"); // 切断後は追従しない

    const orientation2 = installOrientation({ type: "landscape-secondary" });
    document.body.appendChild(el); // reconnect
    expect(el.type).toBe("landscape-secondary");

    orientation2.change({ type: "portrait-secondary" });
    expect(el.type).toBe("portrait-secondary");
  });

  it("lock()/unlock() コマンドが Core に委譲される", async () => {
    const orientation = installOrientation();
    const el = createScreenOrientation();
    document.body.appendChild(el);

    await el.lock("landscape");
    expect(orientation.lock).toHaveBeenCalledWith("landscape");

    el.unlock();
    expect(orientation.unlock).toHaveBeenCalled();
  });

  it("lock() 失敗時に el.error が非null になる（Shell 委譲の検証）", async () => {
    const orientation = installOrientation();
    orientation.lock = vi.fn(() => Promise.reject({ name: "NotSupportedError", message: "not supported" }));
    const el = createScreenOrientation();
    document.body.appendChild(el);

    await el.lock("landscape");

    expect(el.error).not.toBeNull();
  });

  it("inputs は空（属性を持たない、バッチ中最小の Shell）", () => {
    expect(WcsScreenOrientation.wcBindable.inputs).toEqual([]);
  });

  it("commands は Core から継承した lock/unlock", () => {
    const names = WcsScreenOrientation.wcBindable.commands!.map((c) => c.name);
    expect(names).toEqual(["lock", "unlock"]);
  });
});
