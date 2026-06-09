import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { WcsWakeLock } from "../src/components/WakeLock.js";
import {
  installWakeLock,
  installVisibility,
  WakeLockControl,
} from "./mocks.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  if (!customElements.get("wcs-wakelock")) {
    customElements.define("wcs-wakelock", WcsWakeLock);
  }
});

describe("<wcs-wakelock>", () => {
  let teardownVisibility: () => void;
  let wl: WakeLockControl;

  beforeEach(() => {
    teardownVisibility = installVisibility("visible");
    wl = installWakeLock();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    wl.restore();
    teardownVisibility();
  });

  function make(attrs: Record<string, string> = {}): WcsWakeLock {
    const el = document.createElement("wcs-wakelock") as WcsWakeLock;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  it("active 付きで接続するとロックを取得し display:none になる", async () => {
    const el = make({ active: "" });
    document.body.append(el);
    await flush();
    expect(el.held).toBe(true);
    expect(el.style.display).toBe("none");
    expect(wl.request).toHaveBeenCalledTimes(1);
  });

  it("active 無しで接続しても取得しない", async () => {
    const el = make();
    document.body.append(el);
    await flush();
    expect(el.held).toBe(false);
    expect(wl.request).toHaveBeenCalledTimes(0);
  });

  it("manual + active では接続時に自動取得しない", async () => {
    const el = make({ active: "", manual: "" });
    document.body.append(el);
    await flush();
    expect(el.held).toBe(false);
    expect(wl.request).toHaveBeenCalledTimes(0);
  });

  it("接続後に active 属性を付けると取得、外すと解放する", async () => {
    const el = make();
    document.body.append(el);
    await flush();

    el.setAttribute("active", "");
    await flush();
    expect(el.held).toBe(true);

    el.removeAttribute("active");
    await flush();
    expect(el.held).toBe(false);
  });

  it("active プロパティの setter で属性をミラーする", () => {
    const el = make();
    el.active = true;
    expect(el.hasAttribute("active")).toBe(true);
    expect(el.active).toBe(true);
    el.active = false;
    expect(el.hasAttribute("active")).toBe(false);
    expect(el.active).toBe(false);
  });

  it("type の getter/setter（既定 screen）", () => {
    const el = make();
    expect(el.type).toBe("screen");
    el.type = "screen";
    expect(el.getAttribute("type")).toBe("screen");
  });

  it("接続後に type 属性を変更しても throw せず取得は screen のまま", async () => {
    const el = make({ active: "" });
    document.body.append(el);
    await flush();
    el.setAttribute("type", "screen");
    await flush();
    expect(el.type).toBe("screen");
    expect(wl.request).toHaveBeenCalledWith("screen");
  });

  it("manual プロパティの setter で属性をミラーする", () => {
    const el = make();
    el.manual = true;
    expect(el.hasAttribute("manual")).toBe(true);
    expect(el.manual).toBe(true);
    el.manual = false;
    expect(el.manual).toBe(false);
  });

  it("接続前の属性変更は無視される（detached でロックを取らない）", async () => {
    const el = make();
    el.setAttribute("active", ""); // まだ未接続 → 取得しない
    await flush();
    expect(wl.request).toHaveBeenCalledTimes(0);

    document.body.append(el); // 接続で初期状態を適用 → 取得
    await flush();
    expect(el.held).toBe(true);
    expect(wl.request).toHaveBeenCalledTimes(1);
  });

  it("同値の attributeChangedCallback は no-op", () => {
    const el = make();
    document.body.append(el);
    // 直接呼び出して old===new 早期 return を踏む。
    expect(() => el.attributeChangedCallback("active", "", "")).not.toThrow();
  });

  it("切断するとロックを解放する", async () => {
    const el = make({ active: "" });
    document.body.append(el);
    await flush();
    const sentinel = wl.last()!;
    el.remove();
    expect(el.held).toBe(false);
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("request() / release() コマンドは Core に委譲する", async () => {
    const el = make();
    document.body.append(el);
    await flush();
    await el.request();
    expect(el.held).toBe(true);
    el.release();
    expect(el.held).toBe(false);
  });

  it("command 経路は active 属性をミラーせず、active と held が乖離しうる", async () => {
    const el = make(); // active 属性なし
    document.body.append(el);
    await flush();

    // request コマンド相当（属性を触らず Core の desired を立てる）。
    await el.request();
    expect(el.held).toBe(true); // ロックは保持される
    expect(el.active).toBe(false); // しかし active 属性はミラーされない → 乖離

    // release コマンド相当でも同様に属性は不変。
    el.release();
    expect(el.held).toBe(false);
    expect(el.active).toBe(false);
  });

  it("error getter は Core の error を委譲する", async () => {
    wl.restore();
    const failing = installWakeLock({ reject: new Error("nope") });
    const el = make({ active: "" });
    document.body.append(el);
    await flush();
    expect(el.error).toBeInstanceOf(Error);
    expect(el.error?.message).toBe("nope");
    failing.restore();
    wl = installWakeLock();
  });

  it("wcBindable に held/error プロパティと request/release コマンドを宣言する", () => {
    const names = WcsWakeLock.wcBindable.properties.map((p) => p.name);
    expect(names).toEqual(["held", "error"]);
    const commands = WcsWakeLock.wcBindable.commands?.map((c) => c.name);
    expect(commands).toEqual(["request", "release"]);
    const inputs = WcsWakeLock.wcBindable.inputs?.map((i) => i.name);
    expect(inputs).toEqual(["active", "type", "manual"]);
  });
});
