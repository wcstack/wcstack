import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapGeolocation } from "../src/bootstrapGeolocation";
import { setConfig } from "../src/config";
import { WcsGeolocation } from "../src/components/Geolocation";
import { unregisterAutoTrigger } from "../src/autoTrigger";
import {
  installGeolocation, removeGeolocation, installPermissions, removePermissions, makePosition,
} from "./mocks";

const flush = () => new Promise((r) => setTimeout(r, 0));

function createGeo(attrs: Record<string, string> = {}): WcsGeolocation {
  const el = document.createElement("wcs-geo") as WcsGeolocation;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

describe("Geolocation (Shell)", () => {
  beforeEach(() => {
    setConfig({ autoTrigger: false, triggerAttribute: "data-geotarget", tagNames: { geo: "wcs-geo" } });
    bootstrapGeolocation();
    removePermissions();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removeGeolocation();
    removePermissions();
  });

  it("接続時に display:none になり一発取得する（既定モード）", async () => {
    const mock = installGeolocation({ position: makePosition({ latitude: 1 }) });
    const el = createGeo();
    document.body.appendChild(el);

    expect(el.style.display).toBe("none");
    expect(mock.getCurrentPosition).toHaveBeenCalledTimes(1);
    await flush();
    expect(el.latitude).toBe(1);
  });

  it("hasConnectedCallbackPromise が true で、既定モードは接続時取得を connectedCallbackPromise で待てる", async () => {
    installGeolocation({ position: makePosition({ latitude: 5 }) });
    expect(WcsGeolocation.hasConnectedCallbackPromise).toBe(true);
    const el = createGeo();
    document.body.appendChild(el);

    // SSR(render.ts)が await する Promise。解決後には位置が確定している。
    await el.connectedCallbackPromise;
    expect(el.latitude).toBe(5);
  });

  it("watch / manual モードでは connectedCallbackPromise は即解決（接続時一発取得なし）", async () => {
    installGeolocation();
    const watchEl = createGeo({ watch: "" });
    document.body.appendChild(watchEl);
    await expect(watchEl.connectedCallbackPromise).resolves.toBeUndefined();

    const manualEl = createGeo({ manual: "" });
    document.body.appendChild(manualEl);
    await expect(manualEl.connectedCallbackPromise).resolves.toBeUndefined();
  });

  it("再接続時に既定モードでは再び一発取得する", async () => {
    const mock = installGeolocation({ position: makePosition({ latitude: 7 }) });
    const el = createGeo();
    document.body.appendChild(el);
    await flush();
    expect(mock.getCurrentPosition).toHaveBeenCalledTimes(1);

    el.remove();
    document.body.appendChild(el); // reconnect → 再取得
    await flush();
    expect(mock.getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it("timeout / maximumAge のセッターに NaN を渡しても既定値にフォールバックする", () => {
    const el = createGeo();
    el.timeout = NaN;
    expect(el.timeout).toBe(Infinity);
    el.maximumAge = NaN;
    expect(el.maximumAge).toBe(0);
  });

  it("timeout / maximumAge は厳密パース: 部分数値・負値・空文字は既定値", () => {
    const el = createGeo();
    // 部分数値 "10px" は parseInt なら 10 だが Number では NaN → 既定値
    el.setAttribute("timeout", "10px");
    expect(el.timeout).toBe(Infinity);
    el.setAttribute("maximum-age", "10px");
    expect(el.maximumAge).toBe(0);
    // 負値は既定値
    el.setAttribute("timeout", "-1");
    expect(el.timeout).toBe(Infinity);
    el.setAttribute("maximum-age", "-5");
    expect(el.maximumAge).toBe(0);
    // 空文字 / 空白は既定値
    el.setAttribute("timeout", "");
    expect(el.timeout).toBe(Infinity);
    el.setAttribute("maximum-age", "  ");
    expect(el.maximumAge).toBe(0);
    // 0 は有効値（maximum-age=0 は「キャッシュ不可」、timeout=0 は即時打ち切り）
    el.setAttribute("maximum-age", "0");
    expect(el.maximumAge).toBe(0);
    el.setAttribute("timeout", "0");
    expect(el.timeout).toBe(0);
  });

  it("切断時に Core.dispose が呼ばれ permission 購読が解除される", async () => {
    installGeolocation();
    const status = installPermissions({ state: "prompt" });
    const el = createGeo({ manual: "" });
    document.body.appendChild(el);
    await flush();
    expect(el.permission).toBe("prompt");

    el.remove(); // disconnect → Core.dispose（購読解除）
    // 解除済みなので change は反映されない
    status.change("granted");
    expect(el.permission).toBe("prompt");
  });

  it("watch 属性ありなら接続時に連続監視を開始する", () => {
    const mock = installGeolocation();
    const el = createGeo({ watch: "" });
    document.body.appendChild(el);

    expect(mock.watchPosition).toHaveBeenCalledTimes(1);
    expect(el.watching).toBe(true);
    mock.emitWatch(makePosition({ latitude: 42 }));
    expect(el.latitude).toBe(42);
  });

  it("manual では接続時に何も起動しない", () => {
    const mock = installGeolocation();
    const el = createGeo({ manual: "" });
    document.body.appendChild(el);

    expect(mock.getCurrentPosition).not.toHaveBeenCalled();
    expect(mock.watchPosition).not.toHaveBeenCalled();
  });

  it("切断時に clearWatch する", () => {
    const mock = installGeolocation();
    const el = createGeo({ watch: "" });
    document.body.appendChild(el);
    el.remove();

    expect(mock.clearWatch).toHaveBeenCalledTimes(1);
    expect(el.watching).toBe(false);
  });

  it("trigger プロパティの false→true 書き込みで一発取得する", async () => {
    const mock = installGeolocation({ position: makePosition({ latitude: 3 }) });
    const el = createGeo({ manual: "" });
    document.body.appendChild(el);

    const triggers: boolean[] = [];
    el.addEventListener("wcs-geo:trigger-changed", (e) => triggers.push((e as CustomEvent).detail));

    el.trigger = true;
    expect(el.trigger).toBe(false); // momentary
    expect(triggers).toEqual([false]);
    expect(mock.getCurrentPosition).toHaveBeenCalledTimes(1);
    await flush();
    expect(el.latitude).toBe(3);
  });

  it("trigger に falsy を書いても何も起きない", () => {
    const mock = installGeolocation();
    const el = createGeo({ manual: "" });
    document.body.appendChild(el);

    el.trigger = false;
    expect(mock.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("watchPosition / clearWatch コマンドが Core に委譲される", () => {
    const mock = installGeolocation();
    const el = createGeo({ manual: "" });
    document.body.appendChild(el);

    el.watchPosition();
    expect(mock.watchPosition).toHaveBeenCalledTimes(1);
    expect(el.watching).toBe(true);
    el.clearWatch();
    expect(mock.clearWatch).toHaveBeenCalledTimes(1);
  });

  it("位置オプション属性を PositionOptions として渡す", () => {
    const mock = installGeolocation();
    const el = createGeo({ manual: "", "high-accuracy": "", timeout: "5000", "maximum-age": "1000" });
    document.body.appendChild(el);

    el.getCurrentPosition();
    expect(mock.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 1000 },
    );
  });

  it("属性アクセサ: high-accuracy / watch / manual の get/set", () => {
    const el = createGeo();
    expect(el.highAccuracy).toBe(false);
    el.highAccuracy = true;
    expect(el.hasAttribute("high-accuracy")).toBe(true);
    el.highAccuracy = false;
    expect(el.hasAttribute("high-accuracy")).toBe(false);

    expect(el.watch).toBe(false);
    el.watch = true;
    expect(el.hasAttribute("watch")).toBe(true);
    el.watch = false;
    expect(el.hasAttribute("watch")).toBe(false);

    expect(el.manual).toBe(false);
    el.manual = true;
    expect(el.hasAttribute("manual")).toBe(true);
    el.manual = false;
    expect(el.hasAttribute("manual")).toBe(false);
  });

  it("timeout: 既定は Infinity、不正値は Infinity、有効値はそのまま", () => {
    const el = createGeo();
    expect(el.timeout).toBe(Infinity);
    el.setAttribute("timeout", "abc");
    expect(el.timeout).toBe(Infinity);
    el.timeout = 3000;
    expect(el.timeout).toBe(3000);
  });

  it("maximumAge: 既定は 0、不正値は 0、有効値はそのまま", () => {
    const el = createGeo();
    expect(el.maximumAge).toBe(0);
    el.setAttribute("maximum-age", "xyz");
    expect(el.maximumAge).toBe(0);
    el.maximumAge = 1500;
    expect(el.maximumAge).toBe(1500);
  });

  it("Core 委譲 getter が初期状態を返す", () => {
    const el = createGeo({ manual: "" });
    document.body.appendChild(el);
    expect(el.position).toBeNull();
    expect(el.latitude).toBeNull();
    expect(el.longitude).toBeNull();
    expect(el.accuracy).toBeNull();
    expect(el.coords).toBeNull();
    expect(el.timestamp).toBeNull();
    expect(el.loading).toBe(false);
    expect(el.error).toBeNull();
  });

  it("permission getter が Core の状態を反映する", async () => {
    removePermissions();
    installPermissions({ state: "granted" });
    const el = createGeo({ manual: "" });
    document.body.appendChild(el);
    await flush();
    expect(el.permission).toBe("granted");
  });

  it("切断→再接続後も permission change を追跡し続ける", async () => {
    installGeolocation();
    const status = installPermissions({ state: "prompt" });
    const el = createGeo({ manual: "" });
    document.body.appendChild(el);
    await flush();
    expect(el.permission).toBe("prompt");

    el.remove();                    // disconnect → dispose
    document.body.appendChild(el);  // reconnect → reinitPermission
    await flush();

    status.change("granted");
    expect(el.permission).toBe("granted");
  });

  it("config.autoTrigger が true なら接続時に autoTrigger を登録する", () => {
    installGeolocation();
    setConfig({ autoTrigger: true });
    const el = createGeo({ manual: "" });
    document.body.appendChild(el);
    // クリック委譲が登録されたことを、data-geotarget クリックで確認する
    const spy = vi.spyOn(el, "getCurrentPosition");
    el.id = "auto-on";
    const button = document.createElement("button");
    button.setAttribute("data-geotarget", "auto-on");
    document.body.appendChild(button);
    button.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("wcBindable: Shell は trigger プロパティと watchPosition コマンドを公開する", () => {
    const props = WcsGeolocation.wcBindable.properties.map((p) => p.name);
    expect(props).toContain("trigger");
    const commands = (WcsGeolocation.wcBindable.commands ?? []).map((c) => c.name);
    expect(commands).toEqual(["getCurrentPosition", "watchPosition", "clearWatch"]);
  });
});
