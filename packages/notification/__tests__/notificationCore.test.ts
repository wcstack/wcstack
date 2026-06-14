import { describe, it, expect, afterEach, vi } from "vitest";
import { NotificationCore } from "../src/core/NotificationCore.js";
import { WcsNotifyClickDetail, WcsNotifyErrorDetail } from "../src/types.js";
import {
  FakeNotification, installNotification, removeNotification,
  installServiceWorker, removeServiceWorker,
  installPermissions, removePermissions, flush,
  installBroadcastChannel, removeBroadcastChannel,
} from "./mocks.js";

const EVENTS = [
  "wcs-notify:permission-change",
  "wcs-notify:error",
  "wcs-notify:click",
  "wcs-notify:close",
  "wcs-notify:show",
] as const;

interface Captured { type: string; detail: any }

function listen(core: NotificationCore): Captured[] {
  const events: Captured[] = [];
  for (const type of EVENTS) {
    core.addEventListener(type, (e: Event) => events.push({ type, detail: (e as CustomEvent).detail }));
  }
  return events;
}

function only(events: Captured[], type: string): Captured[] {
  return events.filter((e) => e.type === type);
}

let active: NotificationCore | null = null;
function make(): NotificationCore {
  active = new NotificationCore();
  return active;
}

afterEach(() => {
  active?.dispose();
  active = null;
  removeNotification();
  removePermissions();
  removeServiceWorker();
});

describe("permission 監視", () => {
  it("Permissions API: state を解決し、boolean を導出し、'notifications' を query する", async () => {
    installNotification();
    const perms = installPermissions({ state: "granted" });
    const core = make();
    await core.observe();
    expect(perms.descriptors[0]).toEqual({ name: "notifications" });
    expect(core.permission).toBe("granted");
    expect(core.granted).toBe(true);
    expect(core.denied).toBe(false);
    expect(core.prompt).toBe(false);
    expect(core.unsupported).toBe(false);
  });

  it("Permissions API: ライブな変更で state を再発行する", async () => {
    installNotification();
    const perms = installPermissions({ state: "prompt" });
    const core = make();
    const events = listen(core);
    await core.observe();
    expect(core.prompt).toBe(true);
    perms.statuses[0].change("granted");
    expect(core.granted).toBe(true);
    expect(only(events, "wcs-notify:permission-change").map((e) => e.detail)).toEqual(["granted"]);
  });

  it("静的フォールバック（Permissions API 不在）は Notification.permission を読み、default→prompt に正規化する", async () => {
    installNotification({ permission: "default" });
    removePermissions();
    const core = make();
    await core.observe();
    expect(core.permission).toBe("prompt");
  });

  it("静的フォールバック: granted はそのまま通る", async () => {
    installNotification({ permission: "granted" });
    removePermissions();
    const core = make();
    await core.observe();
    expect(core.granted).toBe(true);
  });

  it("Permissions API が descriptor を reject すると静的な permission にフォールバックする", async () => {
    installNotification({ permission: "denied" });
    installPermissions({ reject: true });
    const core = make();
    await core.observe();
    expect(core.denied).toBe(true);
  });

  it("Notifications API 不在 → unsupported", async () => {
    removeNotification();
    removePermissions();
    const core = make();
    await core.observe();
    expect(core.unsupported).toBe(true);
    expect(core.permission).toBe("unsupported");
  });

  it("dispose 後に resolve した query は破棄される（stale generation）", async () => {
    installNotification();
    const perms = installPermissions({ state: "granted" });
    const core = make();
    core.observe();
    core.dispose();
    await flush();
    // The stale query bailed: state stays at the default and no change listener
    // was attached, so flipping the (orphaned) status does nothing.
    expect(core.permission).toBe("prompt");
    perms.statuses[0].change("denied");
    expect(core.permission).toBe("prompt");
  });

  it("dispose 後に reject した query は破棄される（stale generation）", async () => {
    installNotification({ permission: "granted" });
    installPermissions({ reject: true });
    const core = make();
    const events = listen(core);
    core.observe();
    core.dispose();
    await flush();
    // The reject handler bailed on the stale generation: state stays default.
    expect(core.permission).toBe("prompt");
    expect(events).toHaveLength(0);
  });

  it("unsupported 環境での再購読は click を二重購読しない", async () => {
    removeNotification();
    removePermissions();
    installBroadcastChannel();
    try {
      const core = make();
      // No Notifications API: _initPermission falls to "unsupported" without
      // marking the permission subscribed, so a second observe() re-enters
      // _subscribeClicks — which must short-circuit on the second pass.
      await core.observe();
      await core.observe();
      const { FakeBroadcastChannel } = await import("./mocks.js");
      expect(FakeBroadcastChannel.instances).toHaveLength(1);
    } finally {
      removeBroadcastChannel();
    }
  });

  it("observe() は購読中は冪等で、再接続すると再 query する", async () => {
    installNotification();
    const perms = installPermissions({ state: "granted" });
    const core = make();
    await core.observe();
    await core.observe();
    expect(perms.query).toHaveBeenCalledTimes(1);
    core.dispose();
    await core.observe();
    expect(perms.query).toHaveBeenCalledTimes(2);
  });

  it("target なしで構築すると自分自身に dispatch する", async () => {
    installNotification({ permission: "granted" });
    removePermissions();
    const core = new NotificationCore();
    await core.observe();
    const events = listen(core);
    FakeNotification.requestResult = "denied";
    await core.request();
    expect(only(events, "wcs-notify:permission-change").map((e) => e.detail)).toEqual(["denied"]);
    core.dispose();
  });
});

