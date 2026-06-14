import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { wireNotificationClicks } from "../src/sw.js";
import { flushMacro, installBroadcastChannel, removeBroadcastChannel } from "./mocks.js";

// In happy-dom `self` is the window; the helper attaches its notificationclick
// listener there. Register exactly once so each dispatch runs the handler once.
const scope = self as any;

beforeAll(() => {
  wireNotificationClicks();
});

afterEach(() => {
  delete scope.clients;
  removeBroadcastChannel();
});

interface DispatchOpts {
  notification?: any;
  action?: string;
  withWaitUntil?: boolean;
}

function dispatch(opts: DispatchOpts): Promise<unknown> | undefined {
  const ev = new Event("notificationclick") as any;
  ev.notification = opts.notification;
  ev.action = opts.action;
  let waited: Promise<unknown> | undefined;
  if (opts.withWaitUntil !== false) {
    ev.waitUntil = (p: Promise<unknown>) => { waited = p; };
  }
  scope.dispatchEvent(ev);
  return waited;
}

function captureBroadcast(): { messages: any[]; close: () => void } {
  // Use the deterministic fake so the helper's broadcast is delivered synchronously.
  installBroadcastChannel();
  const channel = new BroadcastChannel("wcs-notify");
  const messages: any[] = [];
  channel.addEventListener("message", (e: MessageEvent) => messages.push(e.data));
  return { messages, close: () => channel.close() };
}

describe("wireNotificationClicks", () => {
  it("click を BroadcastChannel と postMessage で中継し、その後閉じる", async () => {
    const client = { postMessage: vi.fn() };
    scope.clients = { matchAll: vi.fn(() => Promise.resolve([client])) };
    const bc = captureBroadcast();
    const notification = { tag: "t", data: { __wcsId: "t", payload: 1 }, close: vi.fn() };

    const waited = dispatch({ notification, action: "open" });
    await waited;
    await flushMacro();

    expect(notification.close).toHaveBeenCalled();
    expect(client.postMessage).toHaveBeenCalledTimes(1);
    const sent = client.postMessage.mock.calls[0][0];
    expect(sent).toMatchObject({ __wcsNotify: true, tag: "t", action: "open", data: { __wcsId: "t", payload: 1 } });
    expect(sent.id).toMatch(/^t#\d+-[a-z0-9]+$/);
    expect(bc.messages).toHaveLength(1);
    expect(bc.messages[0]).toMatchObject({ tag: "t", action: "open" });
    bc.close();
  });

  it("notification が欠けていても処理する（空 tag、data なし、close なし）", async () => {
    const client = { postMessage: vi.fn() };
    scope.clients = { matchAll: vi.fn(() => Promise.resolve([client])) };
    const waited = dispatch({ notification: undefined });
    await waited;
    expect(client.postMessage).toHaveBeenCalledTimes(1);
    expect(client.postMessage.mock.calls[0][0]).toMatchObject({ tag: "", action: "", data: undefined });
  });

  it("notification に close() メソッドがなくても throw しない", async () => {
    scope.clients = { matchAll: vi.fn(() => Promise.resolve([])) };
    const waited = dispatch({ notification: { tag: "t", data: null }, action: "" });
    await expect(waited).resolves.toBeUndefined();
  });

  it("BroadcastChannel が利用不可でも耐える（postMessage は発火する）", async () => {
    const client = { postMessage: vi.fn() };
    scope.clients = { matchAll: vi.fn(() => Promise.resolve([client])) };
    const original = (globalThis as any).BroadcastChannel;
    delete (globalThis as any).BroadcastChannel;
    try {
      const waited = dispatch({ notification: { tag: "t", close: vi.fn() } });
      await waited;
      expect(client.postMessage).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as any).BroadcastChannel = original;
    }
  });

  it("clients.matchAll の reject に耐える", async () => {
    scope.clients = { matchAll: vi.fn(() => Promise.reject(new Error("no clients"))) };
    const waited = dispatch({ notification: { tag: "t", close: vi.fn() } });
    await expect(waited).resolves.toBeUndefined();
  });

  it("イベントに waitUntil() がなくても動作する", async () => {
    const client = { postMessage: vi.fn() };
    scope.clients = { matchAll: vi.fn(() => Promise.resolve([client])) };
    dispatch({ notification: { tag: "t", close: vi.fn() }, withWaitUntil: false });
    await flushMacro();
    expect(client.postMessage).toHaveBeenCalledTimes(1);
  });

  it("2回目以降の呼び出しは no-op で listener を二重登録しない", async () => {
    // The helper was already wired once in beforeAll. A second (stray) call must
    // not register a second notificationclick listener, or each click would be
    // relayed twice with distinct ids that the page cannot de-dup.
    wireNotificationClicks();
    const client = { postMessage: vi.fn() };
    scope.clients = { matchAll: vi.fn(() => Promise.resolve([client])) };
    const waited = dispatch({ notification: { tag: "t", close: vi.fn() } });
    await waited;
    expect(client.postMessage).toHaveBeenCalledTimes(1);
  });
});
