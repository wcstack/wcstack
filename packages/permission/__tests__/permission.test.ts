import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapPermission } from "../src/bootstrapPermission";
import { setConfig } from "../src/config";
import { WcsPermission } from "../src/components/Permission";
import { installPermissions, removePermissions, flush } from "./mocks";

function createPermission(attrs: Record<string, string> = {}): WcsPermission {
  const el = document.createElement("wcs-permission") as WcsPermission;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

describe("Permission (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { permission: "wcs-permission" } });
    bootstrapPermission();
    removePermissions();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removePermissions();
  });

  it("接続時に display:none になり descriptor で query する", async () => {
    const mock = installPermissions({ state: "granted" });
    const el = createPermission({ name: "geolocation" });
    document.body.appendChild(el);

    expect(el.style.display).toBe("none");
    expect(mock.query).toHaveBeenCalledTimes(1);
    expect(mock.descriptors[0]).toEqual({ name: "geolocation" });
    await flush();
    expect(el.state).toBe("granted");
    expect(el.granted).toBe(true);
  });

  it("接続前の getter は既定値（prompt / false）を返す", () => {
    const el = createPermission({ name: "geolocation" });
    expect(el.state).toBe("prompt");
    expect(el.prompt).toBe(true);
    expect(el.granted).toBe(false);
    expect(el.denied).toBe(false);
    expect(el.unsupported).toBe(false);
  });

  it("hasConnectedCallbackPromise が true で初回 query を待てる（SSR）", async () => {
    installPermissions({ state: "denied" });
    expect(WcsPermission.hasConnectedCallbackPromise).toBe(true);
    const el = createPermission({ name: "geolocation" });
    document.body.appendChild(el);

    await el.connectedCallbackPromise;
    expect(el.state).toBe("denied");
    expect(el.denied).toBe(true);
  });

  it("user-visible-only / sysex 属性が descriptor に載る", async () => {
    const mock = installPermissions();
    const push = createPermission({ name: "push", "user-visible-only": "" });
    document.body.appendChild(push);
    await flush();
    expect(mock.descriptors[0]).toEqual({ name: "push", userVisibleOnly: true });

    const midi = createPermission({ name: "midi", sysex: "" });
    document.body.appendChild(midi);
    await flush();
    expect(mock.descriptors[1]).toEqual({ name: "midi", sysex: true });
  });

  it("属性アクセサ（name / userVisibleOnly / sysex）が属性に反映する", () => {
    const el = createPermission();
    el.name = "camera";
    expect(el.getAttribute("name")).toBe("camera");
    expect(el.name).toBe("camera");

    el.userVisibleOnly = true;
    expect(el.hasAttribute("user-visible-only")).toBe(true);
    expect(el.userVisibleOnly).toBe(true);
    el.userVisibleOnly = false;
    expect(el.hasAttribute("user-visible-only")).toBe(false);

    el.sysex = true;
    expect(el.hasAttribute("sysex")).toBe(true);
    el.sysex = false;
    expect(el.hasAttribute("sysex")).toBe(false);

    // name 未指定なら空文字
    const bare = createPermission();
    expect(bare.name).toBe("");
  });

  it("live change が要素の state に伝わる（event-token の純プロデューサ）", async () => {
    const mock = installPermissions({ state: "prompt" });
    const el = createPermission({ name: "geolocation" });
    const seen: string[] = [];
    el.addEventListener("wcs-permission:change", (e) => seen.push((e as CustomEvent).detail));
    document.body.appendChild(el);
    await flush();

    mock.statuses[0].change("granted");
    expect(el.state).toBe("granted");
    expect(seen).toEqual(["granted"]);
  });

  it("name 未指定の要素は query せず unsupported になる", async () => {
    const mock = installPermissions({ state: "granted" });
    const el = createPermission(); // name 属性なし
    document.body.appendChild(el);
    await el.connectedCallbackPromise;
    expect(el.state).toBe("unsupported");
    expect(el.unsupported).toBe(true);
    expect(mock.query).not.toHaveBeenCalled();
  });

  it("非対応環境では unsupported になる", async () => {
    removePermissions();
    const el = createPermission({ name: "geolocation" });
    document.body.appendChild(el);
    await el.connectedCallbackPromise;
    expect(el.state).toBe("unsupported");
    expect(el.unsupported).toBe(true);
  });

  it("切断で change 購読を解除し、再接続で再 query する", async () => {
    const mock = installPermissions({ state: "prompt" });
    const el = createPermission({ name: "geolocation" });
    document.body.appendChild(el);
    await flush();
    expect(mock.query).toHaveBeenCalledTimes(1);

    el.remove();
    // 切断後の change は無視される
    mock.statuses[0].change("granted");
    expect(el.state).toBe("prompt");

    document.body.appendChild(el); // reconnect → 再 query
    await flush();
    expect(mock.query).toHaveBeenCalledTimes(2);
    mock.statuses[1].change("denied");
    expect(el.state).toBe("denied");
  });
});