describe("request()", () => {
  it("permission を要求して state を更新する", async () => {
    installNotification({ permission: "default" });
    removePermissions();
    const core = make();
    await core.observe();
    expect(core.prompt).toBe(true);
    FakeNotification.requestResult = "granted";
    const result = await core.request();
    expect(result).toBe("granted");
    expect(core.granted).toBe(true);
  });

  it("Notifications API がないとき 'unsupported' を返す", async () => {
    removeNotification();
    const core = make();
    expect(await core.request()).toBe("unsupported");
    expect(core.unsupported).toBe(true);
  });

  it("requestPermission が存在しないとき 'unsupported' を返す", async () => {
    Object.defineProperty(globalThis, "Notification", {
      value: function NoRequest() {},
      configurable: true,
      writable: true,
    });
    const core = make();
    expect(await core.request()).toBe("unsupported");
  });

  it("reject する requestPermission を握りつぶして現在の state を保つ", async () => {
    installNotification({ permission: "granted" });
    removePermissions();
    const core = make();
    await core.observe();
    FakeNotification.rejectRequest = true;
    expect(await core.request()).toBe("granted");
    expect(core.granted).toBe(true);
  });

  it("requestPermission からの default→prompt と unknown→prompt を正規化する", async () => {
    installNotification({ permission: "denied" });
    removePermissions();
    const core = make();
    await core.observe();
    FakeNotification.requestResult = "default";
    expect(await core.request()).toBe("prompt");
    FakeNotification.requestResult = "weird-value";
    expect(await core.request()).toBe("prompt");
  });
});

