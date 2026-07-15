import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapClipboard } from "../src/bootstrapClipboard";
import { setConfig } from "../src/config";
import { WcsClipboard } from "../src/components/Clipboard";
import { unregisterAutoTrigger } from "../src/autoTrigger";
import {
  installClipboard, removeClipboard, installPermissions, removePermissions,
  makeClipboardItem, dispatchPaste, mockSelection,
} from "./mocks";

const flush = () => new Promise((r) => setTimeout(r, 0));

function createClipboard(attrs: Record<string, string> = {}): WcsClipboard {
  const el = document.createElement("wcs-clipboard") as WcsClipboard;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

describe("Clipboard (Shell)", () => {
  beforeEach(() => {
    setConfig({ autoTrigger: false, triggerAttribute: "data-clipboardtarget", tagNames: { clipboard: "wcs-clipboard" } });
    bootstrapClipboard();
    removePermissions();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removeClipboard();
    removePermissions();
  });

  it("接続時に display:none になる", () => {
    const el = createClipboard();
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("monitor 属性ありなら接続時に監視を開始する", () => {
    const el = createClipboard({ monitor: "" });
    document.body.appendChild(el);
    expect(el.monitoring).toBe(true);

    dispatchPaste("hi");
    expect(el.pasted).toBe("hi");
  });

  it("monitor 属性なしでは監視を開始しない", () => {
    const el = createClipboard();
    document.body.appendChild(el);
    expect(el.monitoring).toBe(false);
  });

  it("切断時に stopMonitor と dispose が呼ばれる", () => {
    const el = createClipboard({ monitor: "" });
    document.body.appendChild(el);
    expect(el.monitoring).toBe(true);

    el.remove();
    expect(el.monitoring).toBe(false);
    // 監視解除済みなので paste は反映されない
    dispatchPaste("after");
    expect(el.pasted).toBeNull();
  });

  it("切断時に permission 購読が解除される", async () => {
    const status = installPermissions({ state: "prompt" });
    const el = createClipboard();
    document.body.appendChild(el);
    await flush();
    expect(el.readPermission).toBe("prompt");

    el.remove();
    status.change("granted");
    expect(el.readPermission).toBe("prompt");
  });

  it("切断→再接続後も permission change を追跡し続ける", async () => {
    const status = installPermissions({ state: "prompt" });
    const el = createClipboard();
    document.body.appendChild(el);
    await flush();
    expect(el.readPermission).toBe("prompt");

    el.remove();
    document.body.appendChild(el); // reconnect → reinitPermission
    await flush();

    status.change("granted");
    expect(el.readPermission).toBe("granted");
  });

  it("monitor 属性付き要素は切断→再接続で監視を再開する", () => {
    const el = createClipboard({ monitor: "" });
    document.body.appendChild(el);
    expect(el.monitoring).toBe(true);

    el.remove(); // disconnect → stopMonitor
    expect(el.monitoring).toBe(false);

    document.body.appendChild(el); // reconnect → connectedCallback で監視再開
    expect(el.monitoring).toBe(true);
    // 再開した監視で paste が反映される
    dispatchPaste("again");
    expect(el.pasted).toBe("again");
  });

  it("monitor 属性アクセサの get/set", () => {
    const el = createClipboard();
    expect(el.monitor).toBe(false);
    el.monitor = true;
    expect(el.hasAttribute("monitor")).toBe(true);
    el.monitor = false;
    expect(el.hasAttribute("monitor")).toBe(false);
  });

  it("Core 委譲 getter が初期状態を返す", () => {
    const el = createClipboard();
    document.body.appendChild(el);
    expect(el.text).toBeNull();
    expect(el.items).toBeNull();
    expect(el.loading).toBe(false);
    expect(el.error).toBeNull();
    expect(el.monitoring).toBe(false);
    expect(el.copied).toBeNull();
    expect(el.cut).toBeNull();
    expect(el.pasted).toBeNull();
  });

  it("writeText / write コマンドが Core に委譲される", async () => {
    const mock = installClipboard();
    const el = createClipboard();
    document.body.appendChild(el);

    await el.writeText("hello");
    expect(mock.writeText).toHaveBeenCalledWith("hello");

    const item = makeClipboardItem({ "text/plain": "x" });
    await el.write([item]);
    expect(mock.write).toHaveBeenCalledWith([item]);
  });

  it("errorInfo は Core から転送される（NotAllowedError）", async () => {
    installClipboard({ writeError: new DOMException("denied", "NotAllowedError") });
    removePermissions();
    const el = createClipboard();
    document.body.appendChild(el);
    await el.writeText("x");
    expect(el.errorInfo).toEqual({ code: "not-allowed", phase: "execute", recoverable: false, message: "denied" });
  });

  it("readText / read コマンドが Core に委譲される", async () => {
    const item = makeClipboardItem({ "text/plain": "rich" });
    installClipboard({ readText: "plain read", readItems: [item] });
    const el = createClipboard();
    document.body.appendChild(el);

    await el.readText();
    expect(el.text).toBe("plain read");

    await el.read();
    expect(el.items).toHaveLength(1);
    expect(el.text).toBe("rich");
  });

  it("startMonitor / stopMonitor コマンドが Core に委譲される", () => {
    const el = createClipboard();
    document.body.appendChild(el);

    el.startMonitor();
    expect(el.monitoring).toBe(true);
    mockSelection("sel");
    document.dispatchEvent(new Event("copy", { bubbles: true }));
    expect(el.copied).toBe("sel");

    el.stopMonitor();
    expect(el.monitoring).toBe(false);
  });

  it("permission getter が Core の状態を反映する", async () => {
    installPermissions({ state: "granted" });
    const el = createClipboard();
    document.body.appendChild(el);
    await flush();
    expect(el.readPermission).toBe("granted");
    expect(el.writePermission).toBe("granted");
  });

  it("SSR: connectedCallbackPromise が解決し hasConnectedCallbackPromise=true", async () => {
    installPermissions({ state: "granted" });
    const el = createClipboard();
    document.body.appendChild(el);

    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    expect((el.constructor as typeof WcsClipboard).hasConnectedCallbackPromise).toBe(true);
    // observe() 経由でプローブが解決し permission が反映されている
    expect(el.readPermission).toBe("granted");
    el.remove();
  });

  it("config.autoTrigger が true なら接続時に autoTrigger を登録する", () => {
    installClipboard();
    setConfig({ autoTrigger: true });
    const el = createClipboard();
    el.id = "auto-on";
    document.body.appendChild(el);

    const spy = vi.spyOn(el, "writeText");
    const button = document.createElement("button");
    button.setAttribute("data-clipboardtarget", "auto-on");
    button.setAttribute("data-clipboard-text", "viaAuto");
    document.body.appendChild(button);
    button.click();
    expect(spy).toHaveBeenCalledWith("viaAuto");
  });

  it("wcBindable: Shell は monitor input と全コマンドを公開する", () => {
    const inputs = (WcsClipboard.wcBindable.inputs ?? []).map((i) => i.name);
    expect(inputs).toEqual(["monitor"]);
    const commands = (WcsClipboard.wcBindable.commands ?? []).map((c) => c.name);
    expect(commands).toEqual([
      "writeText", "write", "readText", "read", "startMonitor", "stopMonitor",
    ]);
  });
});
