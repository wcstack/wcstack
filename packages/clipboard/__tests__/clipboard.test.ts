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

  it("monitor 属性ありなら接続時に監視を開始する", async () => {
    const el = createClipboard({ monitor: "" });
    document.body.appendChild(el);
    await flush();
    expect(el.monitoring).toBe(true);

    dispatchPaste("hi");
    expect(el.pasted).toBe("hi");
  });

  it("monitor 属性なしでは監視を開始しない", async () => {
    const el = createClipboard();
    document.body.appendChild(el);
    await flush();
    expect(el.monitoring).toBe(false);
  });

  it("切断時に stopMonitor と dispose が呼ばれる", async () => {
    const el = createClipboard({ monitor: "" });
    document.body.appendChild(el);
    await flush();
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

  it("monitor 属性付き要素は切断→再接続で監視を再開する", async () => {
    const el = createClipboard({ monitor: "" });
    document.body.appendChild(el);
    await flush();
    expect(el.monitoring).toBe(true);

    el.remove(); // disconnect → stopMonitor
    expect(el.monitoring).toBe(false);

    document.body.appendChild(el); // reconnect → connectedCallback で監視再開
    await flush();
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

  it("monitor の undefined はマークアップに書かれた属性へ戻し、null は属性を外す（P1 / P2）", () => {
    const host = document.createElement("div");
    host.innerHTML = '<wcs-clipboard monitor></wcs-clipboard>';
    const el = host.firstElementChild as WcsClipboard;
    el.monitor = false;
    el.monitor = undefined;
    expect(el.monitor).toBe(true);
    el.monitor = null;
    expect(el.hasAttribute("monitor")).toBe(false);

    // マークアップに無ければ undefined は属性なしのまま
    const plain = createClipboard();
    plain.monitor = true;
    plain.monitor = undefined;
    expect(plain.hasAttribute("monitor")).toBe(false);
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

  // router は遷移で同じノードを入れ直し、state は新しい params からの入力をマイクロタスクで書く
  // （timing-and-firing-contract §23、docs/seam-apps.md の shift-desk）
  describe("接続時の監視の判断はマイクロタスクで、そのときの monitor で", () => {
    function recordMonitoring(el: WcsClipboard): boolean[] {
      const seen: boolean[] = [];
      el.addEventListener("wcs-clipboard:monitoring-changed", (e) => seen.push((e as CustomEvent).detail));
      return seen;
    }

    it("入れ直しの間に monitor が外されると、前の monitor で監視を始めない", async () => {
      const el = createClipboard({ monitor: "" });
      document.body.appendChild(el);
      await flush();
      expect(el.monitoring).toBe(true);
      const seen = recordMonitoring(el);

      // state のマイクロタスクは、router が中身を入れ直す前に積まれている
      queueMicrotask(() => { el.monitor = false; });
      el.remove();
      document.body.appendChild(el);
      await flush();
      expect(el.monitoring).toBe(false);
      expect(seen).toEqual([false]); // 切断で止まったきり、始まらない
      dispatchPaste("stale");
      expect(el.pasted).toBeNull();
    });

    it("入れ直しの間に monitor が付くと、新しい monitor で監視を始める", async () => {
      const el = createClipboard();
      document.body.appendChild(el);
      await flush();
      expect(el.monitoring).toBe(false);

      queueMicrotask(() => { el.monitor = true; });
      el.remove();
      document.body.appendChild(el);
      await flush();
      expect(el.monitoring).toBe(true);
      dispatchPaste("fresh");
      expect(el.pasted).toBe("fresh");
    });

    it("判断の前に外した要素は監視を始めない", async () => {
      const el = createClipboard({ monitor: "" });
      const seen = recordMonitoring(el);
      document.body.appendChild(el);
      el.remove();
      await flush();
      expect(el.monitoring).toBe(false);
      expect(seen).toEqual([]);
    });

    it("同じタスクで append の後に書かれた monitor が守られる", async () => {
      const off = createClipboard({ monitor: "" });
      const seenOff = recordMonitoring(off);
      document.body.appendChild(off);
      off.monitor = false;
      const on = createClipboard();
      document.body.appendChild(on);
      on.monitor = true;
      await flush();
      expect(off.monitoring).toBe(false);
      expect(seenOff).toEqual([]);
      expect(on.monitoring).toBe(true);
    });

    it("同じタスクの remove → append は 1 回だけ監視を始める", async () => {
      const el = createClipboard({ monitor: "" });
      const seen = recordMonitoring(el);
      document.body.appendChild(el);
      el.remove();
      document.body.appendChild(el);
      await flush();
      expect(el.monitoring).toBe(true);
      expect(seen).toEqual([true]);
    });

    it("同じタスクで append の後に stopMonitor() されると、監視を始めない", async () => {
      const el = createClipboard({ monitor: "" });
      const seen = recordMonitoring(el);
      document.body.appendChild(el);
      el.stopMonitor();
      await flush();
      expect(el.monitoring).toBe(false);
      expect(seen).toEqual([]);
      dispatchPaste("ignored");
      expect(el.pasted).toBeNull();
    });

    it("stopMonitor() の後、同じタスクで入れ直すと、その接続の監視は 1 回だけ始める", async () => {
      const el = createClipboard({ monitor: "" });
      const seen = recordMonitoring(el);
      document.body.appendChild(el);
      el.stopMonitor();
      el.remove();
      document.body.appendChild(el);
      await flush();
      expect(el.monitoring).toBe(true);
      expect(seen).toEqual([true]);
    });
  });
});