describe("notify() — constructor バックエンド", () => {
  async function granted(): Promise<NotificationCore> {
    installNotification({ permission: "granted" });
    removePermissions();
    const core = make();
    await core.observe();
    return core;
  }

  it("constructor 経由で表示し、採番された tag を返す", async () => {
    const core = await granted();
    const tag = core.notify("Hello", { body: "world" });
    expect(tag).toBe("wcs-1");
    expect(FakeNotification.instances).toHaveLength(1);
    const n = FakeNotification.instances[0];
    expect(n.title).toBe("Hello");
    expect(n.options.tag).toBe("wcs-1");
    expect(n.options.body).toBe("world");
    expect(n.options.data).toEqual({ __wcsId: "wcs-1", payload: undefined });
  });

  it("呼び出し側が指定した tag を使う", async () => {
    const core = await granted();
    expect(core.notify("Hi", { tag: "chat" })).toBe("chat");
    expect(FakeNotification.instances[0].tag).toBe("chat");
  });

  it("API が利用不可のとき error を出して '' を返す", async () => {
    const core = make();
    removeNotification();
    await core.observe();
    const events = listen(core);
    expect(core.notify("Hi")).toBe("");
    expect((only(events, "wcs-notify:error")[0].detail as WcsNotifyErrorDetail).error).toBe("unsupported");
  });

  it("permission が granted でないとき error を出して '' を返す", async () => {
    installNotification({ permission: "denied" });
    removePermissions();
    const core = make();
    await core.observe();
    const events = listen(core);
    expect(core.notify("Hi")).toBe("");
    expect((only(events, "wcs-notify:error")[0].detail as WcsNotifyErrorDetail).error).toBe("not-granted");
  });

  it("title が文字列でないとき error を出して '' を返す", async () => {
    const core = await granted();
    const events = listen(core);
    expect(core.notify(123 as unknown as string)).toBe("");
    expect(FakeNotification.instances).toHaveLength(0);
    expect((only(events, "wcs-notify:error")[0].detail as WcsNotifyErrorDetail).error).toBe("invalid-title");
  });

  it("TypeError 以外の constructor 失敗を show-failed error として表面化する", async () => {
    const core = await granted();
    FakeNotification.throwOnConstruct = new Error("boom");
    const events = listen(core);
    const tag = core.notify("Hi");
    expect(tag).toBe("wcs-1");
    expect((only(events, "wcs-notify:error")[0].detail as WcsNotifyErrorDetail).error).toBe("show-failed");
  });

  it("notification の callback から show / click / close / error を発火する", async () => {
    const core = await granted();
    const events = listen(core);
    core.notify("Hi", { tag: "t", data: { x: 1 } });
    const n = FakeNotification.instances[0];

    n.fireShow();
    n.fireClick();
    n.fireClose();
    n.fireError();

    const expected: WcsNotifyClickDetail = { tag: "t", data: { x: 1 }, action: "" };
    expect(only(events, "wcs-notify:show")[0].detail).toEqual(expected);
    expect(only(events, "wcs-notify:click")[0].detail).toEqual(expected);
    expect(core.clicked).toEqual(expected);
    expect(only(events, "wcs-notify:close")[0].detail).toEqual(expected);
    expect(core.closed).toEqual(expected);
    expect(core.shown).toEqual(expected);
    expect((only(events, "wcs-notify:error")[0].detail as WcsNotifyErrorDetail).error).toBe("show-failed");
  });

  it("dispose 後の notification callback を無視する（stale generation）", async () => {
    const core = await granted();
    core.notify("Hi", { tag: "t" });
    const n = FakeNotification.instances[0];
    core.dispose();
    const events = listen(core);
    n.fireShow();
    n.fireClick();
    n.fireClose();
    n.fireError();
    expect(events).toHaveLength(0);
  });
});

describe("notify() — バックエンド選択", () => {
  async function granted(mode: "auto" | "sw" | "constructor"): Promise<NotificationCore> {
    installNotification({ permission: "granted" });
    removePermissions();
    const core = make();
    await core.observe(mode);
    return core;
  }

  it("auto: constructor の TypeError は Service Worker にフォールバックする", async () => {
    const core = await granted("auto");
    const sw = installServiceWorker();
    FakeNotification.throwOnConstruct = new TypeError("Illegal constructor");
    core.notify("Hi", { tag: "t" });
    await flush();
    expect(sw.showNotification).toHaveBeenCalledTimes(1);
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("mode=constructor: TypeError はフォールバックせず error になる", async () => {
    const core = await granted("constructor");
    const sw = installServiceWorker();
    FakeNotification.throwOnConstruct = new TypeError("Illegal constructor");
    const events = listen(core);
    core.notify("Hi");
    await flush();
    expect(sw.showNotification).not.toHaveBeenCalled();
    expect((only(events, "wcs-notify:error")[0].detail as WcsNotifyErrorDetail).error).toBe("show-failed");
  });

  it("mode=sw: 常に Service Worker を使う", async () => {
    const core = await granted("sw");
    const sw = installServiceWorker();
    core.notify("Hi", { tag: "t" });
    await flush();
    expect(sw.showNotification).toHaveBeenCalledTimes(1);
    expect(FakeNotification.instances).toHaveLength(0);
  });
});

describe("notify() — Service Worker バックエンド", () => {
  async function swGranted(opts: { readyReject?: boolean; showReject?: boolean; getReject?: boolean } = {}): Promise<{ core: NotificationCore; sw: ReturnType<typeof installServiceWorker> }> {
    installNotification({ permission: "granted" });
    removePermissions();
    const sw = installServiceWorker(opts);
    const core = make();
    await core.observe("sw");
    return { core, sw };
  }

  it("Service Worker が利用不可のとき error になる", async () => {
    installNotification({ permission: "granted" });
    removePermissions();
    removeServiceWorker();
    const core = make();
    await core.observe("sw");
    const events = listen(core);
    core.notify("Hi");
    expect((only(events, "wcs-notify:error")[0].detail as WcsNotifyErrorDetail).error).toBe("no-service-worker");
  });

  it("showNotification が resolve した後に show を発火する", async () => {
    const { core, sw } = await swGranted();
    const events = listen(core);
    core.notify("Hi", { tag: "t", data: 5 });
    await flush();
    expect(sw.showNotification).toHaveBeenCalledWith("Hi", expect.objectContaining({ tag: "t" }));
    expect(only(events, "wcs-notify:show")[0].detail).toEqual({ tag: "t", data: 5, action: "" });
  });

  it("ServiceWorkerRegistration.ready が reject すると error になる", async () => {
    const { core } = await swGranted({ readyReject: true });
    const events = listen(core);
    core.notify("Hi");
    await flush();
    expect((only(events, "wcs-notify:error")[0].detail as WcsNotifyErrorDetail).error).toBe("show-failed");
  });

  it("showNotification が reject すると error になる", async () => {
    const { core } = await swGranted({ showReject: true });
    const events = listen(core);
    core.notify("Hi");
    await flush();
    expect((only(events, "wcs-notify:error")[0].detail as WcsNotifyErrorDetail).error).toBe("show-failed");
  });

  it("dispose 済みの要素には show/error を dispatch しない（stale generation）", async () => {
    const { core } = await swGranted();
    core.notify("Hi");
    core.dispose();
    const events = listen(core);
    await flush();
    expect(events).toHaveLength(0);
  });

  it("ready が reject しても dispose 後は error を dispatch しない（stale generation）", async () => {
    const { core } = await swGranted({ readyReject: true });
    core.notify("Hi");
    core.dispose();
    const events = listen(core);
    await flush();
    expect(events).toHaveLength(0);
  });
});

describe("close() / closeAll()", () => {
  async function granted(mode: "auto" | "sw" = "auto"): Promise<NotificationCore> {
    installNotification({ permission: "granted" });
    removePermissions();
    const core = make();
    await core.observe(mode);
    return core;
  }

  it("空または省略された tag を無視する", async () => {
    const core = await granted();
    expect(() => core.close()).not.toThrow();
    expect(() => core.close("")).not.toThrow();
  });

  it("constructor の notification を tag で閉じて忘れる", async () => {
    const core = await granted();
    core.notify("Hi", { tag: "t" });
    const n = FakeNotification.instances[0];
    core.close("t");
    expect(n.closed).toBe(true);
    // A second close is a no-op (already forgotten).
    core.close("t");
    expect(n.closed).toBe(true);
  });

  it("Service Worker の notification を tag で閉じる", async () => {
    const core = await granted("sw");
    const sw = installServiceWorker();
    // Re-observe so the Core sees the freshly-installed SW for the show call.
    core.notify("Hi", { tag: "t" });
    await flush();
    core.close("t");
    await flush();
    expect(sw.getNotifications).toHaveBeenCalledWith({ tag: "t" });
    expect(sw.notifications[0].close).toHaveBeenCalled();
  });

  it("closeAll はすべての constructor notification を閉じる", async () => {
    const core = await granted();
    core.notify("A", { tag: "a" });
    core.notify("B", { tag: "b" });
    const [a, b] = FakeNotification.instances;
    core.closeAll();
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
  });

  it("closeAll はこのインスタンスの tag に限定して Service Worker notification を閉じる", async () => {
    const core = await granted("sw");
    const sw = installServiceWorker();
    core.notify("A", { tag: "a" });
    core.notify("B", { tag: "b" });
    await flush();
    core.closeAll();
    await flush();
    // Scoped: each own tag is enumerated individually, never the whole origin.
    expect(sw.getNotifications).toHaveBeenCalledWith({ tag: "a" });
    expect(sw.getNotifications).toHaveBeenCalledWith({ tag: "b" });
    expect(sw.getNotifications).not.toHaveBeenCalledWith(undefined);
    expect(sw.notifications.every((n) => n.close.mock.calls.length > 0)).toBe(true);
  });

  it("何も表示していないとき closeAll は no-op になる", async () => {
    const core = await granted("sw");
    expect(() => core.closeAll()).not.toThrow();
  });

  it("Service Worker が消えたとき close は SW 経路をスキップする", async () => {
    const core = await granted("sw");
    installServiceWorker();
    core.notify("Hi", { tag: "t" });
    await flush();
    removeServiceWorker();
    expect(() => core.close("t")).not.toThrow();
  });

  it("close 中の getNotifications の reject を握りつぶす", async () => {
    const core = await granted("sw");
    installServiceWorker({ getReject: true });
    core.notify("Hi", { tag: "t" });
    await flush();
    expect(() => core.close("t")).not.toThrow();
    await flush();
  });
});

describe("Service Worker の click 中継", () => {
  async function swCore(): Promise<{ core: NotificationCore; sw: ReturnType<typeof installServiceWorker> }> {
    installNotification({ permission: "granted" });
    removePermissions();
    const sw = installServiceWorker();
    const core = make();
    await core.observe("sw");
    return { core, sw };
  }

  it("中継された SW message を、展開した payload を持つ click イベントに変換する", async () => {
    const { core, sw } = await swCore();
    const events = listen(core);
    sw.sw.dispatchMessage({ __wcsNotify: true, id: "t#0", tag: "t", data: { __wcsId: "t", payload: { room: 7 } }, action: "open" });
    expect(only(events, "wcs-notify:click")[0].detail).toEqual({ tag: "t", data: { room: 7 }, action: "open" });
  });

  it("無関係な message と空の message を無視する", async () => {
    const { core, sw } = await swCore();
    const events = listen(core);
    sw.sw.dispatchMessage({ foo: 1 });
    sw.sw.dispatchMessage(undefined);
    expect(only(events, "wcs-notify:click")).toHaveLength(0);
  });

  it("1 つの click の 2 つの transport（同一 id）を de-dup し、別々の click は保持する", async () => {
    const { core, sw } = await swCore();
    const events = listen(core);
    sw.sw.dispatchMessage({ __wcsNotify: true, id: "t#0", tag: "t", data: null, action: "" });
    sw.sw.dispatchMessage({ __wcsNotify: true, id: "t#0", tag: "t", data: null, action: "" });
    sw.sw.dispatchMessage({ __wcsNotify: true, id: "t#1", tag: "t", data: null, action: "" });
    expect(only(events, "wcs-notify:click")).toHaveLength(2);
  });

  it("プリミティブ（ラップされていない）payload はそのまま展開する", async () => {
    const { core, sw } = await swCore();
    const events = listen(core);
    sw.sw.dispatchMessage({ __wcsNotify: true, id: "t#0", tag: "t", data: "raw", action: "" });
    expect(only(events, "wcs-notify:click")[0].detail.data).toBe("raw");
  });

  // The BroadcastChannel receive path is covered by "_subscribeClicks transport
  // availability > works without a Service Worker"; the sync SW-message path above
  // exercises _onInbound itself.

  it("長時間セッションでリークしないよう de-dup セットに上限を設ける", async () => {
    const { core, sw } = await swCore();
    const events = listen(core);
    for (let i = 0; i <= 50; i++) {
      sw.sw.dispatchMessage({ __wcsNotify: true, id: `e#${i}`, tag: "t", data: null, action: "" });
    }
    // id e#0 was evicted by the FIFO cap, so re-delivering it is treated as new.
    sw.sw.dispatchMessage({ __wcsNotify: true, id: "e#0", tag: "t", data: null, action: "" });
    expect(only(events, "wcs-notify:click")).toHaveLength(52);
  });
});

describe("_subscribeClicks の transport 可用性", () => {
  it("BroadcastChannel がない（削除済み）でも SW message 経路で動作する", async () => {
    installNotification({ permission: "granted" });
    removePermissions();
    const sw = installServiceWorker();
    const original = (globalThis as any).BroadcastChannel;
    delete (globalThis as any).BroadcastChannel;
    try {
      const core = make();
      await core.observe("sw");
      const events = listen(core);
      sw.sw.dispatchMessage({ __wcsNotify: true, id: "t#0", tag: "t", data: null, action: "" });
      expect(only(events, "wcs-notify:click")).toHaveLength(1);
    } finally {
      (globalThis as any).BroadcastChannel = original;
    }
  });

  it("Service Worker がなくても（BroadcastChannel のみで）動作する", async () => {
    installNotification({ permission: "granted" });
    removePermissions();
    removeServiceWorker();
    installBroadcastChannel();
    try {
      const core = make();
      await core.observe();
      const events = listen(core);
      // Post from a sibling channel; the fake delivers synchronously to the Core's.
      const sibling = new BroadcastChannel("wcs-notify");
      sibling.postMessage({ __wcsNotify: true, id: "b#0", tag: "t", data: null, action: "" });
      expect(only(events, "wcs-notify:click")).toHaveLength(1);
    } finally {
      removeBroadcastChannel();
    }
  });
});

describe("dispose()", () => {
  it("すべての購読（Permissions API + channel + SW）を破棄する", async () => {
    installNotification({ permission: "granted" });
    const perms = installPermissions({ state: "granted" });
    const sw = installServiceWorker();
    const core = make();
    await core.observe("sw");
    core.dispose();
    const events = listen(core);
    // Permission change ignored (listener removed).
    perms.statuses[0].change("denied");
    // SW message ignored (listener removed).
    sw.sw.dispatchMessage({ __wcsNotify: true, id: "t#0", tag: "t", data: null, action: "" });
    expect(events).toHaveLength(0);
  });

  it("何も購読していなくても安全（静的 permission、channel なし、SW なし）", async () => {
    installNotification({ permission: "granted" });
    removePermissions();
    removeServiceWorker();
    const original = (globalThis as any).BroadcastChannel;
    delete (globalThis as any).BroadcastChannel;
    try {
      const core = make();
      await core.observe();
      expect(() => core.dispose()).not.toThrow();
    } finally {
      (globalThis as any).BroadcastChannel = original;
    }
  });
});

describe("初期の observable サーフェス", () => {
  it("error/clicked/closed/shown が null で始まり、ready は resolve 済み", async () => {
    const core = make();
    expect(core.error).toBeNull();
    expect(core.clicked).toBeNull();
    expect(core.closed).toBeNull();
    expect(core.shown).toBeNull();
    await expect(core.ready).resolves.toBeUndefined();
  });

  it("command と event-token のサーフェスを持つ wc-bindable マニフェストを公開する", () => {
    const names = NotificationCore.wcBindable.commands!.map((c) => c.name);
    expect(names).toEqual(["request", "notify", "close", "closeAll"]);
    const props = NotificationCore.wcBindable.properties.map((p) => p.name);
    expect(props).toContain("clicked");
    expect(props).toContain("permission");
    const get = (name: string): ((e: Event) => any) =>
      NotificationCore.wcBindable.properties.find((p) => p.name === name)!.getter!;
    // The derived-boolean getters each extract from the permission-change event.
    for (const state of ["granted", "denied", "prompt", "unsupported"]) {
      expect(get(state)(new CustomEvent("x", { detail: state }))).toBe(true);
      expect(get(state)(new CustomEvent("x", { detail: "other" }))).toBe(false);
    }
    // The event-token getters pass the detail through verbatim.
    for (const name of ["clicked", "closed", "shown"]) {
      expect(get(name)(new CustomEvent("x", { detail: { tag: name } }))).toEqual({ tag: name });
    }
    vi.clearAllMocks();
  });
});
